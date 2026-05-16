import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function checkSchema() {
  const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
  for (const table of tables.rows) {
    const tableName = table.name as string;
    const schema = await db.execute(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
    console.log(`--- ${tableName} ---`);
    console.log(schema.rows[0].sql);
  }
  process.exit(0);
}

checkSchema();
