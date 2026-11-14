"""Local multi-device HTTP server and centralized JSON sync API for GlowHub & BentoClub."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import socket
import threading
from typing import Any
from urllib.parse import urlparse

ROOT_DIR = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT_DIR / 'data' / 'seed-data.json'
DB_PATH = ROOT_DIR / 'data' / 'local-server-db.json'
DB_LOCK = threading.Lock()


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def load_seed_products() -> list[dict[str, Any]]:
    """Load canonical initial products from data/seed-data.json."""
    if not SEED_PATH.is_file():
        return []
    seed = json.loads(SEED_PATH.read_text(encoding='utf-8'))
    return seed.get('products', [])


def load_server_db() -> dict[str, Any]:
    """Read persisted local server database or return an empty structure."""
    if not DB_PATH.is_file():
        return {
            'sales': [],
            'clients': {},
            'stockAdjustments': [],
            'cashClosings': {},
            'updatedAt': None,
        }
    try:
        data = json.loads(DB_PATH.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            raise ValueError('Invalid DB root')
        return {
            'sales': data.get('sales') if isinstance(data.get('sales'), list) else [],
            'clients': data.get('clients') if isinstance(data.get('clients'), dict) else {},
            'stockAdjustments': (
                data.get('stockAdjustments') if isinstance(data.get('stockAdjustments'), list) else []
            ),
            'cashClosings': data.get('cashClosings') if isinstance(data.get('cashClosings'), dict) else {},
            'updatedAt': data.get('updatedAt'),
        }
    except (ValueError, OSError):
        return {
            'sales': [],
            'clients': {},
            'stockAdjustments': [],
            'cashClosings': {},
            'updatedAt': None,
        }


def save_server_db(db: dict[str, Any]) -> None:
    """Atomically write the local server database JSON file."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = DB_PATH.with_suffix('.json.tmp')
    tmp_path.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp_path.replace(DB_PATH)


