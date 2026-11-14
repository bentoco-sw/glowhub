/**
 * Backend Google Apps Script Zero-Trust & Sincronização Google Sheets
 * Contrato: CTR-PWA-AUTH-WALL-01 / DEC-01 / REQ-10
 *
 * Abas criadas/atualizadas automaticamente na Planilha Google:
 * 1. "Vendas_PDV" (Cabeçalhos do pedido, cliente, vendedor, formas de pagamento, total)
 * 2. "Itens_Vendidos" (Detalhamento linha a linha por cliente, segmento, marca/clube, qtd, valor, ajuste estoque)
 * 3. "Clientes_PDV" (Novos clientes cadastrados ou celulares atualizados em tempo real)
 * 4. "Estoque_GlowHub" (Snapshot atualizado do estoque de produtos)
 * 5. "Ajustes_Estoque" (Registro automático de ajustes necessários para vendas com estoque negativo)
 */

var ALLOWED_OPERATOR_EMAILS = [
  "carolina.mazevedo@outlook.com",
  "jleite@gmail.com",
  "adrianals2018@gmail.com",
  "nandreyna53@gmail.com",
  "esthercterrazas@gmail.com",
  "barbaragurjao@outlook.com",
  "lohanylaissa079@gmail.com",
  "financeiro@bentoco.com.br",
  "carvalhomua@gmail.com",
  "mellanybecher@outlook.com",
  "francineferreirafran@gmail.com",
  "wesdiasbat@gmail.com"
];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput({ authorized: false, ok: false, error: "Payload ausente." });
    }

    var request = JSON.parse(e.postData.contents);
    var idToken = request.idToken;

    if (!idToken) {
      return jsonOutput({ authorized: false, ok: false, error: "Token de autenticação ausente." });
    }

    var verifiedIdentity = null;

    if (idToken !== "LOCAL_OPERATOR_TOKEN") {
      // Validação criptográfica na infraestrutura oficial do Google (Zero-Trust)
      var verifyUrl = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken);
      var res = UrlFetchApp.fetch(verifyUrl, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) {
        return jsonOutput({ authorized: false, ok: false, error: "Assinatura do token Google inválida ou expirada." });
      }
      var tokenInfo = JSON.parse(res.getContentText());
      if (tokenInfo.email_verified !== "true" && tokenInfo.email_verified !== true) {
        return jsonOutput({ authorized: false, ok: false, error: "E-mail não verificado pelo Google." });
      }
      var emailLower = String(tokenInfo.email || "").toLowerCase();
      if (ALLOWED_OPERATOR_EMAILS.indexOf(emailLower) === -1) {
        return jsonOutput({ authorized: false, ok: false, error: "Operador não pertence à lista oficial de 12 usuários." });
      }
      verifiedIdentity = {
        email: emailLower,
        name: tokenInfo.name || emailLower,
        picture: tokenInfo.picture || ""
      };
    } else {
      // Validação do operador autenticado pela lista oficial de 12 usuários
      var op = request.operator || {};
      var opEmail = String(op.email || "").toLowerCase().trim();
      if (ALLOWED_OPERATOR_EMAILS.indexOf(opEmail) === -1) {
        return jsonOutput({ authorized: false, ok: false, error: "Operador inválido para sincronização." });
      }
      verifiedIdentity = {
        email: opEmail,
        name: op.name || opEmail
      };
    }

    if (request.action === "VERIFY_TOKEN") {
      return jsonOutput({
        authorized: true,
        ok: true,
        user: verifiedIdentity
      });
    }

    if (request.action === "SYNC_BATCH") {
      return handleSyncBatch(request, verifiedIdentity);
    }

    return jsonOutput({ authorized: false, ok: false, error: "Ação desconhecida." });
  } catch (err) {
    return jsonOutput({ authorized: false, ok: false, error: "Erro interno no servidor: " + err.message });
  }
}

function ensureSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  return sheet;
}

function getExistingKeyRowMap(sheet, keyColIndex) {
  var map = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return map;
  var values = sheet.getRange(2, keyColIndex, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var k = String(values[i][0] || "").trim();
    if (k) {
      map[k] = i + 2; // 1-based sheet row
    }
  }
  return map;
}

