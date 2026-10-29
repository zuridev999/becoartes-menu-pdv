import { readAvailabilityProjection } from './availability.mjs';

// Read the current manual source blocks, not the cached menu or client flags.
// Stock balances and costs are deliberately not ordering restrictions.
export const assertQrOrderAvailability = async (db, items) => {
  const { productBlocked, modifierBlocked } = await readAvailabilityProjection(db);
  for (const item of items) {
    if (productBlocked.has(String(item.productId))) {
      throw Object.assign(new Error('Um produto está indisponível. Atualize o cardápio antes de enviar o pedido.'), { statusCode: 403 });
    }
    const modifiers = Array.isArray(item.selectedModifiers) ? item.selectedModifiers : [];
    if (modifiers.some(modifier => modifierBlocked.has(String(modifier.id)))) {
      throw Object.assign(new Error('Um adicional está indisponível. Atualize o cardápio antes de enviar o pedido.'), { statusCode: 403 });
    }
  }
};
