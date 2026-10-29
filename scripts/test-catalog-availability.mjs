import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { assertQrOrderAvailability } from '../server/catalog/qr-order-availability.mjs';
import {
  availabilitySchema,
  getSourceImpact,
  readAvailabilityProjection,
  seedReviewedRecipeLinks,
  setSourceVisibility,
} from '../server/catalog/availability.mjs';

const db = createClient({ url: 'file::memory:' });
await db.batch([
  'CREATE TABLE menu (id TEXT PRIMARY KEY, name TEXT, visible INTEGER, remote_stock_id TEXT)',
  'CREATE TABLE modifiers (id TEXT PRIMARY KEY, name TEXT, status TEXT, linked_product_id TEXT)',
  'CREATE TABLE estoque_produtos (id TEXT PRIMARY KEY, nome TEXT, quantidade_atual REAL)',
  'CREATE TABLE fichas_tecnicas (id TEXT PRIMARY KEY, pdv_product_id TEXT)',
  'CREATE TABLE ficha_ingredientes (id TEXT PRIMARY KEY, ficha_tecnica_id TEXT, estoque_produto_id TEXT)',
  'CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)',
  'CREATE TABLE audit_logs (id TEXT PRIMARY KEY, action TEXT, details TEXT, table_number TEXT, origin TEXT, author_id TEXT, author_name TEXT, timestamp TEXT)',
  ...availabilitySchema,
], 'write');

const coca = '4b849e83-db24-4088-abaf-c28d2abf8021';
const chicken = '255152b7-9eb8-430b-86ba-d98962e173cb';
const passer = 'stock-frango-passarinho-separado';
const lemon = 'stock-limao';
await db.batch([
  ...[[coca, 'COCA COLA LATA', -10], [chicken, 'FILÉ DE FRANGO', 0], [passer, 'FRANGO A PASSARINHO', 5], [lemon, 'LIMÃO', 80]].map(([id, name, qty]) => ({
    sql: 'INSERT INTO estoque_produtos VALUES (?, ?, ?)', args: [id, name, qty],
  })),
  { sql: 'INSERT INTO menu VALUES (?, ?, 1, ?)', args: ['na1', 'Coca-Cola Lata', coca] },
  { sql: "INSERT INTO modifiers VALUES ('na1', 'Coca-Cola Lata', 'active', 'na1')", args: [] },
  { sql: "INSERT INTO modifiers VALUES ('d0db2d63-da73-4f0b-9fc6-d25de649e867', 'Coca-Cola', 'active', NULL)", args: [] },
  ...['br4', 'pr2_file_frango', 'br1', 'pr2_parmegiana_frango', 'p3'].map(id => ({
    sql: 'INSERT INTO menu VALUES (?, ?, 1, NULL)', args: [id, `Prato ${id} com filé de frango`],
  })),
  { sql: "INSERT INTO menu VALUES ('hd778ft4e', 'Frango a Passarinho Becoartes', 0, NULL)", args: [] },
  { sql: "INSERT INTO menu VALUES ('p8', 'Frango a Passarinho', 1, ?)", args: [passer] },
  { sql: "INSERT INTO menu VALUES ('dish_lemon', 'Prato com limão de acompanhamento', 1, NULL)", args: [] },
  ...['br4', 'pr2_file_frango', 'br1', 'pr2_parmegiana_frango', 'p3', 'hd778ft4e'].map(id => ({
    sql: 'INSERT INTO fichas_tecnicas VALUES (?, ?)', args: [`f-${id}`, id],
  })),
  ...['br4', 'pr2_file_frango', 'br1', 'pr2_parmegiana_frango', 'p3', 'hd778ft4e'].map(id => ({
    sql: 'INSERT INTO ficha_ingredientes VALUES (?, ?, ?)', args: [`i-${id}`, `f-${id}`, chicken],
  })),
  { sql: "INSERT INTO fichas_tecnicas VALUES ('f-upsell', 'd0db2d63-da73-4f0b-9fc6-d25de649e867')", args: [] },
  { sql: "INSERT INTO ficha_ingredientes VALUES ('i-upsell', 'f-upsell', ?)", args: [coca] },
  { sql: "INSERT INTO fichas_tecnicas VALUES ('f-dish-lemon', 'dish_lemon')", args: [] },
  { sql: "INSERT INTO ficha_ingredientes VALUES ('i-dish-lemon', 'f-dish-lemon', ?)", args: [lemon] },
], 'write');
await seedReviewedRecipeLinks(db);

