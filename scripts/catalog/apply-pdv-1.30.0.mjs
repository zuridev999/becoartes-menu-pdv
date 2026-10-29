import { createClient } from '@libsql/client';
import { consolidateCocktailFlavors } from './consolidate-cocktail-flavors.mjs';
import { repairJuiceImages } from './repair-juice-images.mjs';

const databaseUrl = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || '';
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || '';
const isLocal = databaseUrl.startsWith('file:');

if (!databaseUrl) throw new Error('TURSO_DATABASE_URL ausente.');
if (!isLocal && !process.argv.includes('--confirm-production-catalog-migration')) {
  throw new Error('Banco remoto exige --confirm-production-catalog-migration.');
}

const db = createClient({ url: databaseUrl, authToken: authToken || undefined });
try {
  const flavors = await consolidateCocktailFlavors(db);
  await repairJuiceImages(db);
  const catalogVersion = `pdv-1.30.0-${Date.now()}`;
  await db.execute({
    sql: "INSERT INTO app_settings (key, value, updated_at) VALUES ('catalog_version', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
    args: [catalogVersion],
  });
  console.log(JSON.stringify({ ok: true, flavors, juiceImages: 'missing-only', catalogVersion }));
} finally {
  db.close();
}
