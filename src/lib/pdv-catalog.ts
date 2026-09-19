import type { Category, Product } from '../types';

export type PdvCatalogCategory = {
  id: string;
  label: string;
  sortOrder: number;
};

const normalizeText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const CATEGORY_LABELS: Record<string, string> = {
  pratos_para_1: 'Pratos para 1',
  pratos_para_2: 'Pratos para 2',
  burgers: 'Burgers',
  porcoes: 'Porções',
  drinks: 'Drinks (Caipirinha)',
  long_necks: 'Long Necks',
  cerveja_600: 'Cerveja 600ml',
  aguas: 'Águas',
  refrigerantes: 'Refrigerantes',
  energeticos: 'Energéticos',
};

const CATEGORY_ORDER = [
  'pratos_para_1',
  'pratos_para_2',
  'burgers',
  'porcoes',
  'drinks',
  'long_necks',
  'cerveja_600',
  'aguas',
  'refrigerantes',
  'energeticos',
];

const hiddenCategory = (name: string) => {
  const normalized = normalizeText(name);
  return normalized.includes('a validar') || normalized.includes('feijoada');
};

const classifyNonAlcoholic = (productName: string) => {
  const normalized = normalizeText(productName);
  if (/\benergetic|monster|red bull|fusion|burn|tnt\b/.test(normalized)) return 'energeticos';
  if (/\bagua\b/.test(normalized) && !/tonica|tonic/.test(normalized)) return 'aguas';
  return 'refrigerantes';
};

export const getPdvProductCategoryId = (
  product: Product,
  categoriesById: Map<string, Category>,
) => {
  const category = categoriesById.get(product.categoryId);
  const categoryName = normalizeText(category?.name || product.categoryName || '');
  const productName = normalizeText(product.name);

  if (categoryName.includes('a validar') || categoryName.includes('feijoada') || productName.includes('feijoada')) return null;
  if (categoryName.includes('salgado')) return 'porcoes';
  if (categoryName.includes('nao alcool')) return classifyNonAlcoholic(product.name);
  if (categoryName.includes('energet')) return 'energeticos';
  if (categoryName.includes('refrigerante')) return 'refrigerantes';
  if (categoryName.includes('agua')) return 'aguas';
  if (categoryName.includes('prato para 2') || categoryName.includes('pratos para 2')) return 'pratos_para_2';
  if (categoryName.includes('prato para 1') || categoryName.includes('pratos para 1') || categoryName.includes('pratos brasileiro')) return 'pratos_para_1';
  if (categoryName.includes('burg')) return 'burgers';
  if (categoryName.includes('porc')) return 'porcoes';
  if (categoryName.includes('drink')) return 'drinks';
  if (categoryName.includes('long neck')) return 'long_necks';
  if (categoryName.includes('600ml') || categoryName.includes('600 ml')) return 'cerveja_600';
  if (!category?.visible && hiddenCategory(categoryName)) return null;

  return product.categoryId ? `category:${product.categoryId}` : null;
};

export const buildPdvCatalogCategories = (
  categories: Category[],
  products: Product[],
) => {
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const entries = new Map<string, PdvCatalogCategory>();

  products.forEach((product, index) => {
    const categoryId = getPdvProductCategoryId(product, categoriesById);
    if (!categoryId || entries.has(categoryId)) return;
    const sourceCategory = categoriesById.get(product.categoryId);
    const knownOrder = CATEGORY_ORDER.indexOf(categoryId);
    entries.set(categoryId, {
      id: categoryId,
      label: CATEGORY_LABELS[categoryId] || sourceCategory?.name || product.categoryName || 'Outros',
      sortOrder: knownOrder === -1 ? CATEGORY_ORDER.length + Number(sourceCategory?.sortOrder ?? index) : knownOrder,
    });
  });

  return Array.from(entries.values()).sort((a, b) => a.sortOrder - b.sortOrder);
};

export const getPdvCategoriesById = (categories: Category[]) => (
  new Map(categories.map((category) => [category.id, category]))
);
