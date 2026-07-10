import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

const port = Number(process.env.TEST_BACKEND_PORT || 18190);
const baseUrl = `http://127.0.0.1:${port}`;
const dbFile = join(tmpdir(), `becoartes-critical-${process.pid}.db`);
const dbUrl = `file:${dbFile}`;

const env = {
  ...process.env,
  PORT: String(port),
  TURSO_DATABASE_URL: dbUrl,
  DEFAULT_MANAGER_PIN: '135790',
  DEFAULT_OPERATOR_PIN: '246801',
  TABLET_SETUP_PIN: '975310',
  ADMIN_BYPASS_PIN: '0719',
  ADMIN_BYPASS_ENABLED: 'true',
  BFF_SESSION_SECRET: 'critical-backend-test-secret',
  OS_EMPRESA_ID: 'empresa_test',
  OS_SYSTEM_USER_ID: 'user_test',
  CASH_SANDBOX_MODE: '1',
  HEALTH_DB_TIMEOUT_MS: '1000',
};

const bffSource = readFileSync(join(process.cwd(), 'server/bff.mjs'), 'utf8');
const routerSource = readFileSync(join(process.cwd(), 'server/routes/api-router.mjs'), 'utf8');
const httpSource = readFileSync(join(process.cwd(), 'server/http.mjs'), 'utf8');
assert.match(bffSource, /ADMIN_BYPASS_ENABLED && ADMIN_BYPASS_PIN/, 'admin bypass must be disabled unless explicitly enabled');
assert.match(bffSource, /api\/cash\/open.*api\/cash\/close/s, 'cash PIN routes must participate in rate limiting');
assert.match(bffSource, /getChecklistAlertsFromOs/, 'checklist alerts must use the authenticated BFF proxy');
assert.match(routerSource, /transient \? 503/, 'transient backend failures must return 503');
assert.match(routerSource, /bff_request_error/, 'backend errors must include structured route context');
assert.match(httpSource, /totalBytes > maxBytes/, 'JSON body parsing must enforce a byte limit');

