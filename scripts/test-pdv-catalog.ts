import assert from 'node:assert/strict';
import {
  buildPdvCatalogCategories,
  getPdvCategoriesById,
  getPdvProductCategoryId,
  searchPdvProducts,
} from '../src/lib/pdv-catalog.ts';

const hiddenFeijoadaCategory = {
  id: 'legacy-feijoada',
  name: 'FEIJOADA',
  visible: false,
  sortOrder: 99,
};
const portionsCategory = {
  id: 'portions',
  name: 'PORÇÕES',
  visible: true,
  sortOrder: 4,
};
const categories = [hiddenFeijoadaCategory, portionsCategory];
const categoriesById = getPdvCategoriesById(categories);
const bolinho = {
  id: 'bolinho-feijoada',
  name: 'Bolinho de Feijoada (5 uni)',
  description: 'Porção',
  price: 55.99,
  categoryId: hiddenFeijoadaCategory.id,
  categoryName: hiddenFeijoadaCategory.name,
  visible: true,
};
const legacyFeijoada = {
  id: 'feijoada-legacy',
  name: 'Feijoada antiga',
  description: '',
  price: 0,
  categoryId: hiddenFeijoadaCategory.id,
  categoryName: hiddenFeijoadaCategory.name,
  visible: false,
};

assert.equal(getPdvProductCategoryId(bolinho, categoriesById), 'porcoes');
assert.equal(getPdvProductCategoryId(legacyFeijoada, categoriesById), null);
assert.deepEqual(searchPdvProducts([bolinho, legacyFeijoada], categoriesById, 'bolinho'), [bolinho]);
assert.equal(buildPdvCatalogCategories(categories, [bolinho]).some((category) => category.id === 'porcoes'), true);

console.log(JSON.stringify({ ok: true, covered: ['bolinho_feijoada_category', 'global_catalog_search'] }, null, 2));