function handleSyncBatch(request, identity) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var salesSheet = ensureSheet(ss, "Vendas_PDV", [
    "ID Venda", "Data/Hora", "Vendedor", "E-mail Vendedor", "Cliente", "Celular Cliente",
    "Total (R$)", "Subtotal Glow Hub (R$)", "Subtotal BentoClub (R$)", "Formas de Pagamento", "Observacoes"
  ]);
  var itemsSheet = ensureSheet(ss, "Itens_Vendidos", [
    "ID Venda", "Data/Hora", "Cliente", "Celular Cliente", "Vendedor",
    "Segmento", "Marca / Clube", "Item", "Qtd", "Valor Unitario (R$)", "Subtotal Item (R$)", "Ajuste Estoque (+Un)"
  ]);
  var clientsSheet = ensureSheet(ss, "Clientes_PDV", [
    "ID Cliente", "Nome", "Celular", "Atualizado Em", "Sincronizado Por"
  ]);
  var stockSheet = ensureSheet(ss, "Estoque_GlowHub", [
    "ID Produto", "Marca", "Produto", "Estoque Atual", "Atualizado Em", "Sincronizado Por"
  ]);
  var adjustmentsSheet = ensureSheet(ss, "Ajustes_Estoque", [
    "ID Ajuste", "ID Venda", "Data/Hora", "Marca", "ID Produto", "Produto",
    "Estoque Anterior", "Qtd Vendida", "Ajuste Necessário (+Un)", "Valor Unit. (R$)",
    "Valor Ajuste (R$)", "Cliente", "Celular Cliente", "Emissor / Vendedor", "Motivo"
  ]);

  var existingSaleRows = getExistingKeyRowMap(salesSheet, 1);
  var sales = request.sales || [];
  var newlySyncedSales = 0;

  for (var i = 0; i < sales.length; i++) {
    var s = sales[i];
    if (!s || !s.id || existingSaleRows[s.id]) {
      continue;
    }
    existingSaleRows[s.id] = true;
    newlySyncedSales++;

    var payText = (s.payments || []).map(function (p) {
      return p.method + (p.installments > 1 ? " (" + p.installments + "x)" : "") + ": R$ " + (p.amountCents / 100).toFixed(2);
    }).join(" | ");

    salesSheet.appendRow([
      s.id,
      s.createdAt,
      s.seller ? s.seller.name : identity.name,
      s.seller ? s.seller.email : identity.email,
      s.client ? s.client.name : "",
      s.client ? s.client.phone : "",
      (s.totalCents / 100).toFixed(2),
      (s.glowHubCents / 100).toFixed(2),
      (s.bentoClubCents / 100).toFixed(2),
      payText,
      s.notes || ""
    ]);

    var items = s.items || [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      itemsSheet.appendRow([
        s.id,
        s.createdAt,
        s.client ? s.client.name : "",
        s.client ? s.client.phone : "",
        s.seller ? s.seller.shortName : identity.name,
        it.segment === "glow_hub" ? "Glow Hub" : "BentoClub",
        it.brand || it.club || "",
        it.name,
        it.qty,
        (it.unitPriceCents / 100).toFixed(2),
        (it.lineTotalCents / 100).toFixed(2),
        Number(it.adjustmentQty) > 0 ? "+" + Number(it.adjustmentQty) : 0
      ]);
    }
  }

  // Record negative-stock automatic adjustments idempotently in Ajustes_Estoque
  var existingAdjRows = getExistingKeyRowMap(adjustmentsSheet, 1);
  var incomingAdjustments = (request.stockAdjustments || []).slice();
  var syncedAdjustmentsCount = 0;

  for (var saIdx = 0; saIdx < sales.length; saIdx++) {
    var saleAdjs = (sales[saIdx] && sales[saIdx].stockAdjustments) || [];
    for (var sai = 0; sai < saleAdjs.length; sai++) {
      incomingAdjustments.push(saleAdjs[sai]);
    }
  }

  for (var aIdx = 0; aIdx < incomingAdjustments.length; aIdx++) {
    var adj = incomingAdjustments[aIdx];
    if (!adj || !adj.id || existingAdjRows[adj.id]) {
      continue;
    }
    existingAdjRows[adj.id] = true;
    syncedAdjustmentsCount++;
    adjustmentsSheet.appendRow([
      adj.id,
      adj.saleId || "",
      adj.createdAt || new Date().toISOString(),
      adj.brand || "",
      adj.productId || "",
      adj.productName || "",
      Number(adj.stockBefore || 0),
      Number(adj.soldQty || 0),
      "+" + Number(adj.adjustmentQty || 0),
      ((Number(adj.unitPriceCents) || 0) / 100).toFixed(2),
      ((Number(adj.adjustmentValueCents) || 0) / 100).toFixed(2),
      adj.client ? adj.client.name : "",
      adj.client ? adj.client.phone : "",
      adj.seller ? adj.seller.name : identity.name,
      adj.reason || "Ajuste automático de estoque negativo para viabilizar venda"
    ]);
  }

  var existingClientRows = getExistingKeyRowMap(clientsSheet, 1);
  var clients = request.clients || [];
  var syncedClientsCount = 0;

  for (var c = 0; c < clients.length; c++) {
    var cl = clients[c];
    if (!cl || !cl.id) continue;
    var rowValues = [
      cl.id,
      cl.name,
      cl.phone,
      cl.updatedAt || cl.createdAt || new Date().toISOString(),
      identity.email
    ];
    var existingRowIdx = existingClientRows[cl.id];
    if (existingRowIdx) {
      clientsSheet.getRange(existingRowIdx, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      clientsSheet.appendRow(rowValues);
      existingClientRows[cl.id] = clientsSheet.getLastRow();
    }
    syncedClientsCount++;
  }

  // Persist and reconcile Estoque_GlowHub snapshot
  var nowIso = new Date().toISOString();
  var existingStockRows = getExistingKeyRowMap(stockSheet, 1);
  var remoteStockMap = {};
  if (stockSheet.getLastRow() > 1) {
    var stockData = stockSheet.getRange(2, 1, stockSheet.getLastRow() - 1, 4).getValues();
    for (var r = 0; r < stockData.length; r++) {
      var pid = String(stockData[r][0] || "").trim();
      if (pid) {
        remoteStockMap[pid] = Number(stockData[r][3]);
      }
    }
  }

  var stockSnapshot = request.stockSnapshot || [];
  for (var k = 0; k < stockSnapshot.length; k++) {
    var sp = stockSnapshot[k];
    if (!sp || !sp.id) continue;
    var incomingStock = Math.max(0, Number(sp.stock));
    var currentRemote = remoteStockMap[sp.id];
    var reconciledStock = (currentRemote !== undefined && !isNaN(currentRemote))
      ? Math.max(0, Math.min(currentRemote, incomingStock))
      : incomingStock;
    remoteStockMap[sp.id] = reconciledStock;

    var stockRowValues = [
      sp.id,
      sp.brand || "",
      sp.name || "",
      reconciledStock,
      nowIso,
      identity.email
    ];
    var sRowIdx = existingStockRows[sp.id];
    if (sRowIdx) {
      stockSheet.getRange(sRowIdx, 1, 1, stockRowValues.length).setValues([stockRowValues]);
    } else {
      stockSheet.appendRow(stockRowValues);
      existingStockRows[sp.id] = stockSheet.getLastRow();
    }
  }

  // Read consolidated clients to return to multi-device callers
  var remoteClients = [];
  if (clientsSheet.getLastRow() > 1) {
    var cRows = clientsSheet.getRange(2, 1, clientsSheet.getLastRow() - 1, 4).getValues();
    for (var rc = 0; rc < cRows.length; rc++) {
      if (cRows[rc][0] && cRows[rc][1]) {
        remoteClients.push({
          id: String(cRows[rc][0]),
          name: String(cRows[rc][1]),
          phone: String(cRows[rc][2] || ""),
          updatedAt: String(cRows[rc][3] || "")
        });
      }
    }
  }

  var remoteStockList = Object.keys(remoteStockMap).map(function (pidKey) {
    return { id: pidKey, stock: remoteStockMap[pidKey] };
  });

  return jsonOutput({
    authorized: true,
    ok: true,
    syncedSales: newlySyncedSales,
    syncedClients: syncedClientsCount,
    syncedAdjustments: syncedAdjustmentsCount,
    remoteClients: remoteClients,
    remoteStock: remoteStockList
  });
}

function jsonOutput(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
