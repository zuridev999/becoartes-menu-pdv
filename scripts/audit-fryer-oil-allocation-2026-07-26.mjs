import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN;

if (!url) throw new Error('TURSO_DATABASE_URL ausente.');

const db = createClient({ url, authToken });
const start = process.argv[2] || '2026-07-01 00:00:00';
const end = process.argv[3] || '2026-07-27 00:00:00';

const friedProductIds = new Set([
  'p1',
  'p2',
  'p3',
  'p5',
  'p6',
  'p7',
  'p8',
  'hd778ft4e',
  'new_r2qck',
  'dang7sgyp',
]);
const friedModifierIds = new Set([
  'b33d44eb-3ffe-440e-bba3-fb35c8e87309',
  'c3ed590f-824b-4539-b576-24e386094003',
  'mod_batata_frita_pratos',
]);
const parmigianaWeights = new Map([
  ['br1', 1],
  ['db433b06-f94a-4b87-aae4-53ceeb41652d', 1],
  ['pr2_parmegiana_frango', 2],
  ['pr2_parmegiana_carne', 2],
]);

const rows = await db.execute({
  sql: `SELECT oi.product_id,oi.quantity,oi.selected_modifiers,
               COALESCE(m.name,oi.product_id) product_name
          FROM order_items oi
          JOIN orders o ON o.id=oi.order_id
          LEFT JOIN menu m ON m.id=oi.product_id
         WHERE o.status='closed' AND o.created_at>=? AND o.created_at<?`,
  args: [start, end],
});

const productCounts = new Map();
const modifierCounts = new Map();
let fryerUnits = 0;

for (const row of rows.rows) {
  const productId = String(row.product_id || '');
  const quantity = Number(row.quantity || 0);
  const productName = String(row.product_name || productId);
  const productWeight = friedProductIds.has(productId)
    ? 1
    : (parmigianaWeights.get(productId) || 0);

  if (productWeight > 0) {
    const current = productCounts.get(productId) || {
      id: productId,
      name: productName,
      quantity: 0,
      fryerUnits: 0,
    };
    current.quantity += quantity;
    current.fryerUnits += quantity * productWeight;
    productCounts.set(productId, current);
    fryerUnits += quantity * productWeight;
  }

  let modifiers = [];
  try {
    modifiers = JSON.parse(String(row.selected_modifiers || '[]'));
  } catch {
    continue;
  }
  for (const modifier of Array.isArray(modifiers) ? modifiers : []) {
    const modifierId = String(modifier?.id || '');
    if (!friedModifierIds.has(modifierId)) continue;
    const current = modifierCounts.get(modifierId) || {
      id: modifierId,
      name: String(modifier?.name || modifierId),
      quantity: 0,
    };
    current.quantity += quantity;
    modifierCounts.set(modifierId, current);
    fryerUnits += quantity;
  }
}

const startMs = new Date(`${start.replace(' ', 'T')}Z`).getTime();
const endMs = new Date(`${end.replace(' ', 'T')}Z`).getTime();
const days = (endMs - startMs) / 86_400_000;
const oilCycleMl = 3.5 * 900;
const oilCycleCost = 3.5 * 9.4;
const cycles = days / 3;
const oilMl = oilCycleMl * cycles;
const oilCost = oilCycleCost * cycles;

console.log(JSON.stringify({
  period: { start, end, days },
  basis: {
    bottlesPerCycle: 3.5,
    bottleMl: 900,
    bottleCost: 9.4,
    cycleDays: 3,
    oilCycleMl,
    oilCycleCost,
  },
  sold: {
    friedProducts: Array.from(productCounts.values()).sort((a, b) => b.fryerUnits - a.fryerUnits),
    friedModifiers: Array.from(modifierCounts.values()).sort((a, b) => b.quantity - a.quantity),
    fryerUnits,
  },
  allocation: {
    oilMl,
    oilCost,
    mlPerFryerUnit: fryerUnits > 0 ? oilMl / fryerUnits : 0,
    costPerFryerUnit: fryerUnits > 0 ? oilCost / fryerUnits : 0,
  },
}, null, 2));
