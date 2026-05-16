import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function migrate() {
  console.log("🛠️ Criando tabela category_modifier_groups...");
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS category_modifier_groups (
        category_id TEXT,
        group_id TEXT,
        sort_order INTEGER DEFAULT 0,
        PRIMARY KEY(category_id, group_id),
        FOREIGN KEY(category_id) REFERENCES categories(id),
        FOREIGN KEY(group_id) REFERENCES modifier_groups(id)
      )
    `);
    console.log("✅ Tabela criada com sucesso.");
  } catch (err) {
    console.error("❌ Erro ao criar tabela:", err);
  }
  process.exit(0);
}

migrate();
