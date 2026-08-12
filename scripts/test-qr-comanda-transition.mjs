import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { rethrowCustomerTabWriteError } from '../server/public-customer-snapshot.mjs';

const port = Number(process.env.TEST_QR_COMANDA_PORT || 18212);
const baseUrl = `http://127.0.0.1:${port}`;
const dbFile = join(tmpdir(), `becoartes-qr-comanda-${process.pid}.db`);
const dbUrl = `file:${dbFile}`;
const allowedHeaders = { 'X-Forwarded-For': '10.0.0.5' };

const createValidCpf = (base) => {
  const digits = String(base).replace(/\D/g, '').padStart(9, '0').slice(-9).split('').map(Number);
  const digit = (values, factor) => {
    const total = values.reduce((sum, value, index) => sum + value * (factor - index), 0);
    const result = 11 - (total % 11);
    return result >= 10 ? 0 : result;
  };
  digits.push(digit(digits, 10));
  digits.push(digit(digits, 11));
  return digits.join('');
};

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
  ], 'write');
  await request('/api/app/init?view=pdv', { token: adminToken, headers: allowedHeaders });
  await db.batch([
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
  assert.deepEqual(Object.keys(inherited.data).sort(), ['access', 'flow', 'physicalTable']);
  assert.deepEqual(Object.keys(inherited.data.physicalTable).sort(), ['id', 'number']);

  const commandSource = await request('/api/qr/resolve', {
    method: 'POST',
    body: { tableNumber: 2 },
  });
  assert.equal(commandSource.data.flow, 'comanda');
  assert.ok(commandSource.data.access?.token);
  for (const invalidNumber of [0, 51, 999999]) {
    const invalidQr = await request('/api/qr/resolve', {
      method: 'POST',
      expectedStatus: 400,
      body: { tableNumber: invalidNumber },
    });
    assert.doesNotMatch(invalidQr.error, /sql|sqlite|stack|internal/i);
  }
  for (const invalidCustomer of [
    { customerName: '', phone: '11999990000', expected: 'Informe seu nome para abrir a comanda.' },
    { customerName: 'Cliente', phone: '123', expected: 'Informe um telefone válido para abrir a comanda.' },
  ]) {
    const invalidOpen = await request('/api/customer-tabs/open', {
      method: 'POST',
      expectedStatus: 400,
      body: {
        customerName: invalidCustomer.customerName,
        phone: invalidCustomer.phone,
        cpf: createValidCpf('424242424'),
        origin: 'qr',
        sourceTableId: commandSource.data.physicalTable.id,
        sourceTableNumber: 2,
        publicAccessToken: commandSource.data.access.token,
      },
    });
    assert.equal(invalidOpen.error, invalidCustomer.expected);
  }

  const publicSnapshot = await request('/api/app/init?view=qr');
  assert.equal(publicSnapshot.data.kitchenData.orders.length, 0, 'QR público não pode receber pedidos da produção');
  assert.equal(publicSnapshot.data.serviceRequests.length, 0, 'QR público não pode receber solicitações de outras mesas');
  assert.equal(publicSnapshot.data.closedBills.length, 0, 'QR público não pode receber vendas fechadas');
  assert.equal(publicSnapshot.data.sellers.length, 0, 'QR público não pode receber usuários internos');
  assert.ok(publicSnapshot.data.tables.every((table) => Number(table.number) <= 50));
  assert.ok(publicSnapshot.data.tables.every((table) => table.orders.length === 0 && table.payments.length === 0 && table.customerTab === null));
  assert.deepEqual(Object.keys(publicSnapshot.data.savedSettings).sort(), ['publicLanguages', 'qrMode', 'serviceTax']);
  const publicProduct = publicSnapshot.data.catalogData.menuItems.find((item) => item.id === 'prod_test');
  assert.ok(publicProduct, 'catálogo público deve continuar disponível');
  for (const forbiddenField of ['cost', 'remoteStockId', 'stockQuantity', 'stockMinimum', 'cmvId', 'cmvStatus', 'erpCode']) {
    assert.equal(Object.hasOwn(publicProduct, forbiddenField), false, `catálogo público vazou ${forbiddenField}`);
  }
  const publicSync = await request('/api/app/sync', {
    method: 'POST',
    body: { view: 'qr', includeCatalog: false },
  });
  assert.ok(publicSync.data.tables.every((table) => table.orders.length === 0 && table.payments.length === 0));
  assert.equal(publicSync.data.kitchenData.orders.length, 0);

  const inheritedState = await request('/api/public-table/state', {
    method: 'POST',
    body: {
      tableId: inherited.data.physicalTable.id,
      tableNumber: 1,
      origin: 'qr',
      publicAccessToken: inherited.data.access.token,
    },
  });
  assert.equal(inheritedState.data.table.number, 1);
  assert.equal(Object.hasOwn(inheritedState.data.table, 'qrFlowOverride'), false);

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
  assert.equal(order.data.inventorySyncError, null, 'QR não deve receber detalhe técnico de estoque');

  const commandState = await request('/api/public-table/state', {
    method: 'POST',
    body: {
      tableId: opened.data.tab.tableId,
      origin: 'qr',
      customerTabId: opened.data.tab.id,
      customerTabAccessToken: opened.data.accessToken,
      sourceTableId: commandSource.data.physicalTable.id,
      sourceTableNumber: 2,
      publicAccessToken: commandSource.data.access.token,
    },
  });
  assert.equal(commandState.data.table.orders.length, 1, 'cliente deve receber apenas a própria conta autorizada');
  assert.equal(Object.hasOwn(commandState.data.table.customerTab, 'phone'), false, 'telefone não deve voltar no estado público');
  assert.equal(Object.hasOwn(commandState.data.table.orders[0], 'remoteStockId'), false);

  const concurrentBody = {
    ...orderBody,
    orderId: 'order_qr_concurrent',
    clientRequestId: 'order_qr_concurrent',
    items: [{ ...orderBody.items[0], id: 'item_qr_concurrent' }],
  };
  const concurrentResults = await Promise.all([
    request('/api/orders/send-to-kitchen', { method: 'POST', body: concurrentBody }),
    request('/api/orders/send-to-kitchen', { method: 'POST', body: concurrentBody }),
  ]);
  assert.ok(concurrentResults.every((result) => result.ok), 'dois toques simultâneos devem ser idempotentes');
  const concurrentOrders = await db.execute({ sql: 'SELECT COUNT(*) AS count FROM orders WHERE client_request_id = ?', args: ['order_qr_concurrent'] });
  const concurrentItems = await db.execute({ sql: 'SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?', args: ['order_qr_concurrent'] });
  assert.equal(Number(concurrentOrders.rows[0]?.count), 1);
  assert.equal(Number(concurrentItems.rows[0]?.count), 1);

  const secondTab = await request('/api/customer-tabs/open', {
    method: 'POST',
    body: {
      customerName: 'Outro Cliente',
      phone: '11988880000',
      cpf: '11144477735',
      origin: 'qr',
      sourceTableId: commandSource.data.physicalTable.id,
      sourceTableNumber: 2,
      publicAccessToken: commandSource.data.access.token,
    },
  });
  assert.notEqual(secondTab.data.tab.tableId, opened.data.tab.tableId);
  const crossAccount = await request('/api/public-table/state', {
    method: 'POST',
    expectedStatus: 403,
    body: {
      tableId: opened.data.tab.tableId,
      origin: 'qr',
      customerTabId: secondTab.data.tab.id,
      customerTabAccessToken: secondTab.data.accessToken,
      sourceTableId: commandSource.data.physicalTable.id,
      sourceTableNumber: 2,
      publicAccessToken: commandSource.data.access.token,
    },
  });
  assert.equal(crossAccount.ok, false, 'uma pessoa não pode ler a comanda de outra');
  assert.doesNotMatch(crossAccount.error, /sql|sqlite|trigger|customer_tab|stack|internal/i);

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
  assert.doesNotMatch(missingOwnership.error, /sql|sqlite|trigger|customer_tab|stack|internal/i);

  await db.execute({ sql: "UPDATE customer_tabs SET status = 'closed' WHERE id = ?", args: [secondTab.data.tab.id] });
  await assert.rejects(
    () => db.execute({
      sql: "INSERT INTO orders (id, table_id, total, status, origin, customer_tab_id) VALUES ('race_order', ?, 10, 'pending', 'qr', ?)",
      args: [secondTab.data.tab.tableId, secondTab.data.tab.id],
    }),
    /customer_tab_not_active/,
    'o banco deve impedir pedido gravado depois do fechamento da comanda',
  );
  await assert.rejects(
    () => db.execute({
      sql: "INSERT INTO service_requests (id, table_id, type, status, customer_tab_id) VALUES ('race_service', ?, 'waiter', 'pending', ?)",
      args: [secondTab.data.tab.tableId, secondTab.data.tab.id],
    }),
    /customer_tab_not_active/,
    'o banco deve impedir solicitação gravada depois do fechamento da comanda',
  );
  assert.throws(
    () => rethrowCustomerTabWriteError(new Error('SQLITE_CONSTRAINT: customer_tab_not_active')),
    (error) => error.statusCode === 409
      && error.message === 'Esta comanda foi encerrada. Escaneie o QR da mesa novamente.',
    'erro interno da corrida deve virar uma orientação segura para o cliente',
  );

  const sameCpf = createValidCpf('314159265');
  const concurrentOpenBody = {
    customerName: 'Cliente Concorrente',
    phone: '11977770000',
    cpf: sameCpf,
    origin: 'qr',
    sourceTableId: commandSource.data.physicalTable.id,
    sourceTableNumber: 2,
    publicAccessToken: commandSource.data.access.token,
  };
  const concurrentOpenResponses = await Promise.all([1, 2].map(() => fetch(`${baseUrl}/api/customer-tabs/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(concurrentOpenBody),
  })));
  assert.deepEqual(concurrentOpenResponses.map((response) => response.status).sort(), [200, 409], 'o mesmo CPF simultâneo deve abrir uma única comanda');
  const concurrentOpenPayloads = await Promise.all(concurrentOpenResponses.map((response) => response.json()));
  assert.ok(concurrentOpenPayloads.every((payload) => !payload.error || !/sql|sqlite|constraint|stack|internal/i.test(payload.error)));
  const sameCpfRows = await db.execute({ sql: "SELECT COUNT(*) AS count FROM customer_tabs WHERE cpf = ? AND status IN ('open', 'paid')", args: [sameCpf] });
  assert.equal(Number(sameCpfRows.rows[0]?.count), 1);

  const distinctCpfs = [createValidCpf('271828182'), createValidCpf('161803398')];
  const distinctTabs = await Promise.all(distinctCpfs.map((distinctCpf, index) => request('/api/customer-tabs/open', {
    method: 'POST',
    body: { ...concurrentOpenBody, cpf: distinctCpf, customerName: `Cliente ${index + 1}` },
  })));
  assert.notEqual(distinctTabs[0].data.tab.tableId, distinctTabs[1].data.tab.tableId, 'aberturas simultâneas devem ocupar comandas diferentes');

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

  await db.execute("UPDATE tables SET status = 'ordering' WHERE CAST(number AS INTEGER) BETWEEN 51 AND 200");
  const fullCapacity = await request('/api/customer-tabs/open', {
    method: 'POST',
    expectedStatus: 409,
    body: { ...concurrentOpenBody, cpf: createValidCpf('141421356'), customerName: 'Sem vaga' },
  });
  assert.equal(fullCapacity.error, 'Não há comandas disponíveis agora. Chame alguém da equipe.');

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
      'public_snapshot_has_no_internal_data',
      'public_sync_has_no_internal_data',
      'authorized_table_state_is_scoped',
      'cross_customer_account_access_denied',
      'concurrent_order_submission_is_idempotent',
      'database_rejects_closed_tab_race',
      'closed_tab_race_has_customer_safe_message',
      'same_cpf_concurrent_open_is_unique',
      'distinct_concurrent_opens_allocate_distinct_tabs',
      'invalid_physical_qr_rejected_cleanly',
      'full_command_capacity_returns_customer_message',
      'customer_form_errors_are_human_readable',
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
