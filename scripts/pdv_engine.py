#!/usr/bin/env python3
"""Core domain and data sanitization engine for PDV Glow Hub & BentoClub."""
from __future__ import annotations

import re
import unicodedata

VALID_PAYMENT_METHODS = (
    'PIX',
    'Dinheiro',
    'Cartão de Crédito',
    'Cartão de Débito',
    'Transferência Bancária',
)

CANONICAL_CLUBS_ORDER = (
    'Clube da Escova',
    'Clube da Unha Clássica',
    'Clube da Esmaltação em Gel',
    'Clube da Massagem',
    'Clube da Maquiagem',
    'Clube da Cor',
)


def clean_display_text(value: str) -> str:
    """Sanitize raw spreadsheet text, removing NBSP and fixing known typos."""
    cleaned = str(value).replace('\xa0', ' ').strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)
    if cleaned == 'Manincure':
        return 'Manicure'
    return cleaned


def normalize_text(value: str) -> str:
    """Normalize text to accent-free lowercase for instant search."""
    base = clean_display_text(value).lower()
    decomposed = unicodedata.normalize('NFD', base)
    return ''.join(ch for ch in decomposed if unicodedata.category(ch) != 'Mn')


def normalize_phone(raw_phone: str) -> str:
    """Extract digits from phone number; treat '0' as empty."""
    digits = re.sub(r'\D', '', str(raw_phone))
    if digits == '0':
        return ''
    return digits


def is_valid_phone(raw_phone: str) -> bool:
    """Verify Brazilian mobile/landline phone length (10 or 11 digits)."""
    digits = normalize_phone(raw_phone)
    return len(digits) == 10 or len(digits) == 11


def to_cents(raw_price: float | int | str) -> int:
    """Convert decimal BRL price into exact integer cents."""
    if isinstance(raw_price, str):
        sanitized = raw_price.replace('R$', '').replace('\xa0', '').strip()
        if ',' in sanitized:
            sanitized = sanitized.replace('.', '').replace(',', '.')
        num = float(sanitized)
    else:
        num = float(raw_price)
    return int(round(num * 100))


def is_excluded_anomaly_product(name: str, price_cents: int) -> bool:
    """Identify the 3 Keune R$ 0,08 (*) anomaly products to hide from catalog."""
    cleaned_name = clean_display_text(name)
    return price_cents <= 8 or '*' in cleaned_name


def classify_user_admin(role: str) -> bool:
    """Only role 'Gestor' (Carolina and João) has Administrator privileges."""
    return clean_display_text(role) == 'Gestor'


def resolve_club_group_and_validity(raw_club: str, sessions: int) -> tuple[str, str]:
    """Map spreadsheet club name to UI group and official validity rule."""
    club = clean_display_text(raw_club)
    if club == 'Manutenção de Alongamento':
        return 'Clube da Esmaltação em Gel', '45 dias'
    if club == 'Clube da Esmaltação em Gel':
        return 'Clube da Esmaltação em Gel', '60 dias'
    if club == 'Clube da Maquiagem':
        return 'Clube da Maquiagem', '30 dias'
    if club == 'Clube da Cor':
        return 'Clube da Cor', '90 dias'
    if club == 'Clube da Massagem' and sessions == 12:
        return 'Clube da Massagem', '3 meses (90 dias)'
    return club, '35 dias'


def can_add_product_to_cart(stock: int, current_in_cart: int, add_qty: int) -> bool:
    """Allow adding product to cart even with zero/negative stock; record adjustment at sale."""
    if add_qty < 1:
        return False
    return (current_in_cart + add_qty) >= 1


def calculate_stock_adjustment(current_stock: int, sold_qty: int) -> dict:
    """Compute required stock adjustment when selling with insufficient or negative stock."""
    if sold_qty < 1:
        raise ValueError('Quantidade vendida deve ser maior ou igual a 1.')
    effective_available = max(0, int(current_stock))
    if sold_qty <= effective_available:
        return {
            'stock_before': int(current_stock),
            'sold_qty': int(sold_qty),
            'adjustment_qty': 0,
            'stock_after': effective_available - int(sold_qty),
            'requires_adjustment': False,
        }
    adjustment_qty = int(sold_qty) - effective_available
    return {
        'stock_before': int(current_stock),
        'sold_qty': int(sold_qty),
        'adjustment_qty': adjustment_qty,
        'stock_after': 0,
        'requires_adjustment': True,
    }


