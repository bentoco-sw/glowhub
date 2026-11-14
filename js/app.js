/* global globalThis */
/**
 * Main Application UI Controller for PDV Glow Hub & BentoClub
 * Mounted dynamically into #app-root ONLY after AuthState.AUTHENTICATED (CTR-PWA-AUTH-WALL-01).
 */
(function (root) {
  "use strict";

  const BRAND_LOGOS = {
    Davines: "assets/davines-logo.png",
    Keune: "assets/keune-logo.png",
    "Kérastase": "assets/kerastase-logo.jpg"
  };

  let appContainer = null;
  let activeUser = null;
  let dbState = null;

  let uiState = {
    view: "home", // 'home' | 'glow_hub' | 'bento_club' | 'reports'
    selectedBrand: "ALL",
    selectedCategory: "ALL",
    onlyInStock: false,
    productQuery: "",
    selectedClub: "ALL",
    clubQuery: "",
    cart: null,
    cartDrawerOpen: false,
    checkoutMode: "single", // 'single' | 'split'
    singlePaymentMethod: "PIX",
    singleInstallments: 1,
    singleCashReceivedInput: "",
    splitPayments: [],
    splitDraftMethod: "PIX",
    splitDraftAmountInput: "",
    splitDraftInstallments: 1,
    checkoutNotes: "",
    checkoutError: "",
    clientModalOpen: false,
    clientModalTab: "search", // 'search' | 'new'
    clientSearchQuery: "",
    selectedClientPendingPhone: null,
    pendingPhoneInput: "",
    newClientNameInput: "",
    newClientPhoneInput: "",
    clientModalError: "",
    pendingCartAddition: null, // { item, qty }
    receiptSale: null,
    syncModalOpen: false,
    syncMessage: "",
    syncError: "",
    reportQuery: "",
    reportSegment: "",
    reportPaymentMethod: "",
    reportSellerId: "",
    reportSubTab: "closing_cash", // 'closing_cash' | 'discrepancy' | 'sales_list' | 'clients_day' | 'clients_history'
    reportDateFilter: root.PDVDomain ? root.PDVDomain.getLocalDateKey() : "ALL",
    discrepancyInputs: {},
    discrepancyNotes: "",
    mobileNavOpen: false,
    printTarget: "report", // 'report' | 'receipt'
    printScope: "active_tab", // 'active_tab' | 'full_closing'
    toastMessage: ""
  };

  let toastTimer = null;

  function escapeHtml(str) {
    return String(str === null || str === undefined ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg) {
    uiState.toastMessage = msg;
    renderToastOnly();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      uiState.toastMessage = "";
      renderToastOnly();
    }, 3200);
  }

  function renderToastOnly() {
    if (!appContainer) return;
    const slot = appContainer.querySelector("#pdv-toast-slot");
    if (!slot) return;
    if (!uiState.toastMessage) {
      slot.innerHTML = "";
      return;
    }
    slot.innerHTML = '<div class="pdv-toast" role="status">' + escapeHtml(uiState.toastMessage) + "</div>";
  }

  function resetCartAndCheckout() {
    uiState.cart = root.PDVDomain.createEmptyCart();
    uiState.checkoutMode = "single";
    uiState.singlePaymentMethod = "PIX";
    uiState.singleInstallments = 1;
    uiState.singleCashReceivedInput = "";
    uiState.splitPayments = [];
    uiState.splitDraftMethod = "PIX";
    uiState.splitDraftAmountInput = "";
    uiState.splitDraftInstallments = 1;
    uiState.checkoutNotes = "";
    uiState.checkoutError = "";
  }

  function mountDashboard(container, user) {
    appContainer = container;
    activeUser = user;
    dbState = root.PDVStorage.loadStateSync(root.PDV_SEED_DATA);
    if (!uiState.cart) {
      resetCartAndCheckout();
    }
    loadDiscrepancyInputsForDate(uiState.reportDateFilter);
    uiState.view = "home";
    renderApp();

    // Hydrate from IndexedDB asynchronously if newer, then sync with local server / Apps Script
    root.PDVStorage.initStateAsync(root.PDV_SEED_DATA).then(function (hydrated) {
      if (hydrated) {
        dbState = hydrated;
        loadDiscrepancyInputsForDate(uiState.reportDateFilter);
        renderApp();
      }
      const cfg = root.PDVStorage.loadSyncConfig();
      if (cfg && cfg.appsScriptUrl && cfg.autoSync !== false) {
        root.PDVStorage.syncWithGoogleSheets(dbState, { user: activeUser }).then(function (syncRes) {
          if (syncRes && syncRes.ok) {
            loadDiscrepancyInputsForDate(uiState.reportDateFilter);
            renderApp();
          }
        });
      }
    });
  }

  function buildProductsMap() {
    const map = {};
    const list = (dbState && dbState.products) || [];
    for (let i = 0; i < list.length; i++) {
      map[list[i].id] = list[i];
    }
    return map;
  }

  function getCurrentViewTitle() {
    if (uiState.view === "glow_hub") return "Produtos Glow Hub";
    if (uiState.view === "bento_club") return "Clubes BentoClub";
    if (uiState.view === "reports") return "Fechamento & Relatórios";
    return "GlowHub & BentoClub";
  }

  function renderTopBar() {
    const totals = root.PDVDomain.calculateCartTotals(uiState.cart);
    const salesCount = ((dbState && dbState.sales) || []).length;
    const pendingSyncCount = ((dbState && dbState.sales) || []).filter(function (s) {
      return s.syncStatus !== "synced";
    }).length;
    const isAdmin = Boolean(activeUser && activeUser.isAdmin);
    const clientBadge = uiState.cart && uiState.cart.client
      ? escapeHtml(uiState.cart.client.name.split(" ")[0])
      : "Sem cliente";
    const viewTitle = getCurrentViewTitle();

    return (
      '<header class="pdv-topbar">' +
        '<div class="topbar-mobile-cluster">' +
          '<button type="button" class="m3-icon-btn" id="btn-mobile-nav-open" aria-label="Abrir menu de navegação" title="Menu">' +
            '<span class="hamburger-lines" aria-hidden="true"><span></span><span></span><span></span></span>' +
          "</button>" +
          '<button type="button" class="topbar-mobile-title-btn" id="btn-mobile-go-home" title="Menu Principal">' +
            '<img src="assets/bento-logo-bege.png" alt="Bento" class="topbar-logo" />' +
            '<span class="topbar-mobile-title-wrap">' +
              '<strong class="topbar-mobile-title">' + escapeHtml(viewTitle) + "</strong>" +
              '<span class="topbar-mobile-sub">' + escapeHtml(activeUser.shortName) + " • " + (uiState.cart && uiState.cart.client ? clientBadge : "Toque p/ menu") + "</span>" +
            "</span>" +
          "</button>" +
        "</div>" +

        '<div class="topbar-left topbar-desktop-nav">' +
          '<button type="button" class="btn-nav-home ' + (uiState.view === "home" ? "active" : "") + '" id="btn-go-home" title="Voltar ao Menu Principal">' +
            '<img src="assets/bento-logo-bege.png" alt="Bento" class="topbar-logo" />' +
            "<span>Menu Principal</span>" +
          "</button>" +
          '<div class="topbar-seg-pills">' +
            '<button type="button" class="seg-pill ' + (uiState.view === "glow_hub" ? "active" : "") + '" id="btn-nav-glow">' +
              "Glow Hub" +
            "</button>" +
            '<button type="button" class="seg-pill ' + (uiState.view === "bento_club" ? "active" : "") + '" id="btn-nav-club">' +
              "BentoClub" +
            "</button>" +
            '<button type="button" class="seg-pill ' + (uiState.view === "reports" ? "active" : "") + '" id="btn-nav-reports">' +
              "📊 Fechamento &amp; Relatórios " +
              '<span class="pill-count">' + salesCount + "</span>" +
            "</button>" +
          "</div>" +
        "</div>" +

        '<div class="topbar-right">' +
          '<button type="button" class="btn-client-chip topbar-desktop-secondary" id="btn-open-client-modal" title="Identificar ou trocar cliente">' +
            '<span class="chip-icon">👤</span>' +
            '<span class="chip-label">' + clientBadge + "</span>" +
          "</button>" +
          '<button type="button" class="btn-sync-chip topbar-desktop-secondary" id="btn-open-sync-modal" title="Sincronização Google Sheets e Backup Excel/CSV">' +
            '<span class="sync-dot ' + (pendingSyncCount > 0 ? "pending" : "ok") + '"></span>' +
            "<span>Dados / Nuvem</span>" +
          "</button>" +
          '<button type="button" class="btn-cart-trigger" id="btn-toggle-cart">' +
            '<span class="cart-icon">🛒</span>' +
            '<span class="cart-badge">' + totals.totalQty + "</span>" +
            '<span class="cart-total-text">' + root.PDVDomain.formatBRLFromCents(totals.totalCents) + "</span>" +
          "</button>" +
          '<div class="user-session-pill topbar-desktop-secondary">' +
            '<span class="user-session-name">' + escapeHtml(activeUser.shortName) + "</span>" +
            '<span class="user-session-role ' + (isAdmin ? "admin" : "") + '">' +
              escapeHtml(isAdmin ? "Admin • Gestor" : activeUser.role) +
            "</span>" +
            '<button type="button" class="btn-logout" id="btn-logout-user" title="Trocar operador">Sair</button>' +
          "</div>" +
        "</div>" +
      "</header>"
    );
  }

  function renderMobileNavDrawer() {
    if (!uiState.mobileNavOpen || !activeUser) return "";
    const isAdmin = Boolean(activeUser.isAdmin);
    const salesCount = ((dbState && dbState.sales) || []).length;
    const pendingSyncCount = ((dbState && dbState.sales) || []).filter(function (s) {
      return s.syncStatus !== "synced";
    }).length;
    const clientLabel = uiState.cart && uiState.cart.client
      ? uiState.cart.client.name
      : "Nenhum cliente vinculado";
    const initials = (activeUser.shortName || activeUser.name || "P").slice(0, 2).toUpperCase();

    return (
      '<div class="m3-drawer-backdrop" id="mobile-nav-drawer-backdrop">' +
        '<aside class="m3-nav-drawer" role="dialog" aria-modal="true" aria-label="Menu de Navegação">' +
          '<div class="m3-drawer-header">' +
            '<div class="m3-drawer-brand">' +
              '<img src="assets/bento-logo-bege.png" alt="Bento" class="m3-drawer-logo" />' +
              "<div>" +
                "<strong>GlowHub &amp; BentoClub</strong>" +
                "<span>Ponto de Venda PWA</span>" +
              "</div>" +
            "</div>" +
            '<button type="button" class="m3-drawer-close" id="btn-mobile-nav-close" aria-label="Fechar menu">✕</button>' +
          "</div>" +

          '<div class="m3-drawer-operator-card">' +
            '<div class="m3-operator-avatar">' + escapeHtml(initials) + "</div>" +
            '<div class="m3-operator-meta">' +
              "<strong>" + escapeHtml(activeUser.name || activeUser.shortName) + "</strong>" +
              '<span class="m3-role-chip ' + (isAdmin ? "admin" : "") + '">' +
                escapeHtml(isAdmin ? "Admin • Gestor" : activeUser.role) +
              "</span>" +
            "</div>" +
          "</div>" +

          '<nav class="m3-drawer-nav" aria-label="Seções">' +
            '<span class="m3-nav-section-label">Navegação</span>' +
            '<button type="button" class="m3-nav-item ' + (uiState.view === "home" ? "active" : "") + '" data-mobile-nav="home">' +
              '<span class="m3-nav-icon">🏠</span><span>Menu Principal</span>' +
            "</button>" +
            '<button type="button" class="m3-nav-item ' + (uiState.view === "glow_hub" ? "active" : "") + '" data-mobile-nav="glow_hub">' +
              '<span class="m3-nav-icon">🧴</span><span>Produtos Glow Hub</span>' +
            "</button>" +
            '<button type="button" class="m3-nav-item ' + (uiState.view === "bento_club" ? "active" : "") + '" data-mobile-nav="bento_club">' +
              '<span class="m3-nav-icon">✨</span><span>Clubes BentoClub</span>' +
            "</button>" +
            '<button type="button" class="m3-nav-item ' + (uiState.view === "reports" ? "active" : "") + '" data-mobile-nav="reports">' +
              '<span class="m3-nav-icon">📊</span><span>Fechamento &amp; Relatórios</span>' +
              '<span class="m3-nav-badge">' + salesCount + "</span>" +
            "</button>" +

            '<span class="m3-nav-section-label">Operação &amp; Dados</span>' +
            '<button type="button" class="m3-nav-item" id="btn-mobile-open-client">' +
              '<span class="m3-nav-icon">👤</span><span class="m3-nav-ellipsis">' + escapeHtml(clientLabel) + "</span>" +
            "</button>" +
            '<button type="button" class="m3-nav-item" id="btn-mobile-open-sync">' +
              '<span class="m3-nav-icon"><span class="sync-dot ' + (pendingSyncCount > 0 ? "pending" : "ok") + '"></span></span>' +
              "<span>Dados / Sincronização</span>" +
              (pendingSyncCount > 0 ? '<span class="m3-nav-badge warn">' + pendingSyncCount + "</span>" : "") +
            "</button>" +
          "</nav>" +

          '<div class="m3-drawer-footer">' +
            '<button type="button" class="m3-btn-logout" id="btn-mobile-logout">🚪 Trocar Operador (Sair)</button>' +
          "</div>" +
        "</aside>" +
      "</div>"
    );
  }

  function renderAdminDashboardSection() {
    if (!activeUser || !activeUser.isAdmin) {
      return "";
    }
    const dash = root.PDVDomain.computeAdminDashboard(dbState.sales, activeUser);
    if (!dash.authorized) return "";

    const brandsHtml = ["Davines", "Keune", "Kérastase"].map(function (bName) {
      const bStats = (dash.byBrand && dash.byBrand[bName]) || { cents: 0, items: 0 };
      const brandShare = dash.segments.glowHub.cents > 0
        ? Math.round((bStats.cents * 100) / dash.segments.glowHub.cents)
        : 0;
      return (
        '<div class="admin-Breakdown-card">' +
          '<div class="admin-brand-head">' +
            '<img src="' + escapeHtml(BRAND_LOGOS[bName]) + '" alt="' + escapeHtml(bName) + '" class="admin-brand-logo" />' +
            "<div>" +
              "<strong>" + escapeHtml(bName) + "</strong>" +
              '<span class="admin-sub-count">' + bStats.items + " un. vendidas (" + brandShare + "%)</span>" +
            "</div>" +
          "</div>" +
          '<div class="admin-brand-value">' + root.PDVDomain.formatBRLFromCents(bStats.cents) + "</div>" +
          '<div class="progress-track"><div class="progress-fill glow" style="width:' + brandShare + '%"></div></div>' +
        "</div>"
      );
    }).join("");

    const clubsHtml = root.PDVDomain.CANONICAL_CLUBS_ORDER.map(function (cName) {
      const cStats = (dash.byClub && dash.byClub[cName]) || { cents: 0, items: 0 };
      const clubShare = dash.segments.bentoClub.cents > 0
        ? Math.round((cStats.cents * 100) / dash.segments.bentoClub.cents)
        : 0;
      return (
        '<div class="admin-club-row">' +
          '<div class="admin-club-info">' +
            "<strong>" + escapeHtml(cName) + "</strong>" +
            "<span>" + cStats.items + " assinatura(s)</span>" +
          "</div>" +
          '<div class="admin-club-val">' + root.PDVDomain.formatBRLFromCents(cStats.cents) + "</div>" +
          '<div class="progress-track compact"><div class="progress-fill club" style="width:' + clubShare + '%"></div></div>' +
        "</div>"
      );
    }).join("");

    return (
      '<section class="admin-executive-panel" id="admin-executive-panel" aria-label="Painel do Administrador">' +
        '<div class="admin-panel-header">' +
          "<div>" +
            '<span class="admin-kicker">VISÃO EXCLUSIVA GESTOR • ' + escapeHtml(activeUser.shortName.toUpperCase()) + "</span>" +
            "<h2>Volume de Vendas por Segmento, Marcas e Clubes</h2>" +
          "</div>" +
          '<div class="admin-panel-actions">' +
            '<button type="button" class="btn-secondary btn-sm" id="btn-admin-export-csv">📥 Exportar Excel/CSV por Cliente</button>' +
            '<button type="button" class="btn-outline btn-sm" id="btn-admin-open-reports">📊 Fechamento do Dia &amp; Relatórios →</button>' +
          "</div>" +
        "</div>" +

        '<div class="admin-kpi-grid">' +
          '<div class="kpi-card kpi-total">' +
            '<span class="kpi-label">Volume Total Geral</span>' +
            '<strong class="kpi-value">' + root.PDVDomain.formatBRLFromCents(dash.totalCents) + "</strong>" +
            '<span class="kpi-foot">' + dash.ordersCount + " venda(s) • " + dash.uniqueClientsCount + " cliente(s) • Ticket médio " + root.PDVDomain.formatBRLFromCents(dash.averageTicketCents) + "</span>" +
          "</div>" +
          '<div class="kpi-card kpi-glow">' +
            '<span class="kpi-label">Segmento Produtos — Glow Hub</span>' +
            '<strong class="kpi-value">' + root.PDVDomain.formatBRLFromCents(dash.segments.glowHub.cents) + "</strong>" +
            '<span class="kpi-foot">' + dash.segments.glowHub.items + " produto(s) • " + dash.segments.glowHub.sharePercent + "% do faturamento</span>" +
          "</div>" +
          '<div class="kpi-card kpi-club">' +
            '<span class="kpi-label">Segmento Assinaturas — BentoClub</span>' +
            '<strong class="kpi-value">' + root.PDVDomain.formatBRLFromCents(dash.segments.bentoClub.cents) + "</strong>" +
            '<span class="kpi-foot">' + dash.segments.bentoClub.items + " pacote(s) • " + dash.segments.bentoClub.sharePercent + "% do faturamento</span>" +
          "</div>" +
        "</div>" +

        '<div class="admin-split-columns">' +
          '<div class="admin-col-card">' +
            "<h3>Volume por Marca (Glow Hub)</h3>" +
            '<div class="admin-brands-list">' + brandsHtml + "</div>" +
          "</div>" +
          '<div class="admin-col-card">' +
            "<h3>Volume por Clube (BentoClub)</h3>" +
            '<div class="admin-clubs-list">' + clubsHtml + "</div>" +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function renderHomeView() {
    const activeProductsCount = (dbState.products || []).length;
    const inStockProductsCount = (dbState.products || []).filter(function (p) {
      return Number(p.stock) > 0;
    }).length;
    const clubsCount = (dbState.clubs || []).length;

    return (
      '<div class="pdv-home-container">' +
        renderAdminDashboardSection() +
        '<section class="segment-choice-section" aria-label="Escolha o segmento da venda">' +
          '<div class="section-heading">' +
            "<h1>Iniciar Nova Venda</h1>" +
            "<p>Escolha se a operação será de <strong>Produtos Glow Hub</strong> ou <strong>Assinaturas BentoClub</strong> (você pode combinar ambos no mesmo carrinho).</p>" +
          "</div>" +
          '<div class="segment-cards-grid">' +
            '<button type="button" class="segment-hero-card card-glow-hub" id="card-choose-glowhub">' +
              '<div class="segment-logo-wrap">' +
                '<img src="assets/glowhub-logo.png" alt="Glow Hub" class="segment-main-logo" />' +
              "</div>" +
              '<div class="segment-card-body">' +
                '<span class="segment-tag">Catálogo de Produtos</span>' +
                "<h2>Venda Glow Hub</h2>" +
                "<p>Produtos oficiais das marcas <strong>Davines</strong>, <strong>Keune</strong> e <strong>Kérastase</strong> com controle de estoque em tempo real.</p>" +
                '<div class="segment-mini-brands">' +
                  '<img src="assets/davines-logo.png" alt="Davines" />' +
                  '<img src="assets/keune-logo.png" alt="Keune" />' +
                  '<img src="assets/kerastase-logo.jpg" alt="Kérastase" />' +
                "</div>" +
                '<div class="segment-meta-row">' +
                  "<span>" + activeProductsCount + " produtos listados (" + inStockProductsCount + " com estoque)</span>" +
                  '<span class="cta-arrow">Acessar Marcas →</span>' +
                "</div>" +
              "</div>" +
            "</button>" +

            '<button type="button" class="segment-hero-card card-bento-club" id="card-choose-bentoclub">' +
              '<div class="segment-logo-wrap club-logo-bg">' +
                '<img src="assets/bentoclub-logo.png" alt="BentoClub" class="segment-main-logo" />' +
              "</div>" +
              '<div class="segment-card-body">' +
                '<span class="segment-tag tag-caramelo">Clubes de Assinatura</span>' +
                "<h2>Venda BentoClub</h2>" +
                "<p>Planos recorrentes e pacotes: <strong>Escova</strong>, <strong>Unha Clássica</strong>, <strong>Esmaltação em Gel + Alongamento</strong>, <strong>Massagem</strong>, <strong>Maquiagem</strong> e <strong>Cor</strong>.</p>" +
                '<div class="segment-club-pills">' +
                  "<span>Escova</span><span>Unha Clássica</span><span>Gel &amp; Alongamento</span><span>Massagem</span><span>Maquiagem</span><span>Cor</span>" +
                "</div>" +
                '<div class="segment-meta-row">' +
                  "<span>6 clubes • " + clubsCount + " opções de pacotes</span>" +
                  '<span class="cta-arrow">Escolher Clube →</span>' +
                "</div>" +
              "</div>" +
            "</button>" +
          "</div>" +
        "</section>" +
      "</div>"
    );
  }

  function renderGlowHubView() {
    const products = dbState.products || [];
    const brands = ["Davines", "Keune", "Kérastase"];

    const brandCardsHtml = [
      '<button type="button" class="brand-select-card ' + (uiState.selectedBrand === "ALL" ? "active" : "") + '" data-brand="ALL">' +
        '<div class="brand-all-badge">TODAS</div>' +
        "<span>" + products.length + " itens</span>" +
      "</button>"
    ].concat(brands.map(function (b) {
      const count = products.filter(function (p) { return p.brand === b; }).length;
      const inStock = products.filter(function (p) { return p.brand === b && Number(p.stock) > 0; }).length;
      return (
        '<button type="button" class="brand-select-card ' + (uiState.selectedBrand === b ? "active" : "") + '" data-brand="' + escapeHtml(b) + '">' +
          '<img src="' + escapeHtml(BRAND_LOGOS[b]) + '" alt="' + escapeHtml(b) + '" class="brand-card-logo" />' +
          '<div class="brand-card-meta">' +
            "<strong>" + escapeHtml(b) + "</strong>" +
            "<span>" + count + " itens (" + inStock + " disp.)</span>" +
          "</div>" +
        "</button>"
      );
    })).join("");

    // Categories for currently selected brand
    const categoriesSet = {};
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (uiState.selectedBrand === "ALL" || p.brand === uiState.selectedBrand) {
        if (p.category) categoriesSet[p.category] = true;
      }
    }
    const categories = Object.keys(categoriesSet).sort();

    const filtered = root.PDVDomain.filterProducts(products, {
      brand: uiState.selectedBrand,
      category: uiState.selectedCategory,
      query: uiState.productQuery,
      onlyInStock: uiState.onlyInStock
    });

    const cartQtyById = {};
    const cartItems = (uiState.cart && uiState.cart.items) || [];
    for (let i = 0; i < cartItems.length; i++) {
      cartQtyById[cartItems[i].itemId] = cartItems[i].qty;
    }

    const cardsHtml = filtered.map(function (p) {
      const stock = Number(p.stock) || 0;
      const inCart = cartQtyById[p.id] || 0;
      const remaining = stock - inCart;
      const isOut = stock <= 0;
      const needsAdjust = isOut || remaining <= 0;
      const excessCount = Math.max(0, inCart - Math.max(0, stock));
      const hasDiscount = p.regularPriceCents && p.regularPriceCents > p.priceCents;

      const stockBadgeText = isOut
        ? "Estoque: " + stock + " un. • Venda c/ Ajuste"
        : remaining <= 0
          ? "Estoque: " + stock + " un. (Ajuste +" + Math.max(1, excessCount) + ")"
          : "Estoque: " + stock + " un.";

      const addBtnText = isOut
        ? (inCart > 0 ? "+ Adicionar (" + inCart + " • Ajuste)" : "+ Adicionar (c/ Ajuste)")
        : remaining <= 0
          ? "+ Adicionar (Ajuste +" + (excessCount + 1) + ")"
          : inCart > 0
            ? "+ Adicionar (" + inCart + " no carrinho)"
            : "+ Adicionar";

      return (
        '<article class="catalog-card ' + (needsAdjust ? "card-stock-adjust" : "") + '" data-product-id="' + escapeHtml(p.id) + '">' +
          '<div class="card-top-badges">' +
            '<span class="badge-brand">' + escapeHtml(p.brand) + "</span>" +
            '<span class="badge-stock ' + (needsAdjust ? "stock-adjust" : stock <= 2 ? "stock-low" : "stock-ok") + '">' +
              escapeHtml(stockBadgeText) +
            "</span>" +
          "</div>" +
          '<h3 class="card-title">' + escapeHtml(p.name) + "</h3>" +
          '<div class="card-tags-row">' +
            (p.line ? '<span class="tag-pill">' + escapeHtml(p.line) + "</span>" : "") +
            (p.category ? '<span class="tag-pill">' + escapeHtml(p.category) + "</span>" : "") +
            (p.sizeLabel ? '<span class="tag-pill">' + escapeHtml(p.sizeLabel) + "</span>" : "") +
          "</div>" +
          (p.benefit ? '<p class="card-benefit">✨ ' + escapeHtml(p.benefit) + (p.needGroup ? " • " + escapeHtml(p.needGroup) : "") + "</p>" : "") +
          '<div class="card-bottom-row">' +
            '<div class="price-block">' +
              (hasDiscount ? '<span class="price-old">De ' + root.PDVDomain.formatBRLFromCents(p.regularPriceCents) + "</span>" : "") +
              '<strong class="price-current">' + root.PDVDomain.formatBRLFromCents(p.priceCents) + "</strong>" +
            "</div>" +
            '<button type="button" class="btn-add-item ' + (inCart > 0 ? "in-cart" : "") + (needsAdjust ? " btn-add-adjust" : "") + '" ' +
              'data-add-product="' + escapeHtml(p.id) + '">' +
              escapeHtml(addBtnText) +
            "</button>" +
          "</div>" +
        "</article>"
      );
    }).join("");

    return (
      '<section class="catalog-view" aria-label="Catálogo de Produtos Glow Hub">' +
        '<div class="catalog-header-banner glow-banner">' +
          '<div class="banner-left">' +
            '<img src="assets/glowhub-logo.png" alt="Glow Hub" class="banner-logo" />' +
            "<div>" +
              "<h1>Catálogo Glow Hub — Produtos</h1>" +
              "<p>Selecione a marca abaixo e busque por nome, linha, categoria ou benefício.</p>" +
            "</div>" +
          "</div>" +
          '<button type="button" class="btn-back-menu" data-action="go-home">← Menu Principal</button>' +
        "</div>" +

        '<div class="brands-selector-row" role="tablist" aria-label="Seleção de Marcas Glow Hub">' +
          brandCardsHtml +
        "</div>" +

        '<div class="catalog-filters-bar">' +
          '<div class="search-input-wrap">' +
            '<input type="search" id="input-product-search" class="input-touch" ' +
              'placeholder="Buscar produto, linha (ex: Genesis, OI, Blonde), shampoo, máscara..." ' +
              'value="' + escapeHtml(uiState.productQuery) + '" />' +
            (uiState.productQuery
              ? '<button type="button" class="btn-clear-search" id="btn-clear-product-search" title="Limpar busca">✕</button>'
              : "") +
          "</div>" +
          '<select id="select-product-category" class="select-touch" aria-label="Filtrar por categoria">' +
            '<option value="ALL">Todas as Categorias</option>' +
            categories.map(function (c) {
              return '<option value="' + escapeHtml(c) + '" ' + (uiState.selectedCategory === c ? "selected" : "") + ">" + escapeHtml(c) + "</option>";
            }).join("") +
          "</select>" +
          '<label class="checkbox-touch">' +
            '<input type="checkbox" id="chk-only-instock" ' + (uiState.onlyInStock ? "checked" : "") + " />" +
            "<span>Apenas disponíveis</span>" +
          "</label>" +
        "</div>" +

        '<div class="catalog-results-meta">' +
          "<span>Exibindo <strong>" + filtered.length + "</strong> produto(s)" +
            (uiState.selectedBrand !== "ALL" ? " da marca <strong>" + escapeHtml(uiState.selectedBrand) + "</strong>" : "") +
          "</span>" +
        "</div>" +

        '<div class="catalog-cards-grid" id="glowhub-cards-grid">' +
          (cardsHtml || '<div class="empty-catalog-box"><p>Nenhum produto encontrado para o filtro selecionado.</p></div>') +
        "</div>" +
      "</section>"
    );
  }

  function renderBentoClubView() {
    const clubs = dbState.clubs || [];
    const clubMetaList = dbState.clubsMeta || [];

    const clubTabsHtml = [
      '<button type="button" class="club-select-card ' + (uiState.selectedClub === "ALL" ? "active" : "") + '" data-club="ALL">' +
        "<strong>Todos os Clubes</strong>" +
        "<span>" + clubs.length + " opções</span>" +
      "</button>"
    ].concat(clubMetaList.map(function (cm) {
      return (
        '<button type="button" class="club-select-card ' + (uiState.selectedClub === cm.id ? "active" : "") + '" data-club="' + escapeHtml(cm.id) + '">' +
          "<strong>" + escapeHtml(cm.name) + "</strong>" +
          "<span>" + cm.count + " opções • " + escapeHtml(cm.subtitle) + "</span>" +
        "</button>"
      );
    })).join("");

    const filtered = root.PDVDomain.filterClubs(clubs, {
      club: uiState.selectedClub,
      query: uiState.clubQuery
    });

    const cartQtyById = {};
    const cartItems = (uiState.cart && uiState.cart.items) || [];
    for (let i = 0; i < cartItems.length; i++) {
      cartQtyById[cartItems[i].itemId] = cartItems[i].qty;
    }

    const cardsHtml = filtered.map(function (c) {
      const inCart = cartQtyById[c.id] || 0;
      const isMaintenance = c.originalClub !== c.club;
      const perSessionCents = c.sessions > 0 ? Math.round(c.priceCents / c.sessions) : c.priceCents;

      return (
        '<article class="catalog-card club-card" data-club-id="' + escapeHtml(c.id) + '">' +
          '<div class="card-top-badges">' +
            '<span class="badge-club">' + escapeHtml(c.club) + "</span>" +
            '<span class="badge-sessions">' + c.sessions + " sessões</span>" +
          "</div>" +
          (isMaintenance
            ? '<div class="club-subcat-banner">Inclui Modalidade: <strong>' + escapeHtml(c.originalClub) + "</strong></div>"
            : "") +
          '<h3 class="card-title">' + escapeHtml(c.option) + (c.size ? " — " + escapeHtml(c.size) : "") + "</h3>" +
          '<div class="card-tags-row">' +
            '<span class="tag-pill">⏱ Validade: ' + escapeHtml(c.validity) + "</span>" +
            (c.size ? '<span class="tag-pill">Tamanho: ' + escapeHtml(c.size) + "</span>" : "") +
            '<span class="tag-pill">' + root.PDVDomain.formatBRLFromCents(perSessionCents) + "/sessão</span>" +
          "</div>" +
          '<div class="card-bottom-row">' +
            '<div class="price-block">' +
              '<span class="price-label">Pacote ' + c.sessions + " sessões</span>" +
              '<strong class="price-current">' + root.PDVDomain.formatBRLFromCents(c.priceCents) + "</strong>" +
            "</div>" +
            '<button type="button" class="btn-add-item ' + (inCart > 0 ? "in-cart" : "") + '" data-add-club="' + escapeHtml(c.id) + '">' +
              (inCart > 0 ? "+ Adicionar (" + inCart + " no carrinho)" : "+ Adicionar") +
            "</button>" +
          "</div>" +
        "</article>"
      );
    }).join("");

    return (
      '<section class="catalog-view" aria-label="Catálogo de Assinaturas BentoClub">' +
        '<div class="catalog-header-banner club-banner">' +
          '<div class="banner-left">' +
            '<img src="assets/bentoclub-logo.png" alt="BentoClub" class="banner-logo" />' +
            "<div>" +
              "<h1>Catálogo BentoClub — Assinaturas</h1>" +
              "<p>Escolha o clube desejado (Escova, Unha Clássica, Esmaltação em Gel + Manutenção de Alongamento, Massagem, Maquiagem ou Cor).</p>" +
            "</div>" +
          "</div>" +
          '<button type="button" class="btn-back-menu" data-action="go-home">← Menu Principal</button>' +
        "</div>" +

        '<div class="clubs-selector-grid" role="tablist" aria-label="Seleção de Clubes BentoClub">' +
          clubTabsHtml +
        "</div>" +

        '<div class="catalog-filters-bar">' +
          '<div class="search-input-wrap">' +
            '<input type="search" id="input-club-search" class="input-touch" ' +
              'placeholder="Buscar opção (ex: Modelada, Alongamento, Fibra, Extra Longo, Glow Ups, Raiz)..." ' +
              'value="' + escapeHtml(uiState.clubQuery) + '" />' +
            (uiState.clubQuery
              ? '<button type="button" class="btn-clear-search" id="btn-clear-club-search" title="Limpar busca">✕</button>'
              : "") +
          "</div>" +
        "</div>" +

        '<div class="catalog-results-meta">' +
          "<span>Exibindo <strong>" + filtered.length + "</strong> opção(ões) de assinatura" +
            (uiState.selectedClub !== "ALL" ? " em <strong>" + escapeHtml(uiState.selectedClub) + "</strong>" : "") +
          "</span>" +
        "</div>" +

        '<div class="catalog-cards-grid" id="bentoclub-cards-grid">' +
          (cardsHtml || '<div class="empty-catalog-box"><p>Nenhuma assinatura encontrada para o filtro informado.</p></div>') +
        "</div>" +
      "</section>"
    );
  }

  function formatCentsForInput(cents) {
    return (Math.round(Number(cents) || 0) / 100).toFixed(2).replace(".", ",");
  }

  function loadDiscrepancyInputsForDate(dateFilter) {
    const key = dateFilter || "ALL";
    const saved = (dbState && dbState.cashClosings && dbState.cashClosings[key]) || null;
    const nextInputs = {};
    if (saved && saved.declaredByPayment) {
      root.PDVDomain.VALID_PAYMENT_METHODS.forEach(function (m) {
        if (saved.declaredByPayment[m] !== undefined && saved.declaredByPayment[m] !== null) {
          nextInputs[m] = formatCentsForInput(saved.declaredByPayment[m]);
        }
      });
    }
    uiState.discrepancyInputs = nextInputs;
    uiState.discrepancyNotes = (saved && saved.notes) || "";
  }

  function getCurrentDeclaredPaymentsCents() {
    const out = {};
    const keys = Object.keys(uiState.discrepancyInputs || {});
    for (let i = 0; i < keys.length; i++) {
      const m = keys[i];
      const raw = String(uiState.discrepancyInputs[m] || "").trim();
      if (raw !== "") {
        out[m] = root.PDVDomain.parseBRLToCents(raw);
      }
    }
    return out;
  }

  function renderClosingCashSection(closing) {
    const cash = closing.cashReport;
    const grandTotal = cash.totals.totalCents;
    const glowShare = grandTotal > 0 ? Math.round((cash.totals.glowHubCents * 100) / grandTotal) : 0;
    const clubShare = grandTotal > 0 ? Math.round((cash.totals.bentoClubCents * 100) / grandTotal) : 0;

    const rowsHtml = cash.rows.map(function (r) {
      const pct = grandTotal > 0 ? Math.round((r.totalCents * 100) / grandTotal) : 0;
      return (
        "<tr>" +
          '<td data-label="Forma de Pagamento"><strong>' + escapeHtml(r.method) + "</strong></td>" +
          '<td data-label="Qtd. Vendas">' + r.ordersCount + "</td>" +
          '<td data-label="Glow Hub (Produtos)">' + root.PDVDomain.formatBRLFromCents(r.glowHubCents) + "</td>" +
          '<td data-label="BentoClub (Clubes)">' + root.PDVDomain.formatBRLFromCents(r.bentoClubCents) + "</td>" +
          '<td data-label="Total Geral"><strong>' + root.PDVDomain.formatBRLFromCents(r.totalCents) + "</strong></td>" +
          '<td data-label="% Participação">' + pct + "%</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<div class="closing-section-wrap" id="tab-closing-cash">' +
        '<div class="admin-kpi-grid">' +
          '<div class="kpi-card kpi-total">' +
            '<span class="kpi-label">Total Líquido no Caixa (' + escapeHtml(closing.dateFilter === "ALL" ? "Todo o Período" : closing.dateFilter) + ")</span>" +
            '<strong class="kpi-value">' + root.PDVDomain.formatBRLFromCents(grandTotal) + "</strong>" +
            '<span class="kpi-foot">' + cash.totals.ordersCount + " venda(s) concluída(s)</span>" +
          "</div>" +
          '<div class="kpi-card kpi-glow">' +
            '<span class="kpi-label">Produtos — Glow Hub</span>' +
            '<strong class="kpi-value">' + root.PDVDomain.formatBRLFromCents(cash.totals.glowHubCents) + "</strong>" +
            '<span class="kpi-foot">' + glowShare + "% do faturamento do período</span>" +
          "</div>" +
          '<div class="kpi-card kpi-club">' +
            '<span class="kpi-label">Clubes — BentoClub</span>' +
            '<strong class="kpi-value">' + root.PDVDomain.formatBRLFromCents(cash.totals.bentoClubCents) + "</strong>" +
            '<span class="kpi-foot">' + clubShare + "% do faturamento do período</span>" +
          "</div>" +
        "</div>" +

        '<div class="report-customer-card">' +
          '<div class="report-cust-header">' +
            "<div>" +
              "<h3>Fechamento de Caixa por Forma de Pagamento × Segmento</h3>" +
              '<span class="report-cust-phone">Valores líquidos recebidos (já descontando eventual troco em dinheiro), distinguindo Produtos Glow Hub e Assinaturas BentoClub.</span>' +
            "</div>" +
          "</div>" +
          '<div class="report-table-wrap">' +
            '<table class="report-items-table">' +
              "<thead>" +
                "<tr>" +
                  "<th>Forma de Pagamento</th>" +
                  "<th>Qtd. Pedidos</th>" +
                  "<th>Produtos (Glow Hub)</th>" +
                  "<th>Clubes (BentoClub)</th>" +
                  "<th>Total no Caixa</th>" +
                  "<th>% Caixa</th>" +
                "</tr>" +
              "</thead>" +
              "<tbody>" + rowsHtml + "</tbody>" +
              "<tfoot>" +
                '<tr class="table-total-row">' +
                  '<td data-label="Resumo"><strong>TOTAL DO CAIXA</strong></td>' +
                  '<td data-label="Qtd. Vendas"><strong>' + cash.totals.ordersCount + "</strong></td>" +
                  '<td data-label="Glow Hub (Produtos)"><strong>' + root.PDVDomain.formatBRLFromCents(cash.totals.glowHubCents) + "</strong></td>" +
                  '<td data-label="BentoClub (Clubes)"><strong>' + root.PDVDomain.formatBRLFromCents(cash.totals.bentoClubCents) + "</strong></td>" +
                  '<td data-label="Total Geral"><strong>' + root.PDVDomain.formatBRLFromCents(grandTotal) + "</strong></td>" +
                  '<td data-label="% Participação"><strong>' + (grandTotal > 0 ? "100%" : "0%") + "</strong></td>" +
                "</tr>" +
              "</tfoot>" +
            "</table>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function renderDiscrepancySection(closing) {
    const disc = closing.discrepancyReport;
    const stockAdj = disc.stockAdjustments;

    const discRowsHtml = disc.rows.map(function (row) {
      const inputVal = uiState.discrepancyInputs && uiState.discrepancyInputs[row.method] !== undefined
        ? uiState.discrepancyInputs[row.method]
        : (row.hasDeclared ? formatCentsForInput(row.declaredCents) : "");
      const statusClass = "status-" + row.status.toLowerCase();
      const diffFormatted = row.hasDeclared
        ? (row.discrepancyCents > 0 ? "+" : "") + root.PDVDomain.formatBRLFromCents(row.discrepancyCents)
        : "—";

      return (
        '<tr data-disc-row="' + escapeHtml(row.method) + '">' +
          '<td data-label="Forma de Pagamento"><strong>' + escapeHtml(row.method) + "</strong></td>" +
          '<td data-label="Glow Hub">' + root.PDVDomain.formatBRLFromCents(row.glowHubCents) + "</td>" +
          '<td data-label="BentoClub">' + root.PDVDomain.formatBRLFromCents(row.bentoClubCents) + "</td>" +
          '<td data-label="Previsto Sistema"><strong>' + root.PDVDomain.formatBRLFromCents(row.expectedCents) + "</strong></td>" +
          '<td data-label="Valor Conferido">' +
            '<input type="text" class="input-touch input-discrepancy" data-discrepancy-method="' + escapeHtml(row.method) + '" ' +
              'placeholder="' + escapeHtml(formatCentsForInput(row.expectedCents)) + '" value="' + escapeHtml(inputVal) + '" />' +
          "</td>" +
          '<td data-label="Discrepância" data-disc-diff="' + escapeHtml(row.method) + '"><strong>' + escapeHtml(diffFormatted) + "</strong></td>" +
          '<td data-label="Situação" data-disc-status="' + escapeHtml(row.method) + '"><span class="discrepancy-pill ' + statusClass + '">' + escapeHtml(row.status) + "</span></td>" +
        "</tr>"
      );
    }).join("");

    const adjRowsHtml = stockAdj.items.map(function (adj) {
      const dt = adj.createdAt ? new Date(adj.createdAt).toLocaleString("pt-BR") : "";
      return (
        "<tr>" +
          '<td data-label="Data/Hora">' + escapeHtml(dt) + "</td>" +
          '<td data-label="Venda"><code>' + escapeHtml(adj.saleId) + "</code></td>" +
          '<td data-label="Marca">' + escapeHtml(adj.brand) + "</td>" +
          '<td data-label="Produto"><strong>' + escapeHtml(adj.productName) + "</strong></td>" +
          '<td data-label="Est. Anterior">' + adj.stockBefore + " un.</td>" +
          '<td data-label="Qtd. Vendida">' + adj.soldQty + " un.</td>" +
          '<td data-label="Ajuste Aplicado"><span class="stock-adj-pill">+' + adj.adjustmentQty + " un.</span></td>" +
          '<td data-label="Valor Ajuste"><strong>' + root.PDVDomain.formatBRLFromCents(adj.adjustmentValueCents) + "</strong></td>" +
          '<td data-label="Cliente">' + escapeHtml((adj.client && adj.client.name) || "") + "</td>" +
          '<td data-label="Emissor">' + escapeHtml((adj.seller && (adj.seller.name || adj.seller.shortName)) || "") + "</td>" +
        "</tr>"
      );
    }).join("");

    const totalStatusClass = "status-" + disc.totals.status.toLowerCase();
    const totalDiffFormatted = disc.totals.checkedMethodsCount > 0
      ? (disc.totals.discrepancyCents > 0 ? "+" : "") + root.PDVDomain.formatBRLFromCents(disc.totals.discrepancyCents)
      : "—";

    return (
      '<div class="closing-section-wrap" id="tab-discrepancy">' +
        '<div class="report-customer-card">' +
          '<div class="report-cust-header">' +
            "<div>" +
              "<h3>1. Conferência e Discrepância Financeira de Caixa</h3>" +
              '<span class="report-cust-phone">Informe o valor físico/comprovado conferido no caixa por forma de pagamento para calcular sobra ou falta.</span>' +
            "</div>" +
            '<div class="discrepancy-actions">' +
              '<button type="button" class="btn-outline btn-sm" id="btn-fill-expected-cash">Preencher c/ Sistema</button>' +
              '<button type="button" class="btn-primary btn-sm" id="btn-save-cash-closing">💾 Salvar Conferência</button>' +
            "</div>" +
          "</div>" +
          (disc.closingMeta && disc.closingMeta.updatedAt
            ? '<p class="closing-saved-meta">Última conferência salva em <strong>' + escapeHtml(new Date(disc.closingMeta.updatedAt).toLocaleString("pt-BR")) + "</strong> por <strong>" + escapeHtml(disc.closingMeta.closedBy || "") + "</strong></p>"
            : "") +
          '<div class="report-table-wrap">' +
            '<table class="report-items-table">' +
              "<thead>" +
                "<tr>" +
                  "<th>Forma de Pagamento</th>" +
                  "<th>Produtos (R$)</th>" +
                  "<th>Clubes (R$)</th>" +
                  "<th>Esperado Sistema</th>" +
                  "<th>Valor Conferido (R$)</th>" +
                  "<th>Discrepância</th>" +
                  "<th>Situação</th>" +
                "</tr>" +
              "</thead>" +
              "<tbody>" + discRowsHtml + "</tbody>" +
              "<tfoot>" +
                '<tr class="table-total-row">' +
                  '<td data-label="Resumo"><strong>CONFERÊNCIA TOTAL</strong></td>' +
                  '<td data-label="Produtos (R$)">' + root.PDVDomain.formatBRLFromCents(closing.cashReport.totals.glowHubCents) + "</td>" +
                  '<td data-label="Clubes (R$)">' + root.PDVDomain.formatBRLFromCents(closing.cashReport.totals.bentoClubCents) + "</td>" +
                  '<td data-label="Esperado Sistema"><strong>' + root.PDVDomain.formatBRLFromCents(disc.totals.expectedCents) + "</strong></td>" +
                  '<td data-label="Valor Conferido" id="disc-total-declared"><strong>' + root.PDVDomain.formatBRLFromCents(disc.totals.declaredCheckedCents) + "</strong></td>" +
                  '<td data-label="Discrepância" id="disc-total-diff"><strong>' + escapeHtml(totalDiffFormatted) + "</strong></td>" +
                  '<td data-label="Situação" id="disc-total-status"><span class="discrepancy-pill ' + totalStatusClass + '">' + escapeHtml(disc.totals.status) + "</span></td>" +
                "</tr>" +
              "</tfoot>" +
            "</table>" +
          "</div>" +
          '<div class="discrepancy-notes-wrap">' +
            '<input type="text" id="input-discrepancy-notes" class="input-touch" placeholder="Observações ou justificativa de discrepância no fechamento de caixa..." value="' + escapeHtml(uiState.discrepancyNotes || (disc.closingMeta && disc.closingMeta.notes) || "") + '" />' +
          "</div>" +
        "</div>" +

        '<div class="report-customer-card">' +
          '<div class="report-cust-header">' +
            "<div>" +
              "<h3>2. Registro de Ajustes de Estoque Negativo (Discrepância de Estoque)</h3>" +
              '<span class="report-cust-phone">Ajustes automáticos necessários para viabilizar vendas de produtos com estoque insuficiente ou zerado.</span>' +
            "</div>" +
            '<div class="report-cust-totals">' +
              '<span class="sub-pill club">' + stockAdj.totalAdjustmentsCount + " ocorrência(s)</span>" +
              '<span class="sub-pill glow">+' + stockAdj.totalAdjustedUnits + " un. ajustadas</span>" +
              '<strong class="cust-grand-total">' + root.PDVDomain.formatBRLFromCents(stockAdj.totalAdjustedValueCents) + "</strong>" +
            "</div>" +
          "</div>" +
          (adjRowsHtml
            ? '<div class="report-table-wrap">' +
                '<table class="report-items-table">' +
                  "<thead>" +
                    "<tr>" +
                      "<th>Data/Hora</th>" +
                      "<th>Pedido</th>" +
                      "<th>Marca</th>" +
                      "<th>Produto</th>" +
                      "<th>Est. Anterior</th>" +
                      "<th>Qtd. Vendida</th>" +
                      "<th>Ajuste Aplicado</th>" +
                      "<th>Valor Ajuste</th>" +
                      "<th>Cliente</th>" +
                      "<th>Emissor da Venda</th>" +
                    "</tr>" +
                  "</thead>" +
                  "<tbody>" + adjRowsHtml + "</tbody>" +
                "</table>" +
              "</div>"
            : '<div class="empty-catalog-box"><p>Nenhum ajuste de estoque negativo registrado para o período selecionado.</p></div>') +
        "</div>" +
      "</div>"
    );
  }

  function renderSalesListSection(closing) {
    const salesRep = closing.salesReport;
    const rowsHtml = salesRep.lines.map(function (line) {
      const dt = line.createdAt ? new Date(line.createdAt).toLocaleString("pt-BR") : "";
      return (
        "<tr>" +
          '<td data-label="Data/Hora">' + escapeHtml(dt) + "</td>" +
          '<td data-label="Pedido"><code>' + escapeHtml(line.saleId) + "</code></td>" +
          '<td data-label="Tipo"><span class="seg-badge ' + (line.segment === "glow_hub" ? "glow" : "club") + '">' + escapeHtml(line.segmentLabel) + "</span></td>" +
          '<td data-label="Marca / Clube">' + escapeHtml(line.brandOrClub) + "</td>" +
          '<td data-label="Produto / Pacote"><strong>' + escapeHtml(line.itemName) + "</strong></td>" +
          '<td data-label="Qtd"><strong>' + line.qty + "</strong></td>" +
          '<td data-label="Unitário">' + root.PDVDomain.formatBRLFromCents(line.unitPriceCents) + "</td>" +
          '<td data-label="Valor Total"><strong>' + root.PDVDomain.formatBRLFromCents(line.subtotalCents) + "</strong></td>" +
          '<td data-label="Ajuste Estoque">' + (line.adjustmentQty > 0 ? '<span class="stock-adj-pill">+' + line.adjustmentQty + " un.</span>" : "—") + "</td>" +
          '<td data-label="Cliente"><strong>' + escapeHtml(line.clientName) + '</strong><br /><span class="table-sub-text">' + escapeHtml(line.clientPhoneFormatted) + "</span></td>" +
          '<td data-label="Emissor"><strong>' + escapeHtml(line.sellerName) + "</strong></td>" +
          '<td data-label="Pagamento">' + escapeHtml(line.paymentSummary) + "</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<div class="closing-section-wrap" id="tab-sales-list">' +
        '<div class="report-summary-strip">' +
          "<div>Pedidos no período: <strong>" + salesRep.totals.ordersCount + "</strong></div>" +
          "<div>Itens vendidos: <strong>" + salesRep.totals.totalQty + " (" + salesRep.totals.linesCount + " linhas)</strong></div>" +
          "<div>Total das Vendas Filtradas: <strong>" + root.PDVDomain.formatBRLFromCents(salesRep.totals.totalCents) + "</strong></div>" +
        "</div>" +
        '<div class="report-customer-card">' +
          (rowsHtml
            ? '<div class="report-table-wrap">' +
                '<table class="report-items-table">' +
                  "<thead>" +
                    "<tr>" +
                      "<th>Data/Hora</th>" +
                      "<th>Pedido</th>" +
                      "<th>Tipo</th>" +
                      "<th>Marca / Clube</th>" +
                      "<th>Produto / Pacote</th>" +
                      "<th>Qtd</th>" +
                      "<th>Unitário</th>" +
                      "<th>Valor Total</th>" +
                      "<th>Ajuste Est.</th>" +
                      "<th>Cliente</th>" +
                      "<th>Emissor da Venda</th>" +
                      "<th>Pagamento</th>" +
                    "</tr>" +
                  "</thead>" +
                  "<tbody>" + rowsHtml + "</tbody>" +
                "</table>" +
              "</div>"
            : '<div class="empty-catalog-box"><p>Nenhuma venda encontrada para a data e filtros selecionados.</p></div>') +
        "</div>" +
      "</div>"
    );
  }

  function renderClientsDaySection(closing) {
    const regRep = closing.registeredClientsReport;
    const rowsHtml = regRep.items.map(function (c) {
      const dt = c.timestamp ? new Date(c.timestamp).toLocaleString("pt-BR") : "";
      const isNew = c.registrationType === "Novo Cadastro";
      return (
        "<tr>" +
          '<td data-label="Data/Hora">' + escapeHtml(dt) + "</td>" +
          '<td data-label="Tipo"><span class="discrepancy-pill ' + (isNew ? "status-correto" : "status-sobra") + '">' + escapeHtml(c.registrationType) + "</span></td>" +
          '<td data-label="Cliente"><strong>' + escapeHtml(c.name) + "</strong></td>" +
          '<td data-label="Celular">' + escapeHtml(c.phoneFormatted) + "</td>" +
          '<td data-label="Compras">' + c.ordersCount + " pedido(s)</td>" +
          '<td data-label="Valor Comprado"><strong>' + root.PDVDomain.formatBRLFromCents(c.totalSpentCents) + "</strong></td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<div class="closing-section-wrap" id="tab-clients-day">' +
        '<div class="report-summary-strip">' +
          "<div>Total no período: <strong>" + regRep.totals.totalCount + " cliente(s)</strong></div>" +
          "<div>Novos Cadastros: <strong>" + regRep.totals.newCount + "</strong></div>" +
          "<div>Celulares Atualizados: <strong>" + regRep.totals.updatedCount + "</strong></div>" +
        "</div>" +
        '<div class="report-customer-card">' +
          (rowsHtml
            ? '<div class="report-table-wrap">' +
                '<table class="report-items-table">' +
                  "<thead>" +
                    "<tr>" +
                      "<th>Data/Hora do Registro</th>" +
                      "<th>Tipo</th>" +
                      "<th>Nome do Cliente</th>" +
                      "<th>Celular</th>" +
                      "<th>Compras no Período</th>" +
                      "<th>Valor Comprado</th>" +
                    "</tr>" +
                  "</thead>" +
                  "<tbody>" + rowsHtml + "</tbody>" +
                "</table>" +
              "</div>"
            : '<div class="empty-catalog-box"><p>Nenhum cliente novo cadastrado ou atualizado na data selecionada.</p></div>') +
        "</div>" +
      "</div>"
    );
  }

  function getFilteredClientsHistoryReport() {
    const sales = (dbState && dbState.sales) || [];
    const dateFilteredSales = uiState.reportDateFilter && uiState.reportDateFilter !== "ALL"
      ? sales.filter(function (s) {
          return root.PDVDomain.getLocalDateKey(s.createdAt) === uiState.reportDateFilter;
        })
      : sales;

    const reportRows = root.PDVDomain.buildCustomerSalesReport(dateFilteredSales, {
      query: uiState.reportQuery,
      segment: uiState.reportSegment,
      paymentMethod: uiState.reportPaymentMethod,
      sellerId: uiState.reportSellerId
    });

    let filteredTotalCents = 0;
    let filteredTotalItems = 0;
    for (let i = 0; i < reportRows.length; i++) {
      filteredTotalCents += reportRows[i].totalCents;
      filteredTotalItems += reportRows[i].itemsCount;
    }

    return {
      rows: reportRows,
      totalCents: filteredTotalCents,
      totalItems: filteredTotalItems
    };
  }

  function getClosingReportData() {
    return root.PDVDomain.buildDailyClosingReport(dbState, {
      dateFilter: uiState.reportDateFilter,
      sellerId: uiState.reportSellerId,
      query: uiState.reportQuery,
      declaredPayments: getCurrentDeclaredPaymentsCents()
    });
  }

  function formatReportPeriodLabel(dateFilter) {
    if (!dateFilter || dateFilter === "ALL") return "Todo o Período";
    return dateFilter.split("-").reverse().join("/");
  }

  function formatSignedBRLFromCents(cents) {
    const val = Number(cents) || 0;
    return (val > 0 ? "+" : "") + root.PDVDomain.formatBRLFromCents(val);
  }

  function renderClientsHistorySection() {
    const historyData = getFilteredClientsHistoryReport();
    const reportRows = historyData.rows;
    const filteredTotalCents = historyData.totalCents;
    const filteredTotalItems = historyData.totalItems;

    const customerCardsHtml = reportRows.map(function (cust) {
      const itemsRowsHtml = cust.purchases.map(function (pur) {
        const dt = pur.createdAt ? new Date(pur.createdAt).toLocaleString("pt-BR") : "";
        return (
          "<tr>" +
            '<td data-label="Data/Hora">' + escapeHtml(dt) + "</td>" +
            '<td data-label="Segmento"><span class="seg-badge ' + (pur.segment === "glow_hub" ? "glow" : "club") + '">' + escapeHtml(pur.segmentLabel) + "</span></td>" +
            '<td data-label="Marca/Clube">' + escapeHtml(pur.groupName) + "</td>" +
            '<td data-label="Item Adquirido"><strong>' + escapeHtml(pur.itemName) + "</strong></td>" +
            '<td data-label="Qtd">' + pur.qty + "</td>" +
            '<td data-label="Unitário">' + root.PDVDomain.formatBRLFromCents(pur.unitPriceCents) + "</td>" +
            '<td data-label="Subtotal"><strong>' + root.PDVDomain.formatBRLFromCents(pur.lineTotalCents) + "</strong></td>" +
            '<td data-label="Emissor">' + escapeHtml(pur.sellerName) + "</td>" +
            '<td data-label="Pagamento">' + escapeHtml(pur.paymentSummary) + "</td>" +
          "</tr>"
        );
      }).join("");

      return (
        '<article class="report-customer-card">' +
          '<div class="report-cust-header">' +
            "<div>" +
              "<h3>" + escapeHtml(cust.clientName) + "</h3>" +
              '<span class="report-cust-phone">📱 ' + escapeHtml(root.PDVDomain.formatPhoneDisplay(cust.clientPhone)) + " • " + cust.ordersCount + " pedido(s) • " + cust.itemsCount + " item(ns)</span>" +
            "</div>" +
            '<div class="report-cust-totals">' +
              (cust.glowHubCents > 0 ? '<span class="sub-pill glow">Glow Hub: ' + root.PDVDomain.formatBRLFromCents(cust.glowHubCents) + "</span>" : "") +
              (cust.bentoClubCents > 0 ? '<span class="sub-pill club">BentoClub: ' + root.PDVDomain.formatBRLFromCents(cust.bentoClubCents) + "</span>" : "") +
              '<strong class="cust-grand-total">' + root.PDVDomain.formatBRLFromCents(cust.totalCents) + "</strong>" +
            "</div>" +
          "</div>" +
          '<div class="report-table-wrap">' +
            '<table class="report-items-table">' +
              "<thead>" +
                "<tr>" +
                  "<th>Data/Hora</th>" +
                  "<th>Segmento</th>" +
                  "<th>Marca/Clube</th>" +
                  "<th>Item Adquirido</th>" +
                  "<th>Qtd</th>" +
                  "<th>Unitário</th>" +
                  "<th>Subtotal</th>" +
                  "<th>Emissor</th>" +
                  "<th>Pagamento</th>" +
                "</tr>" +
              "</thead>" +
              "<tbody>" + itemsRowsHtml + "</tbody>" +
            "</table>" +
          "</div>" +
        "</article>"
      );
    }).join("");

    return (
      '<div class="closing-section-wrap" id="tab-clients-history">' +
        '<div class="catalog-filters-bar history-extra-filters">' +
          '<select id="select-report-segment" class="select-touch">' +
            '<option value="">Todos os Segmentos</option>' +
            '<option value="glow_hub" ' + (uiState.reportSegment === "glow_hub" ? "selected" : "") + ">Produtos Glow Hub</option>" +
            '<option value="bento_club" ' + (uiState.reportSegment === "bento_club" ? "selected" : "") + ">Assinaturas BentoClub</option>" +
          "</select>" +
          '<select id="select-report-payment" class="select-touch">' +
            '<option value="">Todas as Formas de Pagamento</option>' +
            root.PDVDomain.VALID_PAYMENT_METHODS.map(function (m) {
              return '<option value="' + escapeHtml(m) + '" ' + (uiState.reportPaymentMethod === m ? "selected" : "") + ">" + escapeHtml(m) + "</option>";
            }).join("") +
          "</select>" +
        "</div>" +
        '<div class="report-summary-strip">' +
          "<div>Clientes listados: <strong>" + reportRows.length + "</strong></div>" +
          "<div>Itens vendidos: <strong>" + filteredTotalItems + "</strong></div>" +
          "<div>Volume Total Filtrado: <strong>" + root.PDVDomain.formatBRLFromCents(filteredTotalCents) + "</strong></div>" +
        "</div>" +
        '<div class="report-customers-list" id="report-customers-list">' +
          (customerCardsHtml || '<div class="empty-catalog-box"><p>Nenhuma venda registrada para os filtros selecionados.</p></div>') +
        "</div>" +
      "</div>"
    );
  }

  function renderPrintCashSection(closing) {
    const cash = closing.cashReport;
    const grandTotal = cash.totals.totalCents;
    const rowsHtml = cash.rows.map(function (r) {
      const pct = grandTotal > 0 ? Math.round((r.totalCents * 100) / grandTotal) : 0;
      return (
        "<tr>" +
          "<td><strong>" + escapeHtml(r.method) + "</strong></td>" +
          '<td class="num">' + r.ordersCount + "</td>" +
          '<td class="num">' + root.PDVDomain.formatBRLFromCents(r.glowHubCents) + "</td>" +
          '<td class="num">' + root.PDVDomain.formatBRLFromCents(r.bentoClubCents) + "</td>" +
          '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(r.totalCents) + "</strong></td>" +
          '<td class="num">' + pct + "%</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<section class="print-section">' +
        '<h2 class="print-section-title">1. Relatório de Caixa por Forma de Pagamento (Produtos vs. Clubes)</h2>' +
        '<table class="print-table">' +
          "<thead>" +
            "<tr>" +
              '<th style="width:26%">Forma de Pagamento</th>' +
              '<th class="num" style="width:10%">Vendas</th>' +
              '<th class="num" style="width:19%">Glow Hub</th>' +
              '<th class="num" style="width:19%">BentoClub</th>' +
              '<th class="num" style="width:18%">Total Geral</th>' +
              '<th class="num" style="width:8%">%</th>' +
            "</tr>" +
          "</thead>" +
          "<tbody>" + rowsHtml + "</tbody>" +
          "<tfoot>" +
            '<tr class="print-total-row">' +
              "<td><strong>TOTAL DO CAIXA</strong></td>" +
              '<td class="num"><strong>' + cash.totals.ordersCount + "</strong></td>" +
              '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(cash.totals.glowHubCents) + "</strong></td>" +
              '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(cash.totals.bentoClubCents) + "</strong></td>" +
              '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(grandTotal) + "</strong></td>" +
              '<td class="num"><strong>' + (grandTotal > 0 ? "100%" : "0%") + "</strong></td>" +
            "</tr>" +
          "</tfoot>" +
        "</table>" +
      "</section>"
    );
  }

  function renderPrintDiscrepancySection(closing) {
    const disc = closing.discrepancyReport;
    const stockAdj = disc.stockAdjustments;
    const rowsHtml = disc.rows.map(function (row) {
      const declaredTxt = row.hasDeclared ? root.PDVDomain.formatBRLFromCents(row.declaredCents) : "Não informado";
      const diffTxt = row.hasDeclared ? formatSignedBRLFromCents(row.discrepancyCents) : "—";
      return (
        "<tr>" +
          "<td><strong>" + escapeHtml(row.method) + "</strong></td>" +
          '<td class="num">' + root.PDVDomain.formatBRLFromCents(row.glowHubCents) + "</td>" +
          '<td class="num">' + root.PDVDomain.formatBRLFromCents(row.bentoClubCents) + "</td>" +
          '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(row.expectedCents) + "</strong></td>" +
          '<td class="num">' + escapeHtml(declaredTxt) + "</td>" +
          '<td class="num"><strong>' + escapeHtml(diffTxt) + "</strong></td>" +
          "<td><strong>" + escapeHtml(row.status) + "</strong></td>" +
        "</tr>"
      );
    }).join("");

    const totalDiffTxt = disc.totals.checkedMethodsCount > 0 ? formatSignedBRLFromCents(disc.totals.discrepancyCents) : "—";
    const notesText = (uiState.discrepancyNotes || (disc.closingMeta && disc.closingMeta.notes) || "").trim();

    const adjRowsHtml = stockAdj.items.map(function (adj) {
      const dt = adj.createdAt ? new Date(adj.createdAt).toLocaleString("pt-BR") : "";
      return (
        "<tr>" +
          "<td>" + escapeHtml(dt) + '<br /><span class="print-sub">' + escapeHtml(adj.saleId) + "</span></td>" +
          "<td><strong>" + escapeHtml(adj.productName) + '</strong><br /><span class="print-sub">' + escapeHtml(adj.brand) + "</span></td>" +
          '<td class="num">' + adj.stockBefore + " un.</td>" +
          '<td class="num">' + adj.soldQty + " un.</td>" +
          '<td class="num"><strong>+' + adj.adjustmentQty + " un.</strong></td>" +
          '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(adj.adjustmentValueCents) + "</strong></td>" +
          "<td>" + escapeHtml((adj.client && adj.client.name) || "") + '<br /><span class="print-sub">' + escapeHtml((adj.seller && (adj.seller.name || adj.seller.shortName)) || "") + "</span></td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<section class="print-section">' +
        '<h2 class="print-section-title">2. Conferência de Caixa (Discrepância) &amp; Ajustes de Estoque Negativo</h2>' +
        '<table class="print-table">' +
          "<thead>" +
            "<tr>" +
              '<th style="width:20%">Forma Pagto</th>' +
              '<th class="num" style="width:13%">Produtos</th>' +
              '<th class="num" style="width:13%">Clubes</th>' +
              '<th class="num" style="width:14%">Esperado</th>' +
              '<th class="num" style="width:14%">Conferido</th>' +
              '<th class="num" style="width:13%">Discrepância</th>' +
              '<th style="width:13%">Situação</th>' +
            "</tr>" +
          "</thead>" +
          "<tbody>" + rowsHtml + "</tbody>" +
          "<tfoot>" +
            '<tr class="print-total-row">' +
              "<td><strong>CONFERÊNCIA TOTAL</strong></td>" +
              '<td class="num">' + root.PDVDomain.formatBRLFromCents(closing.cashReport.totals.glowHubCents) + "</td>" +
              '<td class="num">' + root.PDVDomain.formatBRLFromCents(closing.cashReport.totals.bentoClubCents) + "</td>" +
              '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(disc.totals.expectedCents) + "</strong></td>" +
              '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(disc.totals.declaredCheckedCents) + "</strong></td>" +
              '<td class="num"><strong>' + escapeHtml(totalDiffTxt) + "</strong></td>" +
              "<td><strong>" + escapeHtml(disc.totals.status) + "</strong></td>" +
            "</tr>" +
          "</tfoot>" +
        "</table>" +
        (notesText
          ? '<p class="print-note-box"><strong>Observações / Justificativa de Caixa:</strong> ' + escapeHtml(notesText) + "</p>"
          : "") +
        '<h3 class="print-subsection-title">Ajustes de Estoque Negativo (' + stockAdj.totalAdjustmentsCount + " ocorrência(s) • +" + stockAdj.totalAdjustedUnits + " un. • " + root.PDVDomain.formatBRLFromCents(stockAdj.totalAdjustedValueCents) + ")</h3>" +
        (adjRowsHtml
          ? '<table class="print-table">' +
              "<thead>" +
                "<tr>" +
                  '<th style="width:17%">Data / Pedido</th>' +
                  '<th style="width:27%">Produto / Marca</th>' +
                  '<th class="num" style="width:9%">Est. Ant.</th>' +
                  '<th class="num" style="width:8%">Venda</th>' +
                  '<th class="num" style="width:10%">Ajuste</th>' +
                  '<th class="num" style="width:12%">Valor</th>' +
                  '<th style="width:17%">Cliente / Emissor</th>' +
                "</tr>" +
              "</thead>" +
              "<tbody>" + adjRowsHtml + "</tbody>" +
            "</table>"
          : '<p class="print-empty-line">Nenhum ajuste de estoque negativo registrado para o período selecionado.</p>') +
      "</section>"
    );
  }

  function renderPrintSalesSection(closing) {
    const salesRep = closing.salesReport;
    const rowsHtml = salesRep.lines.map(function (line) {
      const dt = line.createdAt ? new Date(line.createdAt).toLocaleString("pt-BR") : "";
      const adjText = line.adjustmentQty > 0 ? '<br /><span class="print-sub">Ajuste estoque: +' + line.adjustmentQty + " un.</span>" : "";
      return (
        "<tr>" +
          "<td>" + escapeHtml(dt) + '<br /><span class="print-sub">' + escapeHtml(line.saleId) + "</span></td>" +
          "<td><strong>" + escapeHtml(line.segmentLabel) + '</strong><br /><span class="print-sub">' + escapeHtml(line.brandOrClub) + "</span></td>" +
          "<td><strong>" + escapeHtml(line.itemName) + "</strong>" + adjText + "</td>" +
          '<td class="num"><strong>' + line.qty + "</strong></td>" +
          '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(line.subtotalCents) + '</strong><br /><span class="print-sub">Un: ' + root.PDVDomain.formatBRLFromCents(line.unitPriceCents) + "</span></td>" +
          "<td><strong>" + escapeHtml(line.clientName) + '</strong><br /><span class="print-sub">' + escapeHtml(line.clientPhoneFormatted) + "</span></td>" +
          "<td><strong>" + escapeHtml(line.sellerName) + '</strong><br /><span class="print-sub">' + escapeHtml(line.paymentSummary) + "</span></td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<section class="print-section">' +
        '<h2 class="print-section-title">3. Relatório de Vendas (' + salesRep.totals.ordersCount + " pedido(s) • " + salesRep.totals.totalQty + " itens • " + root.PDVDomain.formatBRLFromCents(salesRep.totals.totalCents) + ")</h2>" +
        (rowsHtml
          ? '<table class="print-table">' +
              "<thead>" +
                "<tr>" +
                  '<th style="width:15%">Data / Pedido</th>' +
                  '<th style="width:13%">Seg. / Marca</th>' +
                  '<th style="width:24%">Produto / Pacote</th>' +
                  '<th class="num" style="width:6%">Qtd</th>' +
                  '<th class="num" style="width:13%">Total / Unit.</th>' +
                  '<th style="width:15%">Cliente</th>' +
                  '<th style="width:14%">Emissor / Pgto</th>' +
                "</tr>" +
              "</thead>" +
              "<tbody>" + rowsHtml + "</tbody>" +
              "<tfoot>" +
                '<tr class="print-total-row">' +
                  '<td colspan="3"><strong>TOTAL DAS VENDAS FILTRADAS (' + salesRep.totals.linesCount + " linhas)</strong></td>" +
                  '<td class="num"><strong>' + salesRep.totals.totalQty + "</strong></td>" +
                  '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(salesRep.totals.totalCents) + "</strong></td>" +
                  '<td colspan="2"></td>' +
                "</tr>" +
              "</tfoot>" +
            "</table>"
          : '<p class="print-empty-line">Nenhuma venda registrada para o período e filtros selecionados.</p>') +
      "</section>"
    );
  }

  function renderPrintClientsDaySection(closing) {
    const regRep = closing.registeredClientsReport;
    const rowsHtml = regRep.items.map(function (c) {
      const dt = c.timestamp ? new Date(c.timestamp).toLocaleString("pt-BR") : "";
      return (
        "<tr>" +
          "<td>" + escapeHtml(dt) + "</td>" +
          "<td><strong>" + escapeHtml(c.registrationType) + "</strong></td>" +
          "<td><strong>" + escapeHtml(c.name) + "</strong></td>" +
          "<td>" + escapeHtml(c.phoneFormatted) + "</td>" +
          '<td class="num">' + c.ordersCount + " pedido(s)</td>" +
          '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(c.totalSpentCents) + "</strong></td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<section class="print-section">' +
        '<h2 class="print-section-title">4. Relatório de Clientes Cadastrados / Atualizados (' + regRep.totals.totalCount + " cliente(s) • " + regRep.totals.newCount + " novos)</h2>" +
        (rowsHtml
          ? '<table class="print-table">' +
              "<thead>" +
                "<tr>" +
                  '<th style="width:18%">Data/Hora</th>' +
                  '<th style="width:16%">Tipo</th>' +
                  '<th style="width:26%">Nome do Cliente</th>' +
                  '<th style="width:16%">Celular</th>' +
                  '<th class="num" style="width:10%">Compras</th>' +
                  '<th class="num" style="width:14%">Valor Total</th>' +
                "</tr>" +
              "</thead>" +
              "<tbody>" + rowsHtml + "</tbody>" +
            "</table>"
          : '<p class="print-empty-line">Nenhum cliente novo cadastrado ou atualizado na data selecionada.</p>') +
      "</section>"
    );
  }

  function renderPrintClientsHistorySection() {
    const historyData = getFilteredClientsHistoryReport();
    const blocksHtml = historyData.rows.map(function (cust) {
      const rowsHtml = cust.purchases.map(function (pur) {
        const dt = pur.createdAt ? new Date(pur.createdAt).toLocaleString("pt-BR") : "";
        return (
          "<tr>" +
            "<td>" + escapeHtml(dt) + "</td>" +
            "<td><strong>" + escapeHtml(pur.segmentLabel) + '</strong><br /><span class="print-sub">' + escapeHtml(pur.groupName) + "</span></td>" +
            "<td><strong>" + escapeHtml(pur.itemName) + "</strong></td>" +
            '<td class="num">' + pur.qty + "</td>" +
            '<td class="num"><strong>' + root.PDVDomain.formatBRLFromCents(pur.lineTotalCents) + "</strong></td>" +
            "<td>" + escapeHtml(pur.sellerName) + '<br /><span class="print-sub">' + escapeHtml(pur.paymentSummary) + "</span></td>" +
          "</tr>"
        );
      }).join("");

      return (
        '<div class="print-customer-block">' +
          '<div class="print-customer-head">' +
            "<div><strong>" + escapeHtml(cust.clientName) + "</strong> • " + escapeHtml(root.PDVDomain.formatPhoneDisplay(cust.clientPhone)) + " (" + cust.ordersCount + " pedido(s) • " + cust.itemsCount + " item(ns))</div>" +
            "<div><strong>Total: " + root.PDVDomain.formatBRLFromCents(cust.totalCents) + "</strong></div>" +
          "</div>" +
          '<table class="print-table">' +
            "<thead>" +
              "<tr>" +
                '<th style="width:16%">Data/Hora</th>' +
                '<th style="width:17%">Seg. / Marca</th>' +
                '<th style="width:31%">Item Adquirido</th>' +
                '<th class="num" style="width:6%">Qtd</th>' +
                '<th class="num" style="width:13%">Subtotal</th>' +
                '<th style="width:17%">Emissor / Pgto</th>' +
              "</tr>" +
            "</thead>" +
            "<tbody>" + rowsHtml + "</tbody>" +
          "</table>" +
        "</div>"
      );
    }).join("");

    return (
      '<section class="print-section">' +
        '<h2 class="print-section-title">Histórico Consolidado por Cliente (' + historyData.rows.length + " cliente(s) • " + root.PDVDomain.formatBRLFromCents(historyData.totalCents) + ")</h2>" +
        (blocksHtml || '<p class="print-empty-line">Nenhuma venda registrada para os filtros selecionados.</p>') +
      "</section>"
    );
  }

  function renderPrintSheet(closing, scopeOverride) {
    if (!activeUser) return "";
    const data = closing || getClosingReportData();
    const scope = scopeOverride || uiState.printScope || "active_tab";
    const sellers = (dbState && dbState.users) || [];
    const sellerObj = sellers.find(function (u) { return u.id === uiState.reportSellerId; });
    const sellerLabel = sellerObj ? (sellerObj.name + " (" + sellerObj.shortName + ")") : "Todos os emissores";
    const periodLabel = formatReportPeriodLabel(uiState.reportDateFilter);
    const printedAt = new Date().toLocaleString("pt-BR");
    const stockAdj = data.discrepancyReport.stockAdjustments;

    let bodySectionsHtml = "";
    let modeLabel = "Fechamento Completo A4";
    if (scope === "full_closing") {
      bodySectionsHtml =
        renderPrintCashSection(data) +
        renderPrintDiscrepancySection(data) +
        renderPrintSalesSection(data) +
        renderPrintClientsDaySection(data);
    } else if (uiState.reportSubTab === "closing_cash") {
      modeLabel = "Relatório de Caixa";
      bodySectionsHtml = renderPrintCashSection(data);
    } else if (uiState.reportSubTab === "discrepancy") {
      modeLabel = "Discrepância de Caixa e Ajustes de Estoque";
      bodySectionsHtml = renderPrintDiscrepancySection(data);
    } else if (uiState.reportSubTab === "sales_list") {
      modeLabel = "Relatório Detalhado de Vendas";
      bodySectionsHtml = renderPrintSalesSection(data);
    } else if (uiState.reportSubTab === "clients_day") {
      modeLabel = "Clientes Cadastrados / Atualizados no Período";
      bodySectionsHtml = renderPrintClientsDaySection(data);
    } else {
      modeLabel = "Histórico de Compras por Cliente";
      bodySectionsHtml = renderPrintClientsHistorySection();
    }

    return (
      '<section id="pdv-print-sheet" class="pdv-print-sheet" aria-label="Versão de Impressão A4">' +
        '<header class="print-sheet-header">' +
          '<div class="print-brand-row">' +
            '<div class="print-logos">' +
              '<img src="assets/glowhub-logo.png" alt="Glow Hub" class="print-logo-img" />' +
              '<img src="assets/bentoclub-logo.png" alt="BentoClub" class="print-logo-img" />' +
            "</div>" +
            '<div class="print-title-col">' +
              '<span class="print-kicker">GLOWHUB &amp; BENTOCLUB • CONTROLE DE OPERAÇÃO E FECHAMENTO DE CAIXA</span>' +
              "<h1>" + escapeHtml(modeLabel) + "</h1>" +
            "</div>" +
          "</div>" +
          '<div class="print-meta-grid">' +
            "<div><span>Período:</span> <strong>" + escapeHtml(periodLabel) + "</strong></div>" +
            "<div><span>Emissor filtrado:</span> <strong>" + escapeHtml(sellerLabel) + "</strong></div>" +
            "<div><span>Emitido por:</span> <strong>" + escapeHtml(activeUser.name || activeUser.shortName) + "</strong></div>" +
            "<div><span>Impressão:</span> <strong>" + escapeHtml(printedAt) + "</strong></div>" +
            (uiState.reportQuery ? "<div><span>Busca aplicada:</span> <strong>" + escapeHtml(uiState.reportQuery) + "</strong></div>" : "") +
          "</div>" +
        "</header>" +

        '<div class="print-kpi-strip">' +
          '<div class="print-kpi-box">' +
            '<span class="print-kpi-label">Caixa Total</span>' +
            "<strong>" + root.PDVDomain.formatBRLFromCents(data.cashReport.totals.totalCents) + "</strong>" +
            "<small>" + data.cashReport.totals.ordersCount + " venda(s)</small>" +
          "</div>" +
          '<div class="print-kpi-box">' +
            '<span class="print-kpi-label">Produtos Glow Hub</span>' +
            "<strong>" + root.PDVDomain.formatBRLFromCents(data.cashReport.totals.glowHubCents) + "</strong>" +
            "<small>Segmento Produtos</small>" +
          "</div>" +
          '<div class="print-kpi-box">' +
            '<span class="print-kpi-label">Clubes BentoClub</span>' +
            "<strong>" + root.PDVDomain.formatBRLFromCents(data.cashReport.totals.bentoClubCents) + "</strong>" +
            "<small>Assinaturas &amp; Pacotes</small>" +
          "</div>" +
          '<div class="print-kpi-box">' +
            '<span class="print-kpi-label">Ajustes Estoque (-)</span>' +
            "<strong>" + root.PDVDomain.formatBRLFromCents(stockAdj.totalAdjustedValueCents) + "</strong>" +
            "<small>" + stockAdj.totalAdjustmentsCount + " ocorrência(s) / +" + stockAdj.totalAdjustedUnits + " un.</small>" +
          "</div>" +
        "</div>" +

        bodySectionsHtml +

        '<footer class="print-signatures-grid">' +
          '<div class="print-sig-col">' +
            '<div class="print-sig-line"></div>' +
            "<strong>" + escapeHtml(activeUser.name || activeUser.shortName) + "</strong>" +
            "<span>Operador / Emissor do Fechamento</span>" +
          "</div>" +
          '<div class="print-sig-col">' +
            '<div class="print-sig-line"></div>' +
            "<strong>Conferência Gerência / Administrador</strong>" +
            "<span>Assinatura e Visto • GlowHub &amp; BentoClub</span>" +
          "</div>" +
        "</footer>" +
      "</section>"
    );
  }

  function renderReportsView(closingOverride) {
    const sellers = (dbState && dbState.users) || [];
    const todayKey = root.PDVDomain.getLocalDateKey();
    const isToday = uiState.reportDateFilter === todayKey;
    const isAll = !uiState.reportDateFilter || uiState.reportDateFilter === "ALL";

    const closing = closingOverride || getClosingReportData();

    let activeTabHtml = "";
    if (uiState.reportSubTab === "closing_cash") {
      activeTabHtml = renderClosingCashSection(closing);
    } else if (uiState.reportSubTab === "discrepancy") {
      activeTabHtml = renderDiscrepancySection(closing);
    } else if (uiState.reportSubTab === "sales_list") {
      activeTabHtml = renderSalesListSection(closing);
    } else if (uiState.reportSubTab === "clients_day") {
      activeTabHtml = renderClientsDaySection(closing);
    } else {
      activeTabHtml = renderClientsHistorySection();
    }

    const totalAllSalesCount = ((dbState && dbState.sales) || []).length;

    return (
      '<section class="reports-view" aria-label="Fechamento do Dia e Relatórios">' +
        '<div class="catalog-header-banner report-banner">' +
          '<div class="banner-left">' +
            "<div>" +
              "<h1>Fechamento do Dia &amp; Relatórios</h1>" +
              "<p>Caixa por forma de pagamento (Produtos vs. Clubes), Discrepância de Caixa &amp; Estoque, Vendas com Emissor e Clientes Cadastrados no Dia.</p>" +
            "</div>" +
          "</div>" +
          '<div class="report-top-actions">' +
            '<button type="button" class="btn-primary" id="btn-export-full-closing-csv">📥 Exportar Fechamento Completo (CSV)</button>' +
            '<button type="button" class="btn-secondary" id="btn-export-report-csv">📊 Exportar Aba (CSV)</button>' +
            '<button type="button" class="btn-outline" id="btn-print-report">🖨 Imprimir Aba Atual</button>' +
            '<button type="button" class="btn-outline" id="btn-print-full-closing">📑 Fechamento A4 Completo</button>' +
            '<button type="button" class="btn-back-menu" data-action="go-home">← Menu Principal</button>' +
          "</div>" +
        "</div>" +

        '<div class="closing-date-bar">' +
          '<div class="date-quick-pills">' +
            '<button type="button" class="date-pill ' + (isToday ? "active" : "") + '" id="btn-report-date-today">📅 Hoje (' + escapeHtml(todayKey.split("-").reverse().join("/")) + ")</button>" +
            '<button type="button" class="date-pill ' + (isAll ? "active" : "") + '" id="btn-report-date-all">🗓 Todo o Período (' + totalAllSalesCount + " vendas)</button>" +
            '<label class="date-picker-label">Data específica: ' +
              '<input type="date" id="input-report-date" class="input-touch input-date-compact" value="' + escapeHtml(isAll ? "" : uiState.reportDateFilter) + '" />' +
            "</label>" +
          "</div>" +
          '<div class="closing-filter-inputs">' +
            '<input type="search" id="input-report-search" class="input-touch" ' +
              'placeholder="Filtrar produto, cliente, celular, emissor ou pedido..." ' +
              'value="' + escapeHtml(uiState.reportQuery) + '" />' +
            '<select id="select-report-seller" class="select-touch">' +
              '<option value="">Todos os Emissores / Vendedores</option>' +
              sellers.map(function (u) {
                return '<option value="' + escapeHtml(u.id) + '" ' + (uiState.reportSellerId === u.id ? "selected" : "") + ">" + escapeHtml(u.name + " (" + u.shortName + ")") + "</option>";
              }).join("") +
            "</select>" +
          "</div>" +
        "</div>" +

        '<div class="closing-subtabs" role="tablist" aria-label="Relatórios de Fechamento">' +
          '<button type="button" class="closing-tab ' + (uiState.reportSubTab === "closing_cash" ? "active" : "") + '" data-report-tab="closing_cash">' +
            "💰 Relatório de Caixa" +
          "</button>" +
          '<button type="button" class="closing-tab ' + (uiState.reportSubTab === "discrepancy" ? "active" : "") + '" data-report-tab="discrepancy">' +
            "⚖️ Discrepância &amp; Estoque " +
            '<span class="pill-count">' + closing.discrepancyReport.stockAdjustments.totalAdjustmentsCount + "</span>" +
          "</button>" +
          '<button type="button" class="closing-tab ' + (uiState.reportSubTab === "sales_list" ? "active" : "") + '" data-report-tab="sales_list">' +
            "🧾 Relatório de Vendas " +
            '<span class="pill-count">' + closing.salesReport.totals.linesCount + "</span>" +
          "</button>" +
          '<button type="button" class="closing-tab ' + (uiState.reportSubTab === "clients_day" ? "active" : "") + '" data-report-tab="clients_day">' +
            "👤 Clientes do Dia " +
            '<span class="pill-count">' + closing.registeredClientsReport.totals.totalCount + "</span>" +
          "</button>" +
          '<button type="button" class="closing-tab ' + (uiState.reportSubTab === "clients_history" ? "active" : "") + '" data-report-tab="clients_history">' +
            "🗂 Consolidado por Cliente" +
          "</button>" +
        "</div>" +

        activeTabHtml +
      "</section>"
    );
  }

  function renderCartDrawer() {
    if (!uiState.cartDrawerOpen) return "";

    const cart = uiState.cart || root.PDVDomain.createEmptyCart();
    const totals = root.PDVDomain.calculateCartTotals(cart);
    const client = cart.client;

    const itemsHtml = cart.items.map(function (it) {
      const lineCents = it.unitPriceCents * it.qty;
      const hasAdjust = it.segment === "glow_hub" && Number(it.adjustmentQty) > 0;
      const availBefore = it.availableStock !== undefined && it.availableStock !== null ? it.availableStock : it.maxStock;
      return (
        '<div class="cart-item-row" data-cart-item="' + escapeHtml(it.itemId) + '">' +
          '<div class="cart-item-info">' +
            '<span class="cart-item-seg ' + (it.segment === "glow_hub" ? "glow" : "club") + '">' +
              (it.segment === "glow_hub" ? "Glow Hub • " + escapeHtml(it.brand) : "BentoClub • " + escapeHtml(it.club)) +
            "</span>" +
            "<strong>" + escapeHtml(it.name) + "</strong>" +
            '<span class="cart-item-sub">' + root.PDVDomain.formatBRLFromCents(it.unitPriceCents) + " un.</span>" +
            (hasAdjust
              ? '<span class="cart-adjust-badge">⚡ Ajuste de estoque na venda: +' + it.adjustmentQty + " un. (Estoque atual: " + (Number(availBefore) || 0) + " un.)</span>"
              : "") +
          "</div>" +
          '<div class="cart-item-controls">' +
            '<div class="qty-stepper">' +
              '<button type="button" class="btn-qty" data-qty-dec="' + escapeHtml(it.itemId) + '" aria-label="Diminuir quantidade">−</button>' +
              '<span class="qty-val">' + it.qty + "</span>" +
              '<button type="button" class="btn-qty" data-qty-inc="' + escapeHtml(it.itemId) + '" aria-label="Aumentar quantidade">+</button>' +
            "</div>" +
            '<strong class="cart-line-price">' + root.PDVDomain.formatBRLFromCents(lineCents) + "</strong>" +
            '<button type="button" class="btn-remove-item" data-qty-remove="' + escapeHtml(it.itemId) + '" title="Remover item">🗑</button>' +
          "</div>" +
        "</div>"
      );
    }).join("");

    // Calculate split payment status
    let splitPaidCents = 0;
    for (let i = 0; i < uiState.splitPayments.length; i++) {
      splitPaidCents += uiState.splitPayments[i].amountCents;
    }
    const splitRemainingCents = Math.max(0, totals.totalCents - splitPaidCents);
    const splitChangeCents = Math.max(0, splitPaidCents - totals.totalCents);

    // Single payment cash change preview
    let singleCashChangeCents = 0;
    if (uiState.checkoutMode === "single" && uiState.singlePaymentMethod === "Dinheiro" && uiState.singleCashReceivedInput) {
      const cashCents = root.PDVDomain.parseBRLToCents(uiState.singleCashReceivedInput);
      if (cashCents > totals.totalCents) {
        singleCashChangeCents = cashCents - totals.totalCents;
      }
    }

    return (
      '<div class="drawer-backdrop" id="cart-drawer-backdrop">' +
        '<aside class="cart-drawer" aria-label="Carrinho de Compras e Checkout">' +
          '<div class="drawer-header">' +
            "<div>" +
              "<h2>Carrinho &amp; Checkout</h2>" +
              "<span>" + totals.totalQty + " item(ns) • " + root.PDVDomain.formatBRLFromCents(totals.totalCents) + "</span>" +
            "</div>" +
            '<div class="drawer-header-actions">' +
              '<button type="button" class="btn-drawer-menu" id="btn-drawer-go-home">Menu Principal</button>' +
              '<button type="button" class="btn-drawer-close" id="btn-close-cart">✕ Fechar Carrinho</button>' +
            "</div>" +
          "</div>" +

          '<div class="drawer-body">' +
            '<div class="cart-client-box ' + (client ? "linked" : "missing") + '">' +
              (client
                ? '<div class="client-linked-details">' +
                    '<span class="client-tag">CLIENTE VINCULADO</span>' +
                    "<strong>" + escapeHtml(client.name) + "</strong>" +
                    "<span>📱 " + escapeHtml(root.PDVDomain.formatPhoneDisplay(client.phone)) + "</span>" +
                  "</div>" +
                  '<button type="button" class="btn-outline btn-sm" id="btn-change-cart-client">Trocar Cliente</button>'
                : '<div class="client-linked-details">' +
                    "<strong>Nenhum cliente vinculado</strong>" +
                    "<span>Identifique ou cadastre o cliente para finalizar</span>" +
                  "</div>" +
                  '<button type="button" class="btn-primary btn-sm" id="btn-change-cart-client">Identificar Cliente</button>') +
            "</div>" +

            '<div class="cart-items-list">' +
              (itemsHtml || '<div class="empty-cart-msg"><p>Seu carrinho está vazio. Escolha produtos Glow Hub ou pacotes BentoClub para iniciar.</p></div>') +
            "</div>" +

            (cart.items.length > 0
              ? '<div class="checkout-section">' +
                  '<div class="checkout-mode-tabs">' +
                    '<button type="button" class="mode-tab ' + (uiState.checkoutMode === "single" ? "active" : "") + '" data-pay-mode="single">Pagamento Único</button>' +
                    '<button type="button" class="mode-tab ' + (uiState.checkoutMode === "split" ? "active" : "") + '" data-pay-mode="split">Pagamento Combinado (2+ formas)</button>' +
                  "</div>" +

                  (uiState.checkoutMode === "single"
                    ? '<div class="payment-methods-grid">' +
                        root.PDVDomain.VALID_PAYMENT_METHODS.map(function (m) {
                          return (
                            '<button type="button" class="pay-method-btn ' + (uiState.singlePaymentMethod === m ? "active" : "") + '" data-single-method="' + escapeHtml(m) + '">' +
                              escapeHtml(m) +
                            "</button>"
                          );
                        }).join("") +
                      "</div>" +
                      (uiState.singlePaymentMethod === "Cartão de Crédito"
                        ? '<div class="pay-extra-row">' +
                            "<label>Parcelamento no Cartão de Crédito:</label>" +
                            '<select id="select-single-installments" class="select-touch">' +
                              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (n) {
                                return '<option value="' + n + '" ' + (Number(uiState.singleInstallments) === n ? "selected" : "") + ">" + n + "x de " + root.PDVDomain.formatBRLFromCents(Math.round(totals.totalCents / n)) + "</option>";
                              }).join("") +
                            "</select>" +
                          "</div>"
                        : "") +
                      (uiState.singlePaymentMethod === "Dinheiro"
                        ? '<div class="pay-extra-row">' +
                            "<label>Valor recebido em Dinheiro (opcional p/ cálculo de troco):</label>" +
                            '<input type="text" id="input-single-cash" class="input-touch" placeholder="Ex: 200,00" value="' + escapeHtml(uiState.singleCashReceivedInput) + '" />' +
                            (singleCashChangeCents > 0
                              ? '<div class="change-highlight">Troco a devolver: <strong>' + root.PDVDomain.formatBRLFromCents(singleCashChangeCents) + "</strong></div>"
                              : "") +
                          "</div>"
                        : "")
                    : '<div class="split-payment-box">' +
                        '<div class="split-entry-row">' +
                          '<select id="select-split-method" class="select-touch">' +
                            root.PDVDomain.VALID_PAYMENT_METHODS.map(function (m) {
                              return '<option value="' + escapeHtml(m) + '" ' + (uiState.splitDraftMethod === m ? "selected" : "") + ">" + escapeHtml(m) + "</option>";
                            }).join("") +
                          "</select>" +
                          '<input type="text" id="input-split-amount" class="input-touch" placeholder="Valor (R$)" value="' + escapeHtml(uiState.splitDraftAmountInput || (splitRemainingCents > 0 ? (splitRemainingCents / 100).toFixed(2).replace(".", ",") : "")) + '" />' +
                          '<button type="button" class="btn-secondary" id="btn-add-split-payment">+ Lançar</button>' +
                        "</div>" +
                        (uiState.splitDraftMethod === "Cartão de Crédito"
                          ? '<div class="pay-extra-row">' +
                              "<label>Parcelas no Cartão de Crédito:</label>" +
                              '<select id="select-split-installments" class="select-touch">' +
                                [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (n) {
                                  return '<option value="' + n + '" ' + (Number(uiState.splitDraftInstallments) === n ? "selected" : "") + ">" + n + "x</option>";
                                }).join("") +
                              "</select>" +
                            "</div>"
                          : "") +
                        '<div class="split-lines-list">' +
                          uiState.splitPayments.map(function (sp, idx) {
                            return (
                              '<div class="split-line-item">' +
                                "<span>" + escapeHtml(sp.method) + (sp.installments > 1 ? " (" + sp.installments + "x)" : "") + "</span>" +
                                "<strong>" + root.PDVDomain.formatBRLFromCents(sp.amountCents) + "</strong>" +
                                '<button type="button" class="btn-remove-split" data-remove-split="' + idx + '">✕</button>' +
                              "</div>"
                            );
                          }).join("") +
                        "</div>" +
                        '<div class="split-summary-bar">' +
                          "<span>Pago: <strong>" + root.PDVDomain.formatBRLFromCents(splitPaidCents) + "</strong></span>" +
                          (splitRemainingCents > 0
                            ? '<span class="split-remaining">Falta: <strong>' + root.PDVDomain.formatBRLFromCents(splitRemainingCents) + "</strong></span>"
                            : '<span class="split-ok">Total coberto ✓' + (splitChangeCents > 0 ? " (Troco: " + root.PDVDomain.formatBRLFromCents(splitChangeCents) + ")" : "") + "</span>") +
                        "</div>" +
                      "</div>") +

                  '<div class="checkout-notes-row">' +
                    '<input type="text" id="input-checkout-notes" class="input-touch" placeholder="Observações do pedido (opcional)..." value="' + escapeHtml(uiState.checkoutNotes) + '" />' +
                  "</div>" +
                  (uiState.checkoutError
                    ? '<div class="auth-alert-error" role="alert">' + escapeHtml(uiState.checkoutError) + "</div>"
                    : "") +
                "</div>"
              : "") +
          "</div>" +

          '<div class="drawer-footer">' +
            '<div class="drawer-totals-summary">' +
              (totals.glowHubCents > 0 ? '<div><span>Subtotal Glow Hub:</span><strong>' + root.PDVDomain.formatBRLFromCents(totals.glowHubCents) + "</strong></div>" : "") +
              (totals.bentoClubCents > 0 ? '<div><span>Subtotal BentoClub:</span><strong>' + root.PDVDomain.formatBRLFromCents(totals.bentoClubCents) + "</strong></div>" : "") +
              '<div class="grand-total-row"><span>Total da Venda:</span><strong>' + root.PDVDomain.formatBRLFromCents(totals.totalCents) + "</strong></div>" +
            "</div>" +
            '<button type="button" class="btn-finalize-sale" id="btn-finalize-sale" ' + (cart.items.length === 0 ? "disabled" : "") + ">" +
              "✓ Concluir Venda (" + root.PDVDomain.formatBRLFromCents(totals.totalCents) + ")" +
            "</button>" +
          "</div>" +
        "</aside>" +
      "</div>"
    );
  }

  function renderClientModal() {
    if (!uiState.clientModalOpen) return "";

    const matches = root.PDVDomain.searchClients(dbState.clients, uiState.clientSearchQuery, 35);
    const pendingItem = uiState.pendingCartAddition ? uiState.pendingCartAddition.item : null;

    const resultsHtml = matches.map(function (c) {
      const hasPhone = root.PDVDomain.isValidPhone(c.phone);
      const isCompleting = uiState.selectedClientPendingPhone && uiState.selectedClientPendingPhone.id === c.id;

      return (
        '<div class="client-result-item ' + (isCompleting ? "completing" : "") + '">' +
          '<div class="client-result-main">' +
            "<div>" +
              "<strong>" + escapeHtml(c.name) + "</strong>" +
              '<span class="client-phone-status ' + (hasPhone ? "ok" : "missing") + '">' +
                (hasPhone ? "📱 " + escapeHtml(root.PDVDomain.formatPhoneDisplay(c.phone)) : "⚠️ Sem celular cadastrado na planilha") +
              "</span>" +
            "</div>" +
            '<button type="button" class="btn-select-client" data-select-client="' + escapeHtml(c.id) + '">' +
              (hasPhone ? "Selecionar →" : "Informar Celular") +
            "</button>" +
          "</div>" +
          (isCompleting
            ? '<div class="client-phone-complete-box">' +
                "<label>Informe o celular com DDD para <strong>" + escapeHtml(c.name) + "</strong>:</label>" +
                '<div class="phone-complete-row">' +
                  '<input type="tel" id="input-complete-client-phone" class="input-touch" placeholder="(92) 99999-9999" value="' + escapeHtml(uiState.pendingPhoneInput) + '" />' +
                  '<button type="button" class="btn-primary" id="btn-save-client-phone">Salvar e Vincular</button>' +
                "</div>" +
              "</div>"
            : "") +
        "</div>"
      );
    }).join("");

    return (
      '<div class="modal-backdrop" id="client-modal-backdrop">' +
        '<div class="modal-card client-modal" role="dialog" aria-modal="true" aria-label="Identificar ou Cadastrar Cliente">' +
          '<div class="modal-header">' +
            "<div>" +
              "<h2>Identificar Cliente da Venda</h2>" +
              (pendingItem
                ? '<p class="pending-item-notice">Para adicionar <strong>' + escapeHtml(pendingItem.name) + "</strong> ao carrinho, localize o cliente ou faça o cadastro rápido.</p>"
                : "<p>Busque nos 1.721 clientes pré-carregados ou cadastre um novo cliente com Nome e Celular.</p>") +
            "</div>" +
            '<button type="button" class="btn-modal-close" id="btn-close-client-modal">✕</button>' +
          "</div>" +

          '<div class="modal-tabs">' +
            '<button type="button" class="modal-tab ' + (uiState.clientModalTab === "search" ? "active" : "") + '" data-client-tab="search">' +
              "🔍 Buscar Cliente (" + ((dbState && dbState.clients) || []).length + ")" +
            "</button>" +
            '<button type="button" class="modal-tab ' + (uiState.clientModalTab === "new" ? "active" : "") + '" data-client-tab="new">' +
              "➕ Cadastro Rápido (Nome + Celular)" +
            "</button>" +
          "</div>" +

          (uiState.clientModalError
            ? '<div class="auth-alert-error" role="alert">' + escapeHtml(uiState.clientModalError) + "</div>"
            : "") +

          (uiState.clientModalTab === "search"
            ? '<div class="modal-body">' +
                '<div class="client-search-row">' +
                  '<input type="search" id="input-client-modal-search" class="input-touch" ' +
                    'placeholder="Digite o nome ou celular do cliente..." ' +
                    'value="' + escapeHtml(uiState.clientSearchQuery) + '" />' +
                  '<button type="button" class="btn-secondary" id="btn-jump-new-client">+ Novo Cliente</button>' +
                "</div>" +
                '<div class="client-results-list" id="client-results-list">' +
                  (resultsHtml ||
                    '<div class="empty-client-search">' +
                      "<p>Nenhum cliente encontrado com <strong>" + escapeHtml(uiState.clientSearchQuery) + "</strong>.</p>" +
                      '<button type="button" class="btn-primary" id="btn-create-from-search">+ Cadastrar "' + escapeHtml(uiState.clientSearchQuery) + '" Agora</button>' +
                    "</div>") +
                "</div>" +
              "</div>"
            : '<form id="form-quick-new-client" class="modal-body quick-client-form" autocomplete="off">' +
                '<div class="form-field">' +
                  "<label for=\"input-new-client-name\">Nome Completo do Cliente *</label>" +
                  '<input type="text" id="input-new-client-name" class="input-touch" required placeholder="Ex: Maria Clara Souza" value="' + escapeHtml(uiState.newClientNameInput) + '" />' +
                "</div>" +
                '<div class="form-field">' +
                  "<label for=\"input-new-client-phone\">Celular com DDD (WhatsApp) *</label>" +
                  '<input type="tel" id="input-new-client-phone" class="input-touch" required placeholder="Ex: (92) 98400-0000" value="' + escapeHtml(uiState.newClientPhoneInput) + '" />' +
                "</div>" +
                '<div class="modal-form-actions">' +
                  '<button type="submit" class="btn-primary btn-block">✓ Cadastrar Cliente e Continuar Venda</button>' +
                "</div>" +
              "</form>") +
        "</div>" +
      "</div>"
    );
  }

  function renderReceiptModal() {
    const sale = uiState.receiptSale;
    if (!sale) return "";

    const dt = new Date(sale.createdAt).toLocaleString("pt-BR");
    const itemsHtml = sale.items.map(function (it) {
      return (
        '<div class="receipt-item-line">' +
          "<div>" +
            "<strong>" + it.qty + "x " + escapeHtml(it.name) + "</strong>" +
            "<span>" + (it.segment === "glow_hub" ? "Glow Hub • " + escapeHtml(it.brand) : "BentoClub • " + escapeHtml(it.club)) + "</span>" +
            (Number(it.adjustmentQty) > 0
              ? '<span class="receipt-adjust-tag">⚡ Ajuste de estoque aplicado: +' + it.adjustmentQty + " un.</span>"
              : "") +
          "</div>" +
          "<strong>" + root.PDVDomain.formatBRLFromCents(it.lineTotalCents) + "</strong>" +
        "</div>"
      );
    }).join("");

    const adjs = sale.stockAdjustments || [];
    const adjustmentsBoxHtml = adjs.length > 0
      ? '<div class="receipt-adjustments-box">' +
          "<h4>⚡ Registros de Ajuste de Estoque Negativo</h4>" +
          adjs.map(function (adj) {
            return (
              '<div class="receipt-adj-line">' +
                "<span>" + escapeHtml(adj.productName) + " (Ant.: " + adj.stockBefore + " • Vend.: " + adj.soldQty + ")</span>" +
                "<strong>Ajuste +" + adj.adjustmentQty + " un.</strong>" +
              "</div>"
            );
          }).join("") +
        "</div>"
      : "";

    const paymentsHtml = sale.payments.map(function (p) {
      return (
        '<div class="receipt-pay-line">' +
          "<span>" + escapeHtml(p.method) + (p.installments > 1 ? " (" + p.installments + "x)" : "") + "</span>" +
          "<strong>" + root.PDVDomain.formatBRLFromCents(p.amountCents) + "</strong>" +
        "</div>"
      );
    }).join("");

    return (
      '<div class="modal-backdrop" id="receipt-modal-backdrop">' +
        '<div class="modal-card receipt-modal" role="dialog" aria-modal="true" aria-label="Comprovante de Venda">' +
          '<div class="receipt-badge-ok">✓ Venda Registrada com Sucesso!</div>' +
          "<h2>Pedido " + escapeHtml(sale.id) + "</h2>" +
          '<p class="receipt-meta">' + escapeHtml(dt) + " • Atendido por <strong>" + escapeHtml(sale.seller.shortName) + "</strong></p>" +

          '<div class="receipt-client-box">' +
            "<span>Cliente: <strong>" + escapeHtml(sale.client.name) + "</strong></span>" +
            "<span>Celular: <strong>" + escapeHtml(root.PDVDomain.formatPhoneDisplay(sale.client.phone)) + "</strong></span>" +
          "</div>" +

          '<div class="receipt-items-box">' + itemsHtml + "</div>" +
          adjustmentsBoxHtml +

          '<div class="receipt-payments-box">' +
            "<h4>Formas de Pagamento</h4>" +
            paymentsHtml +
            '<div class="receipt-total-line"><span>Total da Venda</span><strong>' + root.PDVDomain.formatBRLFromCents(sale.totalCents) + "</strong></div>" +
            (sale.changeCents > 0
              ? '<div class="receipt-change-line"><span>Troco Devolvido</span><strong>' + root.PDVDomain.formatBRLFromCents(sale.changeCents) + "</strong></div>"
              : "") +
          "</div>" +

          '<div class="receipt-actions">' +
            '<button type="button" class="btn-secondary" id="btn-print-receipt">🖨 Imprimir Comprovante</button>' +
            '<button type="button" class="btn-primary" id="btn-receipt-new-sale">Nova Venda no Menu Principal →</button>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function renderSyncModal() {
    if (!uiState.syncModalOpen) return "";
    const cfg = root.PDVStorage.loadSyncConfig();
    const pendingCount = ((dbState && dbState.sales) || []).filter(function (s) {
      return s.syncStatus !== "synced";
    }).length;

    return (
      '<div class="modal-backdrop" id="sync-modal-backdrop">' +
        '<div class="modal-card sync-modal" role="dialog" aria-modal="true" aria-label="Persistência Híbrida e Sincronização">' +
          '<div class="modal-header">' +
            "<div>" +
              "<h2>Persistência Híbrida: Local + Google Sheets</h2>" +
              "<p>Exporte planilhas Excel/CSV a qualquer momento ou sincronize múltiplos Tablets/Smartphones via Google Apps Script.</p>" +
            "</div>" +
            '<button type="button" class="btn-modal-close" id="btn-close-sync-modal">✕</button>' +
          "</div>" +

          '<div class="modal-body">' +
            (uiState.syncMessage ? '<div class="sync-alert-ok">' + escapeHtml(uiState.syncMessage) + "</div>" : "") +
            (uiState.syncError ? '<div class="auth-alert-error">' + escapeHtml(uiState.syncError) + "</div>" : "") +

            '<div class="sync-section-card">' +
              "<h3>1. Exportação e Importação Local (GitHub Pages / Offline)</h3>" +
              "<p>Total registrado neste dispositivo: <strong>" + ((dbState && dbState.sales) || []).length + " venda(s)</strong> e <strong>" + ((dbState && dbState.clients) || []).length + " cliente(s)</strong>.</p>" +
              '<div class="sync-buttons-row">' +
                '<button type="button" class="btn-primary" id="btn-modal-export-csv">📥 Baixar Relatório Excel/CSV</button>' +
                '<button type="button" class="btn-secondary" id="btn-modal-export-json">💾 Exportar Backup JSON</button>' +
                '<label class="btn-outline file-upload-btn">' +
                  "📂 Importar Excel/CSV ou JSON" +
                  '<input type="file" id="input-import-backup-json" class="visually-hidden-file" accept=".csv,.json,text/csv,application/json" />' +
                "</label>" +
              "</div>" +
            "</div>" +

            '<div class="sync-section-card">' +
              "<h3>2. Sincronização em Tempo Real com Google Sheets (Apps Script)</h3>" +
              "<p>Vendas pendentes de envio para a nuvem: <strong>" + pendingCount + "</strong>" +
                (dbState.lastSyncedAt ? " • Última sincronização: " + escapeHtml(new Date(dbState.lastSyncedAt).toLocaleString("pt-BR")) : "") +
              "</p>" +
              '<div class="form-field">' +
                "<label for=\"input-apps-script-url\">URL do Web App Google Apps Script (`backend/Code.gs`):</label>" +
                '<input type="text" id="input-apps-script-url" class="input-touch" placeholder="https://script.google.com/macros/s/.../exec ou /api/sync" value="' + escapeHtml(cfg.appsScriptUrl) + '" />' +
              "</div>" +
              '<div class="sync-buttons-row">' +
                '<button type="button" class="btn-primary" id="btn-save-and-sync-cloud">☁️ Salvar URL e Sincronizar Agora</button>' +
              "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function renderApp() {
    if (!appContainer || !activeUser) return;

    let mainViewHtml = "";
    let printSheetHtml = "";
    if (uiState.view === "home") {
      mainViewHtml = renderHomeView();
    } else if (uiState.view === "glow_hub") {
      mainViewHtml = renderGlowHubView();
    } else if (uiState.view === "bento_club") {
      mainViewHtml = renderBentoClubView();
    } else if (uiState.view === "reports") {
      const closing = getClosingReportData();
      mainViewHtml = renderReportsView(closing);
      printSheetHtml = renderPrintSheet(closing);
    }

    const activePrintTarget = uiState.receiptSale ? "receipt" : (uiState.printTarget || "report");

    appContainer.innerHTML =
      '<div class="pdv-shell" data-print-target="' + escapeHtml(activePrintTarget) + '">' +
        renderTopBar() +
        '<main class="pdv-main" id="pdv-main-content">' +
          mainViewHtml +
        "</main>" +
        printSheetHtml +
        renderMobileNavDrawer() +
        renderCartDrawer() +
        renderClientModal() +
        renderReceiptModal() +
        renderSyncModal() +
        '<div id="pdv-toast-slot"></div>' +
      "</div>";

    renderToastOnly();
    bindAppEvents();
  }

  function handleAttemptAddCatalogItem(item, qty) {
    const res = root.PDVDomain.addItemToCart(uiState.cart, item, qty || 1);
    if (res.ok) {
      uiState.cart = res.cart;
      if (res.stockAdjustmentInfo && res.stockAdjustmentInfo.requiresStockAdjustment) {
        showToast("Adicionado: " + item.name + " (Ajuste de estoque +" + res.stockAdjustmentInfo.adjustmentQty + " un. na venda)");
      } else {
        showToast("Adicionado: " + item.name);
      }
      renderApp();
      return;
    }
    if (res.requiresClient) {
      uiState.pendingCartAddition = { item: item, qty: qty || 1 };
      uiState.clientModalOpen = true;
      uiState.clientModalTab = "search";
      uiState.clientModalError = "";
      renderApp();
      return;
    }
    showToast(res.error || "Não foi possível adicionar o item.");
  }

  function completeClientBindAndPendingAdd(client) {
    uiState.cart = {
      client: client,
      items: (uiState.cart && uiState.cart.items) || []
    };
    uiState.clientModalOpen = false;
    uiState.selectedClientPendingPhone = null;
    uiState.pendingPhoneInput = "";
    uiState.clientModalError = "";

    if (uiState.pendingCartAddition) {
      const pending = uiState.pendingCartAddition;
      uiState.pendingCartAddition = null;
      const addRes = root.PDVDomain.addItemToCart(uiState.cart, pending.item, pending.qty);
      if (addRes.ok) {
        uiState.cart = addRes.cart;
        uiState.cartDrawerOpen = true;
        if (addRes.stockAdjustmentInfo && addRes.stockAdjustmentInfo.requiresStockAdjustment) {
          showToast("Cliente vinculado e item adicionado (ajuste de estoque +" + addRes.stockAdjustmentInfo.adjustmentQty + " un.).");
        } else {
          showToast("Cliente " + client.name.split(" ")[0] + " vinculado e item adicionado ao carrinho!");
        }
      } else {
        showToast(addRes.error || "Erro ao adicionar item pendente.");
      }
    } else {
      showToast("Cliente vinculado: " + client.name);
    }
    renderApp();
  }

  function triggerDownload(filename, content, mimeType) {
    if (typeof document === "undefined") return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function handleExportClosingCSV(section) {
    const csvContent = root.PDVDomain.exportDailyClosingCSV(
      dbState,
      {
        dateFilter: uiState.reportDateFilter,
        sellerId: uiState.reportSellerId,
        query: uiState.reportQuery,
        declaredPayments: getCurrentDeclaredPaymentsCents()
      },
      section || "full_closing"
    );
    const stamp = uiState.reportDateFilter && uiState.reportDateFilter !== "ALL"
      ? uiState.reportDateFilter
      : root.PDVDomain.getLocalDateKey();
    const prefix = section === "full_closing" ? "fechamento_completo_" : ("relatorio_" + section + "_");
    triggerDownload(prefix + stamp + ".csv", csvContent, "text/csv;charset=utf-8;");
    showToast("Relatório CSV/Excel exportado com sucesso!");
  }

  function handleExportCSV() {
    if (uiState.view === "reports") {
      if (uiState.reportSubTab === "closing_cash") {
        handleExportClosingCSV("cash");
        return;
      }
      if (uiState.reportSubTab === "discrepancy") {
        handleExportClosingCSV("discrepancy");
        return;
      }
      if (uiState.reportSubTab === "sales_list") {
        handleExportClosingCSV("sales");
        return;
      }
      if (uiState.reportSubTab === "clients_day") {
        handleExportClosingCSV("clients_day");
        return;
      }
    }

    const csvContent = root.PDVDomain.exportCustomerReportCSV(dbState.sales, {
      query: uiState.reportQuery,
      segment: uiState.reportSegment,
      paymentMethod: uiState.reportPaymentMethod,
      sellerId: uiState.reportSellerId
    });
    const stamp = new Date().toISOString().slice(0, 10);
    triggerDownload("relatorio_vendas_por_cliente_" + stamp + ".csv", csvContent, "text/csv;charset=utf-8;");
    showToast("Relatório CSV/Excel exportado com sucesso!");
  }

  function updateDiscrepancyLiveDom() {
    if (!appContainer) return;
    const closing = root.PDVDomain.buildDailyClosingReport(dbState, {
      dateFilter: uiState.reportDateFilter,
      sellerId: uiState.reportSellerId,
      query: uiState.reportQuery,
      declaredPayments: getCurrentDeclaredPaymentsCents()
    });
    const disc = closing.discrepancyReport;
    disc.rows.forEach(function (row) {
      const diffCell = appContainer.querySelector('[data-disc-diff="' + row.method + '"]');
      const statusCell = appContainer.querySelector('[data-disc-status="' + row.method + '"]');
      const statusClass = "status-" + row.status.toLowerCase();
      const diffText = row.hasDeclared
        ? (row.discrepancyCents > 0 ? "+" : "") + root.PDVDomain.formatBRLFromCents(row.discrepancyCents)
        : "—";
      if (diffCell) diffCell.innerHTML = "<strong>" + escapeHtml(diffText) + "</strong>";
      if (statusCell) {
        statusCell.innerHTML = '<span class="discrepancy-pill ' + statusClass + '">' + escapeHtml(row.status) + "</span>";
      }
    });

    const totalDecl = appContainer.querySelector("#disc-total-declared");
    const totalDiff = appContainer.querySelector("#disc-total-diff");
    const totalStatus = appContainer.querySelector("#disc-total-status");
    if (totalDecl) {
      totalDecl.innerHTML = "<strong>" + root.PDVDomain.formatBRLFromCents(disc.totals.declaredCheckedCents) + "</strong>";
    }
    if (totalDiff) {
      const tDiffText = disc.totals.checkedMethodsCount > 0
        ? (disc.totals.discrepancyCents > 0 ? "+" : "") + root.PDVDomain.formatBRLFromCents(disc.totals.discrepancyCents)
        : "—";
      totalDiff.innerHTML = "<strong>" + escapeHtml(tDiffText) + "</strong>";
    }
    if (totalStatus) {
      totalStatus.innerHTML = '<span class="discrepancy-pill status-' + disc.totals.status.toLowerCase() + '">' + escapeHtml(disc.totals.status) + "</span>";
    }
  }

  function handleSaveCashClosing() {
    const key = uiState.reportDateFilter || "ALL";
    if (!dbState.cashClosings || typeof dbState.cashClosings !== "object") {
      dbState.cashClosings = {};
    }
    dbState.cashClosings[key] = {
      updatedAt: new Date().toISOString(),
      closedBy: (activeUser && (activeUser.name || activeUser.shortName)) || "Operador",
      notes: root.PDVDomain.cleanDisplayText(uiState.discrepancyNotes || ""),
      declaredByPayment: getCurrentDeclaredPaymentsCents()
    };
    root.PDVStorage.saveStateSync(dbState);
    const cfg = root.PDVStorage.loadSyncConfig();
    if (cfg && cfg.appsScriptUrl && cfg.autoSync !== false) {
      root.PDVStorage.syncWithGoogleSheets(dbState, { user: activeUser }).then(function () {
        renderApp();
      });
    }
    showToast("Conferência e discrepância de caixa salvas!");
    renderApp();
  }

  function handleFinalizeCheckout() {
    const totals = root.PDVDomain.calculateCartTotals(uiState.cart);
    let paymentsToSubmit = [];

    if (uiState.checkoutMode === "single") {
      let amountCents = totals.totalCents;
      if (uiState.singlePaymentMethod === "Dinheiro" && uiState.singleCashReceivedInput.trim()) {
        amountCents = root.PDVDomain.parseBRLToCents(uiState.singleCashReceivedInput);
      }
      paymentsToSubmit = [
        {
          method: uiState.singlePaymentMethod,
          amountCents: amountCents,
          installments: uiState.singlePaymentMethod === "Cartão de Crédito" ? Number(uiState.singleInstallments) || 1 : 1
        }
      ];
    } else {
      paymentsToSubmit = uiState.splitPayments.slice();
    }

    const result = root.PDVDomain.finalizeSale({
      cart: uiState.cart,
      payments: paymentsToSubmit,
      user: activeUser,
      products: dbState.products,
      notes: uiState.checkoutNotes
    });

    if (!result.ok) {
      uiState.checkoutError = result.error;
      renderApp();
      return;
    }

    dbState.products = result.products;
    dbState.sales.unshift(result.sale);
    if (!Array.isArray(dbState.stockAdjustments)) {
      dbState.stockAdjustments = [];
    }
    if (Array.isArray(result.stockAdjustments) && result.stockAdjustments.length > 0) {
      dbState.stockAdjustments = result.stockAdjustments.concat(dbState.stockAdjustments);
    }
    root.PDVStorage.saveStateSync(dbState);

    // Trigger background cloud sync if configured
    const cfg = root.PDVStorage.loadSyncConfig();
    if (cfg.appsScriptUrl && cfg.autoSync) {
      root.PDVStorage.syncWithGoogleSheets(dbState, { user: activeUser });
    }

    resetCartAndCheckout();
    uiState.cartDrawerOpen = false;
    uiState.printTarget = "receipt";
    uiState.receiptSale = result.sale;
    renderApp();
  }

  function navigateToView(viewName) {
    uiState.view = viewName || "home";
    uiState.mobileNavOpen = false;
    renderApp();
  }

  function triggerPrint(target, scope) {
    uiState.printTarget = target || "report";
    if (scope) uiState.printScope = scope;
    uiState.mobileNavOpen = false;
    renderApp();
    if (typeof document !== "undefined" && document.body) {
      document.body.setAttribute("data-print-target", uiState.printTarget);
    }
    if (typeof window !== "undefined" && typeof window.print === "function") {
      window.print();
    }
  }

  function bindAppEvents() {
    if (!appContainer) return;

    function onClick(selector, handler) {
      const el = appContainer.querySelector(selector);
      if (el) el.addEventListener("click", handler);
    }

    // Mobile drawer navigation
    onClick("#btn-mobile-nav-open", function () {
      uiState.mobileNavOpen = true;
      renderApp();
    });
    onClick("#btn-mobile-go-home", function () {
      navigateToView("home");
    });
    onClick("#btn-mobile-nav-close", function () {
      uiState.mobileNavOpen = false;
      renderApp();
    });
    const drawerBackdrop = appContainer.querySelector("#mobile-nav-drawer-backdrop");
    if (drawerBackdrop) {
      drawerBackdrop.addEventListener("click", function (e) {
        if (e.target === e.currentTarget) {
          uiState.mobileNavOpen = false;
          renderApp();
        }
      });
    }
    const mobileNavBtns = appContainer.querySelectorAll("[data-mobile-nav]");
    for (let i = 0; i < mobileNavBtns.length; i++) {
      mobileNavBtns[i].addEventListener("click", function (e) {
        navigateToView(e.currentTarget.getAttribute("data-mobile-nav") || "home");
      });
    }
    onClick("#btn-mobile-open-client", function () {
      uiState.mobileNavOpen = false;
      uiState.clientModalOpen = true;
      uiState.clientModalError = "";
      renderApp();
    });
    onClick("#btn-mobile-open-sync", function () {
      uiState.mobileNavOpen = false;
      uiState.syncModalOpen = true;
      uiState.syncMessage = "";
      uiState.syncError = "";
      renderApp();
    });
    onClick("#btn-mobile-logout", function () {
      uiState.mobileNavOpen = false;
      resetCartAndCheckout();
      root.PDVAuthGuard.logout();
    });

    // Topbar navigation
    onClick("#btn-go-home", function () {
      navigateToView("home");
    });
    onClick("#btn-nav-glow", function () {
      navigateToView("glow_hub");
    });
    onClick("#btn-nav-club", function () {
      navigateToView("bento_club");
    });
    onClick("#btn-nav-reports", function () {
      navigateToView("reports");
    });
    onClick("#btn-open-client-modal", function () {
      uiState.clientModalOpen = true;
      uiState.clientModalError = "";
      renderApp();
    });
    onClick("#btn-open-sync-modal", function () {
      uiState.syncModalOpen = true;
      uiState.syncMessage = "";
      uiState.syncError = "";
      renderApp();
    });
    onClick("#btn-toggle-cart", function () {
      uiState.cartDrawerOpen = !uiState.cartDrawerOpen;
      uiState.checkoutError = "";
      renderApp();
    });
    onClick("#btn-logout-user", function () {
      resetCartAndCheckout();
      root.PDVAuthGuard.logout();
    });

    // Home view buttons
    onClick("#card-choose-glowhub", function () {
      uiState.view = "glow_hub";
      renderApp();
    });
    onClick("#card-choose-bentoclub", function () {
      uiState.view = "bento_club";
      renderApp();
    });
    onClick("#btn-admin-open-reports", function () {
      uiState.view = "reports";
      renderApp();
    });
    onClick("#btn-admin-export-csv", handleExportCSV);

    // Back to menu buttons
    const backBtns = appContainer.querySelectorAll('[data-action="go-home"]');
    for (let i = 0; i < backBtns.length; i++) {
      backBtns[i].addEventListener("click", function () {
        uiState.view = "home";
        renderApp();
      });
    }

    // Glow Hub events
    const brandBtns = appContainer.querySelectorAll("[data-brand]");
    for (let i = 0; i < brandBtns.length; i++) {
      brandBtns[i].addEventListener("click", function (e) {
        uiState.selectedBrand = e.currentTarget.getAttribute("data-brand") || "ALL";
        uiState.selectedCategory = "ALL";
        renderApp();
      });
    }

    const prodSearch = appContainer.querySelector("#input-product-search");
    if (prodSearch) {
      prodSearch.addEventListener("input", function (e) {
        uiState.productQuery = e.target.value || "";
        renderApp();
        const restored = appContainer.querySelector("#input-product-search");
        if (restored) {
          restored.focus();
          try {
            restored.setSelectionRange(uiState.productQuery.length, uiState.productQuery.length);
          } catch (_err) { /* ignore */ }
        }
      });
    }
    onClick("#btn-clear-product-search", function () {
      uiState.productQuery = "";
      renderApp();
    });

    const catSelect = appContainer.querySelector("#select-product-category");
    if (catSelect) {
      catSelect.addEventListener("change", function (e) {
        uiState.selectedCategory = e.target.value || "ALL";
        renderApp();
      });
    }

    const stockChk = appContainer.querySelector("#chk-only-instock");
    if (stockChk) {
      stockChk.addEventListener("change", function (e) {
        uiState.onlyInStock = Boolean(e.target.checked);
        renderApp();
      });
    }

    const addProdBtns = appContainer.querySelectorAll("[data-add-product]");
    for (let i = 0; i < addProdBtns.length; i++) {
      addProdBtns[i].addEventListener("click", function (e) {
        const pid = e.currentTarget.getAttribute("data-add-product");
        const prod = (dbState.products || []).find(function (p) { return p.id === pid; });
        if (prod) handleAttemptAddCatalogItem(prod, 1);
      });
    }

    // BentoClub events
    const clubBtns = appContainer.querySelectorAll("[data-club]");
    for (let i = 0; i < clubBtns.length; i++) {
      clubBtns[i].addEventListener("click", function (e) {
        uiState.selectedClub = e.currentTarget.getAttribute("data-club") || "ALL";
        renderApp();
      });
    }

    const clubSearch = appContainer.querySelector("#input-club-search");
    if (clubSearch) {
      clubSearch.addEventListener("input", function (e) {
        uiState.clubQuery = e.target.value || "";
        renderApp();
        const restored = appContainer.querySelector("#input-club-search");
        if (restored) {
          restored.focus();
          try {
            restored.setSelectionRange(uiState.clubQuery.length, uiState.clubQuery.length);
          } catch (_err) { /* ignore */ }
        }
      });
    }
    onClick("#btn-clear-club-search", function () {
      uiState.clubQuery = "";
      renderApp();
    });

    const addClubBtns = appContainer.querySelectorAll("[data-add-club]");
    for (let i = 0; i < addClubBtns.length; i++) {
      addClubBtns[i].addEventListener("click", function (e) {
        const cid = e.currentTarget.getAttribute("data-add-club");
        const clubItem = (dbState.clubs || []).find(function (c) { return c.id === cid; });
        if (clubItem) handleAttemptAddCatalogItem(clubItem, 1);
      });
    }

    // Reports & Daily Closing events
    const reportTabs = appContainer.querySelectorAll("[data-report-tab]");
    for (let i = 0; i < reportTabs.length; i++) {
      reportTabs[i].addEventListener("click", function (e) {
        uiState.reportSubTab = e.currentTarget.getAttribute("data-report-tab") || "closing_cash";
        renderApp();
      });
    }

    onClick("#btn-report-date-today", function () {
      uiState.reportDateFilter = root.PDVDomain.getLocalDateKey();
      loadDiscrepancyInputsForDate(uiState.reportDateFilter);
      renderApp();
    });
    onClick("#btn-report-date-all", function () {
      uiState.reportDateFilter = "ALL";
      loadDiscrepancyInputsForDate("ALL");
      renderApp();
    });
    const repDateInput = appContainer.querySelector("#input-report-date");
    if (repDateInput) {
      repDateInput.addEventListener("change", function (e) {
        uiState.reportDateFilter = e.target.value ? e.target.value : "ALL";
        loadDiscrepancyInputsForDate(uiState.reportDateFilter);
        renderApp();
      });
    }

    const discInputs = appContainer.querySelectorAll("[data-discrepancy-method]");
    for (let i = 0; i < discInputs.length; i++) {
      discInputs[i].addEventListener("input", function (e) {
        const method = e.currentTarget.getAttribute("data-discrepancy-method");
        if (!uiState.discrepancyInputs) uiState.discrepancyInputs = {};
        uiState.discrepancyInputs[method] = e.currentTarget.value || "";
        updateDiscrepancyLiveDom();
      });
    }
    const discNotes = appContainer.querySelector("#input-discrepancy-notes");
    if (discNotes) {
      discNotes.addEventListener("input", function (e) {
        uiState.discrepancyNotes = e.target.value || "";
      });
    }
    onClick("#btn-fill-expected-cash", function () {
      const closing = root.PDVDomain.buildDailyClosingReport(dbState, {
        dateFilter: uiState.reportDateFilter,
        sellerId: uiState.reportSellerId,
        query: uiState.reportQuery
      });
      const filled = {};
      closing.cashReport.rows.forEach(function (r) {
        filled[r.method] = formatCentsForInput(r.totalCents);
      });
      uiState.discrepancyInputs = filled;
      renderApp();
      showToast("Valores do sistema preenchidos para conferência.");
    });
    onClick("#btn-save-cash-closing", handleSaveCashClosing);

    const repSearch = appContainer.querySelector("#input-report-search");
    if (repSearch) {
      repSearch.addEventListener("input", function (e) {
        uiState.reportQuery = e.target.value || "";
        renderApp();
        const restored = appContainer.querySelector("#input-report-search");
        if (restored) {
          restored.focus();
          try {
            restored.setSelectionRange(uiState.reportQuery.length, uiState.reportQuery.length);
          } catch (_err) { /* ignore */ }
        }
      });
    }
    const repSeg = appContainer.querySelector("#select-report-segment");
    if (repSeg) {
      repSeg.addEventListener("change", function (e) {
        uiState.reportSegment = e.target.value || "";
        renderApp();
      });
    }
    const repPay = appContainer.querySelector("#select-report-payment");
    if (repPay) {
      repPay.addEventListener("change", function (e) {
        uiState.reportPaymentMethod = e.target.value || "";
        renderApp();
      });
    }
    const repSeller = appContainer.querySelector("#select-report-seller");
    if (repSeller) {
      repSeller.addEventListener("change", function (e) {
        uiState.reportSellerId = e.target.value || "";
        renderApp();
      });
    }
    onClick("#btn-export-full-closing-csv", function () {
      handleExportClosingCSV("full_closing");
    });
    onClick("#btn-export-report-csv", handleExportCSV);
    onClick("#btn-print-report", function () {
      triggerPrint("report", "active_tab");
    });
    onClick("#btn-print-full-closing", function () {
      triggerPrint("report", "full_closing");
    });

    // Cart Drawer events
    onClick("#btn-close-cart", function () {
      uiState.cartDrawerOpen = false;
      renderApp();
    });
    onClick("#btn-drawer-go-home", function () {
      uiState.cartDrawerOpen = false;
      uiState.view = "home";
      renderApp();
    });
    onClick("#btn-change-cart-client", function () {
      uiState.clientModalOpen = true;
      uiState.clientModalError = "";
      renderApp();
    });

    const decBtns = appContainer.querySelectorAll("[data-qty-dec]");
    for (let i = 0; i < decBtns.length; i++) {
      decBtns[i].addEventListener("click", function (e) {
        const itemId = e.currentTarget.getAttribute("data-qty-dec");
        const item = uiState.cart.items.find(function (it) { return it.itemId === itemId; });
        if (item) {
          const res = root.PDVDomain.updateCartItemQty(uiState.cart, itemId, item.qty - 1, buildProductsMap());
          if (res.ok) uiState.cart = res.cart;
          renderApp();
        }
      });
    }

    const incBtns = appContainer.querySelectorAll("[data-qty-inc]");
    for (let i = 0; i < incBtns.length; i++) {
      incBtns[i].addEventListener("click", function (e) {
        const itemId = e.currentTarget.getAttribute("data-qty-inc");
        const item = uiState.cart.items.find(function (it) { return it.itemId === itemId; });
        if (item) {
          const res = root.PDVDomain.updateCartItemQty(uiState.cart, itemId, item.qty + 1, buildProductsMap());
          if (res.ok) {
            uiState.cart = res.cart;
          } else {
            showToast(res.error);
          }
          renderApp();
        }
      });
    }

    const remBtns = appContainer.querySelectorAll("[data-qty-remove]");
    for (let i = 0; i < remBtns.length; i++) {
      remBtns[i].addEventListener("click", function (e) {
        const itemId = e.currentTarget.getAttribute("data-qty-remove");
        const res = root.PDVDomain.updateCartItemQty(uiState.cart, itemId, 0, buildProductsMap());
        if (res.ok) uiState.cart = res.cart;
        renderApp();
      });
    }

    const payModeBtns = appContainer.querySelectorAll("[data-pay-mode]");
    for (let i = 0; i < payModeBtns.length; i++) {
      payModeBtns[i].addEventListener("click", function (e) {
        uiState.checkoutMode = e.currentTarget.getAttribute("data-pay-mode") || "single";
        uiState.checkoutError = "";
        renderApp();
      });
    }

    const singleMethodBtns = appContainer.querySelectorAll("[data-single-method]");
    for (let i = 0; i < singleMethodBtns.length; i++) {
      singleMethodBtns[i].addEventListener("click", function (e) {
        uiState.singlePaymentMethod = e.currentTarget.getAttribute("data-single-method") || "PIX";
        uiState.checkoutError = "";
        renderApp();
      });
    }

    const instSelect = appContainer.querySelector("#select-single-installments");
    if (instSelect) {
      instSelect.addEventListener("change", function (e) {
        uiState.singleInstallments = Number(e.target.value) || 1;
      });
    }

    const singleCashInput = appContainer.querySelector("#input-single-cash");
    if (singleCashInput) {
      singleCashInput.addEventListener("input", function (e) {
        uiState.singleCashReceivedInput = e.target.value || "";
        renderApp();
        const restored = appContainer.querySelector("#input-single-cash");
        if (restored) {
          restored.focus();
          try {
            restored.setSelectionRange(uiState.singleCashReceivedInput.length, uiState.singleCashReceivedInput.length);
          } catch (_err) { /* ignore */ }
        }
      });
    }

    const splitMethodSel = appContainer.querySelector("#select-split-method");
    if (splitMethodSel) {
      splitMethodSel.addEventListener("change", function (e) {
        uiState.splitDraftMethod = e.target.value || "PIX";
        renderApp();
      });
    }

    const splitInstSel = appContainer.querySelector("#select-split-installments");
    if (splitInstSel) {
      splitInstSel.addEventListener("change", function (e) {
        uiState.splitDraftInstallments = Number(e.target.value) || 1;
      });
    }

    const splitAmtInput = appContainer.querySelector("#input-split-amount");
    if (splitAmtInput) {
      splitAmtInput.addEventListener("input", function (e) {
        uiState.splitDraftAmountInput = e.target.value || "";
      });
    }

    onClick("#btn-add-split-payment", function () {
      const amtEl = appContainer.querySelector("#input-split-amount");
      const rawAmt = amtEl ? amtEl.value : uiState.splitDraftAmountInput;
      const cents = root.PDVDomain.parseBRLToCents(rawAmt);
      if (cents <= 0) {
        uiState.checkoutError = "Informe um valor maior que R$ 0,00 para lançar a parcela.";
        renderApp();
        return;
      }
      uiState.splitPayments.push({
        method: uiState.splitDraftMethod,
        amountCents: cents,
        installments: uiState.splitDraftMethod === "Cartão de Crédito" ? (Number(uiState.splitDraftInstallments) || 1) : 1
      });
      uiState.splitDraftAmountInput = "";
      uiState.splitDraftInstallments = 1;
      uiState.checkoutError = "";
      renderApp();
    });

    const removeSplitBtns = appContainer.querySelectorAll("[data-remove-split]");
    for (let i = 0; i < removeSplitBtns.length; i++) {
      removeSplitBtns[i].addEventListener("click", function (e) {
        const idx = Number(e.currentTarget.getAttribute("data-remove-split"));
        uiState.splitPayments.splice(idx, 1);
        renderApp();
      });
    }

    const notesInput = appContainer.querySelector("#input-checkout-notes");
    if (notesInput) {
      notesInput.addEventListener("input", function (e) {
        uiState.checkoutNotes = e.target.value || "";
      });
    }

    onClick("#btn-finalize-sale", handleFinalizeCheckout);

    // Client Modal events
    onClick("#btn-close-client-modal", function () {
      uiState.clientModalOpen = false;
      uiState.pendingCartAddition = null;
      uiState.selectedClientPendingPhone = null;
      renderApp();
    });

    const clientTabs = appContainer.querySelectorAll("[data-client-tab]");
    for (let i = 0; i < clientTabs.length; i++) {
      clientTabs[i].addEventListener("click", function (e) {
        uiState.clientModalTab = e.currentTarget.getAttribute("data-client-tab") || "search";
        uiState.clientModalError = "";
        renderApp();
      });
    }

    onClick("#btn-jump-new-client", function () {
      uiState.clientModalTab = "new";
      uiState.newClientNameInput = uiState.clientSearchQuery;
      uiState.clientModalError = "";
      renderApp();
    });

    onClick("#btn-create-from-search", function () {
      uiState.clientModalTab = "new";
      uiState.newClientNameInput = uiState.clientSearchQuery;
      uiState.clientModalError = "";
      renderApp();
    });

    const clientSearchInput = appContainer.querySelector("#input-client-modal-search");
    if (clientSearchInput) {
      clientSearchInput.addEventListener("input", function (e) {
        uiState.clientSearchQuery = e.target.value || "";
        uiState.selectedClientPendingPhone = null;
        renderApp();
        const restored = appContainer.querySelector("#input-client-modal-search");
        if (restored) {
          restored.focus();
          try {
            restored.setSelectionRange(uiState.clientSearchQuery.length, uiState.clientSearchQuery.length);
          } catch (_err) { /* ignore */ }
        }
      });
    }

    const selectClientBtns = appContainer.querySelectorAll("[data-select-client]");
    for (let i = 0; i < selectClientBtns.length; i++) {
      selectClientBtns[i].addEventListener("click", function (e) {
        const cid = e.currentTarget.getAttribute("data-select-client");
        const found = (dbState.clients || []).find(function (c) { return c.id === cid; });
        if (!found) return;
        if (root.PDVDomain.isValidPhone(found.phone)) {
          completeClientBindAndPendingAdd(found);
        } else {
          uiState.selectedClientPendingPhone = found;
          uiState.pendingPhoneInput = "";
          uiState.clientModalError = "";
          renderApp();
        }
      });
    }

    const completePhoneInput = appContainer.querySelector("#input-complete-client-phone");
    if (completePhoneInput) {
      completePhoneInput.addEventListener("input", function (e) {
        uiState.pendingPhoneInput = e.target.value || "";
      });
    }

    onClick("#btn-save-client-phone", function () {
      if (!uiState.selectedClientPendingPhone) return;
      const res = root.PDVDomain.createOrUpdateClient(dbState.clients, {
        id: uiState.selectedClientPendingPhone.id,
        name: uiState.selectedClientPendingPhone.name,
        phone: uiState.pendingPhoneInput
      });
      if (!res.ok) {
        uiState.clientModalError = res.error;
        renderApp();
        return;
      }
      dbState.clients = res.clients;
      root.PDVStorage.saveStateSync(dbState);
      completeClientBindAndPendingAdd(res.client);
    });

    const newClientForm = appContainer.querySelector("#form-quick-new-client");
    if (newClientForm) {
      const nameIn = appContainer.querySelector("#input-new-client-name");
      const phoneIn = appContainer.querySelector("#input-new-client-phone");
      if (nameIn) {
        nameIn.addEventListener("input", function (e) {
          uiState.newClientNameInput = e.target.value || "";
        });
      }
      if (phoneIn) {
        phoneIn.addEventListener("input", function (e) {
          uiState.newClientPhoneInput = e.target.value || "";
        });
      }
      newClientForm.addEventListener("submit", function (e) {
        e.preventDefault();
        const res = root.PDVDomain.createOrUpdateClient(dbState.clients, {
          name: uiState.newClientNameInput,
          phone: uiState.newClientPhoneInput
        });
        if (!res.ok) {
          uiState.clientModalError = res.error;
          renderApp();
          return;
        }
        dbState.clients = res.clients;
        root.PDVStorage.saveStateSync(dbState);
        uiState.newClientNameInput = "";
        uiState.newClientPhoneInput = "";
        completeClientBindAndPendingAdd(res.client);
      });
    }

    // Receipt Modal events
    onClick("#btn-receipt-new-sale", function () {
      uiState.receiptSale = null;
      uiState.printTarget = "report";
      navigateToView("home");
    });
    onClick("#btn-print-receipt", function () {
      triggerPrint("receipt");
    });

    // Sync Modal events
    onClick("#btn-close-sync-modal", function () {
      uiState.syncModalOpen = false;
      renderApp();
    });
    onClick("#btn-modal-export-csv", handleExportCSV);
    onClick("#btn-modal-export-json", function () {
      const payload = root.PDVStorage.createBackupPayload(dbState);
      const stamp = new Date().toISOString().slice(0, 10);
      triggerDownload("backup_pdv_glowhub_bentoclub_" + stamp + ".json", JSON.stringify(payload, null, 2), "application/json");
      uiState.syncMessage = "Backup JSON exportado com sucesso.";
      renderApp();
    });

    const importInput = appContainer.querySelector("#input-import-backup-json");
    if (importInput) {
      importInput.addEventListener("change", function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (evt) {
          const res = root.PDVStorage.importBackupPayload(evt.target.result, dbState, root.PDV_SEED_DATA);
          if (res.ok) {
            dbState = res.state;
            uiState.syncMessage = "Backup importado com sucesso (" + res.importedSales + " vendas consolidadas).";
            uiState.syncError = "";
          } else {
            uiState.syncError = res.error;
          }
          renderApp();
        };
        reader.readAsText(file);
      });
    }

    onClick("#btn-save-and-sync-cloud", function () {
      const urlInput = appContainer.querySelector("#input-apps-script-url");
      const urlVal = urlInput ? urlInput.value.trim() : "";
      root.PDVStorage.saveSyncConfig({ appsScriptUrl: urlVal });
      uiState.syncMessage = "Sincronizando com Google Sheets...";
      uiState.syncError = "";
      renderApp();

      root.PDVStorage.syncWithGoogleSheets(dbState, { appsScriptUrl: urlVal, user: activeUser }).then(function (res) {
        if (res.ok) {
          uiState.syncMessage = "Sincronização concluída! " + res.syncedSales + " venda(s) sincronizada(s) com o Google Sheets.";
          uiState.syncError = "";
        } else {
          uiState.syncMessage = "";
          uiState.syncError = res.error;
        }
        renderApp();
      });
    });
  }

  root.PDVApp = {
    mountDashboard: mountDashboard,
    getUiState: function () { return uiState; },
    getDbState: function () { return dbState; },
    handleAttemptAddCatalogItem: handleAttemptAddCatalogItem,
    completeClientBindAndPendingAdd: completeClientBindAndPendingAdd,
    buildPrintSheetHtml: function (scope) { return renderPrintSheet(null, scope); }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