const cocaImpact = await getSourceImpact(db, { productId: 'na1' });
assert.equal(cocaImpact.sourceId, coca);
assert.deepEqual(new Set(cocaImpact.candidates.filter(row => row.reviewed).map(row => row.key)), new Set([
  'product:na1', 'modifier:na1', 'modifier:d0db2d63-da73-4f0b-9fc6-d25de649e867',
]));
await setSourceVisibility(db, { sourceId: coca, productId: 'na1', hidden: true, selectedKeys: cocaImpact.candidates.map(row => row.key) });
let projection = await readAvailabilityProjection(db);
assert.ok(projection.productBlocked.has('na1'));
assert.ok(projection.modifierBlocked.has('na1'));
assert.ok(projection.modifierBlocked.has('d0db2d63-da73-4f0b-9fc6-d25de649e867'));
await assert.rejects(assertQrOrderAvailability(db, [{ productId: 'na1' }]), { statusCode: 403 });
for (const id of ['na1', 'd0db2d63-da73-4f0b-9fc6-d25de649e867']) {
  await assert.rejects(assertQrOrderAvailability(db, [{ productId: 'br4', selectedModifiers: [{ id }] }]), { statusCode: 403 });
}
await setSourceVisibility(db, { sourceId: coca, productId: 'na1', hidden: false, selectedKeys: [] });
projection = await readAvailabilityProjection(db);
assert.equal(projection.productBlocked.size, 0);
await assertQrOrderAvailability(db, [{ productId: 'na1', selectedModifiers: [{ id: 'na1' }] }]);

const chickenImpact = await getSourceImpact(db, { productId: 'br4', sourceId: chicken });
assert.equal(chickenImpact.candidates.filter(row => row.reviewed).length, 5);
assert.equal(chickenImpact.candidates.find(row => row.key === 'product:hd778ft4e')?.reviewed, false);
await setSourceVisibility(db, {
  sourceId: chicken, productId: 'br4', hidden: true,
  selectedKeys: chickenImpact.candidates.filter(row => row.reviewed && row.key !== 'product:p3').map(row => row.key),
});
projection = await readAvailabilityProjection(db);
assert.ok(projection.productBlocked.has('br4'));
assert.ok(!projection.productBlocked.has('p3'), 'Exception preserves this use of chicken');
assert.ok(!projection.productBlocked.has('hd778ft4e'), 'Suspicious recipe is not an automatic dependency');
assert.ok(!projection.productBlocked.has('p8'), 'Distinct chicken SKU is unaffected');
await assert.rejects(assertQrOrderAvailability(db, [{ productId: 'br4' }]), { statusCode: 403 });
await assertQrOrderAvailability(db, [{ productId: 'p3' }, { productId: 'p8' }]);
const hiddenChicken = await getSourceImpact(db, { productId: 'br4', sourceId: chicken });
assert.equal(hiddenChicken.candidates.find(row => row.key === 'product:p3')?.selected, false);
await setSourceVisibility(db, { sourceId: chicken, productId: 'br4', hidden: false, selectedKeys: [] });
projection = await readAvailabilityProjection(db);
assert.equal(projection.productBlocked.size, 0);
const individuallyHidden = (await db.execute("SELECT visible FROM menu WHERE id='hd778ft4e'")).rows[0];
assert.equal(Number(individuallyHidden.visible), 0, 'Restore must not change base visibility');

const lemonImpact = await getSourceImpact(db, { productId: 'dish_lemon', sourceId: lemon });
assert.equal(lemonImpact.candidates[0].selected, false, 'Unreviewed garnish is not preselected');
await setSourceVisibility(db, {
  sourceId: chicken, productId: 'br4', hidden: true,
  selectedKeys: chickenImpact.candidates.filter(row => row.reviewed).map(row => row.key),
});
await db.execute({ sql: "DELETE FROM ficha_ingredientes WHERE ficha_tecnica_id='f-pr2_file_frango' AND estoque_produto_id=?", args: [chicken] });
projection = await readAvailabilityProjection(db);
assert.ok(!projection.productBlocked.has('pr2_file_frango'), 'Removed recipe link cannot keep item hidden');
await assertQrOrderAvailability(db, [{ productId: 'pr2_file_frango' }]);
console.log('catalog availability: direct SKU, upsell, ID collision, chicken, exceptions, separate SKU, base visibility and unreviewed garnish passed');
db.close();
