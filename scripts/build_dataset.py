#!/usr/bin/env python3
"""Extract and sanitize official Excel spreadsheets from 'Base de Apoio/' into data/seed-data.{json,js}."""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from pdv_engine import (  # noqa: E402
    CANONICAL_CLUBS_ORDER,
    VALID_PAYMENT_METHODS,
    classify_user_admin,
    clean_display_text,
    is_excluded_anomaly_product,
    is_valid_phone,
    normalize_phone,
    normalize_text,
    resolve_club_group_and_validity,
    to_cents,
)

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def read_xlsx_sheet(path: Path, sheet_index: int = 1) -> list[list[str]]:
    """Read an .xlsx worksheet using only the Python standard library."""
    with zipfile.ZipFile(path) as zf:
        shared: list[str] = []
        if 'xl/sharedStrings.xml' in zf.namelist():
            root = ET.fromstring(zf.read('xl/sharedStrings.xml'))
            for si in root.findall('m:si', NS):
                texts = [
                    t.text or ''
                    for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                ]
                shared.append(''.join(texts))

        sname = f'xl/worksheets/sheet{sheet_index}.xml'
        ws = ET.fromstring(zf.read(sname))
        rows: list[list[str]] = []
        for row in ws.findall('.//m:sheetData/m:row', NS):
            rdict: dict[int, str] = {}
            max_col = 0
            for c in row.findall('m:c', NS):
                ref = c.attrib.get('r', 'A1')
                col_letters = re.match(r'[A-Z]+', ref).group(0)
                col_idx = 0
                for ch in col_letters:
                    col_idx = col_idx * 26 + (ord(ch) - 64)
                max_col = max(max_col, col_idx)
                ctype = c.attrib.get('t')
                v = c.find('m:v', NS)
                is_el = c.find('m:is', NS)
                val = ''
                if ctype == 's' and v is not None and v.text is not None:
                    val = shared[int(v.text)]
                elif ctype == 'inlineStr' and is_el is not None:
                    val = ''.join(
                        t.text or ''
                        for t in is_el.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                    )
                elif v is not None and v.text is not None:
                    val = v.text
                rdict[col_idx] = val
            rows.append([rdict.get(i, '') for i in range(1, max_col + 1)])
        return rows


def _find_support_file(base_dir: Path, prefix: str) -> Path:
    for item in sorted(base_dir.iterdir()):
        if normalize_text(item.name).startswith(normalize_text(prefix)) and item.suffix.lower() == '.xlsx':
            return item
    raise FileNotFoundError(f'Planilha não encontrada para prefixo: {prefix}')


