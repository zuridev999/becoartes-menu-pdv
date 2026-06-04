import { createServer } from 'node:http';
import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const runId = Date.now();

const received = [];
const webhook = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    received.push({ url: req.url, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});

await new Promise((resolve) => webhook.listen(19090, '127.0.0.1', resolve));

const fail = (message, details = null) => {
  console.error(message);
  if (details) console.error(JSON.stringify(details, null, 2));
  webhook.close();
  process.exit(1);
};

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    fail(`Request failed: ${options.method || 'GET'} ${path}`, payload || { status: response.status });
  }
  return payload.data;
};

const db = createClient({ url: dbUrl });
await requestJson('/api/app/init?view=delivery');
await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_notification_webhook_smoke', 'Notification Webhook Smoke', 1, 1)");
await db.execute(`
  INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
  VALUES ('produto_notification_webhook_smoke', 'Item Notification Webhook Smoke', 'Produto local de teste notificacao delivery', 17, 'cat_notification_webhook_smoke', '', 1, 0)
`);

const orderId = `delivery_notification_webhook_${runId}`;
await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId,
    customer: {
      name: 'Cliente Notification Smoke',
      phone: '11999990000',
      email: `notification-${runId}@example.com`,
      street: 'Rua Notificacao',
      number: '17',
      neighborhood: 'Centro',
      city: 'Sao Paulo',
      state: 'SP',
      postalCode: '01001000',
      complement: '',
      reference: '',
      notes: '',
      fulfillment: 'delivery',
      paymentMethod: 'pagbank',
      coupon: '',
      joinClub: true,
    },
    items: [{
      id: `${orderId}_item_1`,
      productId: 'produto_notification_webhook_smoke',
      name: 'Item Notification Webhook Smoke',
      price: 17,
      quantity: 1,
      selectedModifiers: [],
      notes: '',
    }],
  }),
});

await new Promise((resolve) => setTimeout(resolve, 150));
if (received.length < 3) fail('Expected webhook calls for email/sms/whatsapp', received);

const notifications = await db.execute({
  sql: "SELECT channel, status, provider FROM delivery_notifications WHERE delivery_order_id = ? ORDER BY channel",
  args: [orderId],
});
if (notifications.rows.length < 3) fail('Expected persisted notification events', notifications.rows);
if (!notifications.rows.every((row) => row.provider === 'webhook' && row.status === 'sent')) {
  fail('Expected webhook notifications sent', notifications.rows);
}

webhook.close();
console.log(JSON.stringify({
  ok: true,
  baseUrl,
  webhookCalls: received.length,
  notifications: notifications.rows,
}, null, 2));
