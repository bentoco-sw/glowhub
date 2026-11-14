/* global globalThis, PDV_SEED_DATA, PDVDomain, PDVStorage, PDVAuthGuard, PDVApp */
/**
 * JavaScript Test Suite for PDV Glow Hub & BentoClub
 * Executed in WebKit JavaScriptCore (jsc) and audited by verify_rtm_coverage.py
 */

const _jsTestResults = [];

function test(title, fn) {
  try {
    fn();
    _jsTestResults.push({ title: title, passed: true });
  } catch (err) {
    _jsTestResults.push({ title: title, passed: false, error: String(err && err.message ? err.message : err) });
  }
}

function expect(actual) {
  return {
    toBe: function (expected) {
      if (actual !== expected) {
        throw new Error("Expected " + JSON.stringify(expected) + " but got " + JSON.stringify(actual));
      }
    },
    toEqual: function (expected) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) {
        throw new Error("Expected " + b + " but got " + a);
      }
    },
    toBeGreaterThan: function (expected) {
      if (!(actual > expected)) {
        throw new Error("Expected " + actual + " > " + expected);
      }
    },
    toContain: function (item) {
      if (!actual || actual.indexOf(item) === -1) {
        throw new Error("Expected " + JSON.stringify(actual) + " to contain " + JSON.stringify(item));
      }
    }
  };
}

test("REQ-01 AC-01 DEC-02 CTR-PWA-AUTH-WALL-01 ARC-10: authenticates 12 users and restricts Gestor admin to Carolina and Joao", () => {
  const users = PDV_SEED_DATA.users;
  expect(users.length).toBe(12);

  const carolina = PDVDomain.authenticateUser(users, "carolina.mazevedo@outlook.com");
  const joao = PDVDomain.authenticateUser(users, "João");
  const danielle = PDVDomain.authenticateUser(users, "financeiro@bentoco.com.br");
  const unknown = PDVDomain.authenticateUser(users, "inexistente@teste.com");

  expect(carolina.isAdmin).toBe(true);
  expect(joao.isAdmin).toBe(true);
  expect(danielle.shortName).toBe("Danielle");
  expect(danielle.isAdmin).toBe(false);
  expect(unknown).toBe(null);
});

test("REQ-02 REQ-03 AC-02 AC-03 DEC-03 DATA-03: filters 254 active Glow Hub products across Davines, Keune and Kerastase hiding 0.08 items", () => {
  const products = PDV_SEED_DATA.products;
  expect(products.length).toBe(254);
  expect(PDV_SEED_DATA.excludedAnomalyProducts.length).toBe(3);

  const davines = PDVDomain.filterProducts(products, { brand: "Davines" });
  const keune = PDVDomain.filterProducts(products, { brand: "Keune" });
  const kerastase = PDVDomain.filterProducts(products, { brand: "Kérastase" });

  expect(davines.length).toBe(72);
  expect(keune.length).toBe(109);
  expect(kerastase.length).toBe(73);
});

test("REQ-04 REQ-05 AC-04 AC-05 ENG-01: filters 31 BentoClub options across 6 clubs and supports accent-insensitive search", () => {
  const clubs = PDV_SEED_DATA.clubs;
  expect(clubs.length).toBe(31);
  expect(PDV_SEED_DATA.clubsMeta.length).toBe(6);

  const escova = PDVDomain.filterClubs(clubs, { club: "Clube da Escova" });
  const unha = PDVDomain.filterClubs(clubs, { club: "Clube da Unha Clássica" });
  const gelAlongamento = PDVDomain.filterClubs(clubs, { club: "Clube da Esmaltação em Gel" });
  const cor = PDVDomain.filterClubs(clubs, { club: "Clube da Cor" });
  const searchAcry = PDVDomain.filterClubs(clubs, { query: "manutencao acrilico" });

  expect(escova.length).toBe(16);
  expect(unha.length).toBe(3);
  expect(unha[0].option).toBe("Manicure");
  expect(gelAlongamento.length).toBe(4);
  expect(cor.length).toBe(3);
  expect(searchAcry.length).toBe(1);
});

