import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function cleanup() {
  console.log("🚀 Iniciando limpeza do catálogo...");

  // 1. Mover produtos da categoria '600ML' para 'CERVEJAS 600ML'
  await db.execute({
    sql: "UPDATE menu SET category_id = '4m973jxcg', category = 'CERVEJAS 600ML' WHERE category_id = '49ugui761'",
    args: []
  });
  console.log("✅ Produtos movidos para a categoria correta.");

  // 2. Excluir categoria duplicada '600ML'
  await db.execute({
    sql: "DELETE FROM categories WHERE id = '49ugui761'",
    args: []
  });
  console.log("✅ Categoria duplicada removida.");

  // 3. Remover produtos sem foto que são duplicados
  // Identificamos produtos com mesmo nome onde um tem foto e outro não
  const allProducts = await db.execute("SELECT id, name, image FROM menu");
  const productsByName = new Map();
  
  for (const row of allProducts.rows) {
    const name = row.name.toLowerCase().trim();
    if (!productsByName.has(name)) {
      productsByName.set(name, []);
    }
    productsByName.get(name).push(row);
  }

  for (const [name, items] of productsByName.entries()) {
    if (items.length > 1) {
      // Tem duplicata. Manter o que tem foto.
      const withPhoto = items.find((p: any) => p.image && p.image.length > 10);
      const withoutPhoto = items.filter((p: any) => !p.image || p.image.length <= 10);
      
      if (withPhoto && withoutPhoto.length > 0) {
        for (const p of withoutPhoto) {
          await db.execute({ sql: "DELETE FROM menu WHERE id = ?", args: [p.id] });
          console.log(`🗑️ Removido duplicado sem foto: ${p.name} (ID: ${p.id})`);
        }
      }
    }
  }

  // 4. Atualizar foto da Eisenbahn
  const imagePath = "/Users/guimameluco/.gemini/antigravity/brain/3e2f77da-2da8-45e5-80ae-0a3bf5d04a83/eisenbahn_600ml_bottle_becoartes_1778801757483.png";
  if (fs.existsSync(imagePath)) {
    const base64Image = `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`;
    await db.execute({
      sql: "UPDATE menu SET image = ? WHERE name LIKE '%Eisenbahn%'",
      args: [base64Image]
    });
    console.log("📸 Foto da Eisenbahn atualizada.");
  }

  console.log("✨ Limpeza concluída com sucesso!");
  process.exit(0);
}

cleanup();
