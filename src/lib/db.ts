const removedDirectDatabaseAccess = () => {
  throw new Error('Acesso direto ao banco pelo frontend foi removido. Use as rotas do BFF em src/lib/api.ts.');
};

export const db = new Proxy({}, {
  get: removedDirectDatabaseAccess,
  apply: removedDirectDatabaseAccess,
}) as never;

export const initDB = async () => removedDirectDatabaseAccess();
