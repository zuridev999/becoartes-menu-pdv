import { createClient } from '@libsql/client';

const url = "libsql://becoartes-os-zuridev999.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function getFullMenu() {
  const catsRes = await db.execute("SELECT id, name FROM categories ORDER BY sort_order ASC");
  const menuRes = await db.execute("SELECT name, price, category_id FROM menu ORDER BY name ASC");
  
  const categories = catsRes.rows;
  const menu = menuRes.rows;
  
  categories.forEach(cat => {
    const items = menu.filter(p => p.category_id === cat.id);
    if (items.length > 0) {
      console.log(`\n### ${cat.name.toUpperCase()}`);
      items.forEach(item => {
        console.log(`- ${item.name}: R$ ${Number(item.price).toFixed(2)}`);
      });
    }
  });
}

getFullMenu().catch(console.error);