const fetchJson = async (path, { method = 'GET', token = '', body = undefined, expectedStatus = 200 } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { 'X-Beco-Session': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expectedStatus, `${method} ${path} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
};

const waitForHealth = async () => {
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const payload = await fetchJson('/api/health');
      if (payload?.status === 'healthy') return payload;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError || new Error('BFF healthcheck did not become healthy');
};

const post = (path, body, token, expectedStatus = 200) => fetchJson(path, { method: 'POST', body, token, expectedStatus });

const seedCatalogAndStock = async () => {
  const db = createClient({ url: dbUrl });
  await db.batch([
    {
      sql: "INSERT OR REPLACE INTO categories (id, name, sort_order, visible) VALUES (?, ?, 0, 1)",
      args: ['cat_test', 'Categoria Teste'],
    },
    {
      sql: `
        INSERT OR REPLACE INTO menu
          (id, name, description, price, category_id, image, visible, remote_stock_id, cost, sort_order)
        VALUES (?, ?, '', ?, ?, '', 1, ?, 0, 0)
      `,
      args: ['prod_test', 'Produto Teste', 100, 'cat_test', 'stock_test'],
    },
    {
      sql: `
        INSERT OR REPLACE INTO estoque_produtos
          (id, empresa_id, nome, categoria, ativo, quantidade_atual, estoque_minimo, created_at)
        VALUES (?, ?, ?, 'Teste', 1, ?, 0, ?)
      `,
      args: ['stock_test', 'empresa_test', 'Produto Teste', 10, Math.floor(Date.now() / 1000)],
    },
    {
      sql: "INSERT OR REPLACE INTO tables (id, number, status, current_seller_id) VALUES ('1', '1', 'available', NULL), ('2', '2', 'available', NULL)",
    },
    {
      sql: "UPDATE tables SET status = 'available', current_seller_id = NULL WHERE id IN ('1', '2')",
    },
    {
      sql: `
        INSERT OR REPLACE INTO sellers
          (id, name, nickname, status, role, permission, pin, tipo_vinculo)
        VALUES (?, ?, ?, 'active', 'Vendedor', 'operator', ?, 'fixo')
      `,
      args: ['seller_test', 'Vendedor Teste', 'Teste', '1122'],
    },
  ], 'write');
};

const getScalar = async (sql, args = []) => {
  const db = createClient({ url: dbUrl });
  const result = await db.execute({ sql, args });
  return result.rows[0] || {};
};

const login = async (pin) => {
  const payload = await post('/api/auth/login', { pin }, '');
  assert.equal(payload.ok, true);
  assert.ok(payload.data?.sessionToken, `login should return a session token for pin ${pin}`);
  return payload.data;
};

const orderItem = (id, quantity = 1) => ({
  id,
  productId: 'prod_test',
  categoryId: 'cat_test',
  categoryName: 'Categoria Teste',
  name: 'Produto Teste',
  price: 100,
  remoteStockId: 'stock_test',
  quantity,
  selectedModifiers: [],
  notes: '',
});

let child;

try {
  rmSync(dbFile, { force: true });
  child = spawn(process.execPath, ['server/bff.mjs'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitForHealth();

  const admin = await login('0719');
  const operator = await login('246801');
  const migrationLedger = await getScalar('SELECT COUNT(*) AS count FROM schema_migrations');
  assert.equal(Number(migrationLedger.count) > 0, true, 'empty database bootstrap should apply versioned migrations');
  await seedCatalogAndStock();

  const denied = await post('/api/sellers', {
    seller: {
      id: 'blocked_seller',
      name: 'Blocked Seller',
      nickname: 'Blocked',
      status: 'active',
      role: 'atendente',
      permission: 'operator',
      pin: '1111',
    },
  }, operator.sessionToken, 403);
  assert.equal(denied.ok, false);
  assert.match(denied.error || '', /Permissão insuficiente/);

  await post('/api/tables/open', { tableId: '1', wasAvailable: true }, admin.sessionToken);
  const order = await post('/api/orders/send-to-kitchen', {
    orderId: 'order_partial',
    tableId: '1',
    total: 100,
    origin: 'pdv',
    sellerId: admin.seller.id,
    items: [orderItem('item_partial')],
  }, admin.sessionToken);
  assert.equal(order.ok, true);
  assert.equal(order.data.inventorySyncError, null, `inventory sync failed: ${order.data.inventorySyncError}`);
  assert.equal(order.data.inventorySync?.movementCount, 1, `inventory sync result: ${JSON.stringify(order.data.inventorySync)}`);

  const partial = await post('/api/table-payments', {
    id: 'partial_1',
    tableId: '1',
    tableNumber: 1,
    method: 'credit',
    amount: 40,
  }, admin.sessionToken);
  assert.equal(partial.ok, true);
  assert.equal(partial.data.payment.id, 'partial_1');

  const partialRetry = await post('/api/table-payments', {
    id: 'partial_1',
    tableId: '1',
    tableNumber: 1,
    method: 'credit',
    amount: 40,
  }, admin.sessionToken);
  assert.equal(partialRetry.ok, true);
  assert.equal(partialRetry.data.idempotent, true);

  const partialAudit = await getScalar("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'partial_payment_registered' AND details LIKE '%partial_1%'");
  assert.equal(Number(partialAudit.count), 1, 'partial payment retry must not duplicate audit');

  const afterOrderStock = await getScalar("SELECT quantidade_atual FROM estoque_produtos WHERE id = 'stock_test'");
  assert.equal(Number(afterOrderStock.quantidade_atual), 9, 'send-to-kitchen should decrement stock once');

  const closePayload = {
    tableId: '1',
    tableNumber: 1,
    sellerId: 'seller_test',
    sellerName: 'Vendedor Teste',
    subtotal: 100,
    serviceFee: 10,
    discount: 0,
    total: 110,
    payments: [
      { id: 'partial_1', method: 'credit', amount: 40 },
      { id: 'close_payment_1', method: 'credit', amount: 70 },
    ],
  };
  const closed = await post('/api/bills/close', closePayload, admin.sessionToken);
  assert.equal(closed.ok, true);
  assert.equal(closed.data.skipped, false);
  assert.ok(closed.data.closedBill?.id);

  const closeRetry = await post('/api/bills/close', closePayload, admin.sessionToken);
  assert.equal(closeRetry.ok, true);
  assert.equal(closeRetry.data.skipped, true, 'duplicate close should be skipped');

  const afterCloseStock = await getScalar("SELECT quantidade_atual FROM estoque_produtos WHERE id = 'stock_test'");
  assert.equal(Number(afterCloseStock.quantidade_atual), 9, 'close retry must not decrement stock again');

  const movementCount = await getScalar("SELECT COUNT(*) AS count FROM estoque_movimentacoes WHERE produto_id = 'stock_test' AND origem = 'pdv'");
  assert.equal(Number(movementCount.count), 1, 'stock movement should remain idempotent for the sold item');

  const appliedPayment = await getScalar("SELECT status, applied_closed_bill_id FROM table_payments WHERE id = 'partial_1'");
  assert.equal(appliedPayment.status, 'applied', 'partial payment should be applied after close');
  assert.ok(appliedPayment.applied_closed_bill_id, 'partial payment should point to closed bill');

  console.log(JSON.stringify({
    ok: true,
    covered: [
      'permissao_negada',
      'pagamento_parcial',
      'retry_pagamento_parcial',
      'fechamento',
      'retry_fechamento',
      'estoque_idempotente',
    ],
  }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (child && !child.killed) child.kill('SIGTERM');
  rmSync(dbFile, { force: true });
  rmSync(`${dbFile}-shm`, { force: true });
  rmSync(`${dbFile}-wal`, { force: true });
}
