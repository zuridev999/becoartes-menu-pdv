import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function updateDrinkImages() {
  const updates = [
    { name: 'Original 600ml', image: '/images/original.jpg' },
    { name: 'Spaten 600ml', image: '/images/spaten.jpg' },
    { name: 'Guaraná Antarctica', image: '/images/guarana.jpg' },
    { name: 'Água Com Gás', image: '/images/agua-gas.jpg' }
  ];

  for (const up of updates) {
    await db.execute({
      sql: "UPDATE menu SET image = ? WHERE name = ? COLLATE NOCASE",
      args: [up.image, up.name]
    });
    console.log(`Atualizado: ${up.name}`);
  }
}

updateDrinkImages().catch(console.error);
