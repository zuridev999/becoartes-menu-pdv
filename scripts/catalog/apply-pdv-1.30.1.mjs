import { createClient } from '@libsql/client';
import { cleanPublicDescriptions } from './clean-public-descriptions.mjs';

const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL;
if (!url) throw new Error('Banco não configurado.');
if (!url.startsWith('file:') && !process.argv.includes('--confirm-production-catalog-migration')) throw new Error('Banco remoto exige confirmação explícita.');
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || undefined });
try { console.log(JSON.stringify({ ok: true, ...await cleanPublicDescriptions(db) })); }
finally { db.close(); }
