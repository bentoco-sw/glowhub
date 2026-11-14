/* global globalThis */
/**
 * Hybrid Persistence Layer (DEC-01 / REQ-10 / ENG-08)
 * - IndexedDB primary database ('bento_glow_pdv_db')
 * - LocalStorage synchronous mirror ('bento_glow_pdv_state_v1')
 * - CSV / Excel & JSON Backup Import/Export
 * - Google Sheets (Google Apps Script) Real-Time Multi-Device Sync
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "bento_glow_pdv_state_v1";
  const CONFIG_KEY = "bento_glow_pdv_sync_config_v1";
  const DB_NAME = "bento_glow_pdv_db";
  const DB_VERSION = 1;

  function openIndexedDB() {
    return new Promise(function (resolve) {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("kv")) {
            db.createObjectStore("kv", { keyPath: "key" });
          }
        };
        req.onsuccess = function (e) {
          resolve(e.target.result);
        };
        req.onerror = function () {
          resolve(null);
        };
      } catch (_err) {
        resolve(null);
      }
    });
  }

  async function saveToIndexedDB(key, value) {
    const db = await openIndexedDB();
    if (!db) return false;
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction("kv", "readwrite");
        const store = tx.objectStore("kv");
        store.put({ key: key, value: value, updatedAt: new Date().toISOString() });
        tx.oncomplete = function () {
          resolve(true);
        };
        tx.onerror = function () {
          resolve(false);
        };
      } catch (_err) {
        resolve(false);
      }
    });
  }

  async function loadFromIndexedDB(key) {
    const db = await openIndexedDB();
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction("kv", "readonly");
        const store = tx.objectStore("kv");
        const req = store.get(key);
        req.onsuccess = function () {
          resolve(req.result ? req.result.value : null);
        };
        req.onerror = function () {
          resolve(null);
        };
      } catch (_err) {
        resolve(null);
      }
    });
  }

  function buildInitialState(seedData) {
    const seed = seedData || root.PDV_SEED_DATA || {
      users: [],
      products: [],
      clubs: [],
      clients: [],
      brandsMeta: [],
      clubsMeta: [],
      paymentMethods: []
    };
    return {
      version: seed.version || "1.0.0",
      users: (seed.users || []).slice(),
      products: (seed.products || []).map(function (p) {
        return Object.assign({}, p);
      }),
      clubs: (seed.clubs || []).map(function (c) {
        return Object.assign({}, c);
      }),
      clients: (seed.clients || []).map(function (c) {
        return Object.assign({}, c);
      }),
      brandsMeta: (seed.brandsMeta || []).slice(),
      clubsMeta: (seed.clubsMeta || []).slice(),
      paymentMethods: (seed.paymentMethods || []).slice(),
      sales: [],
      stockAdjustments: [],
      cashClosings: {},
      lastSyncedAt: null
    };
  }

  function mergeStockAdjustmentsLists(listA, listB) {
    const map = {};
    const merged = [];
    const combined = (listA || []).concat(listB || []);
    for (let i = 0; i < combined.length; i++) {
      const a = combined[i];
      if (a && a.id && !map[a.id]) {
        map[a.id] = a;
        merged.push(a);
      }
    }
    return merged.sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }

  function mergeCashClosings(mapA, mapB) {
    const out = {};
    const sources = [mapB || {}, mapA || {}];
    for (let s = 0; s < sources.length; s++) {
      const src = sources[s];
      const keys = Object.keys(src);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const incoming = src[k];
        const existing = out[k];
        if (!existing || ((incoming && incoming.updatedAt) || "") >= (existing.updatedAt || "")) {
          out[k] = Object.assign({}, existing || {}, incoming);
        }
      }
    }
    return out;
  }

  function mergeSalesLists(listA, listB) {
    const map = {};
    const merged = [];
    const combined = (listA || []).concat(listB || []);
    for (let i = 0; i < combined.length; i++) {
      const s = combined[i];
      if (s && s.id) {
        if (!map[s.id]) {
          map[s.id] = s;
          merged.push(s);
        } else if (s.syncStatus === "synced" && map[s.id].syncStatus !== "synced") {
          const idx = merged.indexOf(map[s.id]);
          if (idx >= 0) merged[idx] = s;
          map[s.id] = s;
        }
      }
    }
    return merged;
  }

  function mergeClientsLists(listA, listB) {
    const byId = {};
    const order = [];
    const combined = (listA || []).concat(listB || []);

    for (let i = 0; i < combined.length; i++) {
      const c = combined[i];
      if (!c || !c.id) continue;
      const existing = byId[c.id];
      if (!existing) {
        byId[c.id] = Object.assign({}, c);
        order.push(c.id);
      } else {
        const existingPhone = (existing.phone || "").trim();
        const incomingPhone = (c.phone || "").trim();
        const useIncoming =
          (!existingPhone && Boolean(incomingPhone)) ||
          ((c.updatedAt || "") > (existing.updatedAt || ""));
        if (useIncoming) {
          byId[c.id] = Object.assign({}, existing, c, {
            phone: incomingPhone || existingPhone,
            hasValidPhone: Boolean(incomingPhone || existingPhone)
          });
        }
      }
    }

    return order.map(function (id) {
      return byId[id];
    });
  }

  function reconcileProductsStock(seedProducts, stockSnapshotsList, salesList, stockAdjustmentsList) {
    const soldByProductId = {};
    const sales = salesList || [];
    for (let s = 0; s < sales.length; s++) {
      const items = (sales[s] && sales[s].items) || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it && it.segment === "glow_hub" && it.itemId) {
          soldByProductId[it.itemId] = (soldByProductId[it.itemId] || 0) + (Number(it.qty) || 0);
        }
      }
    }

    const adjustedByProductId = {};
    const adjustments = stockAdjustmentsList || [];
    for (let a = 0; a < adjustments.length; a++) {
      const adj = adjustments[a];
      if (adj && adj.productId) {
        adjustedByProductId[adj.productId] = (adjustedByProductId[adj.productId] || 0) + (Number(adj.adjustmentQty) || 0);
      }
    }

    const minSnapshotById = {};
    const snapshots = stockSnapshotsList || [];
    for (let g = 0; g < snapshots.length; g++) {
      const arr = snapshots[g] || [];
      for (let i = 0; i < arr.length; i++) {
        const pp = arr[i];
        if (pp && pp.id !== undefined && pp.stock !== undefined && !Number.isNaN(Number(pp.stock))) {
          const val = Math.max(0, Number(pp.stock));
          if (minSnapshotById[pp.id] === undefined || val < minSnapshotById[pp.id]) {
            minSnapshotById[pp.id] = val;
          }
        }
      }
    }

    return (seedProducts || []).map(function (p) {
      const initStock = p.initialStock !== undefined ? Number(p.initialStock) : Number(p.stock);
      const soldQty = soldByProductId[p.id] || 0;
      const adjQty = adjustedByProductId[p.id] || 0;
      const computedFromSales = Math.max(0, initStock + adjQty - soldQty);
      const snapStock = minSnapshotById[p.id];
      const finalStock = snapStock !== undefined
        ? Math.max(0, Math.min(snapStock, computedFromSales))
        : computedFromSales;
      return Object.assign({}, p, { stock: finalStock });
    });
  }

  function mergePersistedWithSeed(persisted, seedData) {
    const base = buildInitialState(seedData);
    if (!persisted || typeof persisted !== "object") {
      return base;
    }

    if (Array.isArray(persisted.sales)) {
      base.sales = mergeSalesLists(persisted.sales, []);
    }

    if (Array.isArray(persisted.stockAdjustments)) {
      base.stockAdjustments = mergeStockAdjustmentsLists(persisted.stockAdjustments, []);
    }

    if (persisted.cashClosings && typeof persisted.cashClosings === "object") {
      base.cashClosings = mergeCashClosings(persisted.cashClosings, {});
    }

    base.products = reconcileProductsStock(
      base.products,
      [Array.isArray(persisted.products) ? persisted.products : []],
      base.sales,
      base.stockAdjustments
    );

    if (Array.isArray(persisted.clients) && persisted.clients.length > 0) {
      base.clients = mergeClientsLists(persisted.clients, base.clients);
    }

    base.lastSyncedAt = persisted.lastSyncedAt || null;
    return base;
  }

  function loadStateSync(seedData) {
    let raw = null;
    if (typeof localStorage !== "undefined") {
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch (_err) {
        raw = null;
      }
    }
    if (!raw) {
      return buildInitialState(seedData);
    }
    try {
      const parsed = JSON.parse(raw);
      return mergePersistedWithSeed(parsed, seedData);
    } catch (_err) {
      return buildInitialState(seedData);
    }
  }

  async function initStateAsync(seedData) {
    const localState = loadStateSync(seedData);
    const idbData = await loadFromIndexedDB(STORAGE_KEY);
    if (idbData) {
      const combinedSales = mergeSalesLists(localState.sales, idbData.sales);
      const combinedClients = mergeClientsLists(localState.clients, idbData.clients);
      const combinedAdjustments = mergeStockAdjustmentsLists(localState.stockAdjustments, idbData.stockAdjustments);
      const combinedClosings = mergeCashClosings(localState.cashClosings, idbData.cashClosings);
      const base = buildInitialState(seedData);
      const reconciledProducts = reconcileProductsStock(
        base.products,
        [localState.products, idbData.products],
        combinedSales,
        combinedAdjustments
      );
      const merged = Object.assign({}, base, {
        products: reconciledProducts,
        clients: combinedClients,
        sales: combinedSales,
        stockAdjustments: combinedAdjustments,
        cashClosings: combinedClosings,
        lastSyncedAt: localState.lastSyncedAt || idbData.lastSyncedAt || null
      });
      saveStateSync(merged);
      return merged;
    }
    await saveToIndexedDB(STORAGE_KEY, serializeCompactState(localState));
    return localState;
  }

  function serializeCompactState(state) {
    return {
      version: state.version,
      products: (state.products || []).map(function (p) {
        return { id: p.id, stock: p.stock };
      }),
      clients: state.clients || [],
      sales: state.sales || [],
      stockAdjustments: state.stockAdjustments || [],
      cashClosings: state.cashClosings || {},
      lastSyncedAt: state.lastSyncedAt || null
    };
  }

  function saveStateSync(state) {
    const compact = serializeCompactState(state);
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
      } catch (_err) {
        // Ignore quota errors in restricted webviews; IndexedDB handles full dataset
      }
    }
    saveToIndexedDB(STORAGE_KEY, compact);
    return compact;
  }

  function isLocalServerHostname(hostname) {
    if (!hostname) return false;
    const host = String(hostname).toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.slice(-6) === ".local" ||
      host.indexOf("192.168.") === 0 ||
      host.indexOf("10.") === 0 ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  }

  function loadSyncConfig() {
    const runningLocal = typeof location !== "undefined" && location && isLocalServerHostname(location.hostname);
    const defaults = {
      appsScriptUrl: runningLocal ? "/api/sync" : "",
      autoSync: true,
      googleClientId: ""
    };
    if (typeof localStorage === "undefined") return defaults;
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return defaults;
      const parsed = Object.assign(defaults, JSON.parse(raw));
      if (!parsed.appsScriptUrl && defaults.appsScriptUrl) {
        parsed.appsScriptUrl = defaults.appsScriptUrl;
      }
      return parsed;
    } catch (_err) {
      return defaults;
    }
  }

  function saveSyncConfig(config) {
    const next = Object.assign(loadSyncConfig(), config || {});
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      } catch (_err) {
        // ignore
      }
    }
    return next;
  }

  function createBackupPayload(state) {
    return {
      schema: "bento_glow_pdv_backup_v1",
      exportedAt: new Date().toISOString(),
      salesCount: (state.sales || []).length,
      clientsCount: (state.clients || []).length,
      state: serializeCompactState(state)
    };
  }

  function parseCSVLine(line, delimiter) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line.charAt(i);
      if (inQuotes) {
        if (ch === '"' && line.charAt(i + 1) === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  function parsePaymentsSummary(paySummary, fallbackTotalCents) {
    if (!paySummary) {
      return [{ method: "PIX", amountCents: fallbackTotalCents, installments: 1 }];
    }
    const parts = String(paySummary).split(/\s*\+\s*/).filter(Boolean);
    const parsed = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const colonIdx = part.indexOf(":");
      const left = colonIdx >= 0 ? part.slice(0, colonIdx).trim() : part.trim();
      const right = colonIdx >= 0 ? part.slice(colonIdx + 1).trim() : "";
      const instMatch = left.match(/\((\d+)x\)/i);
      const installments = instMatch ? Math.max(1, parseInt(instMatch[1], 10)) : 1;
      const method = left.replace(/\(\d+x\)/gi, "").trim() || "PIX";
      const amountCents = root.PDVDomain ? root.PDVDomain.parseBRLToCents(right) : 0;
      if (amountCents > 0) {
        parsed.push({ method: method, amountCents: amountCents, installments: installments });
      }
    }
    if (parsed.length === 0) {
      return [{ method: "PIX", amountCents: fallbackTotalCents, installments: 1 }];
    }
    return parsed;
  }

  function parseExportedCSVToState(csvText, seedData) {
    const cleaned = String(csvText || "").replace(/^\uFEFF/, "").trim();
    if (!cleaned) return null;
    const rawLines = cleaned.split(/\r?\n/).filter(function (l) {
      return l.trim().length > 0;
    });
    if (rawLines.length < 1) return null;

    const delimiter = rawLines[0].indexOf(";") !== -1 ? ";" : ",";
    const headers = parseCSVLine(rawLines[0], delimiter);
    if (headers.length < 8) return null;

    const seed = seedData || root.PDV_SEED_DATA || {};
    const prodByName = {};
    const seedProds = seed.products || [];
    for (let i = 0; i < seedProds.length; i++) {
      prodByName[String(seedProds[i].name || "").toLowerCase()] = seedProds[i];
    }
    const clubByName = {};
    const seedClubs = seed.clubs || [];
    for (let i = 0; i < seedClubs.length; i++) {
      clubByName[String(seedClubs[i].name || "").toLowerCase()] = seedClubs[i];
    }

    const salesById = {};
    const salesOrder = [];
    const importedClients = [];

    for (let r = 1; r < rawLines.length; r++) {
      const cols = parseCSVLine(rawLines[r], delimiter);
      if (cols.length < 10) continue;

      const clientName = cols[0] || "Cliente";
      const clientPhone = root.PDVDomain ? root.PDVDomain.normalizePhone(cols[1]) : String(cols[1] || "").replace(/\D/g, "");
      const saleId = cols[2] || ("vnd-csv-" + r);
      const createdAt = cols[3] || new Date().toISOString();
      const sellerName = cols[4] || "Operador";
      const segRaw = String(cols[5] || "").toLowerCase();
      const segment = segRaw.indexOf("club") !== -1 || segRaw.indexOf("bento") !== -1 ? "bento_club" : "glow_hub";
      const groupName = cols[6] || "";
      const itemName = cols[7] || "Item";
      const qty = Math.max(1, parseInt(cols[8], 10) || 1);
      const unitPriceCents = root.PDVDomain ? root.PDVDomain.parseBRLToCents(cols[9]) : 0;
      const lineTotalCents = cols[10] && root.PDVDomain
        ? root.PDVDomain.parseBRLToCents(cols[10])
        : unitPriceCents * qty;
      const paySummary = cols[11] || "";

      const normClientName = root.PDVDomain ? root.PDVDomain.normalizeText(clientName) : clientName.toLowerCase();
      const clientId = "cli-csv-" + normClientName.replace(/[^a-z0-9]/g, "").slice(0, 12) + "-" + (clientPhone.slice(-4) || "0000");

      importedClients.push({
        id: clientId,
        name: clientName,
        phone: clientPhone,
        hasValidPhone: clientPhone.length === 10 || clientPhone.length === 11,
        searchIndex: normClientName + " " + clientPhone,
        updatedAt: createdAt
      });

      const matchedProd = segment === "glow_hub" ? prodByName[itemName.toLowerCase()] : null;
      const matchedClub = segment === "bento_club" ? clubByName[itemName.toLowerCase()] : null;
      const itemId = matchedProd
        ? matchedProd.id
        : matchedClub
          ? matchedClub.id
          : ("itm-csv-" + r);

      if (!salesById[saleId]) {
        salesById[saleId] = {
          id: saleId,
          createdAt: createdAt,
          seller: { id: "usr-csv", name: sellerName, shortName: sellerName, email: "", role: "" },
          client: { id: clientId, name: clientName, phone: clientPhone },
          items: [],
          payments: [],
          rawPaySummary: paySummary,
          totalCents: 0,
          paidCents: 0,
          changeCents: 0,
          glowHubCents: 0,
          bentoClubCents: 0,
          notes: "Importado via CSV",
          syncStatus: "pending"
        };
        salesOrder.push(saleId);
      }

      const saleObj = salesById[saleId];
      saleObj.items.push({
        itemId: itemId,
        segment: segment,
        brand: segment === "glow_hub" ? groupName : "",
        club: segment === "bento_club" ? groupName : "",
        name: itemName,
        qty: qty,
        unitPriceCents: unitPriceCents,
        lineTotalCents: lineTotalCents
      });
      saleObj.totalCents += lineTotalCents;
      if (segment === "glow_hub") {
        saleObj.glowHubCents += lineTotalCents;
      } else {
        saleObj.bentoClubCents += lineTotalCents;
      }
    }

    const sales = salesOrder.map(function (sid) {
      const s = salesById[sid];
      s.payments = parsePaymentsSummary(s.rawPaySummary, s.totalCents);
      let paid = 0;
      for (let i = 0; i < s.payments.length; i++) {
        paid += s.payments[i].amountCents;
      }
      s.paidCents = paid;
      s.changeCents = Math.max(0, paid - s.totalCents);
      delete s.rawPaySummary;
      return s;
    });

    return {
      sales: sales,
      clients: importedClients,
      products: []
    };
  }

  function importBackupPayload(inputPayload, currentState, seedData) {
    let rawState = null;

    if (typeof inputPayload === "string") {
      const trimmed = inputPayload.replace(/^\uFEFF/, "").trim();
      if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") {
        try {
          const parsed = JSON.parse(trimmed);
          rawState = parsed && parsed.state ? parsed.state : parsed;
        } catch (_err) {
          return { ok: false, error: "Arquivo JSON inválido ou corrompido." };
        }
      } else if (trimmed.indexOf(";") !== -1 || trimmed.indexOf(",") !== -1) {
        rawState = parseExportedCSVToState(trimmed, seedData);
        if (!rawState) {
          return { ok: false, error: "Arquivo CSV/Excel inválido ou sem colunas reconhecidas." };
        }
      } else {
        return { ok: false, error: "Arquivo inválido ou corrompido (use .json ou .csv exportado pelo PDV)." };
      }
    } else if (inputPayload && typeof inputPayload === "object") {
      rawState = inputPayload.state ? inputPayload.state : inputPayload;
    }

    if (!rawState || (!Array.isArray(rawState.sales) && !Array.isArray(rawState.clients))) {
      return { ok: false, error: "Estrutura de backup incompatível com o PDV Glow Hub & BentoClub." };
    }

    const existingSales = (currentState && currentState.sales) || [];
    const mergedSales = mergeSalesLists(rawState.sales || [], existingSales);

    const existingClients = (currentState && currentState.clients) || [];
    const mergedClients = mergeClientsLists(rawState.clients || [], existingClients);

    const existingAdjustments = (currentState && currentState.stockAdjustments) || [];
    const mergedAdjustments = mergeStockAdjustmentsLists(rawState.stockAdjustments || [], existingAdjustments);

    const existingClosings = (currentState && currentState.cashClosings) || {};
    const mergedClosings = mergeCashClosings(rawState.cashClosings || {}, existingClosings);

    const base = buildInitialState(seedData);
    const reconciledProducts = reconcileProductsStock(
      base.products,
      [rawState.products || [], (currentState && currentState.products) || []],
      mergedSales,
      mergedAdjustments
    );

    const merged = Object.assign({}, base, {
      products: reconciledProducts,
      clients: mergeClientsLists(mergedClients, base.clients),
      sales: mergedSales,
      stockAdjustments: mergedAdjustments,
      cashClosings: mergedClosings,
      lastSyncedAt: new Date().toISOString()
    });

    saveStateSync(merged);
    return {
      ok: true,
      state: merged,
      importedSales: mergedSales.length
    };
  }

  async function syncWithGoogleSheets(state, options) {
    const cfg = loadSyncConfig();
    const apiUrl = ((options && options.appsScriptUrl) || cfg.appsScriptUrl || "").trim();
    if (!apiUrl) {
      return {
        ok: false,
        error: "Configure a URL do Web App Google Apps Script para sincronizar com a planilha online."
      };
    }

    const pendingSales = (state.sales || []).filter(function (s) {
      return s.syncStatus !== "synced";
    });
    const modifiedClients = (state.clients || []).filter(function (c) {
      return Boolean((c.createdAt || c.updatedAt) && c.syncStatus !== "synced");
    });

    const payload = {
      action: "SYNC_BATCH",
      idToken: (options && options.idToken) || "LOCAL_OPERATOR_TOKEN",
      operator: (options && options.user) || null,
      sales: pendingSales,
      clients: modifiedClients,
      stockAdjustments: state.stockAdjustments || [],
      cashClosings: state.cashClosings || {},
      stockSnapshot: (state.products || []).map(function (p) {
        return { id: p.id, name: p.name, brand: p.brand, stock: p.stock };
      })
    };

    try {
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (!data || data.ok === false || data.authorized === false) {
        return {
          ok: false,
          error: (data && data.error) || "Falha na resposta do Google Apps Script."
        };
      }

      const nowIso = new Date().toISOString();
      state.sales = (state.sales || []).map(function (s) {
        return Object.assign({}, s, { syncStatus: "synced", syncedAt: nowIso });
      });
      state.clients = (state.clients || []).map(function (c) {
        if ((c.createdAt || c.updatedAt) && c.syncStatus !== "synced") {
          return Object.assign({}, c, { syncStatus: "synced", syncedAt: nowIso });
        }
        return c;
      });
      if (Array.isArray(data.remoteSales) && data.remoteSales.length > 0) {
        const remoteSalesNormalized = data.remoteSales.map(function (s) {
          return Object.assign({}, s, { syncStatus: "synced" });
        });
        state.sales = mergeSalesLists(state.sales, remoteSalesNormalized).sort(function (a, b) {
          return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
        });
      }
      if (Array.isArray(data.remoteClients) && data.remoteClients.length > 0) {
        state.clients = mergeClientsLists(data.remoteClients, state.clients);
      }
      if (Array.isArray(data.remoteStockAdjustments) && data.remoteStockAdjustments.length > 0) {
        state.stockAdjustments = mergeStockAdjustmentsLists(state.stockAdjustments, data.remoteStockAdjustments);
      }
      if (data.remoteCashClosings && typeof data.remoteCashClosings === "object") {
        state.cashClosings = mergeCashClosings(state.cashClosings, data.remoteCashClosings);
      }
      if (
        (Array.isArray(data.remoteStock) && data.remoteStock.length > 0) ||
        (Array.isArray(data.remoteSales) && data.remoteSales.length > 0)
      ) {
        state.products = reconcileProductsStock(
          state.products,
          [state.products, data.remoteStock || []],
          state.sales,
          state.stockAdjustments
        );
      }
      state.lastSyncedAt = nowIso;
      saveStateSync(state);
      return {
        ok: true,
        syncedSales: data.syncedSales !== undefined ? data.syncedSales : pendingSales.length,
        syncedClients: data.syncedClients !== undefined ? data.syncedClients : modifiedClients.length,
        lastSyncedAt: nowIso
      };
    } catch (err) {
      return {
        ok: false,
        error: "Sem conexão com o endpoint Google Apps Script (" + (err && err.message ? err.message : "offline") + "). Os dados permanecem salvos no dispositivo."
      };
    }
  }

  root.PDVStorage = {
    STORAGE_KEY: STORAGE_KEY,
    CONFIG_KEY: CONFIG_KEY,
    buildInitialState: buildInitialState,
    mergePersistedWithSeed: mergePersistedWithSeed,
    loadStateSync: loadStateSync,
    initStateAsync: initStateAsync,
    saveStateSync: saveStateSync,
    loadSyncConfig: loadSyncConfig,
    saveSyncConfig: saveSyncConfig,
    createBackupPayload: createBackupPayload,
    importBackupPayload: importBackupPayload,
    syncWithGoogleSheets: syncWithGoogleSheets
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
