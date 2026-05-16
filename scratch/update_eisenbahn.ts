import { createClient } from '@libsql/client';
import fs from 'fs';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function updateEisenbahn() {
  const imagePath = "/Users/guimameluco/.gemini/antigravity/brain/3e2f77da-2da8-45e5-80ae-0a3bf5d04a83/eisenbahn_600ml_classic_bottle_becoartes_1778801837948.png";
  if (fs.existsSync(imagePath)) {
    const base64Image = `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`;
    await db.execute({
      sql: "UPDATE menu SET image = ? WHERE name LIKE '%Eisenbahn%'",
      args: [base64Image]
    });
    console.log("📸 Foto da Eisenbahn 600ml Clássica atualizada com sucesso.");
  }
  process.exit(0);
}

updateEisenbahn();