test("REQ-13 REQ-14 AC-13 AC-14: records negative stock adjustments, builds daily closing report (cash by segment, discrepancy, sales with emissor, daily clients) and exports CSV", () => {
  const clientNew = PDVDomain.createOrUpdateClient([], {
    name: "Cliente Dia Novo",
    phone: "92991234567"
  });
  expect(typeof clientNew.client.createdAt).toBe("string");
  const todayUtcKey = clientNew.client.createdAt.slice(0, 10);

  const existingNoTimestamp = { id: "cli-seed-1", name: "Cliente Seed Atualizado", phone: "" };
  const clientUpdated = PDVDomain.createOrUpdateClient([existingNoTimestamp], {
    existingClientId: "cli-seed-1",
    name: "Cliente Seed Atualizado",
    phone: "92998765432"
  });
  expect(Boolean(clientUpdated.client.createdAt)).toBe(false);
  expect(typeof clientUpdated.client.updatedAt).toBe("string");
  expect(clientUpdated.client.updatedAt.slice(0, 10)).toBe(todayUtcKey);

  const adjInfo = PDVDomain.computeStockAdjustmentInfo(-1, 3);
  expect(adjInfo.requiresStockAdjustment).toBe(true);
  expect(adjInfo.adjustmentQty).toBe(3);
  expect(adjInfo.stockAfter).toBe(0);

  const glowProd = {
    id: "prd-adj-test",
    segment: "glow_hub",
    brand: "Keune",
    name: "Care Keratin Smooth 300ml",
    priceCents: 10000,
    stock: 1,
    active: true
  };
  const club = {
    id: "club-test-1",
    segment: "bento_club",
    brand: "Clube da Escova",
    name: "Clube da Escova M",
    priceCents: 5000,
    active: true
  };
  const seller = { id: "usr-emissor-1", name: "Marina Vendedora", role: "vendedor", isAdmin: false };

  let cart = { client: clientNew.client, items: [] };
  const addProdRes = PDVDomain.addItemToCart(cart, glowProd, 3); // stock 1, sold 3 => adj 2, lineTotal 30000
  expect(addProdRes.ok).toBe(true);
  expect(addProdRes.stockAdjustmentInfo.adjustmentQty).toBe(2);
  cart = addProdRes.cart;
  const addClubRes = PDVDomain.addItemToCart(cart, club, 1); // total 35000 (30000 glow + 5000 bento)
  expect(addClubRes.ok).toBe(true);
  cart = addClubRes.cart;

  const saleRes = PDVDomain.finalizeSale({
    cart: cart,
    payments: [
      { method: "PIX", amountCents: 14000, installments: 1 },
      { method: "Dinheiro", amountCents: 25000, installments: 1 }
    ],
    user: seller,
    products: [glowProd],
    createdAt: todayUtcKey + "T13:00:00.000Z"
  });
  expect(saleRes.ok).toBe(true);
  expect(saleRes.sale.totalCents).toBe(35000);
  expect(saleRes.sale.changeCents).toBe(4000); // Dinheiro líquido = 21000
  expect(saleRes.sale.seller.name).toBe("Marina Vendedora");
  expect(saleRes.stockAdjustments.length).toBe(1);
  expect(saleRes.stockAdjustments[0].adjustmentQty).toBe(2);
  expect(saleRes.stockAdjustments[0].stockBefore).toBe(1);
  expect(saleRes.stockAdjustments[0].stockAfter).toBe(0);
  expect(saleRes.products[0].stock).toBe(0);

  const mockState = {
    sales: [saleRes.sale],
    clients: [clientNew.client, clientUpdated.client, { id: "cli-old", name: "Sem Alteracao", phone: "92990000000" }],
    stockAdjustments: saleRes.stockAdjustments,
    cashClosings: {}
  };
  mockState.cashClosings[todayUtcKey] = {
    dateKey: todayUtcKey,
    declaredByMethod: {
      PIX: 14000,
      Dinheiro: 20500, // expected 21000 => -500 FALTA
      "Cartão de Crédito": 300 // expected 0 => +300 SOBRA
    },
    notes: "Conferido no fechamento"
  };

  const report = PDVDomain.buildDailyClosingReport(mockState, {
    dateFilter: todayUtcKey,
    useUtcDate: true,
    declaredPayments: mockState.cashClosings[todayUtcKey].declaredByMethod
  });

  expect(report.cashReport.totals.totalCents).toBe(35000);
  expect(report.cashReport.totals.glowHubCents).toBe(30000);
  expect(report.cashReport.totals.bentoClubCents).toBe(5000);
  expect(report.cashReport.byMethod.PIX.glowHubCents).toBe(12000);
  expect(report.cashReport.byMethod.PIX.bentoClubCents).toBe(2000);
  expect(report.cashReport.byMethod.Dinheiro.totalCents).toBe(21000);
  expect(report.cashReport.byMethod.Dinheiro.glowHubCents).toBe(18000);
  expect(report.cashReport.byMethod.Dinheiro.bentoClubCents).toBe(3000);

  const discByMethod = {};
  report.discrepancyReport.rows.forEach(function (r) { discByMethod[r.method] = r; });
  expect(discByMethod.PIX.status).toBe("CORRETO");
  expect(discByMethod.Dinheiro.status).toBe("FALTA");
  expect(discByMethod.Dinheiro.discrepancyCents).toBe(-500);
  expect(discByMethod["Cartão de Crédito"].status).toBe("SOBRA");
  expect(discByMethod["Cartão de Crédito"].discrepancyCents).toBe(300);
  expect(discByMethod["Cartão de Débito"].status).toBe("PENDENTE");
  expect(report.discrepancyReport.stockAdjustments.totalAdjustedUnits).toBe(2);
  expect(report.discrepancyReport.stockAdjustments.totalAdjustedValueCents).toBe(20000);

  expect(report.salesReport.lines.length).toBe(2);
  expect(report.salesReport.lines[0].sellerName).toBe("Marina Vendedora");
  expect(report.salesReport.lines[0].clientName).toBe("Cliente Dia Novo");
  expect(report.salesReport.lines[0].adjustmentQty).toBe(2);

  expect(report.registeredClientsReport.items.length).toBe(2);
  expect(report.registeredClientsReport.totals.newCount).toBe(1);
  expect(report.registeredClientsReport.totals.updatedCount).toBe(1);

  const csvFull = PDVDomain.exportDailyClosingCSV(mockState, { dateFilter: todayUtcKey, useUtcDate: true }, "full_closing");
  expect(csvFull.includes("RELATORIO DE CAIXA")).toBe(true);
  expect(csvFull.includes("Marina Vendedora")).toBe(true);
  expect(csvFull.includes("Cliente Dia Novo")).toBe(true);

  const restored = PDVStorage.importBackupPayload(JSON.stringify({
    sales: mockState.sales,
    clients: mockState.clients,
    stockAdjustments: mockState.stockAdjustments,
    cashClosings: mockState.cashClosings
  }), null, { products: [glowProd], clubs: [club], clients: [] });
  expect(restored.ok).toBe(true);
  expect(restored.state.stockAdjustments.length).toBe(1);
  expect(restored.state.cashClosings[todayUtcKey].notes).toBe("Conferido no fechamento");
  expect(restored.state.products[0].stock).toBe(0);
});

