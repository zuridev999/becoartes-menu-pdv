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
  const tables = Array.from(new Set(SCHEMA_MIGRATIONS.flatMap((migration) => migration.steps
    .filter((step) => step.type === 'add_column')
    .map((step) => step.table))));
  for (const table of tables) {
    const extraColumns = table === 'orders'
      ? ', table_id TEXT, status TEXT'
      : table === 'service_requests'
        ? ', table_id TEXT'
      : table === 'customer_tabs'
        ? ', table_id TEXT, status TEXT, opened_at DATETIME'
        : table === 'closed_bills'
          ? ', closed_at DATETIME'
        : '';
    await db.execute(`CREATE TABLE ${quoteIdentifier(table)} (id TEXT PRIMARY KEY${extraColumns})`);
  }

  await db.execute('CREATE TABLE table_payments (id TEXT PRIMARY KEY, table_id TEXT, status TEXT)');

  await db.execute('ALTER TABLE menu ADD COLUMN category_id TEXT');
};

const testPaidCustomerTabsAreReleasedSafely = async () => {
  const { db, cleanup } = createTempDb();
  try {
    await createLegacyTables(db);
    const recoveryMigration = SCHEMA_MIGRATIONS.at(-1);
    await runSchemaMigrations(db, SCHEMA_MIGRATIONS.slice(0, -1));

    await db.batch([
      {
        sql: `INSERT INTO customer_tabs (id, table_id, status, opened_at, paid_at)
              VALUES ('settled', '73', 'paid', '2026-08-15T22:07:46.464Z', '2026-08-16T02:44:42.513Z')`,
      },
      {
        sql: `INSERT INTO orders (id, table_id, status, customer_tab_id)
              VALUES ('settled_order', '73', 'closed', 'settled')`,
      },
      {
        sql: `INSERT INTO closed_bills (id, table_id, closed_at)
              VALUES ('settled_bill', '73', '2026-08-16T02:44:42.513Z')`,
      },
      {
        sql: `INSERT INTO table_payments (id, table_id, status)
              VALUES ('settled_payment', '73', 'applied')`,
      },
      {
        sql: `INSERT INTO customer_tabs (id, table_id, status, opened_at, paid_at)
              VALUES ('still_active', '74', 'paid', '2026-08-15T22:07:46.464Z', '2026-08-16T02:44:42.513Z')`,
      },
      {
        sql: `INSERT INTO orders (id, table_id, status, customer_tab_id)
              VALUES ('active_order', '74', 'open', 'still_active')`,
      },
      {
        sql: `INSERT INTO closed_bills (id, table_id, closed_at)
              VALUES ('active_bill', '74', '2026-08-16T02:44:42.513Z')`,
      },
    ], 'write');

    await runSchemaMigrations(db, [recoveryMigration]);

    const settled = (await getRows(db, "SELECT status, closed_at, closed_by_name FROM customer_tabs WHERE id = 'settled'"))[0];
    assert.equal(settled.status, 'closed', 'fully settled paid tabs must stop reserving the CPF');
    assert.equal(settled.closed_at, '2026-08-16T02:44:42.513Z');
    assert.equal(settled.closed_by_name, 'Sistema');

    const stillActive = (await getRows(db, "SELECT status FROM customer_tabs WHERE id = 'still_active'"))[0];
    assert.equal(stillActive.status, 'paid', 'tabs with a non-closed order must remain untouched');
  } finally {
    cleanup();
  }
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
await testPaidCustomerTabsAreReleasedSafely();
await testMigrationFailureDoesNotWriteLedger();
await testChecksumMismatchFails();

console.log(JSON.stringify({
  ok: true,
  covered: [
    'migration_legacy_database',
    'migration_existing_column',
    'migration_idempotent_second_run',
    'migration_releases_only_fully_settled_paid_tabs',
    'migration_failure_not_recorded',
    'migration_checksum_mismatch',
  ],
}, null, 2));
