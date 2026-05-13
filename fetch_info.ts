import { db } from './src/lib/db';

async function main() {
  const cats = await db.execute("SELECT * FROM categories ORDER BY sort_order ASC");
  const menu = await db.execute("SELECT id, name, category_id FROM menu");
  console.log("CATEGORIES:");
  console.log(JSON.stringify(cats.rows, null, 2));
  console.log("\nMENU ITEMS:");
  console.log(JSON.stringify(menu.rows, null, 2));
}

main().catch(console.error);
