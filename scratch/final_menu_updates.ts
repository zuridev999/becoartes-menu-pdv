import { db } from '../src/lib/db';

async function runUpdates() {
  try {
    // 1. Reverter Isca de Frango (p3)
    await db.execute({
      sql: "UPDATE menu SET image = 'https://images.unsplash.com/photo-1562967914-608f82629710?w=400' WHERE id = 'p3'",
      args: []
    });

    // 2. Atualizar preços Água
    await db.execute({
      sql: "UPDATE menu SET price = 7 WHERE name LIKE 'Água%'",
      args: []
    });

    // 3. Atualizar preços Refrigerantes (10 reais)
    await db.execute({
      sql: "UPDATE menu SET price = 10 WHERE category_id = (SELECT id FROM categories WHERE name = 'NÃO ALCOÓLICOS') AND (name LIKE 'Coca%' OR name LIKE 'Guaraná%' OR name LIKE 'Fanta%' OR name LIKE 'Sprite%')",
      args: []
    });

    // 4. Adicionar Coca Zero
    const catRes = await db.execute("SELECT id, name FROM categories WHERE name = 'NÃO ALCOÓLICOS'");
    const catId = catRes.rows[0]?.id;
    const catName = catRes.rows[0]?.name;
    if (catId) {
      await db.execute({
        sql: "INSERT OR REPLACE INTO menu (id, name, description, price, category_id, category, image, visible, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ['p_coca_zero', 'Coca-Cola Zero Lata', 'Refrigerante 350ml sem açúcar.', 10, catId, catName, 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=400', 1, 0]
      });
    }

    // 5. Atualizar imagens de Doses e Corona
    const updates = [
      { id: 'd1', image: '/images/dose-cachaca.png' }, // Cachaça
      { id: 'd2', image: '/images/dose-clear.png' },   // Vodka
      { id: 'd3', image: '/images/dose-clear.png' },   // Saquê
      { id: 'd4', image: '/images/dose-whisky.png' },  // Red Label
      { id: 'd5', image: '/images/dose-clear.png' },   // Gin
      { id: 'd6', image: '/images/dose-campari.png' }, // Campari
      { id: 'l2', image: '/images/corona-330ml.png' }, // Corona (preciso confirmar o ID l2)
      { id: 's1', image: '/images/suco-laranja.png' }  // Suco Laranja (ID fictício s1, preciso conferir)
    ];

    for (const up of updates) {
      await db.execute({
        sql: "UPDATE menu SET image = ? WHERE id = ?",
        args: [up.image, up.id]
      });
    }
    
    // Buscar Corona e Suco se os IDs forem diferentes
    await db.execute({
        sql: "UPDATE menu SET image = '/images/corona-330ml.png' WHERE name LIKE 'Corona%'",
        args: []
    });
    await db.execute({
        sql: "UPDATE menu SET image = '/images/suco-laranja.png' WHERE name LIKE 'Suco de Laranja%'",
        args: []
    });

    console.log("✅ Banco de dados atualizado!");
  } catch (e) {
    console.error("❌ Erro no DB:", e);
  }
}

runUpdates();
