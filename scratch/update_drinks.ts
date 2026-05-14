import { createClient } from '@libsql/client';

const url = "libsql://becoartes-os-zuridev999.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ";

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
