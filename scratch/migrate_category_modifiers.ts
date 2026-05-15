import { createClient } from '@libsql/client';

const url = "libsql://becoartes-os-zuridev999.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ";

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
