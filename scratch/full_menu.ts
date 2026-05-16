import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

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
