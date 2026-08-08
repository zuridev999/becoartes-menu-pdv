import { createClient } from '@libsql/client';

const databaseUrl = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN;

if (!databaseUrl || !authToken) {
  throw new Error('Defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN antes de aplicar o catálogo.');
}

const db = createClient({ url: databaseUrl, authToken });

const normalProductId = 'caipirinha_51_varios_sabores';
const premiumProductId = '5cb33298-f4ee-4a04-927b-cb893aa7aecf';
const normalGroupId = 'modgrp_caipirinha_51_sabores';
const premiumGroupId = 'modgrp_caipirinha_premium_sabores';
const drinkCategoryId = 'xhctti03a';

const flavors = [
  { code: 'maracuja', name: 'Maracujá' },
  { code: 'morango', name: 'Morango' },
  { code: 'abacaxi', name: 'Abacaxi' },
];

const premiumFlavors = [{ code: 'limao', name: 'Limão' }, ...flavors];

const modifierId = (tier, code) => `caipirinha_${tier}_sabor_${code}`;

const statements = [
  {
    sql: `CREATE TABLE IF NOT EXISTS modifier_visibility_codes (
      modifier_id TEXT PRIMARY KEY,
      visibility_code TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    sql: `CREATE INDEX IF NOT EXISTS idx_modifier_visibility_codes_code
      ON modifier_visibility_codes(visibility_code)`,
  },
  {
    sql: `CREATE TRIGGER IF NOT EXISTS sync_caipirinha_flavor_visibility_on_insert
      AFTER INSERT ON modifiers
      WHEN EXISTS (SELECT 1 FROM modifier_visibility_codes WHERE modifier_id = NEW.id)
      BEGIN
        UPDATE modifiers
        SET status = NEW.status
        WHERE id IN (
          SELECT modifier_id FROM modifier_visibility_codes
          WHERE visibility_code = (SELECT visibility_code FROM modifier_visibility_codes WHERE modifier_id = NEW.id)
        )
        AND id <> NEW.id;
        UPDATE menu
        SET visible = CASE WHEN EXISTS (
          SELECT 1
          FROM product_modifier_groups pmg
          JOIN modifiers flavor ON flavor.group_id = pmg.group_id
          WHERE pmg.product_id = menu.id AND flavor.status = 'active'
        ) THEN 1 ELSE 0 END
        WHERE id IN ('caipirinha_51_varios_sabores', '5cb33298-f4ee-4a04-927b-cb893aa7aecf');
      END`,
  },
  {
    sql: `CREATE TRIGGER IF NOT EXISTS sync_caipirinha_flavor_visibility_on_update
      AFTER UPDATE OF status ON modifiers
      WHEN EXISTS (SELECT 1 FROM modifier_visibility_codes WHERE modifier_id = NEW.id)
      BEGIN
        UPDATE modifiers
        SET status = NEW.status
        WHERE id IN (
          SELECT modifier_id FROM modifier_visibility_codes
          WHERE visibility_code = (SELECT visibility_code FROM modifier_visibility_codes WHERE modifier_id = NEW.id)
        )
        AND id <> NEW.id;
        UPDATE menu
        SET visible = CASE WHEN EXISTS (
          SELECT 1
          FROM product_modifier_groups pmg
          JOIN modifiers flavor ON flavor.group_id = pmg.group_id
          WHERE pmg.product_id = menu.id AND flavor.status = 'active'
        ) THEN 1 ELSE 0 END
        WHERE id IN ('caipirinha_51_varios_sabores', '5cb33298-f4ee-4a04-927b-cb893aa7aecf');
      END`,
  },
  {
    sql: `UPDATE menu SET name = 'Caipirinha Limão', price = 12.90, visible = 1, sort_order = 1
      WHERE id = 'dr1'`,
  },
  {
    sql: `INSERT OR REPLACE INTO menu
      (id, name, description, price, category, category_id, image, visible, delivery_visible, cost, sort_order)
      VALUES (?, 'Caipirinha (Escolha seu sabor)', 'Caipirinha 51. Escolha entre maracujá, morango ou abacaxi.', 20.90, ?, ?, '/images/caipirinha-51-varios-sabores.webp', 1, 1, 0, 2)`,
    args: [normalProductId, drinkCategoryId, drinkCategoryId],
  },
  {
    sql: `UPDATE menu
      SET name = 'Caipirinha Premium Saliníssima', price = 35.90, visible = 1, sort_order = 3
      WHERE id = ?`,
    args: [premiumProductId],
  },
  {
    sql: `INSERT OR REPLACE INTO modifier_groups
      (id, name, description, min_choices, max_choices, is_required, status)
      VALUES (?, 'Escolha o sabor', 'Selecione um sabor para a caipirinha.', 1, 1, 1, 'active')`,
    args: [normalGroupId],
  },
  {
    sql: `INSERT OR REPLACE INTO modifier_groups
      (id, name, description, min_choices, max_choices, is_required, status)
      VALUES (?, 'Escolha o sabor', 'Selecione um sabor para a caipirinha Premium.', 1, 1, 1, 'active')`,
    args: [premiumGroupId],
  },
  { sql: 'DELETE FROM product_modifier_groups WHERE product_id IN (?, ?, ?)', args: ['dr1', normalProductId, premiumProductId] },
  { sql: 'DELETE FROM modifiers WHERE group_id IN (?, ?)', args: [normalGroupId, premiumGroupId] },
  ...flavors.map((flavor, sortOrder) => ({
    sql: 'INSERT INTO modifiers (id, group_id, name, price, status, sort_order) VALUES (?, ?, ?, 0, \'active\', ?)',
    args: [modifierId('51', flavor.code), normalGroupId, flavor.name, sortOrder],
  })),
  ...premiumFlavors.map((flavor, sortOrder) => ({
    sql: 'INSERT INTO modifiers (id, group_id, name, price, status, sort_order) VALUES (?, ?, ?, 0, \'active\', ?)',
    args: [modifierId('premium', flavor.code), premiumGroupId, flavor.name, sortOrder],
  })),
  ...flavors.flatMap((flavor) => [
    {
      sql: 'INSERT OR REPLACE INTO modifier_visibility_codes (modifier_id, visibility_code) VALUES (?, ?)',
      args: [modifierId('51', flavor.code), `caipirinha_flavor_${flavor.code}`],
    },
    {
      sql: 'INSERT OR REPLACE INTO modifier_visibility_codes (modifier_id, visibility_code) VALUES (?, ?)',
      args: [modifierId('premium', flavor.code), `caipirinha_flavor_${flavor.code}`],
    },
  ]),
  {
    sql: 'INSERT OR REPLACE INTO modifier_visibility_codes (modifier_id, visibility_code) VALUES (?, ?)',
    args: [modifierId('premium', 'limao'), 'caipirinha_flavor_limao'],
  },
  { sql: 'INSERT INTO product_modifier_groups (product_id, group_id, sort_order) VALUES (?, ?, 0)', args: [normalProductId, normalGroupId] },
  { sql: 'INSERT INTO product_modifier_groups (product_id, group_id, sort_order) VALUES (?, ?, 0)', args: [premiumProductId, premiumGroupId] },
  {
    sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('catalog_version', ?, CURRENT_TIMESTAMP)",
    args: [String(Date.now())],
  },
];

await db.batch(statements, 'write');

const result = await db.execute(`
  SELECT m.name, m.price, g.name AS flavor_group, mo.name AS flavor, mo.status, vc.visibility_code
  FROM menu m
  LEFT JOIN product_modifier_groups pmg ON pmg.product_id = m.id
  LEFT JOIN modifier_groups g ON g.id = pmg.group_id
  LEFT JOIN modifiers mo ON mo.group_id = g.id
  LEFT JOIN modifier_visibility_codes vc ON vc.modifier_id = mo.id
  WHERE m.id IN ('dr1', '${normalProductId}', '${premiumProductId}')
  ORDER BY m.name, mo.sort_order
`);

console.log(JSON.stringify(result.rows, null, 2));
