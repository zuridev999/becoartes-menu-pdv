import { createClient } from '@libsql/client';
import fs from 'fs';

const url = "libsql://becoartes-os-zuridev999.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ";

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