def deduct_product_stock(current_stock: int, sold_qty: int) -> int:
    """Deduct sold quantity and clamp at 0 when automatic stock adjustment covers deficit."""
    return calculate_stock_adjustment(current_stock, sold_qty)['stock_after']


def requires_phone_update(client: dict) -> bool:
    """Check if a pre-registered client needs phone number completion on cart bind."""
    return not is_valid_phone(client.get('phone', ''))


def validate_checkout_payments(cart_total_cents: int, payments: list[dict]) -> dict:
    """Validate single or split payments in cents and calculate cash change."""
    if cart_total_cents <= 0 or len(payments) == 0:
        return {'valid': False, 'paid_cents': 0, 'change_cents': 0, 'reason': 'empty_checkout'}

    paid_cents = 0
    has_cash = False
    for p in payments:
        method = p.get('method', '')
        amount = int(p.get('amount_cents', 0))
        if method not in VALID_PAYMENT_METHODS or amount <= 0:
            return {'valid': False, 'paid_cents': paid_cents, 'change_cents': 0, 'reason': 'invalid_payment_entry'}
        if method == 'Dinheiro':
            has_cash = True
        paid_cents = paid_cents + amount

    if paid_cents < cart_total_cents:
        return {
            'valid': False,
            'paid_cents': paid_cents,
            'change_cents': 0,
            'remaining_cents': cart_total_cents - paid_cents,
            'reason': 'insufficient_payment',
        }

    if paid_cents > cart_total_cents and not has_cash:
        return {
            'valid': False,
            'paid_cents': paid_cents,
            'change_cents': 0,
            'reason': 'overpayment_without_cash',
        }

    return {
        'valid': True,
        'paid_cents': paid_cents,
        'change_cents': paid_cents - cart_total_cents,
        'remaining_cents': 0,
        'reason': 'ok',
    }


def aggregate_admin_metrics(sales: list[dict], is_admin: bool) -> dict:
    """Calculate sales volume by segment, brand, and club exclusively for Gestor."""
    if not is_admin:
        raise PermissionError('Visão de Administrador exclusiva para o cargo Gestor.')

    total_cents = 0
    glow_hub_cents = 0
    bento_club_cents = 0
    glow_hub_items = 0
    bento_club_items = 0
    by_brand: dict[str, int] = {'Davines': 0, 'Keune': 0, 'Kérastase': 0}
    by_club: dict[str, int] = {c: 0 for c in CANONICAL_CLUBS_ORDER}

    for sale in sales:
        for item in sale.get('items', []):
            line_cents = int(item['unit_price_cents']) * int(item['qty'])
            qty = int(item['qty'])
            total_cents = total_cents + line_cents
            if item.get('segment') == 'glow_hub':
                glow_hub_cents = glow_hub_cents + line_cents
                glow_hub_items = glow_hub_items + qty
                brand = item.get('brand', '')
                by_brand[brand] = by_brand.get(brand, 0) + line_cents
            else:
                bento_club_cents = bento_club_cents + line_cents
                bento_club_items = bento_club_items + qty
                club = item.get('club', '')
                by_club[club] = by_club.get(club, 0) + line_cents

    return {
        'orders_count': len(sales),
        'total_cents': total_cents,
        'segments': {
            'glow_hub': {'cents': glow_hub_cents, 'items': glow_hub_items},
            'bento_club': {'cents': bento_club_cents, 'items': bento_club_items},
        },
        'by_brand': by_brand,
        'by_club': by_club,
    }


