const { createClient } = require('@libsql/client');

const url = 'libsql://becoartes-os-zuridev999.turso.io';
const authToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ';

const db = createClient({ url, authToken });

async function run() {
  try {
    const cats = await db.execute("SELECT * FROM categories");
    console.log("=== CATEGORIAS ===");
    console.log(cats.rows);

    const items = await db.execute("SELECT m.id, m.name, m.category_id, c.name as category_name FROM menu m LEFT JOIN categories c ON m.category_id = c.id");
    console.log("\n=== PRODUTOS NO CARDÁPIO ===");
    console.log(items.rows);
  } catch (err) {
    console.error(err);
  }
}

run();
