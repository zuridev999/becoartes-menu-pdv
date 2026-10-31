import { createClient } from '@libsql/client';

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const categoryId = 'xhctti03a';
const partnerCost = 30;
const spiritMl = 50;
const products = [
  {
    id: 'artisanal_caipirinha_20261031',
    name: 'Caipirinha Artesanal',
    description: 'Três sabores criados com frutas, rapadura e cachaça artesanal de alambique. Escolha seu favorito e aproveite cada gole sem pressa.',
    price: 39.99,
    image: '/images/artesanais/cachaca-limoeiro.webp',
    sortOrder: 1,
    spiritId: null,
    groupId: 'artisanal_flavors_cachaca_20261031',
    flavorPrefix: 'cachaca',
  },
  {
    id: 'artisanal_saquerinha_20261031',
    name: 'Saquerinha Artesanal',
    description: 'Uma versão mais suave das nossas receitas artesanais, para quem gosta do frescor da caipirinha e prefere saquê. Escolha entre Limoeiro, Carioquinha e Chuva do Caju.',
    price: 49.99,
    image: '/images/artesanais/saque-limoeiro.webp',
    sortOrder: 2,
    spiritId: '4d8b9793-f5ee-4773-ba93-badd931636e4',
    groupId: 'artisanal_flavors_saque_20261031',
    flavorPrefix: 'saque',
  },
  {
    id: 'artisanal_caipiroska_20261031',
    name: 'Caipiroska Artesanal',
    description: 'As nossas receitas artesanais ganham vodka Smirnoff. Frutas e rapadura entram na mistura; você escolhe entre Limoeiro, Carioquinha e Chuva do Caju.',
    price: 54.99,
    image: '/images/artesanais/vodka-limoeiro.webp',
    sortOrder: 3,
    spiritId: '4026b9b9-e483-4059-a8ff-421f6cb96faf',
    groupId: 'artisanal_flavors_vodka_20261031',
    flavorPrefix: 'vodka',
  },
];
const flavors = [
  ['limoeiro', 'Limoeiro — limões e rapadura'],
  ['carioquinha', 'Carioquinha — mexerica, maracujá, limão-cravo e calda de pimenta'],
  ['chuva_do_caju', 'Chuva do Caju — caju, limão-siciliano e gengibre'],
];

const category = (await db.execute({ sql: 'SELECT id,name,visible FROM categories WHERE id=?', args: [categoryId] })).rows[0];
if (category?.name !== 'DRINKS' || Number(category.visible) !== 1) throw new Error('Categoria DRINKS inesperada.');
const columns = (await db.execute('PRAGMA table_info(menu)')).rows.map(row => row.name);
if (process.env.APPLY_ARTISANAL_DRINKS === '1' && (!columns.includes('external_fulfillment') || !columns.includes('external_service_cost'))) {
  throw new Error('Release de preparo externo ainda não publicada.');
}
const existing = (await db.execute({
  sql: `SELECT id,name,price,visible FROM menu WHERE id IN (${products.map(() => '?').join(',')})`,
  args: products.map(product => product.id),
})).rows;
if (existing.length) {
  if (existing.length !== products.length || existing.some(row => {
    const expected = products.find(product => product.id === row.id);
    return row.name !== expected.name || Math.abs(Number(row.price) - expected.price) > 0.001 || Number(row.visible) !== 1;
  })) throw new Error('Publicação artesanal parcial ou divergente: revisão manual necessária.');
  console.log(JSON.stringify({ status: 'already_published', products: existing.map(row => row.name) }));
  process.exit(0);
}
const names = (await db.execute({
  sql: `SELECT name FROM menu WHERE lower(name) IN (${products.map(() => '?').join(',')})`,
  args: products.map(product => product.name.toLowerCase()),
})).rows;
if (names.length) throw new Error('Já existe produto com um dos nomes propostos.');
const stocks = new Map();
for (const product of products.filter(product => product.spiritId)) {
  const stock = (await db.execute({ sql: 'SELECT id,nome,empresa_id,unidade,preco_custo,quantidade_atual,ativo FROM estoque_produtos WHERE id=?', args: [product.spiritId] })).rows[0];
  if (!stock || Number(stock.ativo) !== 1 || String(stock.unidade).toUpperCase() !== 'ML' || Number(stock.preco_custo) <= 0 || Number(stock.quantidade_atual) < spiritMl) {
    throw new Error(`Insumo ${product.spiritId} sem custo, vínculo ou saldo suficiente.`);
  }
  stocks.set(product.spiritId, stock);
}
const companies = new Set([...stocks.values()].map(stock => stock.empresa_id));
if (companies.size !== 1) throw new Error('Insumos de empresas diferentes.');
const companyId = [...companies][0];
const creatorId = (await db.execute({
  sql: 'SELECT criado_por_id FROM fichas_tecnicas WHERE pdv_product_id = ? AND empresa_id = ? LIMIT 1',
  args: ['46gcrhr62', companyId],
})).rows[0]?.criado_por_id;
if (!creatorId) throw new Error('Usuário criador das fichas técnicas não encontrado.');
const maxCode = Number((await db.execute('SELECT COALESCE(MAX(product_code),99) AS n FROM menu WHERE product_code BETWEEN 100 AND 9999')).rows[0].n);
if (maxCode + products.length > 9999) throw new Error('Códigos de produto esgotados.');
const preview = products.map((product, index) => ({
  name: product.name,
  price: product.price,
  partnerCost,
  spirit: product.spiritId ? stocks.get(product.spiritId).nome : 'fornecido pelo parceiro',
  spiritCost: product.spiritId ? Number((stocks.get(product.spiritId).preco_custo * spiritMl).toFixed(2)) : 0,
  houseGross: Number((product.price - partnerCost - (product.spiritId ? stocks.get(product.spiritId).preco_custo * spiritMl : 0)).toFixed(2)),
  productCode: maxCode + index + 1,
  flavors: flavors.map(([slug]) => slug),
}));
if (process.env.APPLY_ARTISANAL_DRINKS !== '1') {
  console.log(JSON.stringify({ status: 'dry_run', category, schemaReady: columns.includes('external_fulfillment') && columns.includes('external_service_cost'), preview }));
  process.exit(0);
}

