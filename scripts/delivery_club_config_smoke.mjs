import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const runId = Date.now();

const fail = (message, details = null) => {
  console.error(message);
  if (details) console.error(JSON.stringify(details, null, 2));
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

const seedCatalog = async () => {
  const db = createClient({ url: dbUrl });
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_club_config_smoke', 'Smoke Club Config', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_club_config_smoke', 'Item Club Config Smoke', 'Produto local de teste clube configuravel', 7, 'cat_club_config_smoke', '', 1, 0)
  `);
};

const createOrder = async (suffix) => requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId: `delivery_club_config_smoke_${runId}_${suffix}`,
    customer: {
      name: 'Teste Clube Config',
      phone: '11999999989',
      email: `club-config-${runId}@example.com`,
      street: 'Rua Clube Config',
      number: '11',
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
      id: `delivery_club_config_smoke_${runId}_${suffix}_item_1`,
      productId: 'produto_club_config_smoke',
      name: 'Item Club Config Smoke',
      price: 7,
      quantity: 1,
      selectedModifiers: [],
      notes: 'teste clube configuravel',
    }],
  }),
});

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const config = await requestJson('/api/delivery/config');
if (config.club?.cycleSize !== 3) fail('Expected configured club cycle size 3', config);
if (config.club?.rewardLabel !== 'sobremesa gratuita') fail('Expected configured reward label', config);

await createOrder('one');
await createOrder('two');
const third = await createOrder('three');

if (!third.order.club?.enrolled) fail('Expected order enrolled in club', third.order);
if (third.order.club.cycleSize !== 3) fail('Expected club cycle size 3', third.order.club);
if (third.order.club.paidOrders !== 3) fail('Expected third paidOrders 3', third.order.club);
if (third.order.club.remainingToReward !== 0) fail('Expected reward completed at third order', third.order.club);
if (third.order.club.rewardsEarned !== 1) fail('Expected one earned reward', third.order.club);
if (third.order.club.rewardLabel !== 'sobremesa gratuita') fail('Expected reward label in order club summary', third.order.club);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  dbUrl,
  cycleSize: third.order.club.cycleSize,
  paidOrders: third.order.club.paidOrders,
  remainingToReward: third.order.club.remainingToReward,
  rewardsEarned: third.order.club.rewardsEarned,
  rewardLabel: third.order.club.rewardLabel,
}, null, 2));
