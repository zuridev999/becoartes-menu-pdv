import { createClient } from '@libsql/client';

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const productId = 'artisanal_caipirgin_20261031';
const vodkaId = 'artisanal_caipiroska_20261031';
const groupId = 'artisanal_flavors_gin_20261031';
const recipeId = 'artisanal_recipe_gin_20261031';
const stockId = '8118d706-99d9-4468-a9c0-9f0e71e4f07d';
const categoryId = 'xhctti03a';
const price = 64.99;
const vodkaPrice = 56.99;
const ml = 50;
const partnerCost = 30;
const description = 'As nossas receitas artesanais ganham gin Apogee Classic. Frutas e rapadura entram na mistura; você escolhe entre Limoeiro, Carioquinha e Chuva do Caju.';
const flavors = [
  ['limoeiro', 'Limoeiro — limões e rapadura'],
  ['carioquinha', 'Carioquinha — mexerica, maracujá, limão-cravo e calda de pimenta'],
  ['chuva_do_caju', 'Chuva do Caju — caju, limão-siciliano e gengibre'],
];
const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
const existing = await one('SELECT id,name,price,visible FROM menu WHERE id=?', [productId]);
const vodka = await one('SELECT id,name,price,visible FROM menu WHERE id=?', [vodkaId]);
if (vodka?.name !== 'Caipiroska Artesanal' || Number(vodka.visible) !== 1) throw new Error('Caipiroska Artesanal inesperada.');
if (existing) {
  if (existing.name !== 'Caipirgin Artesanal' || Number(existing.visible) !== 1 || Math.abs(Number(existing.price) - price) > 0.001 || Math.abs(Number(vodka.price) - vodkaPrice) > 0.001) {
    throw new Error('Publicação parcial ou divergente: revisão manual necessária.');
  }
  console.log(JSON.stringify({ status: 'already_published', productId, price, vodkaPrice }));
  process.exit(0);
}
if (Math.abs(Number(vodka.price) - 54.99) > 0.001) throw new Error('Preço atual da Caipiroska inesperado.');
const category = await one('SELECT id,name,visible FROM categories WHERE id=?', [categoryId]);
if (category?.name !== 'DRINKS' || Number(category.visible) !== 1) throw new Error('Categoria DRINKS inesperada.');
const duplicate = await one('SELECT id FROM menu WHERE lower(name)=?', ['caipirgin artesanal']);
if (duplicate) throw new Error('Já existe Caipirgin Artesanal com outro ID.');
const stock = await one('SELECT id,nome,empresa_id,unidade,preco_custo,quantidade_atual,ativo FROM estoque_produtos WHERE id=?', [stockId]);
if (!stock || Number(stock.ativo) !== 1 || String(stock.unidade).toUpperCase() !== 'ML' || Number(stock.preco_custo) <= 0 || Number(stock.quantidade_atual) < ml || !/APOGEE/i.test(String(stock.nome))) {
  throw new Error('Gin Apogee sem custo, vínculo ou saldo suficiente.');
}
const creatorId = (await one('SELECT criado_por_id FROM fichas_tecnicas WHERE pdv_product_id=? AND empresa_id=? LIMIT 1', ['artisanal_caipiroska_20261031', stock.empresa_id]))?.criado_por_id;
if (!creatorId) throw new Error('Criador das fichas técnicas não encontrado.');
const productCode = Number((await one('SELECT COALESCE(MAX(product_code),99) AS n FROM menu WHERE product_code BETWEEN 100 AND 9999')).n) + 1;
if (productCode > 9999) throw new Error('Códigos de produto esgotados.');
const group = await one('SELECT id FROM modifier_groups WHERE id=?', [groupId]);
const recipe = await one('SELECT id FROM fichas_tecnicas WHERE id=?', [recipeId]);
if (group || recipe) throw new Error('Grupo ou ficha de gin já existente sem produto: revisão manual necessária.');
const vodkaRecipe = await one('SELECT id,preco_venda FROM fichas_tecnicas WHERE pdv_product_id=?', [vodkaId]);
if (!vodkaRecipe || Math.abs(Number(vodkaRecipe.preco_venda) - 54.99) > 0.001) throw new Error('Ficha da Caipiroska inesperada.');
const spiritCost = Number(stock.preco_custo) * ml;
const preview = { productId, name: 'Caipirgin Artesanal', price, vodkaPrice, spirit: stock.nome, spiritMl: ml, spiritCost: Number(spiritCost.toFixed(2)), partnerCost, houseGross: Number((price - partnerCost - spiritCost).toFixed(2)), productCode, sortOrder: 3.5, flavors: flavors.map(([slug]) => slug) };
if (process.env.APPLY_ARTISANAL_GIN !== '1') {
  console.log(JSON.stringify({ status: 'dry_run', preview }));
  process.exit(0);
}
const now = Date.now();
const statements = [
  { sql: 'INSERT INTO menu (id,name,description,price,category,category_id,image,visible,delivery_visible,product_code,cost,sort_order,external_fulfillment,external_service_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', args: [productId, 'Caipirgin Artesanal', description, price, 'DRINKS', categoryId, '/images/artesanais/gin-limoeiro.webp', 1, 0, productCode, spiritCost, 3.5, 0, partnerCost] },
  { sql: 'INSERT INTO modifier_groups (id,name,description,min_selection,max_selection,min_choices,max_choices,is_required,status) VALUES (?,?,?,?,?,?,?,?,?)', args: [groupId, 'Sabores artesanais', '', 1, 1, 1, 1, 1, 'active'] },
  ...flavors.map(([slug,name], index) => ({ sql: 'INSERT INTO modifiers (id,group_id,linked_product_id,name,price,status,sort_order) VALUES (?,?,?,?,?,?,?)', args: [`artisanal_gin_${slug}`, groupId, null, name, 0, 'active', index] })),
  { sql: 'INSERT INTO product_modifier_groups (product_id,group_id,sort_order) VALUES (?,?,?)', args: [productId, groupId, 0] },
  { sql: 'INSERT INTO fichas_tecnicas (id,empresa_id,nome_prato,categoria,preco_venda,custo_total,cmv_percentual,modo_preparo,criado_por_id,created_at,updated_at,pdv_product_id,pdv_product_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', args: [recipeId, stock.empresa_id, 'Caipirgin Artesanal', 'Bebidas', price, spiritCost, 100 * spiritCost / price, `Parceiro fornece frutas e preparo por R$ ${partnerCost} por unidade. Casa fornece ${ml} ml de ${stock.nome}.`, creatorId, now, now, productId, 'Caipirgin Artesanal'] },
  { sql: 'INSERT INTO ficha_ingredientes (id,ficha_tecnica_id,nome_ingrediente,preco_pacote,tamanho_pacote,unidade_medida,quantidade_usada,custo_porcao,tipo,created_at,estoque_produto_id,estoque_produto_nome,nome_exibicao,quantidade_estoque_baixa,unidade_estoque_baixa,fator_conversao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', args: [`${recipeId}_spirit`, recipeId, stock.nome, stock.preco_custo, 1, 'ml', ml, spiritCost, 'ingrediente', now, stock.id, stock.nome, stock.nome, ml, 'ML', 1] },
  { sql: 'UPDATE menu SET price=? WHERE id=? AND price=?', args: [vodkaPrice, vodkaId, 54.99] },
  { sql: 'UPDATE fichas_tecnicas SET preco_venda=?,cmv_percentual=100*custo_total/?,updated_at=? WHERE id=? AND preco_venda=?', args: [vodkaPrice, vodkaPrice, now, vodkaRecipe.id, 54.99] },
  { sql: `INSERT OR REPLACE INTO app_settings (key,value,updated_at) VALUES ('catalog_version',?,CURRENT_TIMESTAMP)`, args: [String(now)] },
];
await db.batch(statements, 'write');
console.log(JSON.stringify({ status: 'published', preview, statements: statements.length }));
