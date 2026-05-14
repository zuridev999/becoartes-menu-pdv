import { createClient } from '@libsql/client/web';

const url = "libsql://becoartes-os-zuridev999.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ";

export const db = createClient({
  url: url,
  authToken: authToken,
});

export const initDB = async () => {
  try {
    // Tabela de Categorias
    await db.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        schedule_config TEXT, -- JSON com dias e horários
        sort_order INTEGER DEFAULT 0,
        visible INTEGER DEFAULT 1
      )
    `);

    // Tabela de Cardápio (Menu) - Atualizada com schedule
    await db.execute(`
      CREATE TABLE IF NOT EXISTS menu (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        category_id TEXT,
        image TEXT,
        visible INTEGER DEFAULT 1,
        erp_code TEXT,
        remote_stock_id TEXT,
        schedule_config TEXT, -- JSON
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )
    `);

    // Tabela de Grupos de Opcionais (Fase 2)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS modifier_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        min_choices INTEGER DEFAULT 0,
        max_choices INTEGER DEFAULT 1,
        is_required INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active'
      )
    `);

    // Tabela de Modificadores (Opcionais) - Atualizada com group_id
    await db.execute(`
      CREATE TABLE IF NOT EXISTS modifiers (
        id TEXT PRIMARY KEY,
        group_id TEXT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        status TEXT DEFAULT 'active',
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY(group_id) REFERENCES modifier_groups(id)
      )
    `);

    // Tabela de relação Produto <-> Grupos de Modificadores
    await db.execute(`
      CREATE TABLE IF NOT EXISTS product_modifier_groups (
        product_id TEXT,
        group_id TEXT,
        sort_order INTEGER DEFAULT 0,
        PRIMARY KEY(product_id, group_id),
        FOREIGN KEY(product_id) REFERENCES menu(id),
        FOREIGN KEY(group_id) REFERENCES modifier_groups(id)
      )
    `);

    // Tabela de Mesas
    await db.execute(`
      CREATE TABLE IF NOT EXISTS tables (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL,
        status TEXT NOT NULL,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela de Pedidos (Orders)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        table_id TEXT,
        total REAL NOT NULL,
        status TEXT NOT NULL,
        origin TEXT DEFAULT 'pdv', -- 'tablet', 'pdv', 'waiter_app'
        created_by_id TEXT, -- sellerId
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        payment_method TEXT,
        FOREIGN KEY(table_id) REFERENCES tables(id),
        FOREIGN KEY(created_by_id) REFERENCES sellers(id)
      )
    `);

    // Tabela de Itens do Pedido (Order Items)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT,
        product_id TEXT,
        quantity INTEGER NOT NULL,
        price_at_time REAL NOT NULL,
        selected_modifiers TEXT, -- JSON string
        notes TEXT,
        FOREIGN KEY(order_id) REFERENCES orders(id),
        FOREIGN KEY(product_id) REFERENCES menu(id)
      )
    `);

    // Tabela de Chamados (Service Requests)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS service_requests (
        id TEXT PRIMARY KEY,
        table_id TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(table_id) REFERENCES tables(id)
      )
    `);

    // Tabela de Vendedores (Sellers)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS sellers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nickname TEXT,
        status TEXT NOT NULL, -- 'active', 'inactive'
        role TEXT NOT NULL, -- 'garçom', 'atendente', 'gerente', 'outro'
        permission TEXT DEFAULT 'standard', -- 'admin', 'standard', 'restricted'
        pin TEXT DEFAULT '1234',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela de Logs de Auditoria (Passo 5)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL, -- 'table_opened', 'item_added', 'bill_requested', 'bill_closed'
        details TEXT, -- JSON string com detalhes
        table_number TEXT,
        origin TEXT, -- 'tablet', 'pdv', 'qr'
        author_id TEXT,
        author_name TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await db.execute("ALTER TABLE menu ADD COLUMN category_id TEXT");
    } catch (e) {}

    try {
      await db.execute("ALTER TABLE menu ADD COLUMN schedule_config TEXT");
    } catch (e) {}

    try {
      await db.execute("ALTER TABLE categories ADD COLUMN visible INTEGER DEFAULT 1");
    } catch (e) {}

    try {
      await db.execute("ALTER TABLE categories ADD COLUMN schedule_config TEXT");
    } catch (e) {}

    try {
      await db.execute("ALTER TABLE sellers ADD COLUMN permission TEXT DEFAULT 'standard'");
    } catch (e) {}

    try {
      await db.execute("ALTER TABLE sellers ADD COLUMN pin TEXT DEFAULT '1234'");
    } catch (e) {}

    // Tabela de Turnos (Shifts / Caixa)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS shifts (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL, -- 'open', 'closed'
        opening_balance REAL NOT NULL,
        closing_balance REAL,
        total_sales REAL DEFAULT 0,
        opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        sort_order INTEGER DEFAULT 0
      )
    `);

    // Adicionar colunas seller_id e seller_name na closed_bills caso não existam
    try {
      await db.execute("ALTER TABLE closed_bills ADD COLUMN seller_id TEXT");
    } catch (e) { /* Coluna já existe */ }
    
    try {
      await db.execute("ALTER TABLE closed_bills ADD COLUMN seller_name TEXT");
    } catch (e) { /* Coluna já existe */ }

    // Migrações para Tabela Orders
    try {
      await db.execute("ALTER TABLE orders ADD COLUMN origin TEXT DEFAULT 'pdv'");
    } catch (e) {}

    try {
      await db.execute("ALTER TABLE order_items ADD COLUMN notes TEXT");
    } catch (e) {}

    try {
      await db.execute("ALTER TABLE modifier_groups ADD COLUMN status TEXT DEFAULT 'active'");
    } catch (e) {}

    try {
      await db.execute("ALTER TABLE modifiers ADD COLUMN status TEXT DEFAULT 'active'");
    } catch (e) {}

    try {
       await db.execute("ALTER TABLE modifiers ADD COLUMN sort_order INTEGER DEFAULT 0");
    } catch (e) {}

    try {
      await db.execute("ALTER TABLE product_modifier_groups ADD COLUMN sort_order INTEGER DEFAULT 0");
    } catch (e) {}

    console.log("✅ Banco de Dados Inicializado com Sucesso!");
  } catch (error) {
    console.error("❌ Erro ao inicializar DB:", error);
  }
};
