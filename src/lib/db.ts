import { createClient } from '@libsql/client/web';

const url = import.meta.env.VITE_TURSO_DATABASE_URL;
const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  throw new Error('Missing Turso configuration. Set VITE_TURSO_DATABASE_URL and VITE_TURSO_AUTH_TOKEN.');
}

export const db = createClient({
  url: url,
  authToken: authToken,
});

export const initDB = async () => {
  try {
    // 1. Criar Tabelas e Rodar Migrações em Lote (Batch) para economizar roundtrips
    await db.batch([
      // Categorias
      "CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, schedule_config TEXT, sort_order INTEGER DEFAULT 0, visible INTEGER DEFAULT 1)",
      // Menu
      "CREATE TABLE IF NOT EXISTS menu (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, price REAL NOT NULL, category_id TEXT, image TEXT, visible INTEGER DEFAULT 1, erp_code TEXT, remote_stock_id TEXT, schedule_config TEXT, cost REAL DEFAULT 0, FOREIGN KEY (category_id) REFERENCES categories(id))",
      // Opcionais
      "CREATE TABLE IF NOT EXISTS modifier_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, min_choices INTEGER DEFAULT 0, max_choices INTEGER DEFAULT 1, is_required INTEGER DEFAULT 0, status TEXT DEFAULT 'active')",
      "CREATE TABLE IF NOT EXISTS modifiers (id TEXT PRIMARY KEY, group_id TEXT, name TEXT NOT NULL, price REAL NOT NULL, status TEXT DEFAULT 'active', sort_order INTEGER DEFAULT 0, FOREIGN KEY(group_id) REFERENCES modifier_groups(id))",
      "CREATE TABLE IF NOT EXISTS product_modifier_groups (product_id TEXT, group_id TEXT, sort_order INTEGER DEFAULT 0, PRIMARY KEY(product_id, group_id), FOREIGN KEY(product_id) REFERENCES menu(id), FOREIGN KEY(group_id) REFERENCES modifier_groups(id))",
      "CREATE TABLE IF NOT EXISTS category_modifier_groups (category_id TEXT, group_id TEXT, sort_order INTEGER DEFAULT 0, PRIMARY KEY(category_id, group_id), FOREIGN KEY(category_id) REFERENCES categories(id), FOREIGN KEY(group_id) REFERENCES modifier_groups(id))",
      // Operacional
      "CREATE TABLE IF NOT EXISTS tables (id TEXT PRIMARY KEY, number TEXT NOT NULL, status TEXT NOT NULL, last_activity DATETIME DEFAULT CURRENT_TIMESTAMP)",
      "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, table_id TEXT, total REAL NOT NULL, status TEXT NOT NULL, origin TEXT DEFAULT 'pdv', created_by_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, payment_method TEXT, FOREIGN KEY(table_id) REFERENCES tables(id), FOREIGN KEY(created_by_id) REFERENCES sellers(id))",
      "CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT, product_id TEXT, quantity INTEGER NOT NULL, price_at_time REAL NOT NULL, selected_modifiers TEXT, notes TEXT, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(product_id) REFERENCES menu(id))",
      "CREATE TABLE IF NOT EXISTS service_requests (id TEXT PRIMARY KEY, table_id TEXT, type TEXT NOT NULL, status TEXT NOT NULL, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(table_id) REFERENCES tables(id))",
      "CREATE TABLE IF NOT EXISTS sellers (id TEXT PRIMARY KEY, name TEXT NOT NULL, nickname TEXT, status TEXT NOT NULL, role TEXT NOT NULL, permission TEXT DEFAULT 'standard', pin TEXT DEFAULT '1234', notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
      "CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, details TEXT, table_number TEXT, origin TEXT, author_id TEXT, author_name TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)",
      "CREATE TABLE IF NOT EXISTS closed_bills (id TEXT PRIMARY KEY, table_id TEXT, table_number INTEGER NOT NULL, seller_id TEXT, seller_name TEXT, subtotal REAL NOT NULL, service_fee REAL DEFAULT 0, discount REAL DEFAULT 0, discount_reason TEXT, total REAL NOT NULL, payments TEXT, closed_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
      "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
      "CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, status TEXT NOT NULL, opening_balance REAL NOT NULL, closing_balance REAL, total_sales REAL DEFAULT 0, opened_at DATETIME DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME, sort_order INTEGER DEFAULT 0)"
    ], "write");

    // Rodar Migrações de Coluna (em blocos separados pois podem falhar se a coluna já existir)
    const migrations = [
      "ALTER TABLE menu ADD COLUMN category_id TEXT",
      "ALTER TABLE menu ADD COLUMN schedule_config TEXT",
      "ALTER TABLE menu ADD COLUMN cost REAL DEFAULT 0",
      "ALTER TABLE categories ADD COLUMN visible INTEGER DEFAULT 1",
      "ALTER TABLE categories ADD COLUMN schedule_config TEXT",
      "ALTER TABLE sellers ADD COLUMN permission TEXT DEFAULT 'standard'",
      "ALTER TABLE sellers ADD COLUMN pin TEXT DEFAULT '1234'",
      "ALTER TABLE orders ADD COLUMN origin TEXT DEFAULT 'pdv'",
      "ALTER TABLE order_items ADD COLUMN notes TEXT",
      "ALTER TABLE modifier_groups ADD COLUMN status TEXT DEFAULT 'active'",
      "ALTER TABLE modifiers ADD COLUMN status TEXT DEFAULT 'active'",
      "ALTER TABLE modifiers ADD COLUMN sort_order INTEGER DEFAULT 0",
      "ALTER TABLE product_modifier_groups ADD COLUMN sort_order INTEGER DEFAULT 0",
      "ALTER TABLE category_modifier_groups ADD COLUMN sort_order INTEGER DEFAULT 0",
      "ALTER TABLE service_requests ADD COLUMN message TEXT",
      "ALTER TABLE closed_bills ADD COLUMN table_id TEXT"
    ];

    for (const sql of migrations) {
      try { await db.execute(sql); } catch {}
    }

    console.log("✅ Banco de Dados Inicializado (Otimizado)!");
  } catch (error) {
    console.error("❌ Erro ao inicializar DB:", error);
  }
};
