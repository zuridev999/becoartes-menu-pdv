import crypto from 'node:crypto';
import { createClient } from '@libsql/client';
import { summarizeInventoryAttention } from '../server/inventory/attention-summary.mjs';

const apply = process.argv.includes('--apply');
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN,
});

const explicitCorrections = new Map([
  ['ing-36394d8e-bba8-4fa0-8893-3f1a3647ff11-b6dfcd2d-bda3-4d7d-984e-d41b3c6e13be-e6fc5129-185e-4f52-b9c8-ce9d24269f2b', [75, 'ML']],
  ['ficha-cmv-caipirinha-51-escolha-sabor-ingrediente-1', [50, 'ML']],
  ['5e5aac09-4eb6-4bde-b3c0-aa7549248a1d', [50, 'ML']],
  ['ing-c727ce82-be64-4b4a-afc5-c393a5910353-estoque-gin-nacional-900ml-1780012758515-0e84e4de-91cb-4d45-ba9d-d336c1851ffe', [100, 'ML']],
  ['b72b87ad-179f-4c2b-aecf-d131eccb0653', [90, 'ML']],
  ['ing-9ca11df3-1de6-4ccf-a971-edab85f9f646-estoque-gin-nacional-900ml-1780012758515-f5b853d6-386c-4e87-a39c-9b9007f73ba8', [50, 'ML']],
  ['ing-ficha-pdv-k6yieoj4z-1779554593371-estoque-gin-nacional-900ml-1780012758515-2c4c4a2b-23d7-40ea-bd3c-e8c6c24245b5', [50, 'ML']],
  ['ing-7c41fdcc-6732-416a-aa18-457fde01a312-estoque-gin-nacional-900ml-1780012758515-f0bddb22-1130-42ab-9995-e009462fd993', [50, 'ML']],
  ['ing-ficha-pdv-uwrgopxgm-1779554593371-estoque-gin-nacional-900ml-1780012758515-66e33991-6923-4ba4-832a-70018ce71c06', [30, 'ML']],
  ['41997bb8-fee3-4611-a0ea-e32ab9ff6391', [40, 'G']],
  ['6880dfee-f96c-49e9-97aa-60e550022095', [1, 'UN']],
  ['b3ab6ce4-005f-4f82-a5c8-c8ddc876f51c', [1, 'G']],
]);

const correctedStockNames = new Set([
  'BATATA CONGELADA BEM BRASIL 2KG',
  'CACHAÇA 51 965ML',
  'GIN NACIONAL 900ML',
  'ÁGUA TÔNICA',
  'CHEDDAR AMARILIS',
  'PÃO DE HAMBÚRGUER',
  'TEMPEROS',
]);

const rows = await db.execute(`
  SELECT fi.id, fi.quantidade_usada, fi.unidade_medida,
         fi.quantidade_estoque_baixa, fi.unidade_estoque_baixa,
         ep.nome AS estoque_nome, ep.unidade AS estoque_unidade
  FROM ficha_ingredientes fi
  JOIN estoque_produtos ep ON ep.id = fi.estoque_produto_id
  WHERE ep.ativo = 1
`);

const corrections = [];
for (const row of rows.rows) {
  const explicit = explicitCorrections.get(String(row.id));
  if (explicit) {
    corrections.push({ id: row.id, quantity: explicit[0], unit: explicit[1], stock: row.estoque_nome });
    continue;
  }
  if (row.estoque_nome === 'BATATA CONGELADA BEM BRASIL 2KG'
      && String(row.estoque_unidade).toUpperCase() === 'G'
      && String(row.unidade_estoque_baixa || row.unidade_medida).toUpperCase() === 'UN') {
    corrections.push({ id: row.id, quantity: Number(row.quantidade_usada), unit: 'G', stock: row.estoque_nome });
  }
}