test("REQ-06 REQ-07 REQ-08 AC-06 AC-07 AC-08 DEC-04: requires client with phone on 1st item, allows negative stock adjustment, and handles mixed cart", () => {
  const emptyCart = PDVDomain.createEmptyCart();
  const inStockProduct = PDV_SEED_DATA.products.find(function (p) { return p.stock >= 2; });
  const zeroStockProduct = PDV_SEED_DATA.products.find(function (p) { return p.stock === 0; });
  const clubItem = PDV_SEED_DATA.clubs[0];

  expect(PDVDomain.canAddProductToCart(0, 0, 1)).toBe(true);
  expect(PDVDomain.canAddProductToCart(-2, 0, 1)).toBe(true);
  const needsClientOnZero = PDVDomain.addItemToCart(emptyCart, zeroStockProduct, 1);
  expect(needsClientOnZero.ok).toBe(false);
  expect(needsClientOnZero.code).toBe("CLIENT_REQUIRED");

  const oneUnitProduct = PDV_SEED_DATA.products.find(function (p) { return p.stock === 1; }) || Object.assign({}, inStockProduct, { stock: 1 });
  const adjClient = { id: "cli-neg-1", name: "Teste Ajuste", phone: "92999998888", createdAt: "2026-11-14T10:00:00.000Z" };
  const negCart = { client: adjClient, items: [] };
  const zeroAdded = PDVDomain.addItemToCart(negCart, zeroStockProduct, 2);
  expect(zeroAdded.ok).toBe(true);
  expect(zeroAdded.stockAdjustmentInfo.requiresStockAdjustment).toBe(true);
  expect(zeroAdded.stockAdjustmentInfo.adjustmentQty).toBe(2);
  expect(zeroAdded.stockAdjustmentInfo.stockAfter).toBe(0);
  const partialAdded = PDVDomain.addItemToCart(zeroAdded.cart, oneUnitProduct, 3);
  expect(partialAdded.ok).toBe(true);
  expect(partialAdded.stockAdjustmentInfo.requiresStockAdjustment).toBe(true);
  expect(partialAdded.stockAdjustmentInfo.adjustmentQty).toBe(2);
  expect(partialAdded.stockAdjustmentInfo.stockAfter).toBe(0);

  const needsClient = PDVDomain.addItemToCart(emptyCart, inStockProduct, 1);
  expect(needsClient.ok).toBe(false);
  expect(needsClient.requiresClient).toBe(true);

  const clientRes = PDVDomain.createOrUpdateClient(PDV_SEED_DATA.clients, {
    name: "Cliente Evento Teste",
    phone: "(92) 98411-2233"
  });
  expect(clientRes.ok).toBe(true);

  const cartWithClient = { client: clientRes.client, items: [] };
  const step1 = PDVDomain.addItemToCart(cartWithClient, inStockProduct, 1);
  expect(step1.ok).toBe(true);

  const step2 = PDVDomain.addItemToCart(step1.cart, clubItem, 1);
  expect(step2.ok).toBe(true);
  expect(step2.totals.totalQty).toBe(2);
  expect(step2.totals.totalCents).toBe(inStockProduct.priceCents + clubItem.priceCents);
});

