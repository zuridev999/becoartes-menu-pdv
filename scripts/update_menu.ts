import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const client = createClient({ url, authToken });

const NEW_MENU = {
  "PORÇÕES": [
    ["Isca de Frango", 55.90],
    ["Carne Acebolada", 65.90],
    ["Pastelzinho", 35.90],
    ["Batata Frita Queijo Cremoso c/ Bacon", 42.90],
    ["Batata Frita", 35.90],
    ["Bolinho de Bacalhau", 45.90],
    ["Bolinho de Feijoada 5 uni", 45.90],
    ["Coxinha de Frango 8 uni", 38.90],
    ["Bolinho de Queijo", 38.90],
    ["Frango a Passarinho Becoartes", 38.90]
  ],
  "CERVEJAS 600ML": [
    ["Original", 20.90],
    ["Heineken", 25.90],
    ["Eisenbahn Pilsen", 17.90]
  ],
  "DRINKS": [
    ["Caipirinha", 16.90],
    ["Caipiroska", 38.90],
    ["Saquerinha", 40.90],
    ["Aperol Spritz", 48.90],
    ["Gin Mango Loco", 48.90],
    ["Gin Tonic Nacional", 40.90],
    ["Negroni", 48.90],
    ["Gin Tonic Importado", 48.90],
    ["Double Gin Nacional", 45.90]
  ],
  "PRATOS BRASILEIROS": [
    ["Parmegiana de Carne", 76.90],
    ["Contra Filé Acebolado", 69.90],
    ["Filé de Frango", 59.90],
    ["Calabresa", 54.90],
    ["Omelete", 49.90],
    ["Adicional Ovo", 3.90]
  ],
  "BURGUERS BECO": [
    ["Bate Burguer", 55.90],
    ["Robin Veggie", 50.90]
  ],
  "NÃO ALCOÓLICOS": [
    ["Refrigerantes", 10.90],
    ["Água sem gás", 7.90],
    ["Suco", 10.90],
    ["Água com Gás", 7.90],
    ["Água de Coco", 10.90],
    ["Monster Melancia", 21.90],
    ["Café", 7.90],
    ["Monster Mango Loko", 19.90]
  ],
  "LONG NECKS": [
    ["Corona", 18.90],
    ["Heineken Long Neck", 18.90],
    ["Heineken Zero Álcool", 18.90],
    ["Spaten Long Neck", 18.90],
    ["Amstel Puro Malte", 16.90]
  ],
  "SOBREMESAS": [
    ["Açaí", 25.90],
    ["Churros", 25.90]
  ],
  "DOSES": [
    ["Gin", 30.90],
    ["Cachaça", 20.90],
    ["Red Label Whisky", 30.90]
  ],
  "CAFÉ DA MANHÃ": [
    ["Bowl de Açaí", 25.90],
    ["Café Preto", 7.90]
  ]
};

async function run() {
  const categoriesRes = await client.execute("SELECT * FROM categories");
  const menuRes = await client.execute("SELECT * FROM menu");
  
  let currentCategories = categoriesRes.rows;
  const currentMenu = menuRes.rows;
  
  const results = [];
  const processedMenuIds = new Set();

  for (const [catName, items] of Object.entries(NEW_MENU)) {
    let category = currentCategories.find(c => (c.name as string).toUpperCase() === catName.toUpperCase());
    
    if (!category) {
      const catId = Math.random().toString(36).substr(2, 9);
      await client.execute({
        sql: "INSERT INTO categories (id, name, visible, sort_order) VALUES (?, ?, 1, 0)",
        args: [catId, catName]
      });
      category = { id: catId, name: catName } as any;
      const r = await client.execute("SELECT * FROM categories");
      currentCategories = r.rows;
    }

    for (const [prodName, price] of items as [string, number][]) {
      const existing = currentMenu.filter(p => (p.name as string).trim().toUpperCase() === prodName.trim().toUpperCase());
      
      if (existing.length >= 1) {
        for (const p of existing) {
          // Atualizar preço, category_id e tamém 'category' (texto) se existir
          await client.execute({
            sql: "UPDATE menu SET price = ?, category_id = ?, category = ?, visible = 1 WHERE id = ?",
            args: [price, category.id, catName, p.id]
          }).catch(async () => {
             // Fallback se 'category' não existir como coluna
             await client.execute({
               sql: "UPDATE menu SET price = ?, category_id = ?, visible = 1 WHERE id = ?",
               args: [price, category.id, p.id]
             });
          });
          processedMenuIds.add(p.id);
        }
        
        results.push({
          category: catName,
          product: prodName,
          oldPrice: existing[0].price,
          newPrice: price,
          status: existing.length > 1 ? 'duplicado encontrado' : 'atualizado'
        });
      } else {
        const prodId = Math.random().toString(36).substr(2, 9);
        await client.execute({
          sql: "INSERT INTO menu (id, name, price, category_id, category, visible, image) VALUES (?, ?, ?, ?, ?, 1, '')",
          args: [prodId, prodName, price, category.id, catName]
        }).catch(async () => {
           await client.execute({
             sql: "INSERT INTO menu (id, name, price, category_id, visible, image) VALUES (?, ?, ?, ?, 1, '')",
             args: [prodId, prodName, price, category.id]
           });
        });
        results.push({
          category: catName,
          product: prodName,
          oldPrice: '-',
          newPrice: price,
          status: 'atualizado'
        });
        processedMenuIds.add(prodId);
      }
    }
  }

  for (const p of currentMenu) {
    if (!processedMenuIds.has(p.id)) {
      await client.execute({
        sql: "UPDATE menu SET visible = 0 WHERE id = ?",
        args: [p.id]
      });
      results.push({
        category: (p.category_name || 'OUTROS') as string,
        product: p.name as string,
        oldPrice: p.price as number,
        newPrice: '-',
        status: 'ocultado do tablet'
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

run();
