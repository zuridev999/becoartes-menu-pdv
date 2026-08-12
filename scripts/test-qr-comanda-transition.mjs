import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

const port = Number(process.env.TEST_QR_COMANDA_PORT || 18212);
const baseUrl = `http://127.0.0.1:${port}`;
const dbFile = join(tmpdir(), `becoartes-qr-comanda-${process.pid}.db`);
const dbUrl = `file:${dbFile}`;
const allowedHeaders = { 'X-Forwarded-For': '10.0.0.5' };

const env = {
  ...process.env,
  PORT: String(port),
  TURSO_DATABASE_URL: dbUrl,
  ADMIN_BYPASS_PIN: '0719',
  ADMIN_BYPASS_ENABLED: 'true',
  DEFAULT_MANAGER_PIN: '135790',
  DEFAULT_OPERATOR_PIN: '246801',
  TABLET_SETUP_PIN: '975310',
  BFF_SESSION_SECRET: 'qr-comanda-transition-test-secret',
  OS_EMPRESA_ID: 'empresa_test',
  OS_SYSTEM_USER_ID: 'user_test',
  ALLOWED_OPERATION_IPS: '10.0.0.5',
  INVENTORY_RECONCILIATION_DISABLED: '1',
  CASH_SANDBOX_MODE: '1',
  HEALTH_DB_TIMEOUT_MS: '1000',
};

const request = async (path, {
  method = 'GET',
  token = '',
  body,
  expectedStatus = 200,
  headers = {},
} = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { 'X-Beco-Session': token } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(
    response.status,
    expectedStatus,
    `${method} ${path}: expected ${expectedStatus}, got ${response.status} ${JSON.stringify(payload)}`,
  );
  return payload;
};

const waitForHealth = async () => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const health = await request('/api/health');
      if (health?.status === 'healthy') return;
    } catch {
      // O servidor ainda está iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('BFF não ficou saudável a tempo.');
};

