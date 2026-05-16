import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function cleanupMenu() {
  const catsRes = await db.execute("SELECT id, name FROM categories");
  const menuRes = await db.execute("SELECT id, name, price, category_id FROM menu");
  
  const categories = catsRes.rows;
  const menu = menuRes.rows;
  
  const bebidasCat = categories.find(c => c.name.toUpperCase() === 'BEBIDAS');
  const naoAlcoolicosCat = categories.find(c => c.name.toUpperCase() === 'NÃO ALCOÓLICOS');
  const longnecksCat = categories.find(c => c.name.toUpperCase() === 'LONGNECKS');
  const cat600ml = categories.find(c => c.name.toUpperCase() === '600ML');

  if (!bebidasCat) {
    console.log("Categoria BEBIDAS não encontrada.");
    return;
  }

  console.log(`--- INICIANDO LIMPEZA DO CARDÁPIO ---`);

  for (const item of menu) {
    if (item.category_id === bebidasCat.id) {
      const name = item.name.toLowerCase().trim();
      const price = Number(item.price) || 0;
      
      // Procurar se já existe em outra categoria
      const existsElsewhere = menu.find(p => 
        p.category_id !== bebidasCat.id && 
        p.name.toLowerCase().trim() === name
      );

      if (existsElsewhere) {
        console.log(`- Excluindo duplicado em BEBIDAS: ${item.name} (Já existe em ${categories.find(c => c.id === existsElsewhere.category_id)?.name})`);
        await db.execute({ sql: "DELETE FROM menu WHERE id = ?", args: [item.id] });
      } else {
        if (price > 0) {
          // Mover para categoria adequada
          let newCatId = naoAlcoolicosCat?.id; // Default para não alcoólicos
          if (name.includes('600ml')) newCatId = cat600ml?.id;
          if (name.includes('long')) newCatId = longnecksCat?.id;

          if (newCatId) {
            console.log(`- Movendo item único ${item.name} para ${categories.find(c => c.id === newCatId)?.name}`);
            await db.execute({ sql: "UPDATE menu SET category_id = ? WHERE id = ?", args: [newCatId, item.id] });
          }
        } else {
          console.log(`- Excluindo item sem preço: ${item.name}`);
          await db.execute({ sql: "DELETE FROM menu WHERE id = ?", args: [item.id] });
        }
      }
    }
  }

  // Limpar duplicatas de Açaí e Churros em outras categorias
  const dupCheck = ['açaí', 'churros', 'heineken 600ml', 'original 600ml'];
  for (const nameToClean of dupCheck) {
    const items = menu.filter(p => p.name.toLowerCase().trim() === nameToClean);
    if (items.length > 1) {
      // Manter apenas um (o com ID que parece mais novo ou o primeiro)
      const toDelete = items.slice(1);
      for (const d of toDelete) {
         console.log(`- Limpando duplicata global: ${d.name} (ID: ${d.id})`);
         await db.execute({ sql: "DELETE FROM menu WHERE id = ?", args: [d.id] });
      }
    }
  }

  // Deletar categoria BEBIDAS
  console.log(`- Removendo categoria redundante: BEBIDAS`);
  await db.execute({ sql: "DELETE FROM categories WHERE id = ?", args: [bebidasCat.id] });

  console.log(`--- LIMPEZA CONCLUÍDA ---`);
}

cleanupMenu().catch(console.error);
