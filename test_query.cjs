const { createClient } = require('@libsql/client');

const url = 'libsql://becoartes-os-zuridev999.turso.io';
const authToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ';

const db = createClient({ url, authToken });

async function run() {
  try {
    console.log("=== RUNNING SELECT WITH NOT EXISTS ===");
    const res = await db.execute(`
      SELECT
        o.id,
        o.table_id,
        COALESCE((
          SELECT group_concat(oi.quantity || 'x ' || COALESCE(m.name, 'Item'), ', ')
          FROM order_items oi
          LEFT JOIN menu m ON oi.product_id = m.id
          WHERE oi.order_id = o.id
        ), 'Novo pedido') as message
      FROM orders o
      WHERE o.status IN ('pending', 'preparing')
        AND o.table_id = '36'
        AND NOT EXISTS (
          SELECT 1 FROM service_requests sr
          WHERE sr.table_id = o.table_id
            AND sr.status = 'pending'
            AND sr.type = 'new_order'
            AND sr.message = COALESCE((
              SELECT group_concat(oi2.quantity || 'x ' || COALESCE(m2.name, 'Item'), ', ')
              FROM order_items oi2
              LEFT JOIN menu m2 ON oi2.product_id = m2.id
              WHERE oi2.order_id = o.id
            ), 'Novo pedido')
        )
    `);
    console.log("Selected rows:", res.rows);
  } catch (err) {
    console.error(err);
  }
}

run();
