import { createClient } from '@libsql/client';

const url = "libsql://becoartes-os-zuridev999.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ";

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
