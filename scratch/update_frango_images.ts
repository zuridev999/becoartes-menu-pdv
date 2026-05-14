import { db } from '../src/lib/db';

async function updateImages() {
  try {
    // 1. Isca de Frango (p3) recebe a foto antiga do Frango a Passarinho
    await db.execute({
      sql: "UPDATE menu SET image = '/images/frango-passarinho.jpg' WHERE id = 'p3'",
      args: []
    });

    // 2. Frango a Passarinho (p8) recebe a nova foto premium
    await db.execute({
      sql: "UPDATE menu SET image = '/images/frango-passarinho-premium.png' WHERE id = 'p8'",
      args: []
    });

    console.log("✅ Fotos atualizadas com sucesso!");
  } catch (e) {
    console.error("❌ Erro ao atualizar fotos:", e);
  }
}

updateImages();