def build_customer_sales_report(sales: list[dict], search_query: str = '', segment_filter: str = '') -> list[dict]:
    """Group and filter everything sold per customer."""
    norm_q = normalize_text(search_query)
    grouped: dict[str, dict] = {}

    for sale in sales:
        client = sale.get('client', {})
        cid = str(client.get('id', ''))
        cname = clean_display_text(client.get('name', ''))
        cphone = normalize_phone(client.get('phone', ''))

        matched_items = []
        for item in sale.get('items', []):
            if segment_filter != '' and item.get('segment') != segment_filter:
                continue
            matched_items.append(item)

        if len(matched_items) == 0:
            continue

        haystack = normalize_text(f"{cname} {cphone} {' '.join(i.get('name', '') for i in matched_items)}")
        if norm_q != '' and norm_q not in haystack:
            continue

        if cid not in grouped:
            grouped[cid] = {
                'client_id': cid,
                'client_name': cname,
                'client_phone': cphone,
                'orders_count': 0,
                'items_count': 0,
                'total_cents': 0,
                'items_purchased': [],
            }

        entry = grouped[cid]
        entry['orders_count'] = entry['orders_count'] + 1
        for item in matched_items:
            qty = int(item['qty'])
            line_cents = int(item['unit_price_cents']) * qty
            entry['items_count'] = entry['items_count'] + qty
            entry['total_cents'] = entry['total_cents'] + line_cents
            entry['items_purchased'].append({
                'sale_id': sale.get('id', ''),
                'sold_at': sale.get('created_at', ''),
                'seller_name': sale.get('seller_name', ''),
                'segment': item.get('segment', ''),
                'group': item.get('brand') or item.get('club', ''),
                'name': item.get('name', ''),
                'qty': qty,
                'unit_price_cents': int(item['unit_price_cents']),
                'line_total_cents': line_cents,
            })

    return sorted(grouped.values(), key=lambda r: (-r['total_cents'], r['client_name']))


def _matches_target_date(iso_ts: str, target_date: str) -> bool:
    """Return True when target_date is empty or matches the YYYY-MM-DD prefix."""
    if not target_date:
        return True
    return str(iso_ts).startswith(target_date)


def _compute_sale_segments(sale: dict) -> tuple[int, int]:
    """Sum Glow Hub product cents and BentoClub cents for a sale."""
    glow_cents = 0
    bento_cents = 0
    for item in sale.get('items', []):
        line_cents = int(item.get('unit_price_cents', 0)) * int(item.get('qty', 0))
        if item.get('segment') == 'glow_hub':
            glow_cents = glow_cents + line_cents
        else:
            bento_cents = bento_cents + line_cents
    return glow_cents, bento_cents


