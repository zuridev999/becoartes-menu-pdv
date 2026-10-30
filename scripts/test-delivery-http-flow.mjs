import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { defaultDeliverySettings } from '../server/delivery/commerce.mjs';

const folder = await mkdtemp(join(tmpdir(), 'beco-delivery-http-'));
const databaseUrl = `file:${join(folder, 'delivery.db')}`;
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/bff.mjs'], {
  stdio: ['ignore', 'ignore', 'pipe'],
  env: {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    PORT: String(port),
    BFF_LISTEN_HOST: '127.0.0.1',
    TURSO_DATABASE_URL: databaseUrl,
    BFF_SESSION_SECRET: 'delivery-http-local-session-secret',
    ADMIN_BYPASS_PIN: '8642',
    ADMIN_BYPASS_ENABLED: 'true',
    DEFAULT_MANAGER_PIN: '1357',
    DEFAULT_OPERATOR_PIN: '2468',
    TABLET_SETUP_PIN: '9753',
    CASH_SANDBOX_MODE: '1',
    DELIVERY_PUBLIC_STATUS: 'open',
    DELIVERY_PAYMENT_PROVIDER: 'mock',
    DELIVERY_LOCAL_SIMULATION: '1',
    DELIVERY_KITCHEN_DISPATCH_MODE: 'production',
    DELIVERY_LOGISTICS_PROVIDER: 'disabled',
    DELIVERY_OS_CRM_SYNC: 'disabled',
    DELIVERY_EMAIL_PROVIDER: 'disabled',
    DELIVERY_SMS_PROVIDER: 'disabled',
    DELIVERY_WHATSAPP_PROVIDER: 'disabled',
    OS_EMPRESA_ID: 'delivery-test-company',
    OS_SYSTEM_USER_ID: 'delivery-test-user',
  },
});
let stderr = '';
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-10000); });

const request = async (path, { method = 'GET', body, session = '', tracking = '' } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(session ? { 'x-beco-session': session } : {}),
      ...(tracking ? { 'x-beco-delivery-tracking': tracking } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, `${method} ${path}: ${JSON.stringify(payload)}`);
  assert.equal(payload.ok, true, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload.data;
};

let db;
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`BFF encerrou: ${stderr}`);
    try {
      const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      ready = health.ok;
    } catch { /* startup */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, `BFF não iniciou: ${stderr}`);
  await request('/api/app/init?view=delivery');
  db = createClient({ url: databaseUrl });
  const settings = {
    ...defaultDeliverySettings,
    acceptingOrders: true,
    pickupEnabled: true,
    pickupAddress: 'Endereço local de teste',
    hours: defaultDeliverySettings.hours.map(() => ({ enabled: true, start: '00:00', end: '23:59' })),
  };
  await db.batch([
    { sql: "INSERT OR REPLACE INTO app_settings(key,value) VALUES ('delivery_settings',?)", args: [JSON.stringify(settings)] },
    { sql: "INSERT OR REPLACE INTO app_settings(key,value) VALUES ('catalog_version','delivery-http-v1')", args: [] },
    { sql: "INSERT OR REPLACE INTO categories(id,name,visible) VALUES ('delivery-food','Delivery',1)", args: [] },
    { sql: "INSERT OR REPLACE INTO estoque_produtos(id,empresa_id,nome,ativo,quantidade_atual,estoque_minimo,preco_custo) VALUES ('delivery-stock','delivery-test-company','Produto delivery',1,10,2,4)", args: [] },
    { sql: "INSERT OR REPLACE INTO menu(id,name,description,price,category_id,visible,delivery_visible,remote_stock_id) VALUES ('delivery-product','Produto delivery','Teste',12,'delivery-food',1,1,'delivery-stock')", args: [] },
  ], 'write');

  const quote = await request('/api/delivery/quote', {
    method: 'POST',
    body: {
      customer: { fulfillment: 'pickup', coupon: '' },
      items: [{ productId: 'delivery-product', quantity: 1, selectedModifiers: [], notes: '' }],
    },
  });
  const orderId = `delivery_${randomUUID()}`;
  const checkoutBody = {
    orderId,
    requestKey: randomUUID(),
    customer: {
      name: 'Cliente Delivery', phone: '11999999999', email: 'delivery@example.com', taxId: '52998224725',
      fulfillment: 'pickup', paymentMethod: 'pix', quoteId: quote.quote.quoteId, coupon: '', joinClub: false,
    },
    items: [{ productId: 'delivery-product', quantity: 1, selectedModifiers: [], notes: '' }],
  };
  const checkout = await request('/api/delivery/checkout', { method: 'POST', body: checkoutBody });
  assert.equal(checkout.order.paymentStatus, 'payment_pending');
  const repeated = await request('/api/delivery/checkout', { method: 'POST', body: checkoutBody });
  assert.equal(repeated.order.orderId, orderId);
  await request('/api/delivery/payment/simulate', {
    method: 'POST', body: { orderId, trackingToken: checkout.trackingToken },
  });
  const paid = await request(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`, { tracking: checkout.trackingToken });
  assert.equal(paid.order.paymentStatus, 'paid');
  assert.equal(paid.order.kitchenStatus, 'sent_production');

  assert.equal(Number((await db.execute({ sql: 'SELECT COUNT(*) n FROM delivery_receipts WHERE order_id=?', args: [orderId] })).rows[0].n), 1);
  assert.equal(Number((await db.execute({ sql: 'SELECT COUNT(*) n FROM closed_bills WHERE id=?', args: [`delivery_bill_${orderId}`] })).rows[0].n), 0, 'simulação não pode virar faturamento real');
  assert.equal(Number((await db.execute({ sql: 'SELECT COUNT(*) n FROM orders WHERE id=?', args: [`delivery_prod_${orderId}`] })).rows[0].n), 1);
  assert.equal(Number((await db.execute({ sql: 'SELECT quantidade_atual n FROM estoque_produtos WHERE id=?', args: ['delivery-stock'] })).rows[0].n), 9);
  assert.equal(Number((await db.execute({ sql: 'SELECT COUNT(*) n FROM estoque_movimentacoes WHERE order_id=?', args: [`delivery_prod_${orderId}`] })).rows[0].n), 1);

  const login = await request('/api/auth/login', { method: 'POST', body: { pin: '8642', view: 'admin' } });
  const kitchen = await request('/api/app/init?view=kitchen', { session: login.sessionToken });
  assert.ok(kitchen.kitchenData.orders.some(order => order.orderId === `delivery_prod_${orderId}` && order.origin === 'delivery'));
  console.log('Delivery HTTP: cotação, Pix pendente, idempotência, confirmação, cozinha e baixa única de estoque passaram; simulação não entrou no faturamento real.');
} finally {
  db?.close();
  child.kill('SIGTERM');
  await rm(folder, { recursive: true, force: true });
}
