import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function cleanupMenu() {
  console.log(`--- INICIANDO LIMPEZA RESILIENTE ---`);
  
  const catsRes = await db.execute("SELECT id, name FROM categories");
  const menuRes = await db.execute("SELECT id, name, price, category_id FROM menu");
  
  const categories = catsRes.rows;
  const menu = menuRes.rows;
  
  const bebidasCat = categories.find(c => c.name.toUpperCase() === 'BEBIDAS');
  const naoAlcoolicosCat = categories.find(c => c.name.toUpperCase() === 'NÃO ALCOÓLICOS');
  const longnecksCat = categories.find(c => c.name.toUpperCase() === 'LONGNECKS');
  const cat600ml = categories.find(c => c.name.toUpperCase() === '600ML');

  if (!bebidasCat) return;

  for (const item of menu) {
    if (item.category_id === bebidasCat.id) {
      const name = item.name.toLowerCase().trim();
      const price = Number(item.price) || 0;
      
      const existsElsewhere = menu.find(p => p.category_id !== bebidasCat.id && p.name.toLowerCase().trim() === name);

      if (existsElsewhere || price === 0) {
         // Tentar excluir. Se falhar por FK, apenas desativar e tirar da categoria
         try {
           await db.execute({ sql: "DELETE FROM menu WHERE id = ?", args: [item.id] });
           console.log(`- Excluído: ${item.name}`);
         } catch (e) {
           console.log(`- Ocultando (FK): ${item.name}`);
           await db.execute({ sql: "UPDATE menu SET visible = 0, category_id = NULL WHERE id = ?", args: [item.id] });
         }
      } else {
         // Mover item válido
         let newCatId = naoAlcoolicosCat?.id;
         if (name.includes('600ml')) newCatId = cat600ml?.id;
         if (name.includes('long')) newCatId = longnecksCat?.id;
         if (newCatId) {
            await db.execute({ sql: "UPDATE menu SET category_id = ? WHERE id = ?", args: [newCatId, item.id] });
            console.log(`- Movido: ${item.name} -> ${categories.find(c => c.id === newCatId)?.name}`);
         }
      }
    }
  }

  // Tentar deletar categoria
  try {
    await db.execute({ sql: "DELETE FROM categories WHERE id = ?", args: [bebidasCat.id] });
    console.log(`- Categoria BEBIDAS removida.`);
  } catch (e) {
    console.log(`- Categoria BEBIDAS não pôde ser removida (FK). Renomeando para ARQUIVO.`);
    await db.execute({ sql: "UPDATE categories SET name = 'ARQUIVO_ANTIGO' WHERE id = ?", args: [bebidasCat.id] });
  }

  console.log(`--- FIM ---`);
}

cleanupMenu().catch(console.error);