def build_daily_closing_report(
    sales: list[dict],
    clients: list[dict],
    stock_adjustments: list[dict] | None = None,
    target_date: str = '',
    declared_payments: dict[str, int] | None = None,
) -> dict:
    """Build end-of-day closing reports: cash breakdown, discrepancy, sales lines, and daily clients."""
    cash_by_payment = {
        method: {
            'method': method,
            'total_cents': 0,
            'glow_hub_cents': 0,
            'bento_club_cents': 0,
            'orders_count': 0,
        }
        for method in VALID_PAYMENT_METHODS
    }
    sales_items_report = []
    filtered_sales = [s for s in sales if _matches_target_date(s.get('created_at', ''), target_date)]

    for sale in filtered_sales:
        sale_glow, sale_bento = _compute_sale_segments(sale)
        sale_total = sale_glow + sale_bento
        remaining_change = int(sale.get('change_cents', 0))
        methods_seen_in_sale = set()
        payment_labels = []

        for payment in sale.get('payments', []):
            method = payment.get('method', '')
            if method not in cash_by_payment:
                continue
            raw_amount = int(payment.get('amount_cents', 0))
            net_amount = raw_amount
            if method == 'Dinheiro' and remaining_change > 0:
                deduct = min(remaining_change, raw_amount)
                net_amount = raw_amount - deduct
                remaining_change = remaining_change - deduct

            if sale_total > 0:
                gh_part = round(net_amount * sale_glow / sale_total)
                bc_part = net_amount - gh_part
            else:
                gh_part = 0
                bc_part = 0

            bucket = cash_by_payment[method]
            bucket['total_cents'] = bucket['total_cents'] + net_amount
            bucket['glow_hub_cents'] = bucket['glow_hub_cents'] + gh_part
            bucket['bento_club_cents'] = bucket['bento_club_cents'] + bc_part
            if method not in methods_seen_in_sale:
                bucket['orders_count'] = bucket['orders_count'] + 1
                methods_seen_in_sale.add(method)
            payment_labels.append(method)

        payment_summary = ' + '.join(payment_labels)
        client = sale.get('client', {})
        seller_name = clean_display_text(sale.get('seller_name', ''))

        for item in sale.get('items', []):
            qty = int(item['qty'])
            unit_cents = int(item['unit_price_cents'])
            sales_items_report.append({
                'sale_id': sale.get('id', ''),
                'created_at': sale.get('created_at', ''),
                'segment': item.get('segment', ''),
                'brand_or_club': item.get('brand') or item.get('club', ''),
                'item_name': item.get('name', ''),
                'qty': qty,
                'unit_price_cents': unit_cents,
                'subtotal_cents': unit_cents * qty,
                'adjustment_qty': int(item.get('adjustment_qty', 0)),
                'client_name': clean_display_text(client.get('name', '')),
                'client_phone': normalize_phone(client.get('phone', '')),
                'seller_name': seller_name,
                'payment_summary': payment_summary,
            })

    declared_map = declared_payments or {}
    discrepancy_by_payment = []
    total_expected = 0
    total_declared = 0
    for method in VALID_PAYMENT_METHODS:
        expected = cash_by_payment[method]['total_cents']
        total_expected = total_expected + expected
        if method in declared_map and declared_map[method] is not None:
            declared = int(declared_map[method])
            diff = declared - expected
            if diff == 0:
                status = 'CORRETO'
            elif diff < 0:
                status = 'FALTA'
            else:
                status = 'SOBRA'
            total_declared = total_declared + declared
        else:
            declared = None
            diff = 0
            status = 'PENDENTE'
        discrepancy_by_payment.append({
            'method': method,
            'expected_cents': expected,
            'declared_cents': declared,
            'discrepancy_cents': diff,
            'status': status,
        })

    raw_adjustments = stock_adjustments or []
    filtered_adjustments = [
        adj for adj in raw_adjustments if _matches_target_date(adj.get('created_at', ''), target_date)
    ]

    registered_clients = []
    for client in clients:
        created_at = str(client.get('created_at', ''))
        updated_at = str(client.get('updated_at', ''))
        created_today = bool(created_at) and _matches_target_date(created_at, target_date)
        updated_today = bool(updated_at) and _matches_target_date(updated_at, target_date)
        if created_today or updated_today:
            registered_clients.append({
                'id': str(client.get('id', '')),
                'name': clean_display_text(client.get('name', '')),
                'phone': normalize_phone(client.get('phone', '')),
                'registration_type': 'Novo Cadastro' if created_today else 'Cadastro Atualizado',
                'timestamp': created_at if created_today else updated_at,
            })

    return {
        'cash_by_payment': cash_by_payment,
        'cash_totals': {
            'total_cents': sum(b['total_cents'] for b in cash_by_payment.values()),
            'glow_hub_cents': sum(b['glow_hub_cents'] for b in cash_by_payment.values()),
            'bento_club_cents': sum(b['bento_club_cents'] for b in cash_by_payment.values()),
            'orders_count': len(filtered_sales),
        },
        'discrepancy_by_payment': discrepancy_by_payment,
        'discrepancy_totals': {
            'expected_cents': total_expected,
            'declared_cents': total_declared,
            'discrepancy_cents': total_declared - total_expected,
        },
        'stock_adjustments_report': {
            'total_adjustments_count': len(filtered_adjustments),
            'total_adjusted_units': sum(int(a.get('adjustment_qty', 0)) for a in filtered_adjustments),
            'total_adjusted_value_cents': sum(int(a.get('adjustment_value_cents', 0)) for a in filtered_adjustments),
            'items': filtered_adjustments,
        },
        'sales_items_report': sales_items_report,
        'registered_clients_report': registered_clients,
    }
