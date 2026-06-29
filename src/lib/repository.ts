const removedDirectRepositoryAccess = () => {
  throw new Error('Repository direto do frontend foi removido. Use os clientes do BFF em src/lib/api.ts.');
};

export const Repository = new Proxy({}, {
  get: removedDirectRepositoryAccess,
  apply: removedDirectRepositoryAccess,
}) as never;
