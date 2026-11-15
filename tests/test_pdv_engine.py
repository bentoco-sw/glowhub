#!/usr/bin/env python3
"""Comprehensive unit and integration test suite for PDV Glow Hub & BentoClub."""
from __future__ import annotations

import json
import re
import struct
import subprocess
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
ROOT_DIR = TESTS_DIR.parent
SCRIPTS_DIR = ROOT_DIR / 'scripts'
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from pdv_engine import (  # noqa: E402
    CANONICAL_CLUBS_ORDER,
    VALID_PAYMENT_METHODS,
    aggregate_admin_metrics,
    build_customer_sales_report,
    build_daily_closing_report,
    calculate_stock_adjustment,
    can_add_product_to_cart,
    classify_user_admin,
    clean_display_text,
    deduct_product_stock,
    is_excluded_anomaly_product,
    is_valid_phone,
    normalize_phone,
    normalize_text,
    requires_phone_update,
    resolve_club_group_and_validity,
    to_cents,
    validate_checkout_payments,
)


class TestPDVEngineAndRTM(unittest.TestCase):
    """Covers REQ-01..REQ-12, DEC-01..DEC-04, AC-01..AC-12, CTR-PWA-AUTH-WALL-01, ENG-01, ENG-08, ARC-02, ARC-10, DATA-03."""

    def test_REQ_01_AC_01_DEC_02_clean_text_and_admin_classification(self) -> None:
        """REQ-01 AC-01 DEC-02 ARC-10: sanitize user names/typos and classify Gestor as only Admin."""
        self.assertEqual(clean_display_text('Danielle \xa0'), 'Danielle')
        self.assertEqual(clean_display_text('Manincure'), 'Manicure')
        self.assertEqual(clean_display_text('  BAIN   HYDRA \xa0 250ML '), 'BAIN HYDRA 250ML')
        self.assertTrue(classify_user_admin('Gestor'))
        self.assertTrue(classify_user_admin(' Gestor\xa0'))
        self.assertFalse(classify_user_admin('Financeiro'))
        self.assertFalse(classify_user_admin('Recepcionista'))
        self.assertFalse(classify_user_admin('Administrativo'))

    def test_REQ_02_REQ_05_AC_02_AC_05_normalize_text_and_cents(self) -> None:
        """REQ-02 REQ-05 AC-02 AC-05 DATA-03: accent stripping and exact integer cent conversion."""
        self.assertEqual(normalize_text('Kérastase Première Óleo\xa0'), 'kerastase premiere oleo')
        self.assertEqual(normalize_text('Manincure'), 'manicure')
        self.assertEqual(to_cents(184), 18400)
        self.assertEqual(to_cents(0.08), 8)
        self.assertEqual(to_cents('R$ 1.295,50\xa0'), 129550)
        self.assertEqual(to_cents('288.45'), 28845)

    def test_REQ_03_AC_03_DEC_03_anomaly_product_exclusion(self) -> None:
        """REQ-03 AC-03 DEC-03: exclude R$ 0,08 (<= 8 cents) and asterisk (*) items."""
        self.assertTrue(is_excluded_anomaly_product('SATIN OIL SACHET 3ML *', 8))
        self.assertTrue(is_excluded_anomaly_product('ITEM PROMO', 8))
        self.assertTrue(is_excluded_anomaly_product('ITEM PROMO', 5))
        self.assertTrue(is_excluded_anomaly_product('LINHA ANTIGA *', 15000))
        self.assertFalse(is_excluded_anomaly_product('SHAMPOO OI 280ML', 9))
        self.assertFalse(is_excluded_anomaly_product('BAIN GENESIS 250ML', 18400))

    def test_REQ_04_AC_04_club_mapping_and_validity(self) -> None:
        """REQ-04 AC-04 DEC-03: map 6 BentoClub groups including Manutenção de Alongamento and validities."""
        self.assertEqual(len(CANONICAL_CLUBS_ORDER), 6)
        self.assertEqual(
            resolve_club_group_and_validity('Manutenção de Alongamento', 3),
            ('Clube da Esmaltação em Gel', '45 dias'),
        )
        self.assertEqual(
            resolve_club_group_and_validity('Clube da Esmaltação em Gel', 4),
            ('Clube da Esmaltação em Gel', '60 dias'),
        )
        self.assertEqual(
            resolve_club_group_and_validity('Clube da Maquiagem', 3),
            ('Clube da Maquiagem', '30 dias'),
        )
        self.assertEqual(
            resolve_club_group_and_validity('Clube da Cor', 3),
            ('Clube da Cor', '90 dias'),
        )
        self.assertEqual(
            resolve_club_group_and_validity('Clube da Massagem', 12),
            ('Clube da Massagem', '3 meses (90 dias)'),
        )
        self.assertEqual(
            resolve_club_group_and_validity('Clube da Massagem', 6),
            ('Clube da Massagem', '35 dias'),
        )
        self.assertEqual(
            resolve_club_group_and_validity('Clube da Escova', 4),
            ('Clube da Escova', '35 dias'),
        )

    def test_REQ_06_AC_06_DEC_03_stock_adjustment_and_deduction(self) -> None:
        """REQ-06 AC-06 DEC-03 REQ-13 AC-13: allow sale on zero/negative stock with auto-adjustment record and clamp stock at 0."""
        self.assertTrue(can_add_product_to_cart(stock=0, current_in_cart=0, add_qty=1))
        self.assertTrue(can_add_product_to_cart(stock=-2, current_in_cart=0, add_qty=1))
        self.assertFalse(can_add_product_to_cart(stock=5, current_in_cart=0, add_qty=0))
        self.assertFalse(can_add_product_to_cart(stock=0, current_in_cart=0, add_qty=-1))
        self.assertTrue(can_add_product_to_cart(stock=1, current_in_cart=0, add_qty=1))
        self.assertTrue(can_add_product_to_cart(stock=3, current_in_cart=2, add_qty=1))
        self.assertTrue(can_add_product_to_cart(stock=3, current_in_cart=2, add_qty=2))

        adj_ok = calculate_stock_adjustment(5, 2)
        self.assertEqual(adj_ok['stock_before'], 5)
        self.assertEqual(adj_ok['sold_qty'], 2)
        self.assertEqual(adj_ok['adjustment_qty'], 0)
        self.assertEqual(adj_ok['stock_after'], 3)
        self.assertFalse(adj_ok['requires_adjustment'])

        adj_exact = calculate_stock_adjustment(3, 3)
        self.assertEqual(adj_exact['adjustment_qty'], 0)
        self.assertEqual(adj_exact['stock_after'], 0)
        self.assertFalse(adj_exact['requires_adjustment'])

        adj_partial = calculate_stock_adjustment(1, 3)
        self.assertEqual(adj_partial['stock_before'], 1)
        self.assertEqual(adj_partial['sold_qty'], 3)
        self.assertEqual(adj_partial['adjustment_qty'], 2)
        self.assertEqual(adj_partial['stock_after'], 0)
        self.assertTrue(adj_partial['requires_adjustment'])

        adj_zero = calculate_stock_adjustment(0, 2)
        self.assertEqual(adj_zero['adjustment_qty'], 2)
        self.assertEqual(adj_zero['stock_after'], 0)
        self.assertTrue(adj_zero['requires_adjustment'])

        adj_neg = calculate_stock_adjustment(-2, 3)
        self.assertEqual(adj_neg['stock_before'], -2)
        self.assertEqual(adj_neg['adjustment_qty'], 3)
        self.assertEqual(adj_neg['stock_after'], 0)
        self.assertTrue(adj_neg['requires_adjustment'])

        self.assertEqual(deduct_product_stock(5, 1), 4)
        self.assertEqual(deduct_product_stock(3, 3), 0)
        self.assertEqual(deduct_product_stock(3, 4), 0)
        self.assertEqual(deduct_product_stock(0, 2), 0)
        with self.assertRaises(ValueError):
            calculate_stock_adjustment(3, 0)
        with self.assertRaises(ValueError):
            deduct_product_stock(3, 0)

    def test_REQ_07_AC_07_DEC_04_phone_validation_and_client_update(self) -> None:
        """REQ-07 AC-07 DEC-04: normalize phones, treat '0' as empty, validate 10/11 digits."""
        self.assertEqual(normalize_phone('0'), '')
        self.assertEqual(normalize_phone(''), '')
        self.assertEqual(normalize_phone('(92) 98441-4454'), '92984414454')
        self.assertTrue(is_valid_phone('92984414454'))
        self.assertTrue(is_valid_phone('9232345678'))
        self.assertFalse(is_valid_phone('929844144'))
        self.assertFalse(is_valid_phone('929844144549'))
        self.assertFalse(is_valid_phone('0'))
        self.assertTrue(requires_phone_update({'name': 'Adrian Gomes', 'phone': ''}))
        self.assertTrue(requires_phone_update({'name': 'Cliente Zero', 'phone': '0'}))
        self.assertFalse(requires_phone_update({'name': 'Adalgiza', 'phone': '92984414454'}))

    def test_REQ_08_REQ_09_AC_08_AC_09_checkout_payments_validation(self) -> None:
        """REQ-08 REQ-09 AC-08 AC-09 DEC-04: validate single and combined payments and cash change."""
        self.assertEqual(len(VALID_PAYMENT_METHODS), 5)

        empty_res = validate_checkout_payments(0, [{'method': 'PIX', 'amount_cents': 100}])
        self.assertFalse(empty_res['valid'])
        self.assertEqual(empty_res['reason'], 'empty_checkout')
        no_pays = validate_checkout_payments(10000, [])
        self.assertFalse(no_pays['valid'])
        self.assertEqual(no_pays['reason'], 'empty_checkout')

        bad_method = validate_checkout_payments(10000, [{'method': 'Boleto', 'amount_cents': 10000}])
        self.assertFalse(bad_method['valid'])
        self.assertEqual(bad_method['reason'], 'invalid_payment_entry')

        zero_amt = validate_checkout_payments(10000, [{'method': 'PIX', 'amount_cents': 0}])
        self.assertFalse(zero_amt['valid'])

        underpaid = validate_checkout_payments(10000, [{'method': 'PIX', 'amount_cents': 6000}])
        self.assertFalse(underpaid['valid'])
        self.assertEqual(underpaid['remaining_cents'], 4000)

        overpaid_pix = validate_checkout_payments(10000, [{'method': 'PIX', 'amount_cents': 12000}])
        self.assertFalse(overpaid_pix['valid'])
        self.assertEqual(overpaid_pix['reason'], 'overpayment_without_cash')

        overpaid_cash = validate_checkout_payments(10000, [{'method': 'Dinheiro', 'amount_cents': 15000}])
        self.assertTrue(overpaid_cash['valid'])
        self.assertEqual(overpaid_cash['change_cents'], 5000)

        exact_split = validate_checkout_payments(
            25000,
            [
                {'method': 'PIX', 'amount_cents': 10000},
                {'method': 'Cartão de Crédito', 'amount_cents': 15000},
            ],
        )
        self.assertTrue(exact_split['valid'])
        self.assertEqual(exact_split['paid_cents'], 25000)
        self.assertEqual(exact_split['change_cents'], 0)

    def test_REQ_11_REQ_12_AC_11_AC_12_admin_metrics_and_customer_report(self) -> None:
        """REQ-11 REQ-12 AC-11 AC-12 DATA-03: compute Gestor dashboard and customer report with filters."""
        sample_sales = [
            {
                'id': 'VND-01',
                'created_at': '2026-11-14T10:00:00Z',
                'seller_name': 'Carolina',
                'client': {'id': 'cli-1', 'name': 'Adalgiza Araújo', 'phone': '92984414454'},
                'items': [
                    {
                        'segment': 'glow_hub',
                        'brand': 'Kérastase',
                        'name': 'Bain Genesis',
                        'qty': 2,
                        'unit_price_cents': 18400,
                    },
                    {
                        'segment': 'bento_club',
                        'club': 'Clube da Escova',
                        'name': 'Escova Simples Curto',
                        'qty': 1,
                        'unit_price_cents': 37500,
                    },
                ],
            },
            {
                'id': 'VND-02',
                'created_at': '2026-11-14T11:00:00Z',
                'seller_name': 'João',
                'client': {'id': 'cli-2', 'name': 'Beatriz Silva', 'phone': '92991112222'},
                'items': [
                    {
                        'segment': 'glow_hub',
                        'brand': 'Davines',
                        'name': 'OI Oil',
                        'qty': 1,
                        'unit_price_cents': 20000,
                    },
                ],
            },
        ]

        with self.assertRaises(PermissionError):
            aggregate_admin_metrics(sample_sales, is_admin=False)

        metrics = aggregate_admin_metrics(sample_sales, is_admin=True)
        self.assertEqual(metrics['orders_count'], 2)
        self.assertEqual(metrics['total_cents'], 94300)
        self.assertEqual(metrics['segments']['glow_hub']['cents'], 56800)
        self.assertEqual(metrics['segments']['glow_hub']['items'], 3)
        self.assertEqual(metrics['segments']['bento_club']['cents'], 37500)
        self.assertEqual(metrics['segments']['bento_club']['items'], 1)
        self.assertEqual(metrics['by_brand']['Kérastase'], 36800)
        self.assertEqual(metrics['by_brand']['Davines'], 20000)
        self.assertEqual(metrics['by_club']['Clube da Escova'], 37500)

        all_report = build_customer_sales_report(sample_sales)
        self.assertEqual(len(all_report), 2)
        self.assertEqual(all_report[0]['client_name'], 'Adalgiza Araújo')
        self.assertEqual(all_report[0]['total_cents'], 74300)
        self.assertEqual(all_report[0]['items_count'], 3)
        self.assertEqual(all_report[0]['orders_count'], 1)
        self.assertEqual(all_report[0]['items_purchased'][0]['group'], 'Kérastase')
        self.assertEqual(all_report[0]['items_purchased'][1]['group'], 'Clube da Escova')

        club_only = build_customer_sales_report(sample_sales, segment_filter='bento_club')
        self.assertEqual(len(club_only), 1)
        self.assertEqual(club_only[0]['total_cents'], 37500)

        search_davines = build_customer_sales_report(sample_sales, search_query='beatriz')
        self.assertEqual(len(search_davines), 1)
        self.assertEqual(search_davines[0]['client_id'], 'cli-2')

    def test_REQ_10_AC_10_DEC_01_CTR_PWA_AUTH_WALL_01_artifacts_and_jsc(self) -> None:
        """REQ-10 AC-10 DEC-01 CTR-PWA-AUTH-WALL-01 ENG-01 ENG-08 ARC-02: verify seed data, Auth Wall shell and JSC suite."""
        seed_json_path = ROOT_DIR / 'data' / 'seed-data.json'
        if not seed_json_path.is_file():
            return

        seed = json.loads(seed_json_path.read_text(encoding='utf-8'))
        self.assertEqual(len(seed['users']), 12)
        admins = [u['shortName'] for u in seed['users'] if u['isAdmin']]
        self.assertEqual(admins, ['Carolina', 'João'])
        self.assertEqual(len(seed['products']), 254)
        self.assertEqual(len(seed['excludedAnomalyProducts']), 3)
        self.assertEqual(len(seed['clubs']), 31)
        self.assertEqual(len(seed['clubsMeta']), 6)
        self.assertEqual(len(seed['clients']), 1721)

        index_html = (ROOT_DIR / 'index.html').read_text(encoding='utf-8')
        self.assertIn('id="app-root"', index_html)
        self.assertIn('id="initial-loader"', index_html)
        self.assertNotIn('display: none', index_html)
        self.assertNotIn('display:none', index_html)
        self.assertIn('<title>GlowHub &amp; BentoClub</title>', index_html)
        self.assertNotIn('PDV Eventos', index_html)

        auth_guard_js = (ROOT_DIR / 'js' / 'auth-guard.js').read_text(encoding='utf-8')
        self.assertIn('<h1>GlowHub &amp; BentoClub</h1>', auth_guard_js)
        self.assertNotIn('PDV Eventos', auth_guard_js)

        manifest = json.loads((ROOT_DIR / 'manifest.webmanifest').read_text(encoding='utf-8'))
        self.assertEqual(manifest['name'], 'GlowHub & BentoClub')
        self.assertEqual(manifest['short_name'], 'GlowHub & BentoClub')

        sw_js = (ROOT_DIR / 'sw.js').read_text(encoding='utf-8')
        self.assertIn('script.google.com', sw_js)
        self.assertIn('oauth2.googleapis.com', sw_js)

        code_gs = (ROOT_DIR / 'backend' / 'Code.gs').read_text(encoding='utf-8')
        self.assertIn('oauth2.googleapis.com/tokeninfo', code_gs)
        self.assertIn('SYNC_BATCH', code_gs)
        self.assertIn('Estoque_GlowHub', code_gs)

        jsc_bin = Path('/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc')
        if jsc_bin.is_file():
            proc = subprocess.run(
                [
                    str(jsc_bin),
                    str(ROOT_DIR / 'data' / 'seed-data.js'),
                    str(ROOT_DIR / 'js' / 'domain.js'),
                    str(ROOT_DIR / 'js' / 'storage.js'),
                    str(ROOT_DIR / 'js' / 'auth-guard.js'),
                    str(ROOT_DIR / 'js' / 'app.js'),
                    str(ROOT_DIR / 'tests' / 'pdv_app.test.js'),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(proc.returncode, 0, msg=proc.stdout + '\n' + proc.stderr)

            # Execute backend/Code.gs inside JSC with mocked SpreadsheetApp & UrlFetchApp
            gas_harness = (
                "var _sheets = {};\n"
                "function _makeSheet(name) {\n"
                "  return {\n"
                "    name: name, rows: [],\n"
                "    appendRow: function(r) { this.rows.push(r.slice()); },\n"
                "    getLastRow: function() { return this.rows.length; },\n"
                "    getRange: function(r, c, numR, numC) {\n"
                "      var self = this;\n"
                "      return {\n"
                "        setFontWeight: function() {},\n"
                "        getValues: function() {\n"
                "          var out = [];\n"
                "          for (var i = 0; i < numR; i++) {\n"
                "            var row = self.rows[r - 1 + i] || [];\n"
                "            out.push(row.slice(c - 1, c - 1 + numC));\n"
                "          }\n"
                "          return out;\n"
                "        },\n"
                "        setValues: function(vals) {\n"
                "          for (var i = 0; i < vals.length; i++) {\n"
                "            self.rows[r - 1 + i] = vals[i].slice();\n"
                "          }\n"
                "        }\n"
                "      };\n"
                "    }\n"
                "  };\n"
                "}\n"
                "var SpreadsheetApp = {\n"
                "  getActiveSpreadsheet: function() {\n"
                "    return {\n"
                "      getSheetByName: function(n) { return _sheets[n] || null; },\n"
                "      insertSheet: function(n) { _sheets[n] = _makeSheet(n); return _sheets[n]; }\n"
                "    };\n"
                "  }\n"
                "};\n"
                "var ContentService = {\n"
                "  MimeType: { JSON: 'application/json' },\n"
                "  createTextOutput: function(txt) {\n"
                "    return { _txt: txt, setMimeType: function() { return this; }, getContent: function() { return this._txt; } };\n"
                "  }\n"
                "};\n"
                + code_gs
                + "\n"
                "var payload = {\n"
                "  action: 'SYNC_BATCH',\n"
                "  idToken: 'LOCAL_OPERATOR_TOKEN',\n"
                "  operator: { email: 'jleite@gmail.com', name: 'João' },\n"
                "  sales: [{ id: 'V1', createdAt: '2026-11-14', totalCents: 18400, glowHubCents: 18400, bentoClubCents: 0, client: { name: 'Ana', phone: '92999999999' }, payments: [{ method: 'PIX', amountCents: 18400, installments: 1 }], items: [{ segment: 'glow_hub', brand: 'Keune', name: 'Shampoo', qty: 1, unitPriceCents: 18400, lineTotalCents: 18400, adjustmentQty: 1 }] }],\n"
                "  stockAdjustments: [{ id: 'ADJ-1', saleId: 'V1', createdAt: '2026-11-14T10:00:00Z', productId: 'prd-001', productName: 'Shampoo', brand: 'Keune', stockBefore: 0, soldQty: 1, adjustmentQty: 1, stockAfter: 0, clientName: 'Ana', clientPhone: '92999999999', operatorName: 'João' }],\n"
                "  clients: [{ id: 'cli-1', name: 'Ana', phone: '92999999999', updatedAt: '2026-11-14' }],\n"
                "  stockSnapshot: [{ id: 'prd-001', brand: 'Keune', name: 'Shampoo', stock: 0 }]\n"
                "};\n"
                "var r1 = JSON.parse(doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());\n"
                "var r2 = JSON.parse(doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());\n"
                "print(JSON.stringify({ r1: r1, r2: r2, salesRows: _sheets['Vendas_PDV'].rows.length, clientRows: _sheets['Clientes_PDV'].rows.length, stockRows: _sheets['Estoque_GlowHub'].rows.length, adjRows: _sheets['Ajustes_Estoque'] ? _sheets['Ajustes_Estoque'].rows.length : 0 }));\n"
            )
            gas_proc = subprocess.run(
                [str(jsc_bin), '-e', gas_harness],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(gas_proc.returncode, 0, msg=gas_proc.stderr)
            gas_out = json.loads(gas_proc.stdout.strip().splitlines()[-1])
            self.assertTrue(gas_out['r1']['ok'])
            self.assertEqual(gas_out['r1']['syncedSales'], 1)
            self.assertEqual(gas_out['r2']['syncedSales'], 0)
            self.assertEqual(gas_out['salesRows'], 2)   # 1 header + 1 deduplicated sale row
            self.assertEqual(gas_out['clientRows'], 2)  # 1 header + 1 upserted client row
            self.assertEqual(gas_out['stockRows'], 2)   # 1 header + 1 stock row
            self.assertEqual(gas_out['adjRows'], 2)     # 1 header + 1 deduplicated stock adjustment row

    def test_REQ_13_REQ_14_AC_13_AC_14_daily_closing_and_discrepancy_reports(self) -> None:
        """REQ-13 REQ-14 AC-13 AC-14: daily closing report aggregates payment methods by segment, cash discrepancy, adjustments, sales with emissor, and daily clients."""
        sales = [
            {
                'id': 'V-01',
                'created_at': '2026-11-14T10:00:00Z',
                'client': {'id': 'c1', 'name': 'Maria', 'phone': '92999990001'},
                'seller_name': 'Ana Vendedora',
                'total_cents': 15000,
                'change_cents': 2000,
                'items': [
                    {
                        'segment': 'glow_hub',
                        'brand': 'Davines',
                        'name': 'Shampoo Oi',
                        'qty': 2,
                        'unit_price_cents': 5000,
                    },
                    {
                        'segment': 'bento_club',
                        'club': 'Clube da Escova',
                        'name': 'Clube da Escova M',
                        'qty': 1,
                        'unit_price_cents': 5000,
                    },
                ],
                'payments': [
                    {'method': 'PIX', 'amount_cents': 9000},
                    {'method': 'Dinheiro', 'amount_cents': 1500},
                    {'method': 'Dinheiro', 'amount_cents': 6500},
                ],
            },
            {
                'id': 'V-02',
                'created_at': '2026-11-14T14:30:00Z',
                'client': {'id': 'c2', 'name': 'João', 'phone': '92999990002'},
                'seller_name': 'Carlos Caixa',
                'total_cents': 20000,
                'change_cents': 0,
                'items': [
                    {
                        'segment': 'glow_hub',
                        'brand': 'Keune',
                        'name': 'Máscara',
                        'qty': 2,
                        'unit_price_cents': 10000,
                        'adjustment_qty': 1,
                    },
                ],
                'payments': [
                    {'method': 'Cartão de Crédito', 'amount_cents': 20000},
                    {'method': 'Metodo Desconhecido', 'amount_cents': 5000},
                ],
            },
            {
                'id': 'V-ZERO',
                'created_at': '2026-11-14T15:00:00Z',
                'client': {'id': 'c3', 'name': 'Brinde', 'phone': '92999990003'},
                'seller_name': 'Ana Vendedora',
                'total_cents': 0,
                'change_cents': 0,
                'items': [
                    {
                        'segment': 'glow_hub',
                        'brand': 'Davines',
                        'name': 'Amostra',
                        'qty': 1,
                        'unit_price_cents': 0,
                    },
                ],
                'payments': [{'method': 'PIX', 'amount_cents': 0}],
            },
            {
                'id': 'V-OUTRO-DIA',
                'created_at': '2026-11-13T18:00:00Z',
                'client': {'id': 'c4', 'name': 'Ontem', 'phone': '92999990004'},
                'seller_name': 'Ana Vendedora',
                'total_cents': 9900,
                'change_cents': 0,
                'items': [
                    {'segment': 'bento_club', 'club': 'Clube', 'name': 'Clube', 'qty': 1, 'unit_price_cents': 9900},
                ],
                'payments': [{'method': 'PIX', 'amount_cents': 9900}],
            },
        ]
        clients = [
            {'id': 'c1', 'name': 'Maria', 'phone': '92999990001', 'created_at': '2026-11-14T09:50:00Z'},
            {'id': 'c2', 'name': 'João', 'phone': '92999990002', 'updated_at': '2026-11-14T14:20:00Z'},
            {'id': 'c3', 'name': 'Antigo', 'phone': '92999990003'},
            {'id': 'c4', 'name': 'Ontem', 'phone': '92999990004', 'created_at': '2026-11-13T10:00:00Z'},
        ]
        adjustments = [
            {
                'id': 'ADJ-1',
                'sale_id': 'V-02',
                'created_at': '2026-11-14T14:30:00Z',
                'product_id': 'p2',
                'product_name': 'Máscara',
                'brand': 'Keune',
                'adjustment_qty': 1,
                'adjustment_value_cents': 10000,
            },
            {
                'id': 'ADJ-OLD',
                'sale_id': 'V-OUTRO-DIA',
                'created_at': '2026-11-13T18:00:00Z',
                'product_name': 'Outro',
                'adjustment_qty': 3,
                'adjustment_value_cents': 15000,
            },
        ]
        declared = {
            'PIX': 9000,               # CORRETO (expected 9000)
            'Dinheiro': 5500,          # FALTA (expected 8000 - 2000 change = 6000 -> -500)
            'Cartão de Crédito': 20500,  # SOBRA (expected 20000 -> +500)
            # Cartão de Débito & Transferência Bancária omitted -> PENDENTE
        }

        report = build_daily_closing_report(
            sales=sales,
            clients=clients,
            stock_adjustments=adjustments,
            target_date='2026-11-14',
            declared_payments=declared,
        )

        # Totals for 2026-11-14: V-01 (15000 = 10000 glow + 5000 bento) + V-02 (20000 glow) + V-ZERO (0) = 35000
        self.assertEqual(report['cash_totals']['total_cents'], 35000)
        self.assertEqual(report['cash_totals']['glow_hub_cents'], 30000)
        self.assertEqual(report['cash_totals']['bento_club_cents'], 5000)
        self.assertEqual(report['cash_totals']['orders_count'], 3)

        by_method = report['cash_by_payment']
        self.assertEqual(by_method['PIX']['total_cents'], 9000)
        self.assertEqual(by_method['PIX']['glow_hub_cents'], 6000)
        self.assertEqual(by_method['PIX']['bento_club_cents'], 3000)
        self.assertEqual(by_method['PIX']['orders_count'], 2)
        self.assertEqual(by_method['Dinheiro']['total_cents'], 6000)
        self.assertEqual(by_method['Dinheiro']['glow_hub_cents'], 4000)
        self.assertEqual(by_method['Dinheiro']['bento_club_cents'], 2000)
        self.assertEqual(by_method['Dinheiro']['orders_count'], 1)
        self.assertEqual(by_method['Cartão de Crédito']['total_cents'], 20000)
        self.assertEqual(by_method['Cartão de Crédito']['glow_hub_cents'], 20000)
        self.assertEqual(by_method['Cartão de Crédito']['bento_club_cents'], 0)
        self.assertEqual(by_method['Cartão de Débito']['total_cents'], 0)

        disc_by_method = {row['method']: row for row in report['discrepancy_by_payment']}
        self.assertEqual(disc_by_method['PIX']['status'], 'CORRETO')
        self.assertEqual(disc_by_method['PIX']['discrepancy_cents'], 0)
        self.assertEqual(disc_by_method['Dinheiro']['status'], 'FALTA')
        self.assertEqual(disc_by_method['Dinheiro']['discrepancy_cents'], -500)
        self.assertEqual(disc_by_method['Cartão de Crédito']['status'], 'SOBRA')
        self.assertEqual(disc_by_method['Cartão de Crédito']['discrepancy_cents'], 500)
        self.assertEqual(disc_by_method['Cartão de Débito']['status'], 'PENDENTE')
        self.assertIsNone(disc_by_method['Cartão de Débito']['declared_cents'])
        self.assertEqual(report['discrepancy_totals']['expected_cents'], 35000)
        self.assertEqual(report['discrepancy_totals']['declared_cents'], 35000)
        self.assertEqual(report['discrepancy_totals']['discrepancy_cents'], 0)

        self.assertEqual(report['stock_adjustments_report']['total_adjustments_count'], 1)
        self.assertEqual(report['stock_adjustments_report']['total_adjusted_units'], 1)
        self.assertEqual(report['stock_adjustments_report']['total_adjusted_value_cents'], 10000)

        self.assertEqual(len(report['sales_items_report']), 4)
        self.assertEqual(report['sales_items_report'][0]['seller_name'], 'Ana Vendedora')
        self.assertEqual(report['sales_items_report'][0]['client_name'], 'Maria')
        self.assertEqual(report['sales_items_report'][1]['brand_or_club'], 'Clube da Escova')
        self.assertEqual(report['sales_items_report'][2]['seller_name'], 'Carlos Caixa')
        self.assertEqual(report['sales_items_report'][2]['adjustment_qty'], 1)
        self.assertEqual(report['sales_items_report'][2]['subtotal_cents'], 20000)

        clients_rep = {c['id']: c for c in report['registered_clients_report']}
        self.assertEqual(set(clients_rep.keys()), {'c1', 'c2'})
        self.assertEqual(clients_rep['c1']['registration_type'], 'Novo Cadastro')
        self.assertEqual(clients_rep['c2']['registration_type'], 'Cadastro Atualizado')

        all_dates_report = build_daily_closing_report(sales=sales, clients=clients, stock_adjustments=adjustments, target_date='')
        self.assertEqual(all_dates_report['cash_totals']['total_cents'], 44900)
        self.assertEqual(all_dates_report['cash_totals']['bento_club_cents'], 14900)
        self.assertEqual(all_dates_report['stock_adjustments_report']['total_adjustments_count'], 2)
        self.assertEqual(all_dates_report['stock_adjustments_report']['total_adjusted_units'], 4)
        self.assertEqual(
            {c['id'] for c in all_dates_report['registered_clients_report']},
            {'c1', 'c2', 'c4'},
        )

    def test_REQ_14_AC_14_ENG_01_mobile_drawer_and_a4_print_architecture(self) -> None:
        """REQ-14 AC-14 ENG-01: verify Material You mobile drawer, card-table CSS, A4 print layout, and SW cache bump."""
        styles_text = (ROOT_DIR / 'styles.css').read_text(encoding='utf-8')
        self.assertIn('@page', styles_text)
        self.assertIn('size: A4 portrait;', styles_text)
        self.assertIn('.m3-nav-drawer', styles_text)
        self.assertIn('.report-items-table td[data-label]', styles_text)
        self.assertIn('#app-root .pdv-shell[data-print-target="report"] #pdv-print-sheet', styles_text)
        self.assertIn('thead {\n  display: table-header-group;', styles_text)

        app_js_text = (ROOT_DIR / 'js' / 'app.js').read_text(encoding='utf-8')
        self.assertIn('renderMobileNavDrawer', app_js_text)
        self.assertIn('renderPrintSheet', app_js_text)
        self.assertIn('btn-print-full-closing', app_js_text)

        sw_text = (ROOT_DIR / 'sw.js').read_text(encoding='utf-8')
        self.assertIn('bento-glow-pdv-shell-v1.5.0', sw_text)
        self.assertIn('./assets/icon-192.png', sw_text)
        self.assertIn('./assets/icon-512.png', sw_text)
        self.assertIn('ignoreSearch: true', sw_text)

        arch_text = (ROOT_DIR / 'docs' / 'specs' / 'ARCHITECTURE.md').read_text(encoding='utf-8')
        self.assertIn('bento-glow-pdv-shell-v1.5.0', arch_text)

        index_text = (ROOT_DIR / 'index.html').read_text(encoding='utf-8')
        self.assertIn('assets/icon-192.png', index_text)
        self.assertIn('name="theme-color" content="#1D6452"', index_text)

        manifest = json.loads((ROOT_DIR / 'manifest.webmanifest').read_text(encoding='utf-8'))
        self.assertEqual(manifest['id'], './index.html')
        self.assertEqual(manifest['start_url'], './index.html')
        self.assertEqual(manifest['scope'], './')
        self.assertEqual(manifest['theme_color'], '#1D6452')
        icon_srcs = {entry['src'] for entry in manifest['icons']}
        self.assertIn('assets/icon-192.png', icon_srcs)
        self.assertIn('assets/icon-512.png', icon_srcs)

        # PNG dimensions & solid RGB icon checks (stdlib struct on PNG IHDR)
        def png_meta(rel_path: str) -> tuple[int, int, int]:
            raw = (ROOT_DIR / rel_path).read_bytes()
            self.assertEqual(raw[:8], b'\x89PNG\r\n\x1a\n')
            w, h = struct.unpack('>II', raw[16:24])
            return w, h, raw[25]

        self.assertEqual(png_meta('assets/icon-192.png'), (192, 192, 2))
        self.assertEqual(png_meta('assets/icon-512.png'), (512, 512, 2))
        bege_w, bege_h, _ = png_meta('assets/bento-logo-bege.png')
        verde_w, verde_h, _ = png_meta('assets/bento-logo-verde.png')
        self.assertGreater(bege_w, bege_h * 4)
        self.assertGreater(verde_w, verde_h * 4)

        # UI contrast, cascade, responsive drawer/topbar, print target & hygiene invariants
        self.assertIn('background: var(--bento-verde-escuro);', styles_text)
        self.assertIn('background: #124236;', styles_text)
        self.assertNotIn('background: var(--bento-bege-claro);\n  color: var(--bento-verde-escuro);', styles_text)
        self.assertIn('background: var(--bento-marrom-terra);', styles_text)
        self.assertIn(':focus-visible', styles_text)
        self.assertIn('::placeholder', styles_text)
        self.assertIn('grid-column: 1 / -1;', styles_text)
        self.assertIn('@media (max-width: 1024px)', styles_text)
        self.assertIn('@media (min-width: 1025px) and (max-width: 1366px)', styles_text)
        self.assertIn('.glow-logo-bg', styles_text)
        self.assertIn('.club-logo-bg', styles_text)
        self.assertIn('.report-sales-table', styles_text)
        self.assertIn('.receipt-body', styles_text)
        self.assertIn('.receipt-actions', styles_text)
        self.assertIn('pointer-events: none;', styles_text)
        self.assertIn('.auth-wall-screen', styles_text)
        self.assertIn('[data-print-target="page"]', styles_text)
        self.assertNotIn('#login-screen', styles_text)
        self.assertNotIn('.card-out-of-stock', styles_text)
        self.assertNotIn('.stock-zero', styles_text)
        self.assertNotIn('.report-filters', styles_text)

        declared_vars = set(re.findall(r'(--[a-zA-Z0-9_-]+)\s*:', styles_text))
        used_vars = set(re.findall(r'var\((--[a-zA-Z0-9_-]+)\)', styles_text))
        self.assertEqual(declared_vars - used_vars, set())

        self.assertIn('glow-logo-bg', app_js_text)
        self.assertIn('report-sales-table', app_js_text)
        self.assertIn('receipt-body', app_js_text)
        self.assertIn('topbar-label-compact', app_js_text)

        deploy_yml = (ROOT_DIR / '.github' / 'workflows' / 'deploy-pages.yml').read_text(encoding='utf-8')
        self.assertIn('actions/deploy-pages@v4', deploy_yml)
        self.assertIn('path: "_site"', deploy_yml)
        self.assertTrue((ROOT_DIR / '.github' / 'workflows' / 'ci.yml').is_file())
        codeowners_text = (ROOT_DIR / '.github' / 'CODEOWNERS').read_text(encoding='utf-8')
        self.assertIn('@bentoco-sw', codeowners_text)
        self.assertIn('@jleite-afluentes', codeowners_text)
        self.assertTrue((ROOT_DIR / '.github' / 'dependabot.yml').is_file())
        self.assertTrue((ROOT_DIR / '.gitattributes').is_file())
        self.assertIn('Base de Apoio/', (ROOT_DIR / '.gitignore').read_text(encoding='utf-8'))
        self.assertTrue((ROOT_DIR / 'scripts' / 'deploy_github.sh').is_file())


if __name__ == '__main__':
    unittest.main()
