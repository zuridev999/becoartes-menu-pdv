import { createHash } from 'node:crypto';

const addColumn = (table, column, definition) => ({
  type: 'add_column',
  table,
  column,
  definition,
});

const executeSql = (sql) => ({ type: 'execute_sql', sql });

export const SCHEMA_MIGRATIONS = [
  {
    id: '20260628_0001_legacy_additive_columns',
    description: 'Add columns introduced before versioned migrations.',
    steps: [
      addColumn('menu', 'category_id', 'TEXT'),
      addColumn('menu', 'schedule_config', 'TEXT'),
      addColumn('menu', 'cost', 'REAL DEFAULT 0'),
      addColumn('menu', 'sort_order', 'INTEGER DEFAULT 0'),
      addColumn('categories', 'visible', 'INTEGER DEFAULT 1'),
      addColumn('categories', 'schedule_config', 'TEXT'),
      addColumn('sellers', 'permission', "TEXT DEFAULT 'standard'"),
      addColumn('sellers', 'pin', "TEXT DEFAULT '1234'"),
      addColumn('sellers', 'tipo_vinculo', "TEXT DEFAULT 'fixo'"),
      addColumn('orders', 'origin', "TEXT DEFAULT 'pdv'"),
      addColumn('order_items', 'notes', 'TEXT'),
      addColumn('modifier_groups', 'status', "TEXT DEFAULT 'active'"),
      addColumn('modifiers', 'status', "TEXT DEFAULT 'active'"),
      addColumn('modifiers', 'sort_order', 'INTEGER DEFAULT 0'),
      addColumn('product_modifier_groups', 'sort_order', 'INTEGER DEFAULT 0'),
      addColumn('category_modifier_groups', 'sort_order', 'INTEGER DEFAULT 0'),
      addColumn('service_requests', 'message', 'TEXT'),
      addColumn('tables', 'current_seller_id', 'TEXT'),
      addColumn('customer_tabs', 'cpf_hash', 'TEXT'),
      addColumn('customer_tabs', 'cpf_last4', 'TEXT'),
      addColumn('customer_tabs', 'paid_at', 'DATETIME'),
      addColumn('customer_tabs', 'closed_at', 'DATETIME'),
      addColumn('customer_tabs', 'closed_by_id', 'TEXT'),
      addColumn('customer_tabs', 'closed_by_name', 'TEXT'),
      addColumn('closed_bills', 'table_id', 'TEXT'),
      addColumn('closed_bills', 'coupon_code', 'TEXT'),
      addColumn('closed_bills', 'coupon_amount', 'REAL DEFAULT 0'),
      addColumn('closed_bills', 'coupon_benefit', 'TEXT'),
      addColumn('pdv_coupons', 'customer_id', 'TEXT'),
      addColumn('pdv_coupons', 'customer_name', 'TEXT'),
      addColumn('pdv_coupons', 'phone', 'TEXT'),
      addColumn('pdv_coupons', 'campaign_name', 'TEXT'),
      addColumn('pdv_coupons', 'valid_until', 'DATETIME'),
      addColumn('pdv_coupons', 'min_order_value', 'REAL DEFAULT 0'),
      addColumn('pdv_coupons', 'selected_benefit', 'TEXT'),
      addColumn('pdv_coupons', 'used_by_employee_id', 'TEXT'),
      addColumn('pdv_coupons', 'used_by_employee', 'TEXT'),
      addColumn('pdv_coupons', 'table_number', 'INTEGER'),
      addColumn('pdv_coupons', 'order_id', 'TEXT'),
      addColumn('pdv_coupons', 'whatsapp_message', 'TEXT'),
      addColumn('pdv_coupons', 'sent_at', 'DATETIME'),
      addColumn('pdv_coupons', 'benefit_type', 'TEXT'),
      addColumn('pdv_coupons', 'discount_type', 'TEXT'),
      addColumn('pdv_coupons', 'target_category', 'TEXT'),
      addColumn('pdv_coupons', 'target_product_id', 'TEXT'),
      addColumn('pdv_coupons', 'target_product_name', 'TEXT'),
      addColumn('pdv_coupons', 'free_item_name', 'TEXT'),
      addColumn('pdv_coupons', 'benefit_label', 'TEXT'),
      addColumn('pdv_coupons', 'rule_json', 'TEXT'),
      addColumn('delivery_orders', 'payment_provider', 'TEXT'),
      addColumn('delivery_orders', 'payment_external_id', 'TEXT'),
      addColumn('delivery_orders', 'checkout_url', 'TEXT'),
      addColumn('delivery_orders', 'production_order_id', 'TEXT'),
      addColumn('delivery_customers', 'city', 'TEXT'),
      addColumn('delivery_customers', 'state', 'TEXT'),
      addColumn('delivery_customers', 'postal_code', 'TEXT'),
      addColumn('delivery_customers', 'reference', 'TEXT'),
      addColumn('delivery_customers', 'latitude', 'REAL'),
      addColumn('delivery_customers', 'longitude', 'REAL'),
      addColumn('delivery_customers', 'password_hash', 'TEXT'),
      addColumn('delivery_customers', 'email_verified', 'INTEGER DEFAULT 0'),
      addColumn('delivery_customers', 'phone_verified', 'INTEGER DEFAULT 0'),
      addColumn('delivery_customers', 'verification_code_hash', 'TEXT'),
      addColumn('delivery_customers', 'verification_code_expires_at', 'DATETIME'),
      addColumn('delivery_customers', 'reset_code_hash', 'TEXT'),
      addColumn('delivery_customers', 'reset_code_expires_at', 'DATETIME'),
      addColumn('delivery_customers', 'last_login_at', 'DATETIME'),
      addColumn('estoque_produtos', 'estoque_minimo', 'REAL DEFAULT 0'),
      addColumn('estoque_produtos', 'status', "TEXT DEFAULT 'Saudável'"),
      addColumn('estoque_produtos', 'updated_at', 'INTEGER'),
      addColumn('estoque_movimentacoes', 'closed_bill_id', 'TEXT'),
      addColumn('estoque_movimentacoes', 'order_id', 'TEXT'),
      addColumn('estoque_movimentacoes', 'order_item_id', 'TEXT'),
      addColumn('estoque_movimentacoes', 'origem', 'TEXT'),
      addColumn('estoque_movimentacoes', 'integration_event_id', 'TEXT'),
      addColumn('estoque_movimentacoes', 'source_item_id', 'TEXT'),
      addColumn('estoque_movimentacoes', 'source_item_kind', 'TEXT'),
      addColumn('users', 'nome', 'TEXT'),
      addColumn('users', 'email', 'TEXT'),
      addColumn('users', 'funcao', 'TEXT'),
      addColumn('users', 'ativo', 'INTEGER DEFAULT 1'),
      addColumn('users', 'pin', 'TEXT'),
      addColumn('users', 'is_operador', 'INTEGER DEFAULT 1'),
      addColumn('users', 'permitir_acesso_remoto', 'INTEGER DEFAULT 0'),
      addColumn('users', 'tipo_vinculo', 'TEXT'),
      addColumn('users', 'pdv_sell_enabled', 'INTEGER DEFAULT 0'),
    ],
  },
  {
    id: '20260701_0001_freelancer_operational_access',
    description: 'Add temporary operational access payload for approved freelancer shifts.',
    steps: [
      addColumn('users', 'freelancer_operational_access', 'TEXT'),
    ],
  },
  {
    id: '20260702_0001_delivery_product_visibility',
    description: 'Add per-product delivery visibility flag.',
    steps: [
      addColumn('menu', 'delivery_visible', 'INTEGER DEFAULT 1'),
    ],
  },
  {
    id: '20260706_0001_order_submission_idempotency',
    description: 'Add idempotency key for table order submissions.',
    steps: [
      addColumn('orders', 'client_request_id', 'TEXT'),
    ],
  },
  {
    id: '20260716_0001_pdv_cmv_linkage',
    description: 'Expose CMV ownership and calculated cost to the PDV catalog.',
    steps: [
      addColumn('estoque_produtos', 'preco_custo', 'REAL DEFAULT 0'),
      addColumn('fichas_tecnicas', 'categoria', 'TEXT'),
      addColumn('fichas_tecnicas', 'subcategoria', 'TEXT'),
      addColumn('fichas_tecnicas', 'preco_venda', 'REAL DEFAULT 0'),
      addColumn('fichas_tecnicas', 'custo_total', 'REAL DEFAULT 0'),
      addColumn('fichas_tecnicas', 'cmv_percentual', 'REAL DEFAULT 0'),
      addColumn('fichas_tecnicas', 'modo_preparo', 'TEXT'),
      addColumn('fichas_tecnicas', 'criado_por_id', 'TEXT'),
      addColumn('fichas_tecnicas', 'pdv_product_id', 'TEXT'),
      addColumn('fichas_tecnicas', 'pdv_product_name', 'TEXT'),
      addColumn('fichas_tecnicas', 'created_at', 'INTEGER'),
      addColumn('fichas_tecnicas', 'updated_at', 'INTEGER'),
    ],
  },
  {
    id: '20260801_0001_inventory_cost_snapshots',
    description: 'Preserve the weighted-average inventory cost used by each PDV movement.',
    steps: [
      addColumn('estoque_movimentacoes', 'custo_unitario_centavos', 'INTEGER'),
      addColumn('estoque_movimentacoes', 'custo_total_centavos', 'INTEGER'),
      addColumn('estoque_movimentacoes', 'metodo_custeio', 'TEXT'),
      addColumn('estoque_movimentacoes', 'custo_fonte', 'TEXT'),
    ],
  },
  {
    id: '20260808_0001_canonical_product_codes_and_modifiers',
    description: 'Give menu products a human code and link modifier options to canonical products.',
    steps: [
      addColumn('menu', 'category', 'TEXT'),
      addColumn('menu', 'product_code', 'INTEGER'),
      addColumn('modifiers', 'linked_product_id', 'TEXT'),
    ],
  },
  {
    id: '20260812_0001_qr_comanda_transition',
    description: 'Separate physical QR locations from customer-tab accounts and preserve active tables during mode changes.',
    steps: [
      addColumn('tables', 'qr_flow_override', 'TEXT'),
      addColumn('tables', 'qr_session_revision', 'INTEGER DEFAULT 1'),
      addColumn('orders', 'source_table_id', 'TEXT'),
      addColumn('orders', 'source_table_number', 'INTEGER'),
      addColumn('orders', 'customer_tab_id', 'TEXT'),
      addColumn('service_requests', 'source_table_id', 'TEXT'),
      addColumn('service_requests', 'source_table_number', 'INTEGER'),
      addColumn('service_requests', 'customer_tab_id', 'TEXT'),
      executeSql(`CREATE TRIGGER IF NOT EXISTS validate_active_customer_tab_order
        BEFORE INSERT ON orders
        WHEN NEW.customer_tab_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM customer_tabs ct
            WHERE ct.id = NEW.customer_tab_id
              AND ct.table_id = NEW.table_id
              AND ct.status IN ('open', 'paid')
          )
        BEGIN
          SELECT RAISE(ABORT, 'customer_tab_not_active');
        END`),
      executeSql(`CREATE TRIGGER IF NOT EXISTS validate_active_customer_tab_service_request
        BEFORE INSERT ON service_requests
        WHEN NEW.customer_tab_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM customer_tabs ct
            WHERE ct.id = NEW.customer_tab_id
              AND ct.table_id = NEW.table_id
              AND ct.status IN ('open', 'paid')
          )
        BEGIN
          SELECT RAISE(ABORT, 'customer_tab_not_active');
        END`),
    ],
  },
];

