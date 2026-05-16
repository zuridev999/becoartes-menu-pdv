import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function swapAndAudit() {
  // 1. Get current images
  const res = await db.execute("SELECT name, image FROM menu WHERE name IN ('Frango a Passarinho', 'Isca de Frango')");
  const frangoPass = res.rows.find(r => r.name === 'Frango a Passarinho');
  const iscaFrango = res.rows.find(r => r.name === 'Isca de Frango');

  console.log(`Atual: Frango a Passarinho -> ${frangoPass?.image}`);
  console.log(`Atual: Isca de Frango -> ${iscaFrango?.image}`);

  // 2. Update Isca de Frango with Frango a Passarinho's current image
  if (frangoPass?.image) {
    await db.execute({
      sql: "UPDATE menu SET image = ? WHERE name = 'Isca de Frango'",
      args: [frangoPass.image]
    });
    console.log(`Isca de Frango atualizada com foto de Frango a Passarinho.`);
  }

  // 3. Update Frango a Passarinho with new generated image path
  await db.execute({
    sql: "UPDATE menu SET image = '/images/frango-passarinho.jpg' WHERE name = 'Frango a Passarinho'",
    args: []
  });
  console.log(`Frango a Passarinho atualizado com nova imagem local.`);
}

swapAndAudit().catch(console.error);
