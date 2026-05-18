const { createClient } = require('@libsql/client');

const url = 'libsql://becoartes-os-zuridev999.turso.io';
const authToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ';

const db = createClient({ url, authToken });

async function run() {
  try {
    console.log("=== TODOS OS PEDIDOS ATIVOS (status != closed) ===");
    const res = await db.execute("SELECT o.id, o.status, o.table_id, o.origin, o.created_at, t.number as tableNumber FROM orders o JOIN tables t ON o.table_id = t.id WHERE o.status != 'closed' ORDER BY o.created_at DESC");
    console.log(res.rows);

    for (const order of res.rows) {
      console.log(`\n=== ITENS DO PEDIDO ${order.id} (Mesa ${order.tableNumber}) ===`);
      const itemsRes = await db.execute({
        sql: "SELECT oi.*, m.name as menu_name FROM order_items oi LEFT JOIN menu m ON oi.product_id = m.id WHERE oi.order_id = ?",
        args: [order.id]
      });
      console.log(itemsRes.rows);
    }
  } catch (err) {
    console.error(err);
  }
}

run();
