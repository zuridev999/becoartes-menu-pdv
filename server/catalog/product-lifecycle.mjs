const normalizeText = (value) => String(value || '').trim();

export const getPdvPublishBlockers = ({
  name,
  price,
  categoryFound,
  directStockFound,
  recipeId,
  ingredientCount,
  unlinkedIngredientCount,
  invalidQuantityCount,
} = {}) => {
  const blockers = [];

  if (!normalizeText(name)) {
    blockers.push('Informe o nome do produto.');
  }

  if (!Number.isFinite(Number(price)) || Number(price) <= 0) {
    blockers.push('Informe um preço de venda maior que zero.');
  }

  if (!categoryFound) {
    blockers.push('Vincule o produto a uma categoria válida.');
  }

  if (!directStockFound) {
    if (!normalizeText(recipeId)) {
      blockers.push('Vincule um estoque direto ou cadastre a ficha técnica do produto.');
    } else if (Number(ingredientCount || 0) === 0) {
      blockers.push('Adicione ao menos um insumo à ficha técnica.');
    } else {
      if (Number(unlinkedIngredientCount || 0) > 0) {
        blockers.push('Vincule todos os insumos da ficha técnica ao estoque.');
      }
      if (Number(invalidQuantityCount || 0) > 0) {
        blockers.push('Corrija as quantidades inválidas da ficha técnica.');
      }
    }
  }

  return blockers;
};

export const canPublishPdvProduct = (readiness) => getPdvPublishBlockers(readiness).length === 0;
