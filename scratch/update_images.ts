import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function updateImages() {
  console.log("Atualizando imagens...");
  
  await db.execute({
    sql: "UPDATE menu SET image = '/images/parmegiana.jpg' WHERE name = 'Parmegiana de Carne'",
    args: []
  });
  
  await db.execute({
    sql: "UPDATE menu SET image = '/images/omelete.jpg' WHERE name = 'Omelete'",
    args: []
  });
  
  console.log("Imagens atualizadas com sucesso!");
}

updateImages().catch(console.error);