def compute_reconciled_stock(
    seed_products: list[dict[str, Any]],
    sales: list[dict[str, Any]],
    stock_adjustments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Recompute non-negative Glow Hub stock levels from initial stock, adjustments, and sales."""
    sold_by_id: dict[str, int] = {}
    for sale in sales:
        for item in sale.get('items', []) or []:
            if item.get('segment') == 'glow_hub' and item.get('itemId'):
                pid = str(item['itemId'])
                sold_by_id[pid] = sold_by_id.get(pid, 0) + int(item.get('qty') or 0)

    adj_by_id: dict[str, int] = {}
    for adj in stock_adjustments:
        pid = adj.get('productId')
        if pid:
            key = str(pid)
            adj_by_id[key] = adj_by_id.get(key, 0) + int(adj.get('adjustmentQty') or 0)

    snapshot: list[dict[str, Any]] = []
    for prod in seed_products:
        pid = str(prod.get('id', ''))
        init_stock = int(prod.get('initialStock', prod.get('stock', 0)) or 0)
        computed = max(0, init_stock + adj_by_id.get(pid, 0) - sold_by_id.get(pid, 0))
        snapshot.append({
            'id': pid,
            'brand': prod.get('brand', ''),
            'name': prod.get('name', ''),
            'stock': computed,
        })
    return snapshot


def build_sync_response(db: dict[str, Any], seed_products: list[dict[str, Any]], **counts: int) -> dict[str, Any]:
    """Assemble standardized JSON payload compatible with PDVStorage.syncWithGoogleSheets."""
    sales = db.get('sales', [])
    adjustments = db.get('stockAdjustments', [])
    clients_dict = db.get('clients', {})
    return {
        'ok': True,
        'authorized': True,
        'mode': 'local_pc_server',
        'updatedAt': db.get('updatedAt'),
        'syncedSales': counts.get('syncedSales', 0),
        'syncedClients': counts.get('syncedClients', 0),
        'syncedAdjustments': counts.get('syncedAdjustments', 0),
        'remoteSales': sales,
        'remoteClients': list(clients_dict.values()),
        'remoteStockAdjustments': adjustments,
        'remoteCashClosings': db.get('cashClosings', {}),
        'remoteStock': compute_reconciled_stock(seed_products, sales, adjustments),
    }


def merge_sync_payload(payload: dict[str, Any], seed_products: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge incoming SYNC_BATCH payload idempotently into data/local-server-db.json."""
    now_iso = utc_now_iso()
    with DB_LOCK:
        db = load_server_db()

        # 1. Sales (deduplicated by id, newest first)
        sales_by_id = {str(s['id']): s for s in db['sales'] if isinstance(s, dict) and s.get('id')}
        new_sales_count = 0
        for sale in payload.get('sales') or []:
            if not isinstance(sale, dict) or not sale.get('id'):
                continue
            sid = str(sale['id'])
            normalized = dict(sale)
            normalized['syncStatus'] = 'synced'
            normalized.setdefault('syncedAt', now_iso)
            if sid not in sales_by_id:
                new_sales_count += 1
            sales_by_id[sid] = normalized
        merged_sales = sorted(
            sales_by_id.values(),
            key=lambda s: str(s.get('createdAt') or ''),
            reverse=True,
        )

        # 2. Stock Adjustments (direct + nested inside sales)
        adj_by_id = {
            str(a['id']): a
            for a in db['stockAdjustments']
            if isinstance(a, dict) and a.get('id')
        }
        incoming_adjs = list(payload.get('stockAdjustments') or [])
        for sale in payload.get('sales') or []:
            if isinstance(sale, dict) and isinstance(sale.get('stockAdjustments'), list):
                incoming_adjs.extend(sale['stockAdjustments'])
        new_adj_count = 0
        for adj in incoming_adjs:
            if not isinstance(adj, dict) or not adj.get('id'):
                continue
            aid = str(adj['id'])
            if aid not in adj_by_id:
                new_adj_count += 1
                adj_by_id[aid] = dict(adj)
        merged_adjs = sorted(
            adj_by_id.values(),
            key=lambda a: str(a.get('createdAt') or ''),
            reverse=True,
        )

        # 3. Clients (upsert preferring filled phone and newer updatedAt)
        clients_by_id: dict[str, dict[str, Any]] = dict(db['clients'])
        synced_clients_count = 0
        for client in payload.get('clients') or []:
            if not isinstance(client, dict) or not client.get('id'):
                continue
            cid = str(client['id'])
            existing = clients_by_id.get(cid)
            incoming = dict(client)
            incoming['syncStatus'] = 'synced'
            incoming.setdefault('syncedAt', now_iso)
            if not existing:
                clients_by_id[cid] = incoming
                synced_clients_count += 1
            else:
                ex_phone = str(existing.get('phone') or '').strip()
                in_phone = str(incoming.get('phone') or '').strip()
                if (not ex_phone and bool(in_phone)) or (
                    str(incoming.get('updatedAt') or '') >= str(existing.get('updatedAt') or '')
                ):
                    merged_cli = dict(existing)
                    merged_cli.update(incoming)
                    merged_cli['phone'] = in_phone or ex_phone
                    merged_cli['hasValidPhone'] = bool(merged_cli['phone'])
                    clients_by_id[cid] = merged_cli
                    synced_clients_count += 1

        # 4. Cash Closings (upsert by dateKey keeping newest updatedAt)
        closings = dict(db['cashClosings'])
        incoming_closings = payload.get('cashClosings') or {}
        if isinstance(incoming_closings, dict):
            for date_key, entry in incoming_closings.items():
                if not isinstance(entry, dict):
                    continue
                existing_closing = closings.get(date_key)
                if not existing_closing or (
                    str(entry.get('updatedAt') or '') >= str(existing_closing.get('updatedAt') or '')
                ):
                    closings[str(date_key)] = dict(entry)

        db['sales'] = merged_sales
        db['stockAdjustments'] = merged_adjs
        db['clients'] = clients_by_id
        db['cashClosings'] = closings
        db['updatedAt'] = now_iso
        save_server_db(db)

        return build_sync_response(
            db,
            seed_products,
            syncedSales=new_sales_count,
            syncedClients=synced_clients_count,
            syncedAdjustments=new_adj_count,
        )


class PDVRequestHandler(SimpleHTTPRequestHandler):
    """Serve static PWA assets alongside JSON sync endpoints on the local network."""

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.webmanifest': 'application/manifest+json; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
    }

    def end_headers(self) -> None:
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def _send_json(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in ('/api/sync', '/api/status'):
            with DB_LOCK:
                db = load_server_db()
            seed_products = load_seed_products()
            self._send_json(HTTPStatus.OK, build_sync_response(db, seed_products))
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != '/api/sync':
            self._send_json(HTTPStatus.NOT_FOUND, {'ok': False, 'error': 'Endpoint not found'})
            return

        content_length = int(self.headers.get('Content-Length') or 0)
        raw_body = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            payload = json.loads(raw_body.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            self._send_json(HTTPStatus.BAD_REQUEST, {'ok': False, 'error': 'Invalid JSON payload'})
            return

        if not isinstance(payload, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {'ok': False, 'error': 'JSON body must be an object'})
            return

        action = str(payload.get('action') or 'SYNC_BATCH').upper()
        if action == 'VERIFY_TOKEN':
            self._send_json(HTTPStatus.OK, {'ok': True, 'authorized': True, 'mode': 'local_pc_server'})
            return

        seed_products = load_seed_products()
        response = merge_sync_payload(payload, seed_products)
        self._send_json(HTTPStatus.OK, response)

    def handle(self) -> None:
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass


def detect_lan_ips() -> list[str]:
    """Return likely LAN IPv4 addresses so tablets and phones on Wi-Fi can connect."""
    ips: list[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(('8.8.8.8', 80))
            primary = sock.getsockname()[0]
            if primary and not primary.startswith('127.'):
                ips.append(primary)
    except OSError:
        pass

    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip and not ip.startswith('127.') and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


def create_server(host: str = '0.0.0.0', port: int = 8080) -> ThreadingHTTPServer:
    """Instantiate a reusable multi-threaded HTTP server bound to the project root."""
    handler_cls = partial(PDVRequestHandler, directory=str(ROOT_DIR))
    ThreadingHTTPServer.allow_reuse_address = True
    return ThreadingHTTPServer((host, port), handler_cls)


def main() -> int:
    parser = argparse.ArgumentParser(description='Servidor Local PDV GlowHub & BentoClub')
    parser.add_argument('--host', default='0.0.0.0', help='Interface de rede (padrao: 0.0.0.0)')
    parser.add_argument('--port', type=int, default=8080, help='Porta HTTP (padrao: 8080)')
    args = parser.parse_args()

    server = create_server(args.host, args.port)
    lan_ips = detect_lan_ips()
    print(f'GlowHub & BentoClub Server ativo em http://localhost:{args.port}/', flush=True)
    for ip in lan_ips:
        print(f'Acesso na rede Wi-Fi (Tablets/Smartphones): http://{ip}:{args.port}/', flush=True)
    print(f'Banco compartilhado local: {DB_PATH}', flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
