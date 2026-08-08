import { createClient } from '@libsql/client';

const apply = process.argv.includes('--apply');
const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN;

if (!url) throw new Error('TURSO_DATABASE_URL ausente.');

const db = createClient({ url, authToken });
const productId = 'br5';
const groups = [
  ['modgrp_batata_frita_pratos', 0],
  ['modgrp_acompanhamentos_pratos', 1],
];

const before = await db.execute({
  sql: `SELECT product_id,group_id,sort_order
          FROM product_modifier_groups
         WHERE product_id=?
         ORDER BY sort_order,group_id`,
  args: [productId],
});

console.log(JSON.stringify({ apply, productId, before: before.rows, target: groups }, null, 2));

if (apply) {
  const tx = await db.transaction('write');
  try {
    for (const [groupId, sortOrder] of groups) {
      await tx.execute({
        sql: `INSERT INTO product_modifier_groups (product_id,group_id,sort_order)
              VALUES (?,?,?)
              ON CONFLICT(product_id,group_id) DO UPDATE SET sort_order=excluded.sort_order`,
        args: [productId, groupId, sortOrder],
      });
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }

  const after = await db.execute({
    sql: `SELECT product_id,group_id,sort_order
            FROM product_modifier_groups
           WHERE product_id=?
           ORDER BY sort_order,group_id`,
    args: [productId],
  });
  console.log(JSON.stringify({ applied: true, after: after.rows }, null, 2));
}