const eventsResult = await db.execute({
  sql: "SELECT id, table_id, payload, status FROM integration_events WHERE status IN ('pending_inventory', 'inventory_processing', 'inventory_attention')",
  args: [],
});
const eventUpdates = [];
const remainingByTable = new Map();
for (const row of eventsResult.rows) {
  const payload = JSON.parse(String(row.payload || '{}'));
  const unmatched = Array.isArray(payload.inventorySync?.unmatched) ? payload.inventorySync.unmatched : [];
  const remaining = unmatched.filter((issue) => {
    const name = String(issue).split(' (')[0].replace(/^\d+(?:[.,]\d+)?x\s*/i, '').trim();
    return !(correctedStockNames.has(name) && /unidade incompatível/i.test(String(issue)));
  });
  if (remaining.length === unmatched.length) {
    if (remaining.length > 0) {
      const table = String(payload.tableNumber || row.table_id || '?');
      const current = remainingByTable.get(table) || [];
      current.push(...remaining);
      remainingByTable.set(table, current);
    }
    continue;
  }
  payload.inventorySync = { ...payload.inventorySync, unmatched: remaining };
  payload.inventoryResolution = {
    strategy: 'unit_contract_fixed_without_historical_stock_replay',
    resolvedAt: new Date().toISOString(),
  };
  const status = remaining.length > 0 || payload.inventorySyncError ? 'inventory_attention' : 'completed';
  eventUpdates.push({ id: row.id, payload: JSON.stringify(payload), status });
  if (remaining.length > 0) {
    const table = String(payload.tableNumber || row.table_id || '?');
    const current = remainingByTable.get(table) || [];
    current.push(...remaining);
    remainingByTable.set(table, current);
  }
}

const report = {
  mode: apply ? 'apply' : 'dry-run',
  recipeCorrections: corrections.length,
  eventUpdates: eventUpdates.length,
  remainingTables: remainingByTable.size,
  historicalStockMovementsCreated: 0,
};

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  db.close();
  process.exit(0);
}

const empresaId = process.env.OS_EMPRESA_ID || process.env.VITE_OS_EMPRESA_ID;
const slug = process.env.OS_TENANT_SLUG || process.env.VITE_OS_TENANT_SLUG || 'becoartes';
if (!empresaId) throw new Error('OS_EMPRESA_ID is required');

const tx = await db.transaction('write');
try {
  for (const correction of corrections) {
    await tx.execute({
      sql: 'UPDATE ficha_ingredientes SET quantidade_usada = ?, unidade_medida = ?, quantidade_estoque_baixa = ?, unidade_estoque_baixa = ? WHERE id = ?',
      args: [correction.quantity, correction.unit, correction.quantity, correction.unit, correction.id],
    });
  }
  await tx.execute({
    sql: "UPDATE estoque_produtos SET unidade = 'ML' WHERE id = ? AND unidade = 'UN'",
    args: ['3d12d1f7-c82e-49e1-96f3-f4ea98fe61c0'],
  });
  for (const event of eventUpdates) {
    await tx.execute({
      sql: 'UPDATE integration_events SET status = ?, payload = ?, updated_at = ? WHERE id = ?',
      args: [event.status, event.payload, Date.now(), event.id],
    });
  }
  await tx.execute({
    sql: "UPDATE notificacoes SET lida = 1 WHERE empresa_id = ? AND lida = 0 AND titulo IN ('Itens do PDV sem vínculo de estoque', 'Conversão de estoque pendente no PDV', 'Baixa de estoque pendente no PDV')",
    args: [empresaId],
  });
  for (const [table, issues] of remainingByTable) {
    const summary = summarizeInventoryAttention(issues, table);
    await tx.execute({
      sql: 'INSERT INTO notificacoes (id, empresa_id, usuario_id, titulo, mensagem, tipo, lida, link, created_at) VALUES (?, ?, NULL, ?, ?, ?, 0, ?, ?)',
      args: [crypto.randomUUID(), empresaId, summary.title, summary.message, 'alert', `/${slug}/estoque?origem=pdv&mesa=${encodeURIComponent(table)}`, Math.floor(Date.now() / 1000)],
    });
  }
  await tx.commit();
} catch (error) {
  await tx.rollback();
  throw error;
} finally {
  db.close();
}

console.log(JSON.stringify(report, null, 2));