const now = Date.now();
const statements = [];
products.forEach((product, index) => {
  statements.push({
    sql: `INSERT INTO menu (id,name,description,price,category,category_id,image,visible,delivery_visible,product_code,cost,sort_order,external_fulfillment,external_service_cost)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [product.id, product.name, product.description, product.price, 'DRINKS', categoryId, product.image, 1, 0, maxCode + index + 1, product.spiritId ? Number(stocks.get(product.spiritId).preco_custo) * spiritMl : 0, product.sortOrder, product.spiritId ? 0 : 1, partnerCost],
  });
  statements.push({
    sql: 'INSERT INTO modifier_groups (id,name,description,min_selection,max_selection,min_choices,max_choices,is_required,status) VALUES (?,?,?,?,?,?,?,?,?)',
    args: [product.groupId, 'Sabores artesanais', '', 1, 1, 1, 1, 1, 'active'],
  });
  flavors.forEach(([slug, name], flavorIndex) => statements.push({
    sql: 'INSERT INTO modifiers (id,group_id,linked_product_id,name,price,status,sort_order) VALUES (?,?,?,?,?,?,?)',
    args: [`artisanal_${product.flavorPrefix}_${slug}`, product.groupId, null, name, 0, 'active', flavorIndex],
  }));
  statements.push({
    sql: 'INSERT INTO product_modifier_groups (product_id,group_id,sort_order) VALUES (?,?,?)',
    args: [product.id, product.groupId, 0],
  });
  if (product.spiritId) {
    const stock = stocks.get(product.spiritId);
    const spiritCost = Number(stock.preco_custo) * spiritMl;
    const recipeId = `artisanal_recipe_${product.flavorPrefix}_20261031`;
    statements.push({
      sql: `INSERT INTO fichas_tecnicas (id,empresa_id,nome_prato,categoria,preco_venda,custo_total,cmv_percentual,modo_preparo,criado_por_id,created_at,updated_at,pdv_product_id,pdv_product_name)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [recipeId, companyId, product.name, 'Bebidas', product.price, spiritCost, 100 * spiritCost / product.price, `Parceiro fornece frutas e preparo por R$ 30 por unidade. Casa fornece ${spiritMl} ml de ${stock.nome}.`, creatorId, now, now, product.id, product.name],
    });
    statements.push({
      sql: `INSERT INTO ficha_ingredientes (id,ficha_tecnica_id,nome_ingrediente,preco_pacote,tamanho_pacote,unidade_medida,quantidade_usada,custo_porcao,tipo,created_at,estoque_produto_id,estoque_produto_nome,nome_exibicao,quantidade_estoque_baixa,unidade_estoque_baixa,fator_conversao)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [`${recipeId}_spirit`, recipeId, stock.nome, stock.preco_custo, 1, 'ml', spiritMl, spiritCost, 'ingrediente', now, stock.id, stock.nome, stock.nome, spiritMl, 'ML', 1],
    });
  }
});
statements.push({
  sql: `INSERT OR REPLACE INTO app_settings (key,value,updated_at) VALUES ('catalog_version',?,CURRENT_TIMESTAMP)`,
  args: [String(now)],
});
await db.batch(statements, 'write');
console.log(JSON.stringify({ status: 'published', preview, statements: statements.length }));
