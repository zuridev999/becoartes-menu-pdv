import { createClient } from '@libsql/client';
import { migrateLio } from '../server/lio/schema.mjs';

const url=process.env.TURSO_DATABASE_URL;
if(!url) throw new Error('TURSO_DATABASE_URL obrigatório. Não usa fallback para evitar banco errado.');
if(!url.startsWith('file:') && !process.argv.includes('--confirm-production-additive-migration')) {
  throw new Error('Banco remoto: exige revisão de release e --confirm-production-additive-migration.');
}
const db=createClient({url,authToken:process.env.TURSO_AUTH_TOKEN});
try { await migrateLio(db); console.log('Schema LIO aditivo preparado; nenhum dado operacional alterado.'); }
finally { db.close(); }
