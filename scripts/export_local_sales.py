"""Export local-server-db.json sales cleanly to production seed & backup JSON."""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = ROOT_DIR / 'data' / 'local-server-db.json'
DEFAULT_SEED_PATH = ROOT_DIR / 'data' / 'seed-data.json'
DEFAULT_JS_OUT = ROOT_DIR / 'data' / 'migrated-sales.js'
DEFAULT_BACKUP_OUT = ROOT_DIR / 'dist' / 'backup-vendas-locais-2026-11-14.json'


def normalize_exported_sales(raw_sales: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return migrated sales sorted newest-first with syncStatus set to pending for Sheets."""
    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for sale in raw_sales:
        sale_id = str(sale.get('id') or '').strip()
        if not sale_id or sale_id in seen_ids:
            continue
        seen_ids.add(sale_id)
        item = deepcopy(sale)
        item['syncStatus'] = 'pending'
        item.pop('syncedAt', None)
        normalized.append(item)

    normalized.sort(key=lambda s: str(s.get('createdAt') or ''), reverse=True)
    return normalized


def filter_modified_clients(
    raw_clients: list[dict[str, Any]],
    seed_clients: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep only new clients or clients with phone/name changes relative to canonical seed."""
    seed_by_id = {c['id']: c for c in seed_clients if c.get('id')}
    out: list[dict[str, Any]] = []
    for client in raw_clients:
        cid = client.get('id')
        if not cid:
            continue
        base = seed_by_id.get(cid)
        if not base or client.get('phone') != base.get('phone') or client.get('name') != base.get('name'):
            c_copy = deepcopy(client)
            c_copy['syncStatus'] = 'pending'
            c_copy.pop('syncedAt', None)
            out.append(c_copy)
    return out


def compute_reconciled_products(
    seed_products: list[dict[str, Any]],
    sales: list[dict[str, Any]],
    adjustments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Recompute product stock from canonical seed stock + adjustments - sold units."""
    sold_by_id: dict[str, int] = {}
    for sale in sales:
        for item in sale.get('items') or []:
            if item.get('segment') == 'glow_hub' and item.get('itemId'):
                pid = item['itemId']
                sold_by_id[pid] = sold_by_id.get(pid, 0) + int(item.get('qty') or 0)

    adjusted_by_id: dict[str, int] = {}
    for adj in adjustments:
        pid = adj.get('productId')
        if pid:
            adjusted_by_id[pid] = adjusted_by_id.get(pid, 0) + int(adj.get('adjustmentQty') or 0)

    reconciled: list[dict[str, Any]] = []
    for prod in seed_products:
        p_copy = deepcopy(prod)
        initial_stock = int(prod.get('initialStock', prod.get('stock', 0)))
        pid = prod['id']
        remaining = max(0, initial_stock + adjusted_by_id.get(pid, 0) - sold_by_id.get(pid, 0))
        p_copy['initialStock'] = initial_stock
        p_copy['stock'] = remaining
        reconciled.append(p_copy)
    return reconciled


def export_local_sales(
    db_path: Path = DEFAULT_DB_PATH,
    seed_path: Path = DEFAULT_SEED_PATH,
    js_out: Path = DEFAULT_JS_OUT,
    backup_out: Path | None = DEFAULT_BACKUP_OUT,
) -> dict[str, Any]:
    """Validate and export local server sales to production JS seed and backup JSON."""
    local_db = json.loads(db_path.read_text(encoding='utf-8'))
    seed_data = json.loads(seed_path.read_text(encoding='utf-8'))

    seed_prod_ids = {p['id'] for p in seed_data.get('products') or []}
    seed_club_ids = {c['id'] for c in seed_data.get('clubs') or []}

    sales = normalize_exported_sales(local_db.get('sales') or [])
    adjustments = list(local_db.get('stockAdjustments') or [])
    cash_closings = dict(local_db.get('cashClosings') or {})
    clients = filter_modified_clients(local_db.get('clients') or [], seed_data.get('clients') or [])

    for sale in sales:
        for item in sale.get('items') or []:
            seg = item.get('segment')
            iid = item.get('itemId')
            valid_pool = seed_prod_ids if seg == 'glow_hub' else seed_club_ids
            if iid not in valid_pool:
                raise ValueError(f'Unknown {seg} itemId in sale {sale["id"]}: {iid}')

    reconciled_products = compute_reconciled_products(
        seed_data.get('products') or [],
        sales,
        adjustments,
    )

    exported_at = local_db.get('updatedAt') or datetime.now(timezone.utc).isoformat()
    total_cents = sum(int(s.get('totalCents') or 0) for s in sales)

    migration_payload = {
        'schema': 'bento_glow_pdv_migration_v1',
        'sourceUpdatedAt': exported_at,
        'salesCount': len(sales),
        'totalCents': total_cents,
        'clientsCount': len(clients),
        'sales': sales,
        'clients': clients,
        'stockAdjustments': adjustments,
        'cashClosings': cash_closings,
    }

    js_out.parent.mkdir(parents=True, exist_ok=True)
    js_body = (
        '/* Auto-generated by scripts/export_local_sales.py — DO NOT EDIT MANUALLY */\n'
        'globalThis.PDV_MIGRATED_DATA = '
        + json.dumps(migration_payload, ensure_ascii=False, indent=2)
        + ';\n'
    )
    js_out.write_text(js_body, encoding='utf-8')

    if backup_out is not None:
        backup_out.parent.mkdir(parents=True, exist_ok=True)
        backup_payload = {
            'schema': 'bento_glow_pdv_backup_v1',
            'exportedAt': exported_at,
            'salesCount': len(sales),
            'clientsCount': len(clients),
            'state': {
                'sales': sales,
                'clients': clients,
                'stockAdjustments': adjustments,
                'cashClosings': cash_closings,
                'products': [
                    {'id': p['id'], 'initialStock': p['initialStock'], 'stock': p['stock']}
                    for p in reconciled_products
                ],
                'lastSyncedAt': None,
            },
        }
        backup_out.write_text(
            json.dumps(backup_payload, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )

    return {
        'ok': True,
        'salesCount': len(sales),
        'totalCents': total_cents,
        'clientsCount': len(clients),
        'stockAdjustmentsCount': len(adjustments),
        'cashClosingsCount': len(cash_closings),
        'jsOut': str(js_out),
        'backupOut': str(backup_out) if backup_out else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Export local PDV sales for production deploy.')
    parser.add_argument('--db', type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument('--seed', type=Path, default=DEFAULT_SEED_PATH)
    parser.add_argument('--js-out', type=Path, default=DEFAULT_JS_OUT)
    parser.add_argument('--backup-out', type=Path, default=DEFAULT_BACKUP_OUT)
    args = parser.parse_args()

    result = export_local_sales(args.db, args.seed, args.js_out, args.backup_out)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