let child;
let serverStderr = '';
try {
  rmSync(dbFile, { force: true });
  child = spawn(process.execPath, ['server/bff.mjs'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => { serverStderr += chunk.toString(); });
  await waitForHealth();

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: allowedHeaders,
    body: { pin: '0719', view: 'pdv' },
  });
  const adminToken = login.data?.sessionToken;
  assert.ok(adminToken, 'login administrativo deve devolver sessão');
  await request('/api/app/init?view=pdv', { token: adminToken, headers: allowedHeaders });

  const db = createClient({ url: dbUrl });
  await db.batch([
    {
      sql: "INSERT OR REPLACE INTO categories (id, name, sort_order, visible) VALUES ('cat_test', 'Teste', 0, 1)",
      args: [],
    },
    {
      sql: "INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, remote_stock_id, cost, sort_order) VALUES ('prod_test', 'Produto Teste', '', 10, 'cat_test', '', 1, NULL, 0, 0)",
      args: [],
    },
    {
      sql: "UPDATE tables SET status = 'ordering', current_seller_id = NULL WHERE CAST(number AS INTEGER) = 1",
      args: [],
    },
    {
      sql: "UPDATE tables SET status = 'available', current_seller_id = NULL WHERE CAST(number AS INTEGER) = 2",
      args: [],
    },
  ], 'write');
  const seededPhysical = await db.execute("SELECT id, number, status, qr_flow_override FROM tables WHERE CAST(number AS INTEGER) IN (1, 2) ORDER BY CAST(number AS INTEGER)");
  assert.equal(String(seededPhysical.rows[0]?.status), 'ordering', `mesa 1 deve estar ativa antes da troca: ${JSON.stringify(seededPhysical.rows)}`);

  const switched = await request('/api/settings/qr-mode', {
    method: 'POST',
    token: adminToken,
    headers: allowedHeaders,
    body: { qrMode: 'comanda' },
  });
  const transitionedPhysical = await db.execute("SELECT id, number, status, qr_flow_override FROM tables WHERE CAST(number AS INTEGER) IN (1, 2) ORDER BY CAST(number AS INTEGER)");
  assert.deepEqual(switched.data.transitionTables, [1], `somente a mesa física ativa deve permanecer herdada: ${JSON.stringify(transitionedPhysical.rows)}`);

  const transferTables = await db.execute("SELECT id, number FROM tables WHERE CAST(number AS INTEGER) IN (3, 4, 5, 6) ORDER BY CAST(number AS INTEGER)");
  const byNumber = Object.fromEntries(transferTables.rows.map((row) => [Number(row.number), String(row.id)]));
  await db.batch([
    { sql: "UPDATE tables SET status = 'ordering', qr_flow_override = 'mesa_until_close' WHERE id = ?", args: [byNumber[3]] },
    { sql: "UPDATE tables SET status = 'ordering', qr_flow_override = 'mesa_until_close' WHERE id = ?", args: [byNumber[5]] },
  ], 'write');
  await request('/api/tables/transfer', {
    method: 'POST',
    token: adminToken,
    headers: allowedHeaders,
    body: { fromTableId: byNumber[3], toTableId: byNumber[4] },
  });
  const transferredTarget = await db.execute({ sql: "SELECT status, qr_flow_override FROM tables WHERE id = ?", args: [byNumber[4]] });
  assert.equal(transferredTarget.rows[0]?.status, 'ordering');
  assert.equal(transferredTarget.rows[0]?.qr_flow_override, 'mesa_until_close', 'transferência deve preservar a sessão de mesa herdada');

  await request('/api/tables/join', {
    method: 'POST',
    token: adminToken,
    headers: allowedHeaders,
    body: { tableIds: [byNumber[5], byNumber[6]], targetTableId: byNumber[6] },
  });
  const joinedTarget = await db.execute({ sql: "SELECT status, qr_flow_override FROM tables WHERE id = ?", args: [byNumber[6]] });
  assert.equal(joinedTarget.rows[0]?.status, 'ordering');
  assert.equal(joinedTarget.rows[0]?.qr_flow_override, 'mesa_until_close', 'junção deve preservar a sessão de mesa herdada');

  const inherited = await request('/api/qr/resolve', {
    method: 'POST',
    body: { tableNumber: 1 },
  });
  assert.equal(inherited.data.flow, 'mesa');
  assert.equal(inherited.data.inheritedMesa, true);

  const commandSource = await request('/api/qr/resolve', {
    method: 'POST',
    body: { tableNumber: 2 },
  });
  assert.equal(commandSource.data.flow, 'comanda');
  assert.ok(commandSource.data.access?.token);

  const opened = await request('/api/customer-tabs/open', {
    method: 'POST',
    body: {
      customerName: 'Cliente Transição',
      phone: '11999990000',
      cpf: '52998224725',
      origin: 'qr',
      sourceTableId: commandSource.data.physicalTable.id,
      sourceTableNumber: 2,
      publicAccessToken: commandSource.data.access.token,
    },
  });
  assert.ok(opened.data.accessToken, 'comanda deve devolver token de posse');
  assert.ok(Number(opened.data.tab.tableNumber) >= 51, 'comanda técnica jamais pode ocupar mesa física 1-50');

  const orderBody = {
    orderId: 'order_qr_transition',
    clientRequestId: 'order_qr_transition',
    tableId: opened.data.tab.tableId,
    total: 10,
    origin: 'qr',
    sellerId: null,
    customerTabId: opened.data.tab.id,
    customerTabAccessToken: opened.data.accessToken,
    sourceTableId: commandSource.data.physicalTable.id,
    sourceTableNumber: 2,
    publicAccessToken: commandSource.data.access.token,
    items: [{
      id: 'item_qr_transition',
      productId: 'prod_test',
      name: 'Produto Teste',
      price: 10,
      quantity: 1,
      selectedModifiers: [],
      notes: '',
    }],
  };
  const order = await request('/api/orders/send-to-kitchen', {
    method: 'POST',
    body: orderBody,
  });
  assert.equal(order.data.request.sourceTableNumber, 2);
  assert.equal(order.data.request.customerTabNumber, opened.data.tab.tableNumber);

  const persisted = await db.execute({
    sql: "SELECT table_id, source_table_id, source_table_number, customer_tab_id FROM orders WHERE id = ?",
    args: ['order_qr_transition'],
  });
  assert.equal(String(persisted.rows[0].table_id), String(opened.data.tab.tableId));
  assert.equal(Number(persisted.rows[0].source_table_number), 2);
  assert.equal(String(persisted.rows[0].customer_tab_id), String(opened.data.tab.id));

  const kitchen = await request('/api/app/init?view=kitchen', { headers: allowedHeaders });
  const kitchenOrder = kitchen.data.kitchenData.orders.find((entry) => entry.orderId === 'order_qr_transition');
  assert.equal(kitchenOrder.sourceTableNumber, 2);
  assert.equal(kitchenOrder.customerTabNumber, opened.data.tab.tableNumber);

  const pdv = await request('/api/app/init?view=pdv', { token: adminToken, headers: allowedHeaders });
  const serviceRequest = pdv.data.serviceRequests.find((entry) => entry.orderId === 'order_qr_transition');
  assert.equal(serviceRequest.sourceTableNumber, 2);
  assert.equal(serviceRequest.customerTabNumber, opened.data.tab.tableNumber);

  const waiterRequest = await request('/api/service-requests', {
    method: 'POST',
    body: {
      id: 'waiter_qr_transition',
      tableId: opened.data.tab.tableId,
      type: 'waiter',
      message: 'Chamar atendimento',
      origin: 'qr',
      customerTabId: opened.data.tab.id,
      customerTabAccessToken: opened.data.accessToken,
      sourceTableId: commandSource.data.physicalTable.id,
      sourceTableNumber: 2,
      publicAccessToken: commandSource.data.access.token,
    },
  });
  assert.equal(waiterRequest.data.request.sourceTableNumber, 2);
  assert.equal(waiterRequest.data.request.customerTabNumber, opened.data.tab.tableNumber);

  const missingOwnership = await request('/api/orders/send-to-kitchen', {
    method: 'POST',
    expectedStatus: 401,
    body: {
      ...orderBody,
      orderId: 'order_without_tab_ownership',
      clientRequestId: 'order_without_tab_ownership',
      customerTabAccessToken: '',
      items: [{ ...orderBody.items[0], id: 'item_without_tab_ownership' }],
    },
  });
  assert.equal(missingOwnership.ok, false);

  const stalePhysicalToken = inherited.data.access.token;
  await request('/api/tables/status', {
    method: 'POST',
    token: adminToken,
    headers: allowedHeaders,
    body: { tableId: inherited.data.physicalTable.id, status: 'available' },
  });
  const afterClose = await request('/api/qr/resolve', {
    method: 'POST',
    body: { tableNumber: 1 },
  });
  assert.equal(afterClose.data.flow, 'comanda', 'novo acesso após fechamento deve abrir comanda');

  const staleRequest = await request('/api/service-requests', {
    method: 'POST',
    expectedStatus: 401,
    body: {
      id: 'stale_qr_request',
      tableId: inherited.data.physicalTable.id,
      type: 'waiter',
      origin: 'qr',
      publicAccessToken: stalePhysicalToken,
    },
  });
  assert.equal(staleRequest.ok, false, 'token da sessão física encerrada precisa ser recusado');

  await request('/api/settings/qr-mode', {
    method: 'POST',
    token: adminToken,
    headers: allowedHeaders,
    body: { qrMode: 'mesa' },
  });
  const backToTables = await request('/api/qr/resolve', {
    method: 'POST',
    body: { tableNumber: 2 },
  });
  assert.equal(backToTables.data.flow, 'mesa');

  console.log(JSON.stringify({
    ok: true,
    covered: [
      'active_table_inherited_until_close',
      'inactive_table_enters_customer_tab_mode',
      'customer_tabs_reserved_to_51_200',
      'order_records_physical_source_and_account',
      'kitchen_and_pdv_receive_both_locations',
      'service_requests_keep_physical_source',
      'customer_tab_ownership_required',
      'stale_physical_qr_token_revoked_on_close',
      'transfers_and_joins_keep_inherited_table_flow',
      'switch_back_to_table_mode',
    ],
  }, null, 2));
} catch (error) {
  if (child && !child.killed) child.kill('SIGTERM');
  if (serverStderr) console.error(serverStderr);
  throw error;
} finally {
  if (child && !child.killed) child.kill('SIGTERM');
  rmSync(dbFile, { force: true });
  rmSync(`${dbFile}-shm`, { force: true });
  rmSync(`${dbFile}-wal`, { force: true });
}
