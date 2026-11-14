/* global globalThis */
/**
 * Core Domain Logic for PDV Glow Hub & BentoClub
 * Implements REQ-01..REQ-12, DEC-01..DEC-04, AC-01..AC-12
 */
(function (root) {
  "use strict";

  const VALID_PAYMENT_METHODS = [
    "PIX",
    "Dinheiro",
    "Cartão de Crédito",
    "Cartão de Débito",
    "Transferência Bancária"
  ];

  const CANONICAL_CLUBS_ORDER = [
    "Clube da Escova",
    "Clube da Unha Clássica",
    "Clube da Esmaltação em Gel",
    "Clube da Massagem",
    "Clube da Maquiagem",
    "Clube da Cor"
  ];

  function cleanDisplayText(value) {
    if (value === null || value === undefined) return "";
    const cleaned = String(value)
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned === "Manincure") return "Manicure";
    return cleaned;
  }

  function normalizeText(value) {
    const base = cleanDisplayText(value).toLowerCase();
    return base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function normalizePhone(rawPhone) {
    if (rawPhone === null || rawPhone === undefined) return "";
    const digits = String(rawPhone).replace(/\D/g, "");
    if (digits === "0") return "";
    return digits;
  }

  function isValidPhone(rawPhone) {
    const digits = normalizePhone(rawPhone);
    return digits.length === 10 || digits.length === 11;
  }

  function formatPhoneDisplay(rawPhone) {
    const d = normalizePhone(rawPhone);
    if (d.length === 11) {
      return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    }
    if (d.length === 10) {
      return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    }
    return d || "Sem celular";
  }

  function formatBRLFromCents(cents) {
    const safeCents = Math.round(Number(cents) || 0);
    const sign = safeCents < 0 ? "-" : "";
    const abs = Math.abs(safeCents);
    const reais = Math.floor(abs / 100);
    const centavos = String(abs % 100).padStart(2, "0");
    const reaisFormatted = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return sign + "R$ " + reaisFormatted + "," + centavos;
  }

  function parseBRLToCents(input) {
    if (typeof input === "number") {
      return Math.round(input * 100);
    }
    if (!input) return 0;
    let str = String(input)
      .replace(/R\$/gi, "")
      .replace(/\u00a0/g, "")
      .trim();
    if (!str) return 0;
    if (str.indexOf(",") !== -1) {
      str = str.replace(/\./g, "").replace(",", ".");
    }
    const val = parseFloat(str);
    if (Number.isNaN(val)) return 0;
    return Math.round(val * 100);
  }

  function isExcludedAnomalyProduct(name, priceCents) {
    const cleaned = cleanDisplayText(name);
    return priceCents <= 8 || cleaned.indexOf("*") !== -1;
  }

  function authenticateUser(users, identifier) {
    const q = normalizeText(identifier);
    if (!q || !Array.isArray(users)) return null;
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      if (
        normalizeText(u.id) === q ||
        normalizeText(u.email) === q ||
        normalizeText(u.shortName) === q ||
        normalizeText(u.name) === q
      ) {
        const cleanRole = cleanDisplayText(u.role);
        return {
          id: u.id,
          name: cleanDisplayText(u.name),
          shortName: cleanDisplayText(u.shortName),
          email: cleanDisplayText(u.email).toLowerCase(),
          role: cleanRole,
          isAdmin: cleanRole === "Gestor"
        };
      }
    }
    return null;
  }

  function filterProducts(products, filters) {
    const opts = filters || {};
    const brand = cleanDisplayText(opts.brand || "");
    const category = cleanDisplayText(opts.category || "");
    const query = normalizeText(opts.query || "");
    const onlyInStock = Boolean(opts.onlyInStock);

    return (products || []).filter(function (p) {
      if (isExcludedAnomalyProduct(p.name, p.priceCents)) return false;
      if (brand && brand !== "ALL" && cleanDisplayText(p.brand) !== brand) {
        return false;
      }
      if (category && category !== "ALL" && cleanDisplayText(p.category) !== category) {
        return false;
      }
      if (onlyInStock && Number(p.stock) <= 0) {
        return false;
      }
      if (query) {
        const hay = p.searchIndex || normalizeText(
          [p.brand, p.name, p.family, p.line, p.category, p.benefit, p.needGroup].join(" ")
        );
        const tokens = query.split(/\s+/).filter(Boolean);
        for (let i = 0; i < tokens.length; i++) {
          if (hay.indexOf(tokens[i]) === -1) return false;
        }
      }
      return true;
    });
  }

  function filterClubs(clubs, filters) {
    const opts = filters || {};
    const club = cleanDisplayText(opts.club || "");
    const query = normalizeText(opts.query || "");

    return (clubs || []).filter(function (c) {
      if (club && club !== "ALL" && cleanDisplayText(c.club) !== club) {
        return false;
      }
      if (query) {
        const hay = c.searchIndex || normalizeText(
          [c.club, c.originalClub, c.option, c.size, c.sessions, c.validity].join(" ")
        );
        const tokens = query.split(/\s+/).filter(Boolean);
        for (let i = 0; i < tokens.length; i++) {
          if (hay.indexOf(tokens[i]) === -1) return false;
        }
      }
      return true;
    });
  }

  function searchClients(clients, query, limit) {
    const maxResults = limit || 30;
    const q = normalizeText(query || "");
    const qDigits = normalizePhone(query || "");
    const list = clients || [];
    if (!q) {
      return list.slice(0, maxResults);
    }
    const matches = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const hay = c.searchIndex || (normalizeText(c.name) + " " + normalizePhone(c.phone));
      const nameMatch = hay.indexOf(q) !== -1;
      const phoneMatch = qDigits.length >= 3 && normalizePhone(c.phone).indexOf(qDigits) !== -1;
      if (nameMatch || phoneMatch) {
        matches.push(c);
        if (matches.length >= maxResults) break;
      }
    }
    return matches;
  }

  function createOrUpdateClient(clients, payload) {
    const name = cleanDisplayText(payload && payload.name);
    const phone = normalizePhone(payload && payload.phone);
    const existingId = payload && payload.id ? String(payload.id) : "";

    if (name.length < 2) {
      return { ok: false, error: "Informe o nome completo do cliente." };
    }
    if (!isValidPhone(phone)) {
      return { ok: false, error: "Informe um celular válido com DDD (10 ou 11 dígitos)." };
    }

    const updatedList = (clients || []).slice();
    if (existingId) {
      for (let i = 0; i < updatedList.length; i++) {
        if (updatedList[i].id === existingId) {
          const updatedClient = {
            id: updatedList[i].id,
            name: name,
            phone: phone,
            hasValidPhone: true,
            searchIndex: normalizeText(name) + " " + phone,
            createdAt: updatedList[i].createdAt || "",
            updatedAt: new Date().toISOString(),
            syncStatus: "pending"
          };
          updatedList[i] = updatedClient;
          return { ok: true, client: updatedClient, clients: updatedList, isNew: false };
        }
      }
    }

    // Check if client already exists by exact normalized name + phone
    const normName = normalizeText(name);
    for (let i = 0; i < updatedList.length; i++) {
      const existing = updatedList[i];
      if (normalizeText(existing.name) === normName && (!existing.phone || existing.phone === phone)) {
        const merged = {
          id: existing.id,
          name: existing.name,
          phone: phone,
          hasValidPhone: true,
          searchIndex: normalizeText(existing.name) + " " + phone,
          createdAt: existing.createdAt || "",
          updatedAt: new Date().toISOString(),
          syncStatus: "pending"
        };
        updatedList[i] = merged;
        return { ok: true, client: merged, clients: updatedList, isNew: false };
      }
    }

    const newClient = {
      id: "cli-" + String(updatedList.length + 1).padStart(4, "0") + "-" + Date.now().toString(36).slice(-4),
      name: name,
      phone: phone,
      hasValidPhone: true,
      searchIndex: normName + " " + phone,
      createdAt: new Date().toISOString(),
      syncStatus: "pending"
    };
    updatedList.unshift(newClient);
    return { ok: true, client: newClient, clients: updatedList, isNew: true };
  }

  function createEmptyCart() {
    return {
      client: null,
      items: []
    };
  }

  function computeStockAdjustmentInfo(stockBefore, totalQty) {
    const rawBefore = Number(stockBefore) || 0;
    const effectiveAvailable = Math.max(0, rawBefore);
    const qty = Math.max(0, Math.round(Number(totalQty) || 0));
    const adjustmentQty = Math.max(0, qty - effectiveAvailable);
    const stockAfter = adjustmentQty > 0 ? 0 : (effectiveAvailable - qty);
    return {
      stockBefore: rawBefore,
      effectiveAvailable: effectiveAvailable,
      qty: qty,
      adjustmentQty: adjustmentQty,
      stockAfter: stockAfter,
      requiresStockAdjustment: adjustmentQty > 0
    };
  }

  function canAddProductToCart(stock, currentInCart, addQty) {
    const curr = Number(currentInCart) || 0;
    const add = Number(addQty) || 0;
    if (add < 1) return false;
    return curr + add >= 1;
  }

  function calculateCartTotals(cart) {
    const items = (cart && cart.items) || [];
    let totalCents = 0;
    let totalQty = 0;
    let glowHubCents = 0;
    let bentoClubCents = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const lineCents = Math.round(Number(it.unitPriceCents) || 0) * Math.round(Number(it.qty) || 0);
      totalCents += lineCents;
      totalQty += Math.round(Number(it.qty) || 0);
      if (it.segment === "glow_hub") {
        glowHubCents += lineCents;
      } else {
        bentoClubCents += lineCents;
      }
    }
    return {
      totalCents: totalCents,
      totalQty: totalQty,
      glowHubCents: glowHubCents,
      bentoClubCents: bentoClubCents
    };
  }

  function addItemToCart(cart, catalogItem, addQty) {
    const qtyToAdd = addQty === undefined ? 1 : Number(addQty);
    if (!catalogItem || qtyToAdd < 1) {
      return { ok: false, error: "Item ou quantidade inválida." };
    }

    const currentCart = cart || createEmptyCart();
    const existingIndex = currentCart.items.findIndex(function (i) {
      return i.itemId === catalogItem.id;
    });
    const currentQty = existingIndex >= 0 ? currentCart.items[existingIndex].qty : 0;
    const nextQty = currentQty + qtyToAdd;

    // Q4 / REQ-07: Must bind a valid client (with 10/11 digit phone) on the 1st item added
    if (!currentCart.client || !isValidPhone(currentCart.client.phone)) {
      return {
        ok: false,
        code: "CLIENT_REQUIRED",
        requiresClient: true,
        pendingItem: catalogItem,
        pendingQty: qtyToAdd,
        error: "Selecione ou cadastre o cliente (Nome + Celular) para adicionar ao carrinho."
      };
    }

    const stockInfo = catalogItem.segment === "glow_hub"
      ? computeStockAdjustmentInfo(catalogItem.stock, nextQty)
      : null;

    const nextItems = currentCart.items.slice();
    if (existingIndex >= 0) {
      const prev = nextItems[existingIndex];
      nextItems[existingIndex] = Object.assign({}, prev, {
        qty: nextQty,
        availableStock: stockInfo ? stockInfo.stockBefore : prev.availableStock,
        maxStock: stockInfo ? stockInfo.stockBefore : prev.maxStock,
        adjustmentQty: stockInfo ? stockInfo.adjustmentQty : 0,
        requiresStockAdjustment: stockInfo ? stockInfo.requiresStockAdjustment : false
      });
    } else {
      nextItems.push({
        itemId: catalogItem.id,
        segment: catalogItem.segment,
        brand: catalogItem.brand || "",
        club: catalogItem.club || "",
        name: catalogItem.name,
        subtitle: catalogItem.segment === "glow_hub"
          ? [catalogItem.brand, catalogItem.line, catalogItem.sizeLabel].filter(Boolean).join(" • ")
          : [catalogItem.club, catalogItem.sessions + " sessões", "Validade: " + catalogItem.validity].filter(Boolean).join(" • "),
        unitPriceCents: Number(catalogItem.priceCents),
        qty: qtyToAdd,
        availableStock: stockInfo ? stockInfo.stockBefore : null,
        maxStock: stockInfo ? stockInfo.stockBefore : null,
        adjustmentQty: stockInfo ? stockInfo.adjustmentQty : 0,
        requiresStockAdjustment: stockInfo ? stockInfo.requiresStockAdjustment : false
      });
    }

    const nextCart = {
      client: currentCart.client,
      items: nextItems
    };
    return {
      ok: true,
      cart: nextCart,
      totals: calculateCartTotals(nextCart),
      stockAdjustmentInfo: stockInfo
    };
  }

  function updateCartItemQty(cart, itemId, newQty, productsMap) {
    const currentCart = cart || createEmptyCart();
    const idx = currentCart.items.findIndex(function (i) {
      return i.itemId === itemId;
    });
    if (idx === -1) {
      return { ok: false, error: "Item não encontrado no carrinho." };
    }
    const targetQty = Math.round(Number(newQty) || 0);
    const nextItems = currentCart.items.slice();

    if (targetQty <= 0) {
      nextItems.splice(idx, 1);
      const updated = { client: currentCart.client, items: nextItems };
      return { ok: true, cart: updated, totals: calculateCartTotals(updated) };
    }

    const item = nextItems[idx];
    let stockInfo = null;
    if (item.segment === "glow_hub") {
      const liveProduct = productsMap && productsMap[item.itemId];
      const availableStock = liveProduct
        ? Number(liveProduct.stock)
        : Number(item.availableStock !== undefined && item.availableStock !== null ? item.availableStock : item.maxStock);
      stockInfo = computeStockAdjustmentInfo(availableStock, targetQty);
    }

    nextItems[idx] = Object.assign({}, item, {
      qty: targetQty,
      availableStock: stockInfo ? stockInfo.stockBefore : item.availableStock,
      maxStock: stockInfo ? stockInfo.stockBefore : item.maxStock,
      adjustmentQty: stockInfo ? stockInfo.adjustmentQty : 0,
      requiresStockAdjustment: stockInfo ? stockInfo.requiresStockAdjustment : false
    });
    const updated = { client: currentCart.client, items: nextItems };
    return { ok: true, cart: updated, totals: calculateCartTotals(updated), stockAdjustmentInfo: stockInfo };
  }

  function validateCheckoutPayments(cartTotalCents, payments) {
    const total = Math.round(Number(cartTotalCents) || 0);
    if (total <= 0 || !Array.isArray(payments) || payments.length === 0) {
      return {
        valid: false,
        paidCents: 0,
        changeCents: 0,
        remainingCents: Math.max(0, total),
        reason: "empty_checkout",
        error: "Adicione itens ao carrinho e informe a forma de pagamento."
      };
    }

    let paidCents = 0;
    let hasCash = false;

    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      const method = cleanDisplayText(p && p.method);
      const amountCents = Math.round(Number(p && p.amountCents) || 0);
      if (VALID_PAYMENT_METHODS.indexOf(method) === -1 || amountCents <= 0) {
        return {
          valid: false,
          paidCents: paidCents,
          changeCents: 0,
          remainingCents: Math.max(0, total - paidCents),
          reason: "invalid_payment_entry",
          error: "Forma de pagamento ou valor inválido."
        };
      }
      if (method === "Dinheiro") {
        hasCash = true;
      }
      paidCents += amountCents;
    }

    if (paidCents < total) {
      return {
        valid: false,
        paidCents: paidCents,
        changeCents: 0,
        remainingCents: total - paidCents,
        reason: "insufficient_payment",
        error: "Faltam " + formatBRLFromCents(total - paidCents) + " para quitar o total do pedido."
      };
    }

    if (paidCents > total && !hasCash) {
      return {
        valid: false,
        paidCents: paidCents,
        changeCents: 0,
        remainingCents: 0,
        reason: "overpayment_without_cash",
        error: "O valor informado excede o total da venda (troco permitido apenas em Dinheiro)."
      };
    }

    return {
      valid: true,
      paidCents: paidCents,
      changeCents: paidCents - total,
      remainingCents: 0,
      reason: "ok",
      error: null
    };
  }

  function finalizeSale(params) {
    const cart = params && params.cart;
    const payments = params && params.payments;
    const user = params && params.user;
    const products = (params && params.products) || [];
    const notes = cleanDisplayText((params && params.notes) || "");

    if (!user || !user.id) {
      return { ok: false, error: "Operador não autenticado." };
    }
    if (!cart || !cart.client || !isValidPhone(cart.client.phone)) {
      return { ok: false, error: "Cliente com celular válido é obrigatório para concluir a venda." };
    }
    if (!Array.isArray(cart.items) || cart.items.length === 0) {
      return { ok: false, error: "O carrinho está vazio." };
    }

    const totals = calculateCartTotals(cart);
    const payCheck = validateCheckoutPayments(totals.totalCents, payments);
    if (!payCheck.valid) {
      return { ok: false, error: payCheck.error };
    }

    // Deduct product stock atomically and record stock adjustments for insufficient/negative stock
    const nextProducts = products.map(function (p) {
      return Object.assign({}, p);
    });
    const productIndexById = {};
    for (let i = 0; i < nextProducts.length; i++) {
      productIndexById[nextProducts[i].id] = i;
    }

    const nowIso = (params && params.createdAt) || new Date().toISOString();
    const saleId = "vnd-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    const clientSummary = {
      id: cart.client.id,
      name: cleanDisplayText(cart.client.name),
      phone: normalizePhone(cart.client.phone)
    };
    const sellerSummary = {
      id: user.id,
      name: user.name,
      shortName: user.shortName || user.name,
      email: user.email || "",
      role: user.role
    };

    const stockAdjustments = [];
    const finalizedItems = [];

    for (let i = 0; i < cart.items.length; i++) {
      const it = cart.items[i];
      let stockBefore = null;
      let adjustmentQty = 0;
      let stockAfter = null;

      if (it.segment === "glow_hub") {
        const pIdx = productIndexById[it.itemId];
        if (pIdx === undefined) {
          return { ok: false, error: "Produto não encontrado no catálogo: " + it.name };
        }
        const prod = nextProducts[pIdx];
        const adjInfo = computeStockAdjustmentInfo(prod.stock, it.qty);
        stockBefore = adjInfo.stockBefore;
        adjustmentQty = adjInfo.adjustmentQty;
        stockAfter = adjInfo.stockAfter;
        prod.stock = stockAfter;

        if (adjustmentQty > 0) {
          stockAdjustments.push({
            id: "adj-" + Date.now().toString(36).toUpperCase() + "-" + i + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
            saleId: saleId,
            createdAt: nowIso,
            productId: prod.id,
            brand: prod.brand || it.brand || "",
            productName: prod.name || it.name,
            stockBefore: stockBefore,
            soldQty: Number(it.qty),
            negativeBalance: stockBefore - Number(it.qty),
            adjustmentQty: adjustmentQty,
            stockAfter: stockAfter,
            unitPriceCents: Number(it.unitPriceCents),
            adjustmentValueCents: adjustmentQty * Number(it.unitPriceCents),
            client: {
              id: clientSummary.id,
              name: clientSummary.name,
              phone: clientSummary.phone,
              phoneFormatted: formatPhoneDisplay(clientSummary.phone)
            },
            seller: {
              id: sellerSummary.id,
              name: sellerSummary.name,
              shortName: sellerSummary.shortName,
              role: sellerSummary.role
            },
            reason: "Ajuste automático de estoque negativo para viabilizar venda"
          });
        }
      }

      finalizedItems.push({
        itemId: it.itemId,
        segment: it.segment,
        brand: it.brand || "",
        club: it.club || "",
        name: it.name,
        subtitle: it.subtitle || "",
        qty: Number(it.qty),
        unitPriceCents: Number(it.unitPriceCents),
        lineTotalCents: Number(it.unitPriceCents) * Number(it.qty),
        stockBefore: stockBefore,
        adjustmentQty: adjustmentQty,
        stockAfter: stockAfter,
        requiresStockAdjustment: adjustmentQty > 0
      });
    }

    const saleRecord = {
      id: saleId,
      createdAt: nowIso,
      seller: sellerSummary,
      client: clientSummary,
      items: finalizedItems,
      payments: payments.map(function (p) {
        return {
          method: cleanDisplayText(p.method),
          amountCents: Math.round(Number(p.amountCents)),
          installments: p.method === "Cartão de Crédito" ? Math.max(1, Number(p.installments) || 1) : 1
        };
      }),
      totalCents: totals.totalCents,
      paidCents: payCheck.paidCents,
      changeCents: payCheck.changeCents,
      glowHubCents: totals.glowHubCents,
      bentoClubCents: totals.bentoClubCents,
      stockAdjustments: stockAdjustments,
      notes: notes,
      syncStatus: "pending"
    };

    return {
      ok: true,
      sale: saleRecord,
      stockAdjustments: stockAdjustments,
      products: nextProducts,
      emptyCart: createEmptyCart()
    };
  }

  function computeAdminDashboard(sales, user) {
    if (!user || !user.isAdmin || cleanDisplayText(user.role) !== "Gestor") {
      return {
        authorized: false,
        error: "Acesso restrito ao perfil Gestor (Carolina e João)."
      };
    }

    const list = sales || [];
    let totalCents = 0;
    let totalItems = 0;
    let glowHubCents = 0;
    let glowHubItems = 0;
    let bentoClubCents = 0;
    let bentoClubItems = 0;
    const uniqueClients = {};

    const byBrand = {
      Davines: { cents: 0, items: 0 },
      Keune: { cents: 0, items: 0 },
      "Kérastase": { cents: 0, items: 0 }
    };

    const byClub = {};
    for (let i = 0; i < CANONICAL_CLUBS_ORDER.length; i++) {
      byClub[CANONICAL_CLUBS_ORDER[i]] = { cents: 0, items: 0 };
    }

    const byPayment = {};
    for (let i = 0; i < VALID_PAYMENT_METHODS.length; i++) {
      byPayment[VALID_PAYMENT_METHODS[i]] = 0;
    }

    for (let s = 0; s < list.length; s++) {
      const sale = list[s];
      if (sale.client && sale.client.id) {
        uniqueClients[sale.client.id] = true;
      }
      const items = sale.items || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const qty = Number(it.qty) || 0;
        const lineCents = (Number(it.unitPriceCents) || 0) * qty;
        totalCents += lineCents;
        totalItems += qty;

        if (it.segment === "glow_hub") {
          glowHubCents += lineCents;
          glowHubItems += qty;
          const b = it.brand || "Outros";
          if (!byBrand[b]) byBrand[b] = { cents: 0, items: 0 };
          byBrand[b].cents += lineCents;
          byBrand[b].items += qty;
        } else {
          bentoClubCents += lineCents;
          bentoClubItems += qty;
          const c = it.club || "Outros";
          if (!byClub[c]) byClub[c] = { cents: 0, items: 0 };
          byClub[c].cents += lineCents;
          byClub[c].items += qty;
        }
      }

      const pays = sale.payments || [];
      let remainingSaleCents = Number(sale.totalCents) || 0;
      for (let p = 0; p < pays.length; p++) {
        const pm = pays[p];
        const effectiveAmount = Math.min(remainingSaleCents, Number(pm.amountCents) || 0);
        remainingSaleCents = Math.max(0, remainingSaleCents - effectiveAmount);
        byPayment[pm.method] = (byPayment[pm.method] || 0) + effectiveAmount;
      }
    }

    return {
      authorized: true,
      ordersCount: list.length,
      uniqueClientsCount: Object.keys(uniqueClients).length,
      totalCents: totalCents,
      totalItems: totalItems,
      averageTicketCents: list.length > 0 ? Math.round(totalCents / list.length) : 0,
      segments: {
        glowHub: {
          cents: glowHubCents,
          items: glowHubItems,
          sharePercent: totalCents > 0 ? Math.round((glowHubCents * 100) / totalCents) : 0
        },
        bentoClub: {
          cents: bentoClubCents,
          items: bentoClubItems,
          sharePercent: totalCents > 0 ? Math.round((bentoClubCents * 100) / totalCents) : 0
        }
      },
      byBrand: byBrand,
      byClub: byClub,
      byPayment: byPayment
    };
  }

  function buildCustomerSalesReport(sales, filters) {
    const opts = filters || {};
    const q = normalizeText(opts.query || "");
    const segment = opts.segment || "";
    const paymentMethod = opts.paymentMethod || "";
    const sellerId = opts.sellerId || "";

    const grouped = {};
    const list = sales || [];

    for (let s = 0; s < list.length; s++) {
      const sale = list[s];
      if (sellerId && sale.seller && sale.seller.id !== sellerId) {
        continue;
      }
      if (paymentMethod) {
        const hasMethod = (sale.payments || []).some(function (p) {
          return p.method === paymentMethod;
        });
        if (!hasMethod) continue;
      }

      const matchedItems = (sale.items || []).filter(function (it) {
        if (segment && it.segment !== segment) return false;
        return true;
      });
      if (matchedItems.length === 0) continue;

      const client = sale.client || {};
      const clientName = cleanDisplayText(client.name || "Cliente sem nome");
      const clientPhone = normalizePhone(client.phone || "");
      const clientKey = client.id || (normalizeText(clientName) + ":" + clientPhone);

      const searchHay = normalizeText(
        clientName + " " + clientPhone + " " + matchedItems.map(function (i) {
          return i.name + " " + (i.brand || "") + " " + (i.club || "");
        }).join(" ")
      );
      if (q && searchHay.indexOf(q) === -1) {
        continue;
      }

      if (!grouped[clientKey]) {
        grouped[clientKey] = {
          clientId: clientKey,
          clientName: clientName,
          clientPhone: clientPhone,
          ordersCount: 0,
          itemsCount: 0,
          totalCents: 0,
          glowHubCents: 0,
          bentoClubCents: 0,
          purchases: []
        };
      }

      const entry = grouped[clientKey];
      entry.ordersCount += 1;
      const paySummary = (sale.payments || []).map(function (p) {
        const inst = p.method === "Cartão de Crédito" && p.installments > 1 ? " (" + p.installments + "x)" : "";
        return p.method + inst + ": " + formatBRLFromCents(p.amountCents);
      }).join(" + ");

      for (let i = 0; i < matchedItems.length; i++) {
        const it = matchedItems[i];
        const qty = Number(it.qty) || 0;
        const lineCents = (Number(it.unitPriceCents) || 0) * qty;
        entry.itemsCount += qty;
        entry.totalCents += lineCents;
        if (it.segment === "glow_hub") {
          entry.glowHubCents += lineCents;
        } else {
          entry.bentoClubCents += lineCents;
        }
        entry.purchases.push({
          saleId: sale.id,
          createdAt: sale.createdAt,
          sellerName: (sale.seller && (sale.seller.shortName || sale.seller.name)) || "",
          paymentSummary: paySummary,
          segment: it.segment,
          segmentLabel: it.segment === "glow_hub" ? "Glow Hub" : "BentoClub",
          groupName: it.brand || it.club || "",
          itemName: it.name,
          qty: qty,
          unitPriceCents: Number(it.unitPriceCents) || 0,
          lineTotalCents: lineCents
        });
      }
    }

    return Object.keys(grouped)
      .map(function (k) {
        return grouped[k];
      })
      .sort(function (a, b) {
        if (b.totalCents !== a.totalCents) return b.totalCents - a.totalCents;
        return a.clientName.localeCompare(b.clientName);
      });
  }

  function escapeCsvCell(val) {
    const str = String(val === null || val === undefined ? "" : val).replace(/"/g, '""');
    return '"' + str + '"';
  }

  function centsToCsvDecimal(cents) {
    return ((Math.round(Number(cents) || 0)) / 100).toFixed(2).replace(".", ",");
  }

  function getLocalDateKey(input) {
    if (!input) {
      const now = new Date();
      return (
        now.getFullYear() +
        "-" +
        String(now.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(now.getDate()).padStart(2, "0")
      );
    }
    const raw = String(input).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) {
      return "";
    }
    return (
      dt.getFullYear() +
      "-" +
      String(dt.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(dt.getDate()).padStart(2, "0")
    );
  }

  function matchesDateKey(isoStr, dateFilter, useUtcDate) {
    if (!dateFilter || dateFilter === "ALL") return true;
    if (!isoStr) return false;
    if (useUtcDate && /^\d{4}-\d{2}-\d{2}/.test(String(isoStr))) {
      return String(isoStr).slice(0, 10) === dateFilter;
    }
    return getLocalDateKey(isoStr) === dateFilter;
  }

  function exportCustomerReportCSV(sales, filters) {
    const customers = buildCustomerSalesReport(sales, filters);
    const headers = [
      "Cliente",
      "Celular",
      "ID Pedido",
      "Data/Hora",
      "Vendedor",
      "Segmento",
      "Marca / Clube",
      "Item Vendido",
      "Quantidade",
      "Valor Unitario (R$)",
      "Valor Total Item (R$)",
      "Formas de Pagamento"
    ];

    const lines = [headers.map(escapeCsvCell).join(";")];
    for (let c = 0; c < customers.length; c++) {
      const cust = customers[c];
      for (let p = 0; p < cust.purchases.length; p++) {
        const pur = cust.purchases[p];
        lines.push([
          cust.clientName,
          formatPhoneDisplay(cust.clientPhone),
          pur.saleId,
          pur.createdAt,
          pur.sellerName,
          pur.segmentLabel,
          pur.groupName,
          pur.itemName,
          pur.qty,
          centsToCsvDecimal(pur.unitPriceCents),
          centsToCsvDecimal(pur.lineTotalCents),
          pur.paymentSummary
        ].map(escapeCsvCell).join(";"));
      }
    }
    return "\uFEFF" + lines.join("\r\n");
  }

  function computeSaleSegmentTotals(sale) {
    const items = (sale && sale.items) || [];
    let glowHubCents = 0;
    let bentoClubCents = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const lineCents = (Number(it.unitPriceCents) || 0) * (Number(it.qty) || 0);
      if (it.segment === "glow_hub") {
        glowHubCents += lineCents;
      } else {
        bentoClubCents += lineCents;
      }
    }
    return {
      glowHubCents: glowHubCents,
      bentoClubCents: bentoClubCents,
      totalCents: glowHubCents + bentoClubCents
    };
  }

  function collectAllStockAdjustments(state) {
    const seenIds = {};
    const collected = [];
    const topLevel = (state && state.stockAdjustments) || [];

    for (let i = 0; i < topLevel.length; i++) {
      const adj = topLevel[i];
      if (!adj) continue;
      const key = adj.id || (adj.saleId + ":" + adj.productId);
      seenIds[key] = true;
      collected.push(adj);
    }

    const sales = (state && state.sales) || [];
    for (let s = 0; s < sales.length; s++) {
      const sale = sales[s];
      const saleAdjs = (sale && sale.stockAdjustments) || [];
      for (let a = 0; a < saleAdjs.length; a++) {
        const adj = saleAdjs[a];
        if (!adj) continue;
        const key = adj.id || (adj.saleId + ":" + adj.productId);
        if (!seenIds[key]) {
          seenIds[key] = true;
          collected.push(adj);
        }
      }
    }

    return collected.sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }

  function buildDailyClosingReport(state, options) {
    const opts = options || {};
    const safeState = state || {};
    const dateFilter = opts.dateFilter && opts.dateFilter !== "ALL" ? String(opts.dateFilter).trim() : "";
    const sellerId = opts.sellerId ? String(opts.sellerId).trim() : "";
    const query = normalizeText(opts.query || "");
    const useUtcDate = Boolean(opts.useUtcDate);

    const closingKey = dateFilter || "ALL";
    const storedClosing =
      (safeState.cashClosings && (safeState.cashClosings[closingKey] || safeState.cashClosings["ALL"])) || null;
    const declaredPayments =
      opts.declaredPayments || (storedClosing && storedClosing.declaredByPayment) || {};

    const allSales = safeState.sales || [];
    const filteredSales = allSales.filter(function (sale) {
      if (!matchesDateKey(sale.createdAt, dateFilter, useUtcDate)) return false;
      if (sellerId && (!sale.seller || sale.seller.id !== sellerId)) return false;
      return true;
    });

    const cashByPaymentMap = {};
    for (let m = 0; m < VALID_PAYMENT_METHODS.length; m++) {
      const methodName = VALID_PAYMENT_METHODS[m];
      cashByPaymentMap[methodName] = {
        method: methodName,
        totalCents: 0,
        glowHubCents: 0,
        bentoClubCents: 0,
        ordersCount: 0
      };
    }

    const salesLines = [];
    const ordersSummary = [];

    for (let s = 0; s < filteredSales.length; s++) {
      const sale = filteredSales[s];
      const segTotals = computeSaleSegmentTotals(sale);
      const saleTotal = segTotals.totalCents;
      let remainingChange = Math.max(0, Number(sale.changeCents) || 0);
      const methodsInSale = {};
      const paymentLabels = [];

      const pays = sale.payments || [];
      for (let p = 0; p < pays.length; p++) {
        const pay = pays[p];
        const method = cleanDisplayText(pay.method);
        const bucket = cashByPaymentMap[method];
        const rawAmount = Math.round(Number(pay.amountCents) || 0);
        let netAmount = rawAmount;

        if (method === "Dinheiro" && remainingChange > 0) {
          const deduct = Math.min(remainingChange, rawAmount);
          netAmount = rawAmount - deduct;
          remainingChange -= deduct;
        }

        if (bucket) {
          let ghShare = 0;
          let bcShare = 0;
          if (saleTotal > 0) {
            ghShare = Math.round((netAmount * segTotals.glowHubCents) / saleTotal);
            bcShare = netAmount - ghShare;
          }
          bucket.totalCents += netAmount;
          bucket.glowHubCents += ghShare;
          bucket.bentoClubCents += bcShare;
          if (!methodsInSale[method]) {
            bucket.ordersCount += 1;
            methodsInSale[method] = true;
          }
        }

        const inst = method === "Cartão de Crédito" && Number(pay.installments) > 1 ? " (" + pay.installments + "x)" : "";
        paymentLabels.push(method + inst + ": " + formatBRLFromCents(netAmount));
      }

      const paymentSummary = paymentLabels.join(" + ");
      const clientObj = sale.client || {};
      const clientName = cleanDisplayText(clientObj.name || "Cliente");
      const clientPhone = normalizePhone(clientObj.phone || "");
      const sellerObj = sale.seller || {};
      const sellerName = cleanDisplayText(sellerObj.name || sellerObj.shortName || "Operador");
      const sellerShortName = cleanDisplayText(sellerObj.shortName || sellerName);

      ordersSummary.push({
        saleId: sale.id,
        createdAt: sale.createdAt,
        clientName: clientName,
        clientPhone: clientPhone,
        sellerName: sellerName,
        totalCents: Number(sale.totalCents) || saleTotal,
        glowHubCents: segTotals.glowHubCents,
        bentoClubCents: segTotals.bentoClubCents,
        paymentSummary: paymentSummary
      });

      const items = sale.items || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const qty = Number(it.qty) || 0;
        const unitPriceCents = Number(it.unitPriceCents) || 0;
        const subtotalCents = unitPriceCents * qty;
        const brandOrClub = it.brand || it.club || "";
        const line = {
          saleId: sale.id,
          createdAt: sale.createdAt,
          segment: it.segment,
          segmentLabel: it.segment === "glow_hub" ? "Produto Glow Hub" : "Clube BentoClub",
          brandOrClub: brandOrClub,
          itemId: it.itemId,
          itemName: it.name,
          qty: qty,
          unitPriceCents: unitPriceCents,
          subtotalCents: subtotalCents,
          stockBefore: it.stockBefore !== undefined ? it.stockBefore : null,
          adjustmentQty: Number(it.adjustmentQty) || 0,
          clientName: clientName,
          clientPhone: clientPhone,
          clientPhoneFormatted: formatPhoneDisplay(clientPhone),
          sellerId: sellerObj.id || "",
          sellerName: sellerName,
          sellerShortName: sellerShortName,
          sellerRole: sellerObj.role || "",
          paymentSummary: paymentSummary
        };

        if (query) {
          const hay = normalizeText(
            [
              line.saleId,
              line.itemName,
              line.brandOrClub,
              line.segmentLabel,
              line.clientName,
              line.clientPhone,
              line.sellerName,
              line.paymentSummary
            ].join(" ")
          );
          if (hay.indexOf(query) === -1) continue;
        }
        salesLines.push(line);
      }
    }

    const cashRows = VALID_PAYMENT_METHODS.map(function (methodName) {
      return cashByPaymentMap[methodName];
    });
    const cashGrandTotal = cashRows.reduce(function (acc, r) {
      return acc + r.totalCents;
    }, 0);
    const cashGrandGlowHub = cashRows.reduce(function (acc, r) {
      return acc + r.glowHubCents;
    }, 0);
    const cashGrandBentoClub = cashRows.reduce(function (acc, r) {
      return acc + r.bentoClubCents;
    }, 0);

    // Cash financial discrepancy report
    let totalDeclaredChecked = 0;
    let totalExpectedChecked = 0;
    let checkedMethodsCount = 0;

    const discrepancyRows = cashRows.map(function (row) {
      const rawDecl = declaredPayments[row.method];
      const hasDeclared = rawDecl !== undefined && rawDecl !== null && rawDecl !== "";
      const declaredCents = hasDeclared ? Math.round(Number(rawDecl) || 0) : null;
      const discrepancyCents = hasDeclared ? declaredCents - row.totalCents : 0;
      let status = "PENDENTE";
      if (hasDeclared) {
        checkedMethodsCount += 1;
        totalDeclaredChecked += declaredCents;
        totalExpectedChecked += row.totalCents;
        if (discrepancyCents === 0) status = "CORRETO";
        else if (discrepancyCents < 0) status = "FALTA";
        else status = "SOBRA";
      }
      return {
        method: row.method,
        glowHubCents: row.glowHubCents,
        bentoClubCents: row.bentoClubCents,
        expectedCents: row.totalCents,
        hasDeclared: hasDeclared,
        declaredCents: declaredCents,
        discrepancyCents: discrepancyCents,
        status: status
      };
    });

    const overallDiscrepancyCents = totalDeclaredChecked - totalExpectedChecked;
    const allMethodsChecked = checkedMethodsCount === VALID_PAYMENT_METHODS.length;
    const discrepancySummaryStatus =
      checkedMethodsCount === 0
        ? "PENDENTE"
        : overallDiscrepancyCents === 0
          ? "CORRETO"
          : overallDiscrepancyCents < 0
            ? "FALTA"
            : "SOBRA";

    // Negative stock adjustments report
    const allStockAdjustments = collectAllStockAdjustments(safeState).filter(function (adj) {
      if (!matchesDateKey(adj.createdAt, dateFilter, useUtcDate)) return false;
      if (sellerId && (!adj.seller || adj.seller.id !== sellerId)) return false;
      if (query) {
        const hay = normalizeText(
          [
            adj.saleId,
            adj.productName,
            adj.brand,
            adj.client && adj.client.name,
            adj.client && adj.client.phone,
            adj.seller && adj.seller.name
          ].join(" ")
        );
        if (hay.indexOf(query) === -1) return false;
      }
      return true;
    });

    let totalAdjustedUnits = 0;
    let totalAdjustedValueCents = 0;
    for (let a = 0; a < allStockAdjustments.length; a++) {
      totalAdjustedUnits += Number(allStockAdjustments[a].adjustmentQty) || 0;
      totalAdjustedValueCents += Number(allStockAdjustments[a].adjustmentValueCents) || 0;
    }

    // Registered clients on the day (or registered/updated during operations when dateFilter === "")
    const clientSpendById = {};
    for (let s = 0; s < allSales.length; s++) {
      const sale = allSales[s];
      if (dateFilter && !matchesDateKey(sale.createdAt, dateFilter, useUtcDate)) continue;
      const cid = (sale.client && sale.client.id) || "";
      if (!cid) continue;
      if (!clientSpendById[cid]) {
        clientSpendById[cid] = { ordersCount: 0, totalSpentCents: 0 };
      }
      clientSpendById[cid].ordersCount += 1;
      clientSpendById[cid].totalSpentCents += Number(sale.totalCents) || 0;
    }

    const registeredClients = [];
    const allClients = safeState.clients || [];
    for (let c = 0; c < allClients.length; c++) {
      const cli = allClients[c];
      const createdTs = cli.createdAt || "";
      const updatedTs = cli.updatedAt || "";
      const matchesCreated = Boolean(createdTs) && matchesDateKey(createdTs, dateFilter, useUtcDate);
      const matchesUpdated = Boolean(updatedTs) && matchesDateKey(updatedTs, dateFilter, useUtcDate);

      if (!matchesCreated && !matchesUpdated) continue;

      const regType = matchesCreated ? "Novo Cadastro" : "Celular Atualizado";
      const ts = matchesCreated ? createdTs : updatedTs;
      const clientPhone = normalizePhone(cli.phone || "");
      const stats = clientSpendById[cli.id] || { ordersCount: 0, totalSpentCents: 0 };

      if (query) {
        const hay = normalizeText([cli.name, clientPhone, regType].join(" "));
        if (hay.indexOf(query) === -1) continue;
      }

      registeredClients.push({
        id: cli.id,
        name: cleanDisplayText(cli.name),
        phone: clientPhone,
        phoneFormatted: formatPhoneDisplay(clientPhone),
        registrationType: regType,
        timestamp: ts,
        ordersCount: stats.ordersCount,
        totalSpentCents: stats.totalSpentCents
      });
    }

    registeredClients.sort(function (a, b) {
      return String(b.timestamp || "").localeCompare(String(a.timestamp || ""));
    });

    const totalSalesLineCents = salesLines.reduce(function (acc, l) {
      return acc + l.subtotalCents;
    }, 0);
    const totalSalesLineQty = salesLines.reduce(function (acc, l) {
      return acc + l.qty;
    }, 0);

    return {
      dateFilter: dateFilter || "ALL",
      cashReport: {
        rows: cashRows,
        byMethod: cashByPaymentMap,
        totals: {
          ordersCount: filteredSales.length,
          glowHubCents: cashGrandGlowHub,
          bentoClubCents: cashGrandBentoClub,
          totalCents: cashGrandTotal
        }
      },
      discrepancyReport: {
        rows: discrepancyRows,
        totals: {
          expectedCents: cashGrandTotal,
          declaredCheckedCents: totalDeclaredChecked,
          expectedCheckedCents: totalExpectedChecked,
          discrepancyCents: overallDiscrepancyCents,
          checkedMethodsCount: checkedMethodsCount,
          allMethodsChecked: allMethodsChecked,
          status: discrepancySummaryStatus
        },
        closingMeta: storedClosing,
        stockAdjustments: {
          totalAdjustmentsCount: allStockAdjustments.length,
          totalAdjustedUnits: totalAdjustedUnits,
          totalAdjustedValueCents: totalAdjustedValueCents,
          items: allStockAdjustments
        }
      },
      salesReport: {
        lines: salesLines,
        orders: ordersSummary,
        totals: {
          linesCount: salesLines.length,
          ordersCount: filteredSales.length,
          totalQty: totalSalesLineQty,
          totalCents: totalSalesLineCents
        }
      },
      registeredClientsReport: {
        items: registeredClients,
        totals: {
          totalCount: registeredClients.length,
          newCount: registeredClients.filter(function (c) {
            return c.registrationType === "Novo Cadastro";
          }).length,
          updatedCount: registeredClients.filter(function (c) {
            return c.registrationType === "Celular Atualizado";
          }).length
        }
      }
    };
  }

  function exportDailyClosingCSV(state, options, section) {
    const report = buildDailyClosingReport(state, options);
    const targetSection = section || "full_closing";
    const lines = [];

    function pushRow(cols) {
      lines.push(cols.map(escapeCsvCell).join(";"));
    }

    function appendCashSection() {
      pushRow(["=== RELATORIO DE CAIXA (FORMAS DE PAGAMENTO x PRODUTOS vs CLUBES) ===", "Periodo: " + report.dateFilter]);
      pushRow([
        "Forma de Pagamento",
        "Qtd. Pedidos",
        "Produtos Glow Hub (R$)",
        "Clubes BentoClub (R$)",
        "Total Liquido Caixa (R$)"
      ]);
      report.cashReport.rows.forEach(function (r) {
        const bucket = report.cashReport.byMethod[r.method];
        pushRow([
          r.method,
          bucket.ordersCount,
          centsToCsvDecimal(r.glowHubCents),
          centsToCsvDecimal(r.bentoClubCents),
          centsToCsvDecimal(r.totalCents)
        ]);
      });
      pushRow([
        "TOTAL GERAL",
        report.cashReport.totals.ordersCount,
        centsToCsvDecimal(report.cashReport.totals.glowHubCents),
        centsToCsvDecimal(report.cashReport.totals.bentoClubCents),
        centsToCsvDecimal(report.cashReport.totals.totalCents)
      ]);
    }

    function appendDiscrepancySection() {
      pushRow(["=== RELATORIO DE DISCREPANCIA DE CAIXA ===", "Periodo: " + report.dateFilter]);
      pushRow([
        "Forma de Pagamento",
        "Produtos (R$)",
        "Clubes (R$)",
        "Esperado Sistema (R$)",
        "Valor Conferido (R$)",
        "Discrepancia (R$)",
        "Status"
      ]);
      report.discrepancyReport.rows.forEach(function (r) {
        pushRow([
          r.method,
          centsToCsvDecimal(r.glowHubCents),
          centsToCsvDecimal(r.bentoClubCents),
          centsToCsvDecimal(r.expectedCents),
          r.hasDeclared ? centsToCsvDecimal(r.declaredCents) : "Nao informado",
          r.hasDeclared ? centsToCsvDecimal(r.discrepancyCents) : "0,00",
          r.status
        ]);
      });
      pushRow([
        "TOTAL CONFERIDO",
        "",
        "",
        centsToCsvDecimal(report.discrepancyReport.totals.expectedCents),
        centsToCsvDecimal(report.discrepancyReport.totals.declaredCheckedCents),
        centsToCsvDecimal(report.discrepancyReport.totals.discrepancyCents),
        report.discrepancyReport.totals.status
      ]);
      lines.push("");
      pushRow(["=== REGISTRO DE AJUSTES DE ESTOQUE NEGATIVO ==="]);
      pushRow([
        "Data/Hora",
        "ID Pedido",
        "Marca",
        "Produto",
        "Estoque Anterior",
        "Qtd. Vendida",
        "Ajuste Registrado (+Un.)",
        "Valor Ajuste (R$)",
        "Cliente",
        "Emissor da Venda"
      ]);
      report.discrepancyReport.stockAdjustments.items.forEach(function (adj) {
        pushRow([
          adj.createdAt,
          adj.saleId,
          adj.brand,
          adj.productName,
          adj.stockBefore,
          adj.soldQty,
          "+" + adj.adjustmentQty,
          centsToCsvDecimal(adj.adjustmentValueCents),
          (adj.client && adj.client.name) || "",
          (adj.seller && adj.seller.name) || ""
        ]);
      });
    }

    function appendSalesSection() {
      pushRow(["=== RELATORIO DE VENDAS (PRODUTO, QTD, VALORES, CLIENTE E EMISSOR) ===", "Periodo: " + report.dateFilter]);
      pushRow([
        "Data/Hora",
        "ID Pedido",
        "Segmento",
        "Marca / Clube",
        "Produto / Pacote",
        "Quantidade",
        "Valor Unitario (R$)",
        "Valor Total (R$)",
        "Ajuste Estoque (+Un.)",
        "Cliente",
        "Celular Cliente",
        "Emissor da Venda",
        "Formas de Pagamento"
      ]);
      report.salesReport.lines.forEach(function (l) {
        pushRow([
          l.createdAt,
          l.saleId,
          l.segmentLabel,
          l.brandOrClub,
          l.itemName,
          l.qty,
          centsToCsvDecimal(l.unitPriceCents),
          centsToCsvDecimal(l.subtotalCents),
          l.adjustmentQty > 0 ? "+" + l.adjustmentQty : "0",
          l.clientName,
          l.clientPhoneFormatted,
          l.sellerName,
          l.paymentSummary
        ]);
      });
    }

    function appendClientsDaySection() {
      pushRow(["=== RELATORIO DE CLIENTES CADASTRADOS NO DIA ===", "Periodo: " + report.dateFilter]);
      pushRow([
        "Data/Hora",
        "Tipo de Registro",
        "Nome do Cliente",
        "Celular",
        "Pedidos no Periodo",
        "Total Comprado (R$)"
      ]);
      report.registeredClientsReport.items.forEach(function (c) {
        pushRow([
          c.timestamp,
          c.registrationType,
          c.name,
          c.phoneFormatted,
          c.ordersCount,
          centsToCsvDecimal(c.totalSpentCents)
        ]);
      });
    }

    if (targetSection === "cash") {
      appendCashSection();
    } else if (targetSection === "discrepancy") {
      appendDiscrepancySection();
    } else if (targetSection === "sales") {
      appendSalesSection();
    } else if (targetSection === "clients_day") {
      appendClientsDaySection();
    } else {
      appendCashSection();
      lines.push("");
      appendDiscrepancySection();
      lines.push("");
      appendSalesSection();
      lines.push("");
      appendClientsDaySection();
    }

    return "\uFEFF" + lines.join("\r\n");
  }

  root.PDVDomain = {
    VALID_PAYMENT_METHODS: VALID_PAYMENT_METHODS,
    CANONICAL_CLUBS_ORDER: CANONICAL_CLUBS_ORDER,
    cleanDisplayText: cleanDisplayText,
    normalizeText: normalizeText,
    normalizePhone: normalizePhone,
    isValidPhone: isValidPhone,
    formatPhoneDisplay: formatPhoneDisplay,
    formatBRLFromCents: formatBRLFromCents,
    parseBRLToCents: parseBRLToCents,
    isExcludedAnomalyProduct: isExcludedAnomalyProduct,
    authenticateUser: authenticateUser,
    filterProducts: filterProducts,
    filterClubs: filterClubs,
    searchClients: searchClients,
    createOrUpdateClient: createOrUpdateClient,
    createEmptyCart: createEmptyCart,
    canAddProductToCart: canAddProductToCart,
    computeStockAdjustmentInfo: computeStockAdjustmentInfo,
    calculateCartTotals: calculateCartTotals,
    addItemToCart: addItemToCart,
    updateCartItemQty: updateCartItemQty,
    validateCheckoutPayments: validateCheckoutPayments,
    finalizeSale: finalizeSale,
    computeAdminDashboard: computeAdminDashboard,
    buildCustomerSalesReport: buildCustomerSalesReport,
    exportCustomerReportCSV: exportCustomerReportCSV,
    getLocalDateKey: getLocalDateKey,
    buildDailyClosingReport: buildDailyClosingReport,
    exportDailyClosingCSV: exportDailyClosingCSV
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
