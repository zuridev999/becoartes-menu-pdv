
import { createClient } from "@libsql/client";

const url = "libsql://becoartes-os-zuridev999.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function cleanup() {
  console.log("🧹 Iniciando limpeza do catálogo...");

  try {
    // 1. Unificar Categorias
    console.log("🍻 Unificando categorias de cerveja...");
    const cats = await db.execute("SELECT id, name FROM categories WHERE name IN ('600ML', 'CERVEJAS 600ML')");
    const cat600 = cats.rows.find(r => r.name === '600ML');
    const catCervejas600 = cats.rows.find(r => r.name === 'CERVEJAS 600ML');

    if (cat600 && catCervejas600) {
      console.log(`Movendo produtos de ${cat600.id} para ${catCervejas600.id}`);
      await db.execute({
        sql: "UPDATE menu SET category_id = ? WHERE category_id = ?",
        args: [catCervejas600.id, cat600.id]
      });
      await db.execute({
        sql: "DELETE FROM categories WHERE id = ?",
        args: [cat600.id]
      });
    }

    // 2. Remover produtos duplicados (sem foto)
    console.log("📸 Removendo duplicatas sem foto...");
    const dupNames = await db.execute("SELECT name, COUNT(*) as count FROM menu GROUP BY name HAVING count > 1");
    for (const row of dupNames.rows) {
      const name = row.name as string;
      console.log(`Limpando duplicatas para: ${name}`);
      const items = await db.execute({ sql: "SELECT id, image FROM menu WHERE name = ?", args: [name] });
      const hasImage = items.rows.some(r => r.image && !r.image.includes('unsplash'));
      if (hasImage) {
          await db.execute({
              sql: "DELETE FROM menu WHERE name = ? AND (image IS NULL OR image = '' OR image LIKE '%unsplash%')",
              args: [name]
          });
      }
    }

    // 3. Atualizar Eisenbahn 600ml
    console.log("🍺 Atualizando Eisenbahn 600ml...");
    const eisenPhoto = "https://io.convertiez.com.br/m/superpaguemenos/shop/products/images/15442/medium/cerveja-eisenbahn-pilsen-600ml_23192.jpg";
    await db.execute({
      sql: "UPDATE menu SET image = ?, name = 'Eisenbahn 600ml' WHERE name LIKE '%Eisenbahn%' AND name LIKE '%600%'",
      args: [eisenPhoto]
    });

    console.log("✅ Limpeza concluída com sucesso!");
  } catch (error) {
    console.error("❌ Erro na limpeza:", error);
  }
}

cleanup();
