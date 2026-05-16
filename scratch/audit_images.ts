import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || "libsql://becoartes-os-zuridev999.turso.io";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function auditImages() {
  const menuRes = await db.execute("SELECT name, image FROM menu WHERE visible = 1");
  const menu = menuRes.rows;
  
  console.log("--- PRODUTOS SEM FOTO ---");
  const noPhoto = menu.filter(p => !p.image || p.image === "" || (typeof p.image === 'string' && p.image.includes('placeholder')));
  noPhoto.forEach(p => console.log(`- ${p.name}`));
  if (noPhoto.length === 0) console.log("Nenhum.");

  console.log("\n--- FOTOS DUPLICADAS (MESMO LINK/ARQUIVO) ---");
  const seen = new Map<string, string[]>();
  menu.forEach(p => {
    if (p.image && typeof p.image === 'string' && !p.image.includes('placeholder')) {
      const list = seen.get(p.image) || [];
      list.push(p.name as string);
      seen.set(p.image, list);
    }
  });

  let hasDups = false;
  for (const [img, names] of seen.entries()) {
    if (names.length > 1) {
      console.log(`- Foto: ${img}`);
      console.log(`  Produtos: ${names.join(", ")}`);
      hasDups = true;
    }
  }
  if (!hasDups) console.log("Nenhuma.");
}

auditImages().catch(console.error);
