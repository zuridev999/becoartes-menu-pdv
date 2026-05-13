import { db } from './src/lib/db';

async function main() {
  const res = await db.execute("SELECT id, name FROM menu");
  console.log(JSON.stringify(res.rows, null, 2));
}

main().catch(console.error);