test("REQ-09 REQ-10 REQ-11 REQ-12 AC-09 AC-10 AC-11 AC-12 DEC-01 ENG-08 ARC-02: validates split checkout, deducts stock, computes Gestor dashboard and exports CSV", () => {
  const gestor = PDVDomain.authenticateUser(PDV_SEED_DATA.users, "Carolina");
  const recepcionista = PDVDomain.authenticateUser(PDV_SEED_DATA.users, "Andreyna");
  const product = Object.assign({}, PDV_SEED_DATA.products[0], { stock: 3, priceCents: 18400 });
  const club = Object.assign({}, PDV_SEED_DATA.clubs[0], { priceCents: 97000 });

  const cart = {
    client: { id: "cli-test-1", name: "Adalgiza Araújo", phone: "92984414454" },
    items: []
  };
  const c1 = PDVDomain.addItemToCart(cart, product, 1).cart;
  const c2 = PDVDomain.addItemToCart(c1, club, 1).cart;

  const saleRes = PDVDomain.finalizeSale({
    cart: c2,
    payments: [
      { method: "PIX", amountCents: 50000 },
      { method: "Cartão de Crédito", amountCents: 65400, installments: 3 }
    ],
    user: gestor,
    products: [product],
    notes: "Venda mista evento"
  });

  expect(saleRes.ok).toBe(true);
  expect(saleRes.products[0].stock).toBe(2);
  expect(saleRes.sale.totalCents).toBe(115400);

  const deniedDash = PDVDomain.computeAdminDashboard([saleRes.sale], recepcionista);
  expect(deniedDash.authorized).toBe(false);

  const adminDash = PDVDomain.computeAdminDashboard([saleRes.sale], gestor);
  expect(adminDash.authorized).toBe(true);
  expect(adminDash.totalCents).toBe(115400);
  expect(adminDash.segments.glowHub.cents).toBe(18400);
  expect(adminDash.segments.bentoClub.cents).toBe(97000);

  const report = PDVDomain.buildCustomerSalesReport([saleRes.sale], { query: "adalgiza" });
  expect(report.length).toBe(1);
  expect(report[0].totalCents).toBe(115400);

  const csv = PDVDomain.exportCustomerReportCSV([saleRes.sale], {});
  expect(csv).toContain("Adalgiza Araújo");
  expect(csv).toContain("Glow Hub");
  expect(csv).toContain("BentoClub");

  const backup = PDVStorage.createBackupPayload({
    version: "1.0.0",
    products: saleRes.products,
    clients: [cart.client],
    sales: [saleRes.sale]
  });
  expect(backup.salesCount).toBe(1);

  // Verify lossless JSON merge preserves local clients and reconciles product stock across devices
  const localProduct = Object.assign({}, PDV_SEED_DATA.products[0], { initialStock: 5, stock: 3, priceCents: 18400 });
  const localSale = Object.assign({}, saleRes.sale, {
    id: "vnd-LOCAL-B",
    items: [Object.assign({}, saleRes.sale.items[0], { itemId: localProduct.id, qty: 2 })]
  });
  const localStateB = {
    version: "1.0.0",
    products: [localProduct],
    clients: [{ id: "cli-local-b", name: "Cliente Local Tablet B", phone: "92999887766", hasValidPhone: true }],
    sales: [localSale]
  };
  const remoteProductSnap = Object.assign({}, PDV_SEED_DATA.products[0], { initialStock: 5, stock: 4, priceCents: 18400 });
  const remoteBackupJson = JSON.stringify({
    state: {
      products: [remoteProductSnap],
      clients: [{ id: "cli-remote-a", name: "Cliente Remoto Tablet A", phone: "92988776655", hasValidPhone: true }],
      sales: [Object.assign({}, saleRes.sale, {
        id: "vnd-REMOTE-A",
        items: [Object.assign({}, saleRes.sale.items[0], { itemId: localProduct.id, qty: 1 })]
      })]
    }
  });
  const mergedRes = PDVStorage.importBackupPayload(remoteBackupJson, localStateB, {
    version: "1.0.0",
    products: [Object.assign({}, PDV_SEED_DATA.products[0], { initialStock: 5, stock: 5 })],
    clubs: PDV_SEED_DATA.clubs,
    clients: []
  });
  expect(mergedRes.ok).toBe(true);
  expect(mergedRes.importedSales).toBe(2);
  expect(mergedRes.state.products[0].stock).toBe(2);
  const clientIds = mergedRes.state.clients.map(function (c) { return c.id; });
  expect(clientIds).toContain("cli-local-b");
  expect(clientIds).toContain("cli-remote-a");

  // Verify CSV export -> import round-trip (DEC-01)
  const csvImportRes = PDVStorage.importBackupPayload(csv, { sales: [], clients: [], products: [] }, PDV_SEED_DATA);
  expect(csvImportRes.ok).toBe(true);
  expect(csvImportRes.importedSales).toBe(1);
  expect(csvImportRes.state.sales[0].totalCents).toBe(115400);
});

