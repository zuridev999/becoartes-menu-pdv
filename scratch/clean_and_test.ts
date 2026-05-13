import { db } from './src/lib/db'; 
async function run() {
  try {
    await db.execute('DELETE FROM order_items');
    await db.execute('DELETE FROM orders');
    const orderId = Math.random().toString(36).substr(2, 9);
    // Pegar uma mesa válida
    const tablesRes = await db.execute('SELECT id FROM tables LIMIT 1');
    const tableId = tablesRes.rows[0]?.id || '1';
    await db.execute("INSERT INTO orders (id, table_id, total, status, origin, created_at) VALUES (?, ?, 0, 'preparing', 'pdv', datetime('now'))", [orderId, tableId]);
    await db.execute("INSERT INTO order_items (id, order_id, product_id, quantity, price_at_time, selected_modifiers, notes) VALUES (?, ?, 'test', 1, 0, '[]', 'LIMPEZA CONCLUIDA')", [Math.random().toString(36).substr(2, 9), orderId]);
    console.log('DB Cleaned and Test Order Created');
  } catch (e) { console.error(e); }
  process.exit(0);
}
run();