import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { attachModifierGroupsToMenu } from '../src/lib/catalog-menu.ts';
import { sanitizePublicCatalog } from '../server/public-customer-snapshot.mjs';

// No inherited credentials, production database, notification or payment config.
const directory = mkdtempSync(join(tmpdir(), 'beco-qr-availability-'));
const dbUrl = `file:${join(directory, 'fixture.db')}`;
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const env = {
  PATH: process.env.PATH,
  NODE_ENV: 'test',
  PORT: String(port),
  BFF_LISTEN_HOST: '127.0.0.1',
  TURSO_DATABASE_URL: dbUrl,
  BFF_SESSION_SECRET: 'qr-availability-local-test',
  DEFAULT_MANAGER_PIN: '135790',
  DEFAULT_OPERATOR_PIN: '246801',
  TABLET_SETUP_PIN: '975310',
  ADMIN_BYPASS_PIN: '0719',
  ADMIN_BYPASS_ENABLED: 'true',
  OS_EMPRESA_ID: 'empresa_test',
  OS_SYSTEM_USER_ID: 'user_test',
  ALLOWED_OPERATION_IPS: '127.0.0.1',
  CASH_SANDBOX_MODE: '1',
  INVENTORY_RECONCILIATION_DISABLED: '1',
  DELIVERY_PAYMENT_PROVIDER: 'disabled',
};
let child;
let db;
let stderr = '';
let sequence = 0;
const request = async (path, { body, token, status = 200 } = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '127.0.0.1',
      ...(token ? { 'X-Beco-Session': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`);
  return result;
};
const scalar = async sql => Number((await db.execute(sql)).rows[0].n);
const catalog = async (view = 'qr') => (await request(`/api/app/init?view=${view}`)).data.catalogData;
const item = (productId, selectedModifiers = []) => ({
  id: `item-${++sequence}`, productId, name: productId, quantity: 1, price: 10,
  categoryId: 'fixture-category', selectedModifiers,
});

try {
  child = spawn(process.execPath, ['server/bff.mjs'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
  let healthy = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`BFF exited: ${stderr}`);
    try { healthy = (await request('/api/health')).ok; } catch { /* startup */ }
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(healthy, `BFF startup failed: ${stderr}`);
  db = createClient({ url: dbUrl });
  await db.batch([
    "INSERT INTO categories (id,name,visible) VALUES ('fixture-category','Teste',1)",
    ...['direct', 'ingredient'].map(id => ({
      sql: 'INSERT INTO estoque_produtos (id,empresa_id,nome,ativo,quantidade_atual,preco_custo) VALUES (?, ?, ?, 1, -2, 0)',
      args: [id, 'empresa_test', id],
    })),
    ...[['sku', 'direct'], ['recipe', null], ['plain', null], ['base-hidden', null]].map(([id, stock]) => ({
      sql: 'INSERT INTO menu (id,name,price,category_id,visible,delivery_visible,remote_stock_id,cost) VALUES (?, ?, 10, ?, ?, 0, ?, 0)',
      args: [id, id, 'fixture-category', id === 'base-hidden' ? 0 : 1, stock],
    })),
    "INSERT INTO modifier_groups (id,name,status) VALUES ('extras','Extras','active')",
    "INSERT INTO modifiers (id,group_id,name,price,status,linked_product_id) VALUES ('linked','extras','Linked',0,'active','sku'), ('recipe-extra','extras','Recipe',0,'active',NULL), ('hidden-extra','extras','Hidden',0,'active','base-hidden'), ('inactive','extras','Inactive',0,'inactive',NULL)",
    "INSERT INTO category_modifier_groups (category_id,group_id) VALUES ('fixture-category','extras')",
    "INSERT INTO product_modifier_groups (product_id,group_id) VALUES ('plain','extras')",
    ...['recipe', 'recipe-extra'].flatMap(id => [
      { sql: 'INSERT INTO fichas_tecnicas (id,empresa_id,nome_prato,pdv_product_id,custo_total) VALUES (?, ?, ?, ?, 0)', args: [`f-${id}`, 'empresa_test', id, id] },
      { sql: 'INSERT INTO ficha_ingredientes (id,ficha_tecnica_id,estoque_produto_id,quantidade_usada,quantidade_estoque_baixa,unidade_medida) VALUES (?, ?, ?, 0.4, 0.4, ?)', args: [`i-${id}`, `f-${id}`, 'ingredient', 'UN'] },
      { sql: 'INSERT INTO catalog_availability_links (source_id,subject_key) VALUES (?, ?)', args: ['ingredient', `${id === 'recipe' ? 'product' : 'modifier'}:${id}`] },
    ]),
    "INSERT INTO catalog_availability_sources (source_id,hidden,event_id) VALUES ('direct',0,NULL), ('ingredient',0,NULL)",
    "INSERT OR REPLACE INTO app_settings (key,value) VALUES ('catalog_version','fixture-start')",
  ], 'write');
  const login = async pin => (await request('/api/auth/login', { body: { pin } })).data.sessionToken;
  const admin = await login('0719');
  const operator = await login('246801');
  const tableId = String((await db.execute('SELECT id FROM tables WHERE number=1 LIMIT 1')).rows[0].id);
  const access = {};
  for (const origin of ['qr', 'tablet']) {
    access[origin] = (await request('/api/table-access-token', { body: { origin, tableId }, token: admin })).data.token;
  }
  const submit = async (items, { origin = 'qr', token, status = 200 } = {}) => {
    const orderId = `order-${++sequence}`;
    const body = { orderId, clientRequestId: orderId, tableId, total: items.length * 10, origin, publicAccessToken: access[origin] || '', items };
    const result = await request('/api/orders/send-to-kitchen', {
      body, token, status,
    });
    if (status === 200) assert.equal(await scalar(`SELECT COUNT(*) n FROM orders WHERE id='${orderId}'`), 1);
    return { orderId, result, body };
  };
  const rejectWithoutWrites = async (items, options = {}) => {
    const before = await scalar('SELECT COUNT(*) n FROM estoque_movimentacoes');
    const { orderId, result } = await submit(items, { ...options, status: 403 });
    assert.match(result.error, /indisponível|invisível/);
    for (const table of ['orders', 'order_items', 'production_tickets']) {
      const column = table === 'orders' ? 'id' : 'order_id';
      assert.equal(await scalar(`SELECT COUNT(*) n FROM ${table} WHERE ${column}='${orderId}'`), 0);
    }
    assert.equal(await scalar(`SELECT COUNT(*) n FROM integration_events WHERE ref_id='${orderId}'`), 0);
    assert.equal(await scalar(`SELECT COUNT(*) n FROM service_requests WHERE id='new_order_${orderId}'`), 0);
    assert.equal(await scalar('SELECT COUNT(*) n FROM estoque_movimentacoes'), before);
  };

  const initial = await catalog(); // deliberately warm the catalog cache
  assert.equal(initial.menuItems.find(p => p.id === 'sku').visible, true);
  const staleItem = item('sku');
  // No catalog_version bump: checkout must not trust the warmed catalog cache.
  await db.execute("UPDATE catalog_availability_sources SET hidden=1,event_id='block-1'");
  await rejectWithoutWrites([staleItem]);
  await rejectWithoutWrites([item('recipe')]);
  for (const id of ['linked', 'recipe-extra']) {
    await rejectWithoutWrites([item('plain', [{ id, name: 'Client name', price: 0, inheritedUnavailable: false }])]);
  }
  await rejectWithoutWrites([item('plain'), item('sku')]); // no partial order

  await db.execute("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('catalog_version','fixture-hidden')");
  for (const view of ['qr', 'delivery']) {
    const response = await catalog(view);
    const groups = response.modifierGroups;
    const modifiers = groups.find(g => g.id === 'extras').modifiers;
    for (const id of ['linked', 'recipe-extra', 'hidden-extra']) {
      const modifier = modifiers.find(m => m.id === id);
      assert.equal(modifier.inheritedUnavailable, true, `${view}/${id}`);
      assert.equal(Object.hasOwn(modifier, 'linkedProductId'), false, 'do not expose internal links');
    }
    const attached = attachModifierGroupsToMenu(response.menuItems, groups, response.productMapping, response.categoryMapping);
    assert.equal(attached.find(p => p.id === 'plain').modifierGroups.length, 0, 'existing frontend must filter inherited blocks and inactive options');
  }
  // Nested groups use the same public serializer as top-level groups.
  const nested = sanitizePublicCatalog({ menuItems: [{ id: 'nested', modifierGroups: initial.modifierGroups }] });
  assert.equal(nested.menuItems[0].modifierGroups[0].modifiers.find(m => m.id === 'hidden-extra').inheritedUnavailable, true);

  // Exact event exceptions apply independently to products and modifiers.
  await db.execute("INSERT INTO catalog_availability_exceptions VALUES ('direct','product:sku','block-1')");
  await submit([item('sku')]);
  await rejectWithoutWrites([item('plain', [{ id: 'linked', price: 0 }])]);
  await db.execute("INSERT INTO catalog_availability_exceptions VALUES ('direct','modifier:linked','block-1')");
  await submit([item('plain', [{ id: 'linked', price: 0 }])]);
  await db.execute("UPDATE catalog_availability_sources SET event_id='block-2' WHERE source_id='direct'");
  await rejectWithoutWrites([item('sku')]); // old exception must not bypass a new block

  // Operational rules stay unchanged, including selling base-hidden items with permission.
  await submit([item('sku')], { origin: 'pdv', token: admin });
  await submit([item('base-hidden')], { origin: 'pdv', token: admin });
  await submit([item('base-hidden')], { origin: 'pdv', token: operator });
  await db.execute({
    sql: "INSERT OR REPLACE INTO app_settings (key,value) VALUES ('settings',?)",
    args: [JSON.stringify({ pdvPermissions: { operator: { sellUnavailableProduct: false, viewOtherOperatorTables: true } } })],
  });
  await rejectWithoutWrites([item('base-hidden')], { origin: 'pdv', token: operator });
  await rejectWithoutWrites([item('base-hidden')]);
  await submit([item('sku')], { origin: 'tablet' });

  const deliveryCustomer = { name: 'Fixture', phone: '11999999999', email: 'fixture@example.test', fulfillment: 'pickup', paymentMethod: 'pix' };
  await request('/api/delivery/checkout', {
    body: { orderId: 'delivery-denied', customer: deliveryCustomer, items: [item('sku')] }, status: 403,
  });
  await db.execute("UPDATE menu SET delivery_visible=1 WHERE id='sku'");
  await request('/api/delivery/checkout', {
    body: { orderId: 'delivery-existing-policy', customer: deliveryCustomer, items: [item('sku')] },
  }); // delivery does not gain the QR-only source check

  await db.execute('UPDATE catalog_availability_sources SET hidden=0,event_id=NULL');
  await db.execute("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('catalog_version','fixture-restored')");
  const restored = await catalog();
  const restoredExtras = restored.modifierGroups.find(g => g.id === 'extras').modifiers;
  assert.equal(restoredExtras.find(m => m.id === 'linked').inheritedUnavailable, false);
  assert.equal(restoredExtras.find(m => m.id === 'recipe-extra').inheritedUnavailable, false);
  assert.equal(restoredExtras.find(m => m.id === 'hidden-extra').inheritedUnavailable, true);
  assert.equal(restoredExtras.find(m => m.id === 'inactive').status, 'inactive');
  await submit([item('sku')]);
  await submit([item('recipe', [{ id: 'recipe-extra', price: 0 }])]);
  assert.ok(await scalar("SELECT quantidade_atual n FROM estoque_produtos WHERE id='direct'") < 0);
  assert.equal(await scalar("SELECT cost n FROM menu WHERE id='sku'"), 0);
  const accepted = await submit([item('sku')]);
  await db.execute("UPDATE catalog_availability_sources SET hidden=1,event_id='block-retry' WHERE source_id='direct'");
  const movementsBeforeRetry = await scalar('SELECT COUNT(*) n FROM estoque_movimentacoes');
  await request('/api/orders/send-to-kitchen', { body: accepted.body });
  assert.equal(await scalar(`SELECT COUNT(*) n FROM orders WHERE id='${accepted.orderId}'`), 1);
  assert.equal(await scalar('SELECT COUNT(*) n FROM estoque_movimentacoes'), movementsBeforeRetry);
  console.log('QR availability HTTP: stale carts, direct/recipe products and extras, exceptions, no rejected-order writes, public serialization, restore, negative stock/zero cost, PDV/tablet/delivery policies and retry idempotency passed.');
} catch (error) {
  console.error(stderr);
  throw error;
} finally {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  db?.close();
  rmSync(directory, { recursive: true, force: true });
}
