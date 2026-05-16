import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function listData() {
  const cats = await db.execute("SELECT id, name FROM categories");
  const menu = await db.execute("SELECT id, name, category_id, image FROM menu");
  
  console.log("🏷️ CATEGORIAS:");
  console.table(cats.rows);
  
  console.log("🍔 PRODUTOS:");
  console.table(menu.rows);
  
  process.exit(0);
}

listData();
