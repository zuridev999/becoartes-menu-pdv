import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { SCHEMA_MIGRATIONS, runSchemaMigrations } from '../server/migrations/schema.mjs';

const quoteIdentifier = (value) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))) {
    throw new Error(`Invalid test SQL identifier: ${value}`);
  }
  return `"${value}"`;
};

const createTempDb = () => {
  const dbFile = join(tmpdir(), `becoartes-migrations-${process.pid}-${Math.random().toString(16).slice(2)}.db`);
  return {
    dbFile,
    db: createClient({ url: `file:${dbFile}` }),
    cleanup: () => {
      rmSync(dbFile, { force: true });
      rmSync(`${dbFile}-shm`, { force: true });
      rmSync(`${dbFile}-wal`, { force: true });
    },
  };
};

const getRows = async (db, sql, args = []) => {
  const result = await db.execute({ sql, args });
  return result.rows || [];
};

const getTableColumns = async (db, table) => {
  const rows = await getRows(db, `PRAGMA table_info(${quoteIdentifier(table)})`);
  return rows.map((row) => String(row.name));
};

const createLegacyTables = async (db) => {
  const tables = Array.from(new Set(SCHEMA_MIGRATIONS.flatMap((migration) => migration.steps.map((step) => step.table))));
  for (const table of tables) {
    await db.execute(`CREATE TABLE ${quoteIdentifier(table)} (id TEXT PRIMARY KEY)`);
  }

  await db.execute('ALTER TABLE menu ADD COLUMN category_id TEXT');
};

const testLegacyDatabaseMigratesOnce = async () => {
  const { db, cleanup } = createTempDb();
  try {
    await createLegacyTables(db);

    await runSchemaMigrations(db);
    let ledgerRows = await getRows(db, 'SELECT id FROM schema_migrations');
    assert.equal(ledgerRows.length, SCHEMA_MIGRATIONS.length, 'all migrations should be recorded once');

    const menuColumns = await getTableColumns(db, 'menu');
    assert.equal(menuColumns.filter((column) => column === 'category_id').length, 1, 'existing columns must not be duplicated');
    assert.ok(menuColumns.includes('sort_order'), 'missing legacy columns should be added');

    await runSchemaMigrations(db);
    ledgerRows = await getRows(db, 'SELECT id FROM schema_migrations');
    assert.equal(ledgerRows.length, SCHEMA_MIGRATIONS.length, 'second run must not create duplicate ledger rows');
  } finally {
    cleanup();
  }
};

const testMigrationFailureDoesNotWriteLedger = async () => {
  const { db, cleanup } = createTempDb();
  try {
    await assert.rejects(
      () => runSchemaMigrations(db, [{
        id: '20260628_9998_failure_probe',
        description: 'Probe migration failure behavior.',
        steps: [{ type: 'add_column', table: 'missing_table', column: 'probe', definition: 'TEXT' }],
      }]),
      /Migration table missing: missing_table/,
    );

    const ledgerRows = await getRows(db, 'SELECT id FROM schema_migrations');
    assert.equal(ledgerRows.length, 0, 'failed migrations must not be marked as applied');
  } finally {
    cleanup();
  }
};

const testChecksumMismatchFails = async () => {
  const { db, cleanup } = createTempDb();
  try {
    await db.execute('CREATE TABLE probe_table (id TEXT PRIMARY KEY)');
    await runSchemaMigrations(db, [{
      id: '20260628_9999_checksum_probe',
      description: 'Probe migration checksum behavior.',
      steps: [{ type: 'add_column', table: 'probe_table', column: 'first_column', definition: 'TEXT' }],
    }]);

    await assert.rejects(
      () => runSchemaMigrations(db, [{
        id: '20260628_9999_checksum_probe',
        description: 'Probe migration checksum behavior changed.',
        steps: [{ type: 'add_column', table: 'probe_table', column: 'second_column', definition: 'TEXT' }],
      }]),
      /Checksum divergente/,
    );
  } finally {
    cleanup();
  }
};

await testLegacyDatabaseMigratesOnce();
await testMigrationFailureDoesNotWriteLedger();
await testChecksumMismatchFails();

console.log(JSON.stringify({
  ok: true,
  covered: [
    'migration_legacy_database',
    'migration_existing_column',
    'migration_idempotent_second_run',
    'migration_failure_not_recorded',
    'migration_checksum_mismatch',
  ],
}, null, 2));
