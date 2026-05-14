import { createClient } from '@libsql/client';

const url = "libsql://becoartes-os-zuridev999.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function runAudit() {
  const catsRes = await db.execute("SELECT * FROM categories");
  const menuRes = await db.execute("SELECT * FROM menu");
  
  const categories = catsRes.rows;
  const menu = menuRes.rows;
  
  console.log("--- RELATÓRIO DE AUDITORIA DO CARDÁPIO ---");
  console.log(`Total de Categorias: ${categories.length}`);
  console.log(`Total de Produtos: ${menu.length}`);
  console.log("\n");

  // 1. Categorias Vazias
  const emptyCats = categories.filter(c => !menu.some(p => p.category_id === c.id));
  console.log("--- CATEGORIAS VAZIAS ---");
  emptyCats.forEach(c => console.log(`- ${c.name}`));
  if (emptyCats.length === 0) console.log("Nenhuma.");
  console.log("\n");

  // 2. Preço R$ 0,00 ou nulo
  const invalidPrices = menu.filter(p => !p.price || Number(p.price) <= 0);
  console.log("--- PRODUTOS COM PREÇO ZERADO OU INVÁLIDO ---");
  invalidPrices.forEach(p => console.log(`- ${p.name} (R$ ${p.price})`));
  if (invalidPrices.length === 0) console.log("Nenhum.");
  console.log("\n");

  // 3. Sem Imagem
  const noImage = menu.filter(p => !p.image || p.image === "" || (typeof p.image === 'string' && p.image.includes('placeholder')));
  console.log("--- PRODUTOS SEM IMAGEM ---");
  noImage.forEach(p => console.log(`- ${p.name}`));
  if (noImage.length === 0) console.log("Nenhum.");
  console.log("\n");

  // 4. Sem Categoria
  const noCat = menu.filter(p => !p.category_id);
  console.log("--- PRODUTOS SEM CATEGORIA ---");
  noCat.forEach(p => console.log(`- ${p.name}`));
  if (noCat.length === 0) console.log("Nenhum.");
  console.log("\n");

  // 5. Invisíveis
  const invisible = menu.filter(p => p.visible === 0);
  console.log("--- PRODUTOS INVISÍVEIS ---");
  invisible.forEach(p => console.log(`- ${p.name}`));
  if (invisible.length === 0) console.log("Nenhum.");
  console.log("\n");

  // 6. Duplicados
  console.log("--- POSSÍVEIS DUPLICADOS (NOMES IGUAIS) ---");
  const seen = new Set();
  const dups: string[] = [];
  menu.forEach((p1: any) => {
    menu.forEach((p2: any) => {
      if (p1.id !== p2.id && !seen.has(p1.id) && !seen.has(p2.id)) {
        if (p1.name.toLowerCase().trim() === p2.name.toLowerCase().trim()) {
           dups.push(`${p1.name} (IDs: ${p1.id}, ${p2.id})`);
           seen.add(p1.id);
           seen.add(p2.id);
        }
      }
    });
  });
  dups.forEach(d => console.log(`- ${d}`));
  if (dups.length === 0) console.log("Nenhum.");
  console.log("\n");
}

runAudit().catch(console.error);