test("CTR-PWA-AUTH-WALL-01 REQ-01 REQ-02 REQ-07 REQ-11 ENG-01: mounts dashboard only after AUTHENTICATED, renders Gestor panel for Carolina, and opens client modal on 1st cart item", () => {
  const mockContainer = {
    innerHTML: "",
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };

  const carolina = PDVDomain.authenticateUser(PDV_SEED_DATA.users, "Carolina");
  const andreyna = PDVDomain.authenticateUser(PDV_SEED_DATA.users, "Andreyna");

  PDVApp.mountDashboard(mockContainer, carolina);
  expect(mockContainer.innerHTML).toContain("admin-executive-panel");
  expect(mockContainer.innerHTML).toContain("VISÃO EXCLUSIVA GESTOR");

  PDVApp.mountDashboard(mockContainer, andreyna);
  expect(mockContainer.innerHTML.indexOf("admin-executive-panel")).toBe(-1);

  const firstAvailProd = PDV_SEED_DATA.products.find(function (p) { return p.stock > 0; });
  PDVApp.handleAttemptAddCatalogItem(firstAvailProd, 1);
  expect(PDVApp.getUiState().clientModalOpen).toBe(true);

  PDVApp.completeClientBindAndPendingAdd({
    id: "cli-0001",
    name: "Adalgiza Araújo",
    phone: "92984414454"
  });
  expect(PDVApp.getUiState().clientModalOpen).toBe(false);
  expect(PDVApp.getUiState().cart.items.length).toBe(1);
  expect(PDVApp.getUiState().cart.client.name).toBe("Adalgiza Araújo");
});

