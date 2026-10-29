// Explicit catalog migration. Importable for a reviewed release; never run on BFF startup.
export const SHARED_FLAVOR_GROUP = 'modgrp_caipirinha_51_sabores';
export const LEGACY_FLAVOR_GROUP = 'modgrp_caipirinha_premium_sabores';
export const COCKTAIL_PRODUCTS = ['eitvvb40r', '46gcrhr62', '5cb33298-f4ee-4a04-927b-cb893aa7aecf', 'caipirinha_51_varios_sabores'];
export async function consolidateCocktailFlavors(db) {
  const tx = await db.transaction('write');
  try {
    for (const id of COCKTAIL_PRODUCTS) {
      if (!(await tx.execute({sql:'SELECT id FROM menu WHERE id=?',args:[id]})).rows.length) throw new Error(`Produto esperado ausente: ${id}`);
    }
    const signature = async id => (await tx.execute({sql:'SELECT name,price,status,linked_product_id FROM modifiers WHERE group_id=? ORDER BY name',args:[id]})).rows.map(r => JSON.stringify(r)).join('\n');
    const oldLinks = Number((await tx.execute({sql:'SELECT (SELECT COUNT(*) FROM product_modifier_groups WHERE group_id=?) + (SELECT COUNT(*) FROM category_modifier_groups WHERE group_id=?) n',args:[LEGACY_FLAVOR_GROUP,LEGACY_FLAVOR_GROUP]})).rows[0].n);
    if (oldLinks && await signature(SHARED_FLAVOR_GROUP) !== await signature(LEGACY_FLAVOR_GROUP)) throw new Error('Os grupos possuem diferenças. Revise sabores, preços e disponibilidade antes de consolidar.');
    if (!(await tx.execute({sql:'SELECT id FROM modifier_groups WHERE id=?',args:[SHARED_FLAVOR_GROUP]})).rows.length) throw new Error('Grupo compartilhado não encontrado.');
    await tx.execute({sql:"UPDATE modifier_groups SET name='Sabores de caipirinhas',description='Grupo compartilhado por caipirinha, caipiroska e saquerinha.',min_choices=1,max_choices=1,is_required=1 WHERE id=?",args:[SHARED_FLAVOR_GROUP]});
    for (const [table,column] of [['product_modifier_groups','product_id'],['category_modifier_groups','category_id']]) {
      await tx.execute({sql:`INSERT OR IGNORE INTO ${table}(${column},group_id,sort_order) SELECT ${column},?,sort_order FROM ${table} WHERE group_id=?`,args:[SHARED_FLAVOR_GROUP,LEGACY_FLAVOR_GROUP]});
      await tx.execute({sql:`DELETE FROM ${table} WHERE group_id=?`,args:[LEGACY_FLAVOR_GROUP]});
    }
    for (const id of COCKTAIL_PRODUCTS) await tx.execute({sql:'INSERT OR IGNORE INTO product_modifier_groups(product_id,group_id,sort_order) VALUES (?,?,0)',args:[id,SHARED_FLAVOR_GROUP]});
    // Historical option IDs remain intact; only the obsolete group leaves active configuration.
    await tx.execute({sql:"UPDATE modifier_groups SET status='inactive',name='Sabores de caipirinha · legado' WHERE id=?",args:[LEGACY_FLAVOR_GROUP]});
    await tx.commit();
    return {groupId:SHARED_FLAVOR_GROUP,products:COCKTAIL_PRODUCTS.length};
  } catch(err) { await tx.rollback(); throw err; } finally { tx.close(); }
}