const quoteIdentifier = (value) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))) {
    throw new Error(`Identificador SQL inválido em migration: ${value}`);
  }
  return `"${value}"`;
};

const checksumMigration = (migration) => createHash('sha256')
  .update(JSON.stringify({
    id: migration.id,
    description: migration.description,
    steps: migration.steps,
  }))
  .digest('hex');

const ensureMigrationLedger = async (db) => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
};

const getAppliedMigrations = async (db) => {
  const result = await db.execute('SELECT id, checksum FROM schema_migrations');
  return new Map((result.rows || []).map((row) => [String(row.id), String(row.checksum)]));
};

const hasColumn = async (db, table, column) => {
  const result = await db.execute(`PRAGMA table_info(${quoteIdentifier(table)})`);
  return (result.rows || []).some((row) => String(row.name) === String(column));
};

const assertTableExists = async (db, table) => {
  const result = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    args: [table],
  });
  if (!result.rows?.[0]) {
    throw new Error(`Migration table missing: ${table}`);
  }
};

const runStep = async (db, step) => {
  if (step.type === 'execute_sql') {
    await db.execute(step.sql);
    return;
  }
  if (step.type !== 'add_column') throw new Error(`Tipo de migration não suportado: ${step.type}`);

  await assertTableExists(db, step.table);
  if (await hasColumn(db, step.table, step.column)) return;

  await db.execute(`ALTER TABLE ${quoteIdentifier(step.table)} ADD COLUMN ${quoteIdentifier(step.column)} ${step.definition}`);
};

export const runSchemaMigrations = async (db, migrations = SCHEMA_MIGRATIONS) => {
  await ensureMigrationLedger(db);
  const applied = await getAppliedMigrations(db);

  for (const migration of migrations) {
    const checksum = checksumMigration(migration);
    const appliedChecksum = applied.get(migration.id);
    if (appliedChecksum) {
      if (appliedChecksum !== checksum) {
        throw new Error(`Checksum divergente para migration ${migration.id}`);
      }
      continue;
    }

    for (const step of migration.steps) {
      await runStep(db, step);
    }

    await db.execute({
      sql: 'INSERT INTO schema_migrations (id, description, checksum, applied_at) VALUES (?, ?, ?, ?)',
      args: [migration.id, migration.description, checksum, Date.now()],
    });
  }
};
