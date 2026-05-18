const { createClient } = require('@libsql/client');

const url = 'libsql://becoartes-os-zuridev999.turso.io';
const authToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ';

const db = createClient({ url, authToken });

async function run() {
  try {
    const res = await db.execute("SELECT status, count(*) as count FROM orders GROUP BY status");
    console.log("=== CONTAGEM POR STATUS EM TODAS AS ORDENS ===");
    console.log(res.rows);

    const resActive = await db.execute("SELECT o.id, o.status, o.origin, t.number as tableNumber FROM orders o JOIN tables t ON o.table_id = t.id WHERE o.status != 'closed' ORDER BY o.created_at DESC");
    console.log("\n=== ORDENS ATIVAS (NÃO FECHADAS) ===");
    console.log(resActive.rows);
  } catch (err) {
    console.error(err);
  }
}

run();
