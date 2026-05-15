
import { createClient } from "@libsql/client";

const url = "libsql://becoartes-os-zuridev999.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function updateImages() {
  const images = [
    { name: 'Caipiroska', url: '/images/products/caipiroska.png' },
    { name: 'Saquerinha', url: '/images/products/saquerinha.png' },
    { name: 'Gin Mango Loco', url: '/images/products/gin_mango_loco.png' },
    { name: 'Gin Tonic Nacional', url: '/images/products/gin_tonic_nacional.png' },
    { name: 'Negroni', url: '/images/products/negroni.png' },
    { name: 'Heineken Long Neck', url: '/images/products/heineken_long_neck.png' },
    { name: 'Heineken Zero Álcool', url: '/images/products/heineken_zero.png' },
    { name: 'Suco', url: '/images/products/suco.png' },
    { name: 'Água de Coco', url: '/images/products/agua_de_coco.png' },
    { name: 'Café', url: '/images/products/cafe.png' },
    { name: 'Gin Tonic Importado', url: '/images/products/gin_tonic_nacional.png' },
    { name: 'Double Gin Nacional', url: '/images/products/gin_tonic_nacional.png' },
  ];

  console.log("🚀 Atualizando imagens com caminhos relativos...");

  for (const img of images) {
    try {
      await db.execute({
        sql: "UPDATE menu SET image = ? WHERE name = ?",
        args: [img.url, img.name]
      });
      console.log(`✅ ${img.name} atualizado.`);
    } catch (e) {
      console.error(`❌ Erro ao atualizar ${img.name}:`, e);
    }
  }

  console.log("✨ Finalizado!");
}

updateImages();
