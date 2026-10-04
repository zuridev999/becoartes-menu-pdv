import { getSourceImpact, setSourceVisibility } from './availability.mjs';

export const createAvailabilityServices = ({ db, getSettings, requirePermission, isAdminSession, requireString, clearCatalogCache }) => {
  const authorize = async (session) => {
    const settings = await getSettings();
    requirePermission(session, 'toggleProductVisibility', settings);
    if (!isAdminSession(session)) {
      const error = new Error('Apenas administrador pode alterar disponibilidade por insumo.');
      error.statusCode = 403;
      throw error;
    }
  };

  return {
    catalogAvailabilityImpact: async ({ productId, sourceId }, session = null) => {
      await authorize(session);
      return getSourceImpact(db, { productId: requireString(productId, 'productId'), sourceId });
    },
    catalogAvailabilitySet: async ({ productId, sourceId, selectedKeys, hidden }, session = null) => {
      await authorize(session);
      if (typeof hidden !== 'boolean') {
        const error = new Error('Estado de disponibilidade inválido.');
        error.statusCode = 400;
        throw error;
      }
      const result = await setSourceVisibility(db, {
        productId: requireString(productId, 'productId'),
        sourceId: requireString(sourceId, 'sourceId'),
        selectedKeys,
        hidden,
        authorId: session?.id,
        authorName: session?.name,
      });
      clearCatalogCache();
      return result;
    },
  };
};
