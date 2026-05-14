import { db } from '../src/lib/db';

async function checkFrango() {
  const res = await db.execute("SELECT id, name, image FROM menu WHERE name LIKE '%Frango%'");
  console.log(JSON.stringify(res.rows, null, 2));
}

checkFrango();