def build_seed_dataset(base_dir: Path) -> dict:
    users_path = _find_support_file(base_dir, 'Cadastro de Usu')
    products_path = _find_support_file(base_dir, 'GlowHUB_Cadastro_Produtos')
    catalog_ref_path = _find_support_file(base_dir, 'CatatalogoGlowHUB')
    clubs_path = _find_support_file(base_dir, 'Cadastro de Clubes')
    clients_path = _find_support_file(base_dir, 'Cadastro Clientes')

    # 1. Users (12 users)
    user_rows = read_xlsx_sheet(users_path, 1)[1:]
    users = []
    for idx, r in enumerate(user_rows, 1):
        full_name = clean_display_text(r[0] if len(r) > 0 else '')
        if not full_name:
            continue
        email = clean_display_text(r[1] if len(r) > 1 else '').lower()
        role = clean_display_text(r[2] if len(r) > 2 else '')
        short_name = clean_display_text(r[3] if len(r) > 3 else '') or full_name.split()[0]
        users.append({
            'id': f'usr-{idx:02d}',
            'name': full_name,
            'shortName': short_name,
            'email': email,
            'role': role,
            'isAdmin': classify_user_admin(role),
        })

    # Reference regular prices from CatatalogoGlowHUB.xlsx
    ref_rows = read_xlsx_sheet(catalog_ref_path, 1)[1:]
    regular_prices: dict[str, int] = {}
    for r in ref_rows:
        if len(r) >= 7 and r[0] and r[6]:
            key = normalize_text(r[0])
            try:
                cents = to_cents(r[6])
                if cents > 0:
                    regular_prices[key] = cents
            except ValueError:
                pass

    # 2. Glow Hub Products (254 active after excluding 3 items of R$ 0,08)
    prod_rows = read_xlsx_sheet(products_path, 1)[1:]
    products = []
    excluded_products = []
    for idx, r in enumerate(prod_rows, 1):
        brand = clean_display_text(r[0] if len(r) > 0 else '')
        name = clean_display_text(r[1] if len(r) > 1 else '')
        if not brand or not name:
            continue
        price_cents = to_cents(r[2] if len(r) > 2 and r[2] else 0)
        stock = int(round(float(r[11] if len(r) > 11 and r[11] else 0)))
        if is_excluded_anomaly_product(name, price_cents):
            excluded_products.append({'row': idx + 1, 'brand': brand, 'name': name, 'priceCents': price_cents})
            continue

        family = clean_display_text(r[3] if len(r) > 3 else '')
        line = clean_display_text(r[4] if len(r) > 4 else '')
        category = clean_display_text(r[5] if len(r) > 5 else '')
        presentation = clean_display_text(r[6] if len(r) > 6 else '')
        need_group = clean_display_text(r[7] if len(r) > 7 else '')
        benefit = clean_display_text(r[8] if len(r) > 8 else '')
        content_val = clean_display_text(r[9] if len(r) > 9 else '')
        content_unit = clean_display_text(r[10] if len(r) > 10 else '')
        search_terms = clean_display_text(r[12] if len(r) > 12 else '')
        source_url = clean_display_text(r[13] if len(r) > 13 else '')

        norm_key = normalize_text(name)
        reg_cents = regular_prices.get(norm_key, 0)
        if reg_cents <= price_cents:
            reg_cents = int(round(price_cents / 0.8))

        size_label = f'{content_val} {content_unit}'.strip() if content_val else ''
        search_index = normalize_text(
            f'{brand} {name} {family} {line} {category} {presentation} {need_group} {benefit} {size_label} {search_terms}'
        )
        products.append({
            'id': f'prd-{len(products) + 1:03d}',
            'segment': 'glow_hub',
            'brand': brand,
            'name': name,
            'priceCents': price_cents,
            'regularPriceCents': reg_cents,
            'family': family,
            'line': line,
            'category': category,
            'presentation': presentation,
            'needGroup': need_group,
            'benefit': benefit,
            'sizeLabel': size_label,
            'initialStock': stock,
            'stock': stock,
            'sourceUrl': source_url,
            'searchIndex': search_index,
        })

    # 3. BentoClub Subscriptions (31 options across 6 clubs)
    club_rows = read_xlsx_sheet(clubs_path, 1)[1:]
    clubs = []
    for idx, r in enumerate(club_rows, 1):
        raw_club = clean_display_text(r[0] if len(r) > 0 else '')
        option = clean_display_text(r[1] if len(r) > 1 else '')
        size = clean_display_text(r[2] if len(r) > 2 else '')
        if not raw_club or not option:
            continue
        sessions = int(round(float(r[3] if len(r) > 3 and r[3] else 1)))
        price_cents = to_cents(r[4] if len(r) > 4 and r[4] else 0)
        ui_club, validity = resolve_club_group_and_validity(raw_club, sessions)
        sub_category = raw_club if raw_club != ui_club else ''

        size_clean = '' if size in ('N/A', 'NA', '-') else size
        title_parts = [p for p in (sub_category, option, size_clean) if p]
        display_title = ' • '.join(title_parts)
        full_name = f'{ui_club} — {display_title} ({sessions} sessões)'
        search_index = normalize_text(f'{ui_club} {raw_club} {option} {size_clean} {sessions} sessoes {validity}')

        clubs.append({
            'id': f'clb-{idx:02d}',
            'segment': 'bento_club',
            'club': ui_club,
            'originalClub': raw_club,
            'option': option,
            'size': size_clean,
            'sessions': sessions,
            'validity': validity,
            'priceCents': price_cents,
            'displayTitle': display_title,
            'name': full_name,
            'searchIndex': search_index,
        })

    # 4. Clients (1721 unique clients from 1727 rows)
    client_rows = read_xlsx_sheet(clients_path, 1)[1:]
    clients = []
    seen_clients: set[tuple[str, str]] = set()
    for r in client_rows:
        cname = clean_display_text(r[0] if len(r) > 0 else '')
        if not cname:
            continue
        cphone = normalize_phone(r[1] if len(r) > 1 else '')
        dedup_key = (normalize_text(cname), cphone)
        if dedup_key in seen_clients:
            continue
        seen_clients.add(dedup_key)
        clients.append({
            'id': f'cli-{len(clients) + 1:04d}',
            'name': cname,
            'phone': cphone,
            'hasValidPhone': is_valid_phone(cphone),
            'searchIndex': f'{normalize_text(cname)} {cphone}'.strip(),
        })

    brands_meta = [
        {'id': 'Davines', 'name': 'Davines', 'logo': 'assets/davines-logo.png', 'count': sum(1 for p in products if p['brand'] == 'Davines')},
        {'id': 'Keune', 'name': 'Keune', 'logo': 'assets/keune-logo.png', 'count': sum(1 for p in products if p['brand'] == 'Keune')},
        {'id': 'Kérastase', 'name': 'Kérastase', 'logo': 'assets/kerastase-logo.jpg', 'count': sum(1 for p in products if p['brand'] == 'Kérastase')},
    ]

    clubs_meta = [
        {
            'id': c_name,
            'name': c_name,
            'subtitle': 'Inclui Manutenção de Alongamento' if c_name == 'Clube da Esmaltação em Gel' else 'Assinatura BentoClub',
            'count': sum(1 for c in clubs if c['club'] == c_name),
        }
        for c_name in CANONICAL_CLUBS_ORDER
    ]

    return {
        'version': '1.0.0',
        'palette': {
            'verdeEscuro': '#1D6452',
            'verdeClaro': '#81B6A2',
            'begeClaro': '#EADACE',
            'caramelo': '#C49875',
            'marromTerra': '#6A4228',
        },
        'paymentMethods': list(VALID_PAYMENT_METHODS),
        'brandsMeta': brands_meta,
        'clubsMeta': clubs_meta,
        'users': users,
        'products': products,
        'excludedAnomalyProducts': excluded_products,
        'clubs': clubs,
        'clients': clients,
    }


def main() -> int:
    base_dir = ROOT_DIR / 'Base de Apoio'
    data_dir = ROOT_DIR / 'data'
    data_dir.mkdir(parents=True, exist_ok=True)
    dataset = build_seed_dataset(base_dir)

    json_path = data_dir / 'seed-data.json'
    js_path = data_dir / 'seed-data.js'

    serialized = json.dumps(dataset, ensure_ascii=False, indent=2)
    json_path.write_text(serialized + '\n', encoding='utf-8')
    js_path.write_text(
        '/* Auto-generated by scripts/build_dataset.py — DO NOT EDIT MANUALLY */\n'
        f'globalThis.PDV_SEED_DATA = {serialized};\n',
        encoding='utf-8',
    )
    print(json.dumps({
        'users': len(dataset['users']),
        'admins': [u['shortName'] for u in dataset['users'] if u['isAdmin']],
        'products_active': len(dataset['products']),
        'products_excluded': len(dataset['excludedAnomalyProducts']),
        'brands': dataset['brandsMeta'],
        'clubs_options': len(dataset['clubs']),
        'clubs_groups': len(dataset['clubsMeta']),
        'clients_unique': len(dataset['clients']),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