test("REQ-14 AC-14 ENG-01: renders compact mobile Material You drawer, data-label mobile cards, and A4 portrait print sheet without raw inputs", () => {
  const listeners = {};
  function makeStubEl(selector, extraAttrs) {
    return {
      addEventListener: function (ev, fn) {
        listeners[selector + ":" + ev] = fn;
      },
      getAttribute: function (attr) {
        return (extraAttrs && extraAttrs[attr]) || null;
      },
      focus: function () {},
      setSelectionRange: function () {}
    };
  }
  const interactiveContainer = {
    innerHTML: "",
    querySelector: function (sel) {
      if (interactiveContainer.innerHTML.indexOf(sel.slice(1)) !== -1) {
        return makeStubEl(sel);
      }
      return null;
    },
    querySelectorAll: function (sel) {
      if (sel === "[data-mobile-nav]" && interactiveContainer.innerHTML.indexOf('data-mobile-nav="reports"') !== -1) {
        return [makeStubEl('[data-mobile-nav="reports"]', { "data-mobile-nav": "reports" })];
      }
      return [];
    }
  };

  const carolina = PDVDomain.authenticateUser(PDV_SEED_DATA.users, "Carolina");
  PDVApp.mountDashboard(interactiveContainer, carolina);
  expect(interactiveContainer.innerHTML).toContain("btn-mobile-nav-open");
  expect(interactiveContainer.innerHTML.indexOf("mobile-nav-drawer-backdrop")).toBe(-1);

  // Open Material You mobile drawer
  listeners["#btn-mobile-nav-open:click"]({ currentTarget: makeStubEl("#btn-mobile-nav-open") });
  expect(PDVApp.getUiState().mobileNavOpen).toBe(true);
  expect(interactiveContainer.innerHTML).toContain("m3-nav-drawer");
  expect(interactiveContainer.innerHTML).toContain('data-mobile-nav="reports"');

  // Navigate to Reports via mobile drawer -> closes drawer & mounts responsive tables + A4 print sheet
  listeners['[data-mobile-nav="reports"]:click']({
    currentTarget: makeStubEl('[data-mobile-nav="reports"]', { "data-mobile-nav": "reports" })
  });
  expect(PDVApp.getUiState().view).toBe("reports");
  expect(PDVApp.getUiState().mobileNavOpen).toBe(false);
  expect(interactiveContainer.innerHTML).toContain('data-label="Forma de Pagamento"');
  expect(interactiveContainer.innerHTML).toContain("btn-print-full-closing");
  expect(interactiveContainer.innerHTML).toContain('id="pdv-print-sheet"');

  // Full A4 closing sheet renders all 4 closing sections as clean text (never raw <input> boxes)
  const fullSheetHtml = PDVApp.buildPrintSheetHtml("full_closing");
  expect(fullSheetHtml).toContain("1. Relatório de Caixa por Forma de Pagamento");
  expect(fullSheetHtml).toContain("2. Conferência de Caixa (Discrepância)");
  expect(fullSheetHtml).toContain("3. Relatório de Vendas");
  expect(fullSheetHtml).toContain("4. Relatório de Clientes Cadastrados / Atualizados");
  expect(fullSheetHtml).toContain("print-signatures-grid");
  expect(fullSheetHtml.indexOf("<input")).toBe(-1);
});

if (typeof print === "function" && typeof window === "undefined") {
  const failed = _jsTestResults.filter(function (r) { return !r.passed; });
  print(JSON.stringify({ total: _jsTestResults.length, failed: failed.length, results: _jsTestResults }));
  if (failed.length > 0) {
    throw new Error("JS tests failed: " + JSON.stringify(failed));
  }
}
