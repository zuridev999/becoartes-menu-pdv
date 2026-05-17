import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@libsql/client';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const port = Number(process.env.PORT || 80);

const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN;
const OS_EMPRESA_ID = process.env.OS_EMPRESA_ID || process.env.VITE_OS_EMPRESA_ID || 'e19cbcce-b2a7-4cc1-bf70-c06d2f8feb8a';
const OS_TENANT_SLUG = process.env.OS_TENANT_SLUG || process.env.VITE_OS_TENANT_SLUG || 'becoartes';
const OS_SYSTEM_USER_ID = process.env.OS_SYSTEM_USER_ID || process.env.VITE_OS_SYSTEM_USER_ID || '';
const BOOTSTRAP_ADMIN_PIN = process.env.BOOTSTRAP_ADMIN_PIN || process.env.VITE_BOOTSTRAP_ADMIN_PIN || '';
const DEFAULT_MANAGER_PIN = process.env.DEFAULT_MANAGER_PIN || process.env.VITE_DEFAULT_MANAGER_PIN || '2020';
const DEFAULT_OPERATOR_PIN = process.env.DEFAULT_OPERATOR_PIN || process.env.VITE_DEFAULT_OPERATOR_PIN || '0040';
const TABLET_SETUP_PIN = process.env.TABLET_SETUP_PIN || process.env.VITE_TABLET_SETUP_PIN || '0040';
const ADMIN_BYPASS_PIN = process.env.ADMIN_BYPASS_PIN || process.env.VITE_BOOTSTRAP_ADMIN_PIN || BOOTSTRAP_ADMIN_PIN || '0806';
const ALLOWED_OPERATION_IPS = (process.env.ALLOWED_OPERATION_IPS || '')
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);
const SESSION_SECRET = process.env.BFF_SESSION_SECRET || process.env.JWT_SECRET || tursoAuthToken;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PROCESSING_STALE_MS = 10 * 60 * 1000;
const SERVICE_REQUEST_LIMIT = Number(process.env.SERVICE_REQUEST_LIMIT || 150);
const CLOSED_BILLS_LIMIT = Number(process.env.CLOSED_BILLS_LIMIT || 200);
const AUDIT_LOG_LIMIT = Number(process.env.AUDIT_LOG_LIMIT || 100);

if (!tursoUrl || !tursoAuthToken) {
  throw new Error('Missing Turso configuration for BFF runtime.');
}

const db = createClient({
  url: tursoUrl,
  authToken: tursoAuthToken,
});

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cache-control': 'no-store',
};

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors https://os.becoartes.com",
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const createId = () => randomUUID();
const osTimestamp = () => Math.floor(Date.now() / 1000);
const toStockAmount = (value) => Math.max(0, Math.trunc(Number(value || 0)));

const parseJsonArray = (value) => {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseJsonObject = (value) => {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const hashPin = (pin) => createHash('sha256').update(`${pin}becoartes_salt_2024`).digest('hex');
const isLegacyPlainPin = (storedPin) => /^\d{4}$/.test(String(storedPin || ''));
const toSessionSeller = (seller) => ({ ...seller, pin: '' });
const normalizePermission = (permission) => {
  if (permission === 'admin') return 'admin';
  if (permission === 'manager' || permission === 'standard') return 'manager';
  return 'operator';
};

const permissionsByProfile = {
  admin: {
    viewSalesTotals: true,
    manageSettings: true,
    manageTeam: true,
    manageOptionals: true,
    addProduct: true,
    editProductPrice: true,
    deleteProduct: true,
    toggleProductVisibility: true,
    cancelTableItem: true,
    closeBill: true,
  },
  manager: {
    viewSalesTotals: true,
    manageSettings: false,
    manageTeam: false,
    manageOptionals: true,
    addProduct: true,
    editProductPrice: true,
    deleteProduct: true,
    toggleProductVisibility: true,
    cancelTableItem: true,
    closeBill: true,
  },
  operator: {
    viewSalesTotals: false,
    manageSettings: false,
    manageTeam: false,
    manageOptionals: true,
    addProduct: true,
    editProductPrice: false,
    deleteProduct: false,
    toggleProductVisibility: true,
    cancelTableItem: false,
    closeBill: true,
  },
};

const canSession = (session, permission) => {
  if (!session) return false;
  return Boolean(permissionsByProfile[normalizePermission(session.permission)]?.[permission]);
};

const base64UrlEncode = (value) => Buffer.from(value).toString('base64url');
const base64UrlJson = (value) => base64UrlEncode(JSON.stringify(value));
const signSessionPayload = (payload) => (
  createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url')
);

const createSessionToken = (seller) => {
  const payload = base64UrlJson({
    sub: seller.id,
    name: seller.name,
    permission: normalizePermission(seller.permission),
    role: seller.role,
    exp: Date.now() + SESSION_TTL_MS,
  });
  return `${payload}.${signSessionPayload(payload)}`;
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const parseCookies = (header = '') => Object.fromEntries(
  String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      if (index === -1) return [part, ''];
      return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    })
);

const getSessionFromRequest = (req) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = String(req.headers['x-beco-session'] || cookies.beco_session || '');
  if (!token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, signSessionPayload(payload))) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.exp || Number(decoded.exp) < Date.now()) return null;
    return {
      id: decoded.sub,
      name: decoded.name,
      role: decoded.role,
      permission: normalizePermission(decoded.permission),
    };
  } catch {
    return null;
  }
};

const ensureDatabase = async () => {
  await db.batch([
    "CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, schedule_config TEXT, sort_order INTEGER DEFAULT 0, visible INTEGER DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS menu (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, price REAL NOT NULL, category_id TEXT, image TEXT, visible INTEGER DEFAULT 1, erp_code TEXT, remote_stock_id TEXT, schedule_config TEXT, cost REAL DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS modifier_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, min_choices INTEGER DEFAULT 0, max_choices INTEGER DEFAULT 1, is_required INTEGER DEFAULT 0, status TEXT DEFAULT 'active')",
    "CREATE TABLE IF NOT EXISTS modifiers (id TEXT PRIMARY KEY, group_id TEXT, name TEXT NOT NULL, price REAL NOT NULL, status TEXT DEFAULT 'active', sort_order INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS product_modifier_groups (product_id TEXT, group_id TEXT, sort_order INTEGER DEFAULT 0, PRIMARY KEY(product_id, group_id))",
    "CREATE TABLE IF NOT EXISTS category_modifier_groups (category_id TEXT, group_id TEXT, sort_order INTEGER DEFAULT 0, PRIMARY KEY(category_id, group_id))",
    "CREATE TABLE IF NOT EXISTS tables (id TEXT PRIMARY KEY, number TEXT NOT NULL, status TEXT NOT NULL, last_activity DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, table_id TEXT, total REAL NOT NULL, status TEXT NOT NULL, origin TEXT DEFAULT 'pdv', created_by_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, payment_method TEXT)",
    "CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT, product_id TEXT, quantity INTEGER NOT NULL, price_at_time REAL NOT NULL, selected_modifiers TEXT, notes TEXT)",
    "CREATE TABLE IF NOT EXISTS service_requests (id TEXT PRIMARY KEY, table_id TEXT, type TEXT NOT NULL, status TEXT NOT NULL, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS sellers (id TEXT PRIMARY KEY, name TEXT NOT NULL, nickname TEXT, status TEXT NOT NULL, role TEXT NOT NULL, permission TEXT DEFAULT 'standard', pin TEXT DEFAULT '1234', notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, details TEXT, table_number TEXT, origin TEXT, author_id TEXT, author_name TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS closed_bills (id TEXT PRIMARY KEY, table_id TEXT, table_number INTEGER NOT NULL, seller_id TEXT, seller_name TEXT, subtotal REAL NOT NULL, service_fee REAL DEFAULT 0, discount REAL DEFAULT 0, discount_reason TEXT, total REAL NOT NULL, payments TEXT, closed_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS integration_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, table_id TEXT, ref_id TEXT, payload TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, status TEXT NOT NULL, opening_balance REAL NOT NULL, closing_balance REAL, total_sales REAL DEFAULT 0, opened_at DATETIME DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME, sort_order INTEGER DEFAULT 0)",
  ], 'write');

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
    "ALTER TABLE closed_bills ADD COLUMN table_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN closed_bill_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN order_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN order_item_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN origem TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN integration_event_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN source_item_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN source_item_kind TEXT",
  ];

  for (const sql of migrations) {
    try { await db.execute(sql); } catch {}
  }

  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_orders_table_status ON orders(table_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_stock_empresa_nome ON estoque_produtos(empresa_id, ativo, nome)",
    "CREATE INDEX IF NOT EXISTS idx_stock_mov_empresa_created ON estoque_movimentacoes(empresa_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_notif_empresa_created ON notificacoes(empresa_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_category_modifiers_category ON category_modifier_groups(category_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_modifiers_product ON product_modifier_groups(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_modifiers_group_status ON modifiers(group_id, status, sort_order)",
    "CREATE INDEX IF NOT EXISTS idx_category_modifiers_group ON category_modifier_groups(group_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_modifiers_group ON product_modifier_groups(group_id)",
    "CREATE INDEX IF NOT EXISTS idx_integration_events_type_status ON integration_events(type, status)",
    "CREATE INDEX IF NOT EXISTS idx_stock_mov_integration_event ON estoque_movimentacoes(integration_event_id)",
    "CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_service_requests_status_created ON service_requests(status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_closed_bills_closed_at ON closed_bills(closed_at)",
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_mov_pdv_once ON estoque_movimentacoes(integration_event_id, order_item_id, produto_id, source_item_kind, source_item_id) WHERE origem = 'pdv' AND integration_event_id IS NOT NULL AND order_item_id IS NOT NULL",
  ];

  for (const sql of indexes) {
    try { await db.execute(sql); } catch (error) { console.warn('Index skipped:', sql, error); }
  }
};

let databaseReadyPromise = null;
const ensureDatabaseReady = () => {
  if (!databaseReadyPromise) {
    databaseReadyPromise = ensureDatabase().catch((error) => {
      databaseReadyPromise = null;
      throw error;
    });
  }
  return databaseReadyPromise;
};

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
};

const sendJson = (res, status, body) => {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body));
};

const assertSameOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host;
  if (!host) throw new Error('Host ausente.');
  const expectedHttp = `http://${host}`;
  const expectedHttps = `https://${host}`;
  if (origin !== expectedHttp && origin !== expectedHttps) {
    throw new Error('Origem não autorizada.');
  }
};

const pinAttemptBuckets = new Map();
const PIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PIN_RATE_LIMIT_MAX = 12;

const normalizeClientIp = (ip) => String(ip || '')
  .replace(/^::ffff:/, '')
  .trim();

const getClientIp = (req) => {
  if (!req) return 'unknown';
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return normalizeClientIp(forwardedFor || req.socket.remoteAddress || 'unknown');
};

const isOperationIpRestricted = () => ALLOWED_OPERATION_IPS.length > 0;
const isOperationIpAllowed = (req) => (
  !isOperationIpRestricted() || ALLOWED_OPERATION_IPS.includes(getClientIp(req))
);

const isAdminSession = (session) => normalizePermission(session?.permission) === 'admin';
const isAdminBypassPin = (pin) => ADMIN_BYPASS_PIN && String(pin || '') === ADMIN_BYPASS_PIN;

const throwIpRestricted = (req) => {
  const error = new Error(`Acesso operacional permitido apenas na rede autorizada. IP detectado: ${getClientIp(req)}`);
  error.statusCode = 403;
  throw error;
};

const isPinRateLimited = (req, pathname) => {
  if (pathname !== '/api/auth/login' && pathname !== '/api/tablet/setup-login') return false;

  const key = `${pathname}:${getClientIp(req)}`;
  const now = Date.now();
  const bucket = pinAttemptBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    pinAttemptBuckets.set(key, { count: 1, resetAt: now + PIN_RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > PIN_RATE_LIMIT_MAX;
};

const requireString = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Campo obrigatório inválido: ${field}`);
  }
  return value;
};

const requireNumber = (value, field) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Campo numérico inválido: ${field}`);
  return parsed;
};

const getCatalogVersion = async () => {
  const res = await db.execute("SELECT value FROM app_settings WHERE key = 'catalog_version' LIMIT 1");
  return String(res.rows[0]?.value || '0');
};

const getCategories = async () => {
  const res = await db.execute("SELECT * FROM categories ORDER BY sort_order ASC");
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    schedule: parseJsonObject(row.schedule_config),
    sortOrder: Number(row.sort_order || 0),
    visible: row.visible === 1,
  }));
};

const getMenu = async () => {
  const res = await db.execute(`
    SELECT m.*, c.name as category_name
    FROM menu m
    LEFT JOIN categories c ON m.category_id = c.id
  `);
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    price: Number(row.price || 0),
    categoryId: row.category_id || '',
    categoryName: row.category_name || '',
    image: row.image || '',
    visible: row.visible === 1,
    schedule: parseJsonObject(row.schedule_config),
    erpCode: row.erp_code || '',
    remoteStockId: row.remote_stock_id || '',
    cost: Number(row.cost || 0),
    modifierGroups: [],
  }));
};

const getModifierData = async () => {
  const res = await db.execute(`
    SELECT
      'group' as row_kind,
      mg.id as group_id,
      mg.name as group_name,
      mg.description as group_description,
      mg.min_choices,
      mg.max_choices,
      mg.is_required,
      mg.status as group_status,
      NULL as modifier_id,
      NULL as modifier_name,
      NULL as modifier_price,
      NULL as modifier_status,
      NULL as modifier_sort_order,
      NULL as scope,
      NULL as scope_id,
      0 as link_sort_order
    FROM modifier_groups mg
    WHERE mg.status = 'active'

    UNION ALL

    SELECT
      'modifier' as row_kind,
      mg.id as group_id,
      mg.name as group_name,
      mg.description as group_description,
      mg.min_choices,
      mg.max_choices,
      mg.is_required,
      mg.status as group_status,
      m.id as modifier_id,
      m.name as modifier_name,
      m.price as modifier_price,
      m.status as modifier_status,
      m.sort_order as modifier_sort_order,
      NULL as scope,
      NULL as scope_id,
      0 as link_sort_order
    FROM modifiers m
    JOIN modifier_groups mg ON m.group_id = mg.id
    WHERE mg.status = 'active' AND m.status = 'active'

    UNION ALL

    SELECT
      'product_link' as row_kind,
      mg.id as group_id,
      mg.name as group_name,
      mg.description as group_description,
      mg.min_choices,
      mg.max_choices,
      mg.is_required,
      mg.status as group_status,
      NULL as modifier_id,
      NULL as modifier_name,
      NULL as modifier_price,
      NULL as modifier_status,
      NULL as modifier_sort_order,
      'product' as scope,
      pmg.product_id as scope_id,
      pmg.sort_order as link_sort_order
    FROM product_modifier_groups pmg
    JOIN modifier_groups mg ON pmg.group_id = mg.id
    WHERE mg.status = 'active'

    UNION ALL

    SELECT
      'category_link' as row_kind,
      mg.id as group_id,
      mg.name as group_name,
      mg.description as group_description,
      mg.min_choices,
      mg.max_choices,
      mg.is_required,
      mg.status as group_status,
      NULL as modifier_id,
      NULL as modifier_name,
      NULL as modifier_price,
      NULL as modifier_status,
      NULL as modifier_sort_order,
      'category' as scope,
      cmg.category_id as scope_id,
      cmg.sort_order as link_sort_order
    FROM category_modifier_groups cmg
    JOIN modifier_groups mg ON cmg.group_id = mg.id
    WHERE mg.status = 'active'
    ORDER BY group_id, row_kind, modifier_sort_order, link_sort_order
  `);

  const groupById = {};
  const productMapping = {};
  const categoryMapping = {};

  res.rows.forEach((row) => {
    if (!groupById[row.group_id]) {
      groupById[row.group_id] = {
        id: row.group_id,
        name: row.group_name,
        description: row.group_description || '',
        minChoices: Number(row.min_choices || 0),
        maxChoices: Number(row.max_choices || 1),
        isRequired: row.is_required === 1,
        status: row.group_status || 'active',
        modifiers: [],
      };
    }

    if (row.row_kind === 'modifier' && row.modifier_id) {
      groupById[row.group_id].modifiers.push({
        id: row.modifier_id,
        name: row.modifier_name,
        price: Number(row.modifier_price || 0),
        status: row.modifier_status || 'active',
        sortOrder: Number(row.modifier_sort_order || 0),
      });
      return;
    }

    if (row.scope === 'product' && row.scope_id) {
      if (!productMapping[row.scope_id]) productMapping[row.scope_id] = [];
      productMapping[row.scope_id].push(row.group_id);
      return;
    }

    if (row.scope === 'category' && row.scope_id) {
      if (!categoryMapping[row.scope_id]) categoryMapping[row.scope_id] = [];
      categoryMapping[row.scope_id].push(row.group_id);
    }
  });

  return {
    modifierGroups: Object.values(groupById),
    productMapping,
    categoryMapping,
  };
};

let catalogCache = null;
const getCatalogData = async () => {
  const catalogVersion = await getCatalogVersion();
  if (catalogCache?.catalogVersion === catalogVersion) return catalogCache;

  const [categories, menuItems, modifierData] = await Promise.all([
    getCategories(),
    getMenu(),
    getModifierData(),
  ]);

  catalogCache = { categories, menuItems, ...modifierData, catalogVersion };
  return catalogCache;
};

const getSellers = async ({ includePins = false } = {}) => {
  const res = await db.execute("SELECT * FROM sellers");
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    nickname: row.nickname || '',
    status: row.status,
    role: row.role,
    permission: row.permission || 'operator',
    pin: includePins ? row.pin || '' : '',
  }));
};

const getKitchenOrders = async () => {
  const [ordersRes, itemsRes, nowRes] = await Promise.all([
    db.execute("SELECT o.id, o.status, o.table_id, o.origin, strftime('%Y-%m-%dT%H:%M:%SZ', o.created_at) as created_at, t.number as tableNumber FROM orders o JOIN tables t ON o.table_id = t.id WHERE o.status IN ('pending', 'preparing') ORDER BY o.created_at ASC"),
    db.execute(`
      SELECT oi.*, m.name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN menu m ON oi.product_id = m.id
      WHERE o.status IN ('pending', 'preparing')
    `),
    db.execute("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now') as serverNow"),
  ]);

  const itemsByOrder = {};
  itemsRes.rows.forEach((row) => {
    if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
    itemsByOrder[row.order_id].push({
      id: row.id,
      orderId: row.order_id,
      productId: row.product_id,
      name: row.name || '',
      price: Number(row.price_at_time || 0),
      quantity: Number(row.quantity || 0),
      selectedModifiers: parseJsonArray(row.selected_modifiers),
      notes: row.notes || '',
    });
  });

  return {
    orders: ordersRes.rows.map((row) => ({
      id: row.id,
      tableId: row.table_id,
      tableNumber: Number(row.tableNumber),
      status: row.status,
      origin: row.origin || 'pdv',
      createdAt: row.created_at,
      items: itemsByOrder[row.id] || [],
    })),
    serverNow: nowRes.rows[0]?.serverNow || new Date().toISOString(),
  };
};

const materializeNewOrderRequests = async () => {
  await db.execute(`
    INSERT OR IGNORE INTO service_requests (id, table_id, type, status, message, created_at)
    SELECT
      'new_order_' || o.id,
      o.table_id,
      'new_order',
      'pending',
      COALESCE((
        SELECT group_concat(oi.quantity || 'x ' || COALESCE(m.name, 'Item'), ', ')
        FROM order_items oi
        LEFT JOIN menu m ON oi.product_id = m.id
        WHERE oi.order_id = o.id
      ), 'Novo pedido'),
      o.created_at
    FROM orders o
    WHERE o.status IN ('pending', 'preparing')
      AND o.created_at >= datetime('now', '-12 hours')
      AND NOT EXISTS (
        SELECT 1 FROM service_requests sr
        WHERE sr.table_id = o.table_id
          AND sr.status = 'pending'
          AND sr.type = 'new_order'
          AND sr.message = COALESCE((
            SELECT group_concat(oi2.quantity || 'x ' || COALESCE(m2.name, 'Item'), ', ')
            FROM order_items oi2
            LEFT JOIN menu m2 ON oi2.product_id = m2.id
            WHERE oi2.order_id = o.id
          ), 'Novo pedido')
      )
  `);
};

const getServiceRequests = async () => {
  await materializeNewOrderRequests();
  const res = await db.execute({
    sql: `
      SELECT
        sr.id,
        sr.table_id,
        sr.type,
        sr.status,
        sr.message,
        strftime('%Y-%m-%dT%H:%M:%SZ', sr.created_at) as created_at,
        t.number as tableNumber
      FROM service_requests sr
      LEFT JOIN tables t ON sr.table_id = t.id
      WHERE (
          sr.status IN ('pending', 'viewed')
          OR (
            sr.status = 'resolved'
            AND sr.created_at >= datetime('now', '-12 hours')
          )
        )
        AND NOT (
          sr.type = 'new_order'
          AND sr.id NOT LIKE 'new_order_%'
          AND EXISTS (
            SELECT 1 FROM service_requests sr2
            WHERE sr2.table_id = sr.table_id
              AND sr2.type = 'new_order'
              AND sr2.message = sr.message
              AND sr2.status = sr.status
              AND sr2.id LIKE 'new_order_%'
              AND abs(strftime('%s', sr2.created_at) - strftime('%s', sr.created_at)) < 300
          )
        )
      ORDER BY
        CASE sr.status WHEN 'pending' THEN 0 WHEN 'viewed' THEN 1 ELSE 2 END,
        sr.created_at DESC
      LIMIT ?
    `,
    args: [SERVICE_REQUEST_LIMIT],
  });

  return res.rows.map((row) => ({
    id: row.id,
    tableId: row.table_id,
    tableNumber: Number(row.tableNumber || 0),
    type: row.type,
    message: row.message || '',
    status: row.status,
    createdAt: row.created_at || new Date().toISOString(),
  }));
};

const getClosedBills = async (limit = 200) => {
  const res = await db.execute({
    sql: "SELECT id, table_id, table_number, seller_id, seller_name, subtotal, service_fee, discount, discount_reason, total, payments, strftime('%Y-%m-%dT%H:%M:%SZ', closed_at) as closed_at FROM closed_bills ORDER BY closed_at DESC LIMIT ?",
    args: [Math.min(Number(limit) || CLOSED_BILLS_LIMIT, CLOSED_BILLS_LIMIT)],
  });
  return res.rows.map((row) => ({
    id: row.id,
    tableId: row.table_id || '',
    tableNumber: Number(row.table_number || 0),
    sellerId: row.seller_id || '',
    sellerName: row.seller_name || 'Sistema',
    subtotal: Number(row.subtotal || 0),
    serviceFee: Number(row.service_fee || 0),
    discount: Number(row.discount || 0),
    discountReason: row.discount_reason || '',
    total: Number(row.total || 0),
    payments: parseJsonArray(row.payments),
    closedAt: row.closed_at || new Date().toISOString(),
  }));
};

const getSettings = async () => {
  const res = await db.execute("SELECT value FROM app_settings WHERE key = 'settings' LIMIT 1");
  return parseJsonObject(res.rows[0]?.value) || null;
};

const getAuditLogs = async (limit = 50) => {
  const res = await db.execute({
    sql: "SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?",
    args: [Math.min(Number(limit) || 50, AUDIT_LOG_LIMIT)],
  });
  return res.rows.map((row) => ({
    id: row.id,
    action: row.action,
    details: row.details,
    table_number: row.table_number,
    origin: row.origin || 'pdv',
    author_name: row.author_name,
    timestamp: row.timestamp,
  }));
};

const getActiveOrdersByTable = async () => {
  const res = await db.execute(`
    SELECT oi.*, o.table_id, m.name, m.category_id, c.name as category_name
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    LEFT JOIN menu m ON oi.product_id = m.id
    LEFT JOIN categories c ON m.category_id = c.id
    WHERE o.status != 'closed'
  `);

  const ordersByTable = {};
  res.rows.forEach((row) => {
    if (!ordersByTable[row.table_id]) ordersByTable[row.table_id] = [];
    ordersByTable[row.table_id].push({
      id: row.id,
      orderId: row.order_id,
      productId: row.product_id,
      categoryId: row.category_id,
      categoryName: row.category_name,
      name: row.name || '',
      price: Number(row.price_at_time || 0),
      quantity: Number(row.quantity || 0),
      selectedModifiers: parseJsonArray(row.selected_modifiers),
      notes: row.notes || '',
    });
  });
  return ordersByTable;
};

const getTables = async () => {
  let tableRes = await db.execute("SELECT * FROM tables ORDER BY CAST(number AS INTEGER) ASC");
  if (tableRes.rows.length < 50) {
    const values = [];
    const placeholders = [];
    for (let i = tableRes.rows.length + 1; i <= 50; i++) {
      placeholders.push('(?, ?, ?)');
      values.push(String(i), String(i), 'available');
    }
    if (placeholders.length > 0) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO tables (id, number, status) VALUES ${placeholders.join(', ')}`,
        args: values,
      });
      tableRes = await db.execute("SELECT * FROM tables ORDER BY CAST(number AS INTEGER) ASC");
    }
  }

  const ordersByTable = await getActiveOrdersByTable();
  return tableRes.rows.map((row) => ({
    id: row.id,
    number: Number(row.number),
    status: row.status,
    orders: ordersByTable[row.id] || [],
    cart: [],
    lastActivity: row.last_activity || new Date().toISOString(),
  })).sort((a, b) => a.number - b.number);
};

const ensureDefaultSellers = async () => {
  const defaults = [
    { id: 'admin-bootstrap', name: 'Admin Full', nickname: 'Admin', role: 'gerente', permission: 'admin', pin: BOOTSTRAP_ADMIN_PIN },
    { id: 'manager-default', name: 'Gerente', nickname: 'Gerente', role: 'gerente', permission: 'manager', pin: DEFAULT_MANAGER_PIN },
    { id: 'operator-default', name: 'Operador', nickname: 'Operador', role: 'atendente', permission: 'operator', pin: DEFAULT_OPERATOR_PIN },
  ].filter((seller) => seller.pin);

  const existing = await getSellers({ includePins: true });
  for (const seller of defaults) {
    if (existing.some((item) => item.id === seller.id)) continue;
    await db.execute({
      sql: "INSERT INTO sellers (id, name, nickname, status, role, permission, pin) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [seller.id, seller.name, seller.nickname, 'active', seller.role, seller.permission, hashPin(seller.pin)],
    });
  }
};

let defaultSellersReadyPromise = null;
const ensureDefaultSellersReady = () => {
  if (!defaultSellersReadyPromise) {
    defaultSellersReadyPromise = ensureDefaultSellers().catch((error) => {
      defaultSellersReadyPromise = null;
      throw error;
    });
  }
  return defaultSellersReadyPromise;
};

const filterSnapshotForContext = (snapshot, { view = 'pdv', session = null } = {}) => {
  const safeView = ['tablet', 'qr', 'kitchen', 'pdv', 'admin'].includes(view) ? view : 'pdv';
  const canViewSales = canSession(session, 'viewSalesTotals');
  const canManageTeam = canSession(session, 'manageTeam');

  if (safeView === 'tablet' || safeView === 'qr') {
    return {
      ...snapshot,
      sellers: [],
      serviceRequests: [],
      closedBills: [],
      auditLogs: [],
    };
  }

  if (safeView === 'kitchen') {
    return {
      ...snapshot,
      sellers: [],
      serviceRequests: [],
      closedBills: [],
      auditLogs: [],
      savedSettings: snapshot.savedSettings
        ? { kitchen: snapshot.savedSettings.kitchen }
        : null,
    };
  }

  return {
    ...snapshot,
    sellers: canManageTeam
      ? snapshot.sellers
      : snapshot.sellers.map((seller) => ({
          id: seller.id,
          name: seller.name,
          nickname: seller.nickname,
          status: seller.status,
          role: seller.role,
          permission: seller.permission,
          pin: '',
        })),
    closedBills: canViewSales ? snapshot.closedBills : [],
    auditLogs: canViewSales ? snapshot.auditLogs : [],
  };
};

const getRestrictedSnapshot = (view = 'pdv') => ({
  catalogData: {
    categories: [],
    menuItems: [],
    modifierGroups: [],
    productMapping: {},
    categoryMapping: {},
    catalogVersion: 'restricted',
  },
  catalogVersion: 'restricted',
  sellers: [],
  kitchenData: {
    orders: [],
    serverNow: new Date().toISOString(),
  },
  serviceRequests: [],
  closedBills: [],
  savedSettings: null,
  tables: [],
  auditLogs: [],
  accessRestricted: true,
  view,
});

const getAppSnapshot = async ({ includeCatalog = true, includeAuditLimit = 50, view = 'pdv', session = null, operationAccessAllowed = true } = {}) => {
  if (!operationAccessAllowed && !isAdminSession(session)) {
    return getRestrictedSnapshot(view);
  }

  await ensureDatabaseReady();
  const safeView = ['tablet', 'qr', 'kitchen', 'pdv', 'admin'].includes(view) ? view : 'pdv';
  const needsOperationalPanel = safeView === 'pdv' || safeView === 'admin';
  const needsSellers = needsOperationalPanel;
  const needsSalesData = needsOperationalPanel && canSession(session, 'viewSalesTotals');
  if (needsSellers) await ensureDefaultSellersReady();
  const [catalogData, sellers, kitchenData, serviceRequests, closedBills, savedSettings, tables, auditLogs, catalogVersion] = await Promise.all([
    includeCatalog ? getCatalogData() : Promise.resolve(null),
    needsSellers ? getSellers() : Promise.resolve([]),
    getKitchenOrders(),
    needsOperationalPanel ? getServiceRequests() : Promise.resolve([]),
    needsSalesData ? getClosedBills() : Promise.resolve([]),
    getSettings(),
    getTables(),
    needsSalesData ? getAuditLogs(includeAuditLimit) : Promise.resolve([]),
    getCatalogVersion(),
  ]);

  return filterSnapshotForContext({
    catalogData,
    catalogVersion,
    sellers,
    kitchenData,
    serviceRequests,
    closedBills,
    savedSettings,
    tables,
    auditLogs,
  }, { view, session });
};

const login = async ({ pin, sellerId }, { operationAccessAllowed = true, req = null } = {}) => {
  await ensureDatabaseReady();
  await ensureDefaultSellersReady();
  const activeSellers = (await getSellers({ includePins: true }))
    .filter((seller) => seller.status === 'active' && (!sellerId || seller.id === sellerId));
  let blockedNonAdminMatch = false;

  if (activeSellers.length === 0 && BOOTSTRAP_ADMIN_PIN && pin === BOOTSTRAP_ADMIN_PIN) {
    const seller = {
      id: 'master',
      name: 'Admin Mestre',
      status: 'active',
      role: 'gerente',
      permission: 'admin',
      pin: '',
    };
    return {
      seller,
      sessionToken: createSessionToken(seller),
    };
  }

  for (const seller of activeSellers) {
    const storedPin = seller.pin || '';
    const isMatch = isLegacyPlainPin(storedPin) ? storedPin === pin : storedPin === hashPin(pin);
    if (!isMatch) continue;
    const safeSeller = toSessionSeller(seller);

    if (!operationAccessAllowed && !isAdminSession(safeSeller)) {
      blockedNonAdminMatch = true;
      if (req && isOperationIpRestricted()) {
        console.warn(`Blocked non-admin login outside operation IP: ${getClientIp(req)} seller=${seller.id}`);
      }
      continue;
    }

    if (isLegacyPlainPin(storedPin)) {
      await updateSellerPin({ id: seller.id, pin: hashPin(pin) });
    }

    return {
      seller: safeSeller,
      sessionToken: createSessionToken(safeSeller),
    };
  }

  if (!operationAccessAllowed && isAdminBypassPin(pin)) {
    const seller = {
      id: 'admin-bypass',
      name: 'Admin Full',
      status: 'active',
      role: 'gerente',
      permission: 'admin',
      pin: '',
    };
    return {
      seller,
      sessionToken: createSessionToken(seller),
    };
  }

  return { seller: null, sessionToken: null, accessRestricted: blockedNonAdminMatch };
};

const validateTabletSetupPin = async ({ pin }, { operationAccessAllowed = true } = {}) => ({
  valid: operationAccessAllowed && String(pin || '') === TABLET_SETUP_PIN,
});

const resolveOSContext = async () => {
  let empresaId = OS_EMPRESA_ID;
  if (!empresaId) {
    const empresaRes = await db.execute("SELECT id FROM empresas WHERE slug = 'becoartes' LIMIT 1");
    empresaId = empresaRes.rows[0]?.id || '';
  }

  if (!empresaId) throw new Error('Empresa do OS não encontrada.');

  let userId = OS_SYSTEM_USER_ID;
  if (!userId) {
    const userRes = await db.execute({
      sql: "SELECT id FROM users WHERE empresa_id = ? AND role IN ('admin', 'super_admin') ORDER BY created_at ASC LIMIT 1",
      args: [empresaId],
    });
    userId = userRes.rows[0]?.id || '';
  }

  if (!userId) throw new Error('Usuário responsável do OS não encontrado.');
  return { empresaId, userId, slug: OS_TENANT_SLUG };
};

const createOSNotification = async ({ empresaId, title, message, type = 'info', link = null }) => {
  await db.execute({
    sql: "INSERT INTO notificacoes (id, empresa_id, usuario_id, titulo, mensagem, tipo, lida, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [createId(), empresaId, null, title, message, type, 0, link, osTimestamp()],
  });
};

const safeCreateOSNotification = async ({ title, message, type = 'info', link = null, context = null }) => {
  try {
    const osContext = context || await resolveOSContext();
    await createOSNotification({
      empresaId: osContext.empresaId,
      title,
      message,
      type,
      link: link || `/${osContext.slug}/dinheiro`,
    });
    return { sent: true };
  } catch (error) {
    console.error('OS notification skipped:', title, error);
    return {
      sent: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const getActiveOrderItemsForTable = async (tableId) => {
  const res = await db.execute({
    sql: `
      SELECT
        oi.id,
        oi.order_id as orderId,
        oi.product_id as productId,
        COALESCE(m.name, '') as name,
        COALESCE(m.remote_stock_id, '') as remoteStockId,
        oi.quantity,
        oi.selected_modifiers as selectedModifiers
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN menu m ON oi.product_id = m.id
      WHERE o.table_id = ? AND o.status != 'closed'
    `,
    args: [tableId],
  });

  return res.rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    productId: row.productId,
    name: row.name || '',
    remoteStockId: row.remoteStockId || '',
    quantity: Number(row.quantity || 0),
    selectedModifiers: parseJsonArray(row.selectedModifiers),
  }));
};

const claimIntegrationEvent = async (id, type, tableId, payload) => {
  const now = Date.now();
  const inserted = await db.execute({
    sql: `
      INSERT OR IGNORE INTO integration_events
        (id, type, status, table_id, payload, error, created_at, updated_at)
      VALUES (?, ?, 'processing', ?, ?, NULL, ?, ?)
    `,
    args: [id, type, tableId, JSON.stringify(payload), now, now],
  });

  if (Number(inserted.rowsAffected || 0) > 0) return true;

  const existing = await db.execute({
    sql: "SELECT status, updated_at FROM integration_events WHERE id = ? LIMIT 1",
    args: [id],
  });
  const status = existing.rows[0]?.status;
  const updatedAt = Number(existing.rows[0]?.updated_at || 0);

  if (status === 'completed') return false;

  if (status === 'failed' || (status === 'processing' && updatedAt < now - PROCESSING_STALE_MS)) {
    const reclaimed = await db.execute({
      sql: `
        UPDATE integration_events
        SET status = 'processing', payload = ?, error = NULL, updated_at = ?
        WHERE id = ? AND (status = 'failed' OR (status = 'processing' AND updated_at < ?))
      `,
      args: [JSON.stringify(payload), now, id, now - PROCESSING_STALE_MS],
    });
    return Number(reclaimed.rowsAffected || 0) > 0;
  }

  return false;
};

const failIntegrationEvent = async (id, error) => {
  await db.execute({
    sql: "UPDATE integration_events SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
    args: [error instanceof Error ? error.message : String(error), Date.now(), id],
  });
};

const findStockProduct = async (empresaId, candidates) => {
  const ids = [candidates.id].filter(Boolean);
  for (const id of ids) {
    const byId = await db.execute({
      sql: "SELECT * FROM estoque_produtos WHERE empresa_id = ? AND ativo = 1 AND id = ? LIMIT 1",
      args: [empresaId, id],
    });
    if (byId.rows[0]) return byId.rows[0];
  }

  if (!candidates.name?.trim()) return null;

  const byName = await db.execute({
    sql: "SELECT * FROM estoque_produtos WHERE empresa_id = ? AND ativo = 1 AND lower(trim(nome)) = lower(trim(?)) LIMIT 1",
    args: [empresaId, candidates.name],
  });

  return byName.rows[0] || null;
};

const notifyOrderItemCancelled = async ({ tableNumber, itemName, quantity, sellerName, sellerPermission }) => {
  return safeCreateOSNotification({
    title: 'Item cancelado no PDV',
    message: `Mesa ${tableNumber}: ${quantity}x ${itemName} cancelado por ${sellerName} (${sellerPermission}).`,
    type: 'warning',
    link: `/${OS_TENANT_SLUG}/dinheiro`,
  });
};

const notifyCloseBillSyncFailure = async ({ tableNumber, integrationId, error }) => {
  return safeCreateOSNotification({
    title: 'Erro ao fechar conta no PDV',
    message: `Mesa ${tableNumber}: falha no fechamento ${integrationId}. ${error instanceof Error ? error.message : String(error)}`,
    type: 'error',
    link: `/${OS_TENANT_SLUG}/dinheiro`,
  });
};

const deleteOrderItem = async ({ itemId, cancelContext }) => {
  const itemRes = await db.execute({ sql: "SELECT order_id FROM order_items WHERE id = ? LIMIT 1", args: [itemId] });
  const orderId = itemRes.rows[0]?.order_id;

  await db.execute({ sql: "DELETE FROM order_items WHERE id = ?", args: [itemId] });

  if (orderId) {
    const remainingRes = await db.execute({
      sql: "SELECT quantity, price_at_time, selected_modifiers FROM order_items WHERE order_id = ?",
      args: [orderId],
    });

    const remainingItems = remainingRes.rows.map((row) => ({
      price: Number(row.price_at_time || 0),
      quantity: Number(row.quantity || 0),
      selectedModifiers: parseJsonArray(row.selected_modifiers),
    }));

    if (remainingItems.length === 0) {
      await db.execute({ sql: "UPDATE orders SET total = 0, status = 'closed' WHERE id = ?", args: [orderId] });
    } else {
      const total = remainingItems.reduce((acc, item) => {
        const modifiersTotal = item.selectedModifiers.reduce((sum, modifier) => sum + Number(modifier.price || 0), 0);
        return acc + (Number(item.price || 0) + modifiersTotal) * Number(item.quantity || 0);
      }, 0);

      await db.execute({
        sql: "UPDATE orders SET total = ? WHERE id = ?",
        args: [total, orderId],
      });
    }
  }

  if (cancelContext) {
    void notifyOrderItemCancelled({
      tableNumber: Number(cancelContext.tableNumber || 0),
      itemName: String(cancelContext.itemName || 'Item'),
      quantity: Number(cancelContext.quantity || 0),
      sellerName: String(cancelContext.sellerName || 'Sistema'),
      sellerPermission: String(cancelContext.sellerPermission || 'standard'),
    });
  }

  return { orderId: orderId || null };
};

const sendToKitchen = async ({ orderId, tableId, total, origin, sellerId, items }) => {
  requireString(orderId, 'orderId');
  requireString(tableId, 'tableId');
  const safeOrigin = origin === 'tablet' || origin === 'qr' ? origin : 'pdv';
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) throw new Error('Pedido sem itens.');

  const batch = [
    {
      sql: "INSERT INTO orders (id, table_id, total, status, origin, created_by_id) VALUES (?, ?, ?, ?, ?, ?)",
      args: [orderId, tableId, requireNumber(total, 'total'), 'pending', safeOrigin, sellerId || null],
    },
    ...safeItems.map((item) => ({
      sql: "INSERT INTO order_items (id, order_id, product_id, quantity, price_at_time, selected_modifiers, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        requireString(item.id, 'item.id'),
        orderId,
        requireString(item.productId, 'item.productId'),
        requireNumber(item.quantity, 'item.quantity'),
        requireNumber(item.price, 'item.price'),
        JSON.stringify(item.selectedModifiers || []),
        item.notes || '',
      ],
    })),
    {
      sql: "UPDATE tables SET status = ? WHERE id = ?",
      args: ['ordering', tableId],
    },
  ];

  const requestId = `new_order_${orderId}`;
  const itemsList = safeItems.map((item) => `${item.quantity}x ${item.name}`).join(', ');
  batch.push({
    sql: "INSERT OR IGNORE INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, ?, ?, ?)",
    args: [requestId, tableId, 'new_order', 'pending', itemsList],
  });

  await db.batch(batch, 'write');

  return {
    request: {
      id: requestId,
      tableId,
      type: 'new_order',
      message: itemsList,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  };
};

const updateOrderStatus = async ({ orderId, status }) => {
  requireString(orderId, 'orderId');
  const safeStatus = ['pending', 'preparing', 'ready', 'closed'].includes(status) ? status : null;
  if (!safeStatus) throw new Error('Status inválido.');

  await db.execute({
    sql: "UPDATE orders SET status = ? WHERE id = ?",
    args: [safeStatus, orderId],
  });

  if (safeStatus !== 'ready') return { request: null };

  const orderRes = await db.execute({
    sql: `
      SELECT o.table_id, t.number as tableNumber
      FROM orders o
      LEFT JOIN tables t ON t.id = o.table_id
      WHERE o.id = ?
      LIMIT 1
    `,
    args: [orderId],
  });
  const order = orderRes.rows[0];
  if (!order) return { request: null };

  const itemsRes = await db.execute({
    sql: `
      SELECT oi.quantity, COALESCE(m.name, 'Item') as name
      FROM order_items oi
      LEFT JOIN menu m ON oi.product_id = m.id
      WHERE oi.order_id = ?
    `,
    args: [orderId],
  });
  const itemsList = itemsRes.rows.map((item) => `${item.quantity}x ${item.name}`).join(', ');
  const id = createId();

  await db.execute({
    sql: "INSERT INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, ?, ?, ?)",
    args: [id, order.table_id, 'order_ready', 'pending', itemsList],
  });

  return {
    request: {
      id,
      tableId: order.table_id,
      tableNumber: Number(order.tableNumber || 0),
      type: 'order_ready',
      message: itemsList,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  };
};

const bumpCatalogVersion = async () => {
  const version = String(Date.now());
  await db.execute({
    sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('catalog_version', ?, CURRENT_TIMESTAMP)",
    args: [version],
  });
  catalogCache = null;
  return version;
};

const upsertCategory = async ({ category }) => {
  const cat = category || {};
  await db.execute({
    sql: "INSERT OR REPLACE INTO categories (id, name, schedule_config, sort_order, visible) VALUES (?, ?, ?, ?, ?)",
    args: [
      requireString(cat.id, 'category.id'),
      requireString(cat.name, 'category.name'),
      cat.schedule ? JSON.stringify(cat.schedule) : null,
      Number(cat.sortOrder || 0),
      cat.visible ? 1 : 0,
    ],
  });
  return { catalogVersion: await bumpCatalogVersion() };
};

const deleteCategory = async ({ id }) => {
  requireString(id, 'id');
  await db.batch([
    { sql: "DELETE FROM categories WHERE id = ?", args: [id] },
    { sql: "UPDATE menu SET category_id = NULL WHERE category_id = ?", args: [id] },
  ], 'write');
  return { catalogVersion: await bumpCatalogVersion() };
};

const toggleCategoryVisibility = async ({ id, visible }) => {
  requireString(id, 'id');
  await db.execute({
    sql: "UPDATE categories SET visible = ? WHERE id = ?",
    args: [visible ? 1 : 0, id],
  });
  return { catalogVersion: await bumpCatalogVersion() };
};

const upsertProduct = async ({ product }, session = null) => {
  const p = product || {};
  const productId = requireString(p.id, 'product.id');
  const existing = await db.execute({
    sql: "SELECT price FROM menu WHERE id = ? LIMIT 1",
    args: [productId],
  });
  if (existing.rows[0] && !canSession(session, 'editProductPrice')) {
    const currentPrice = Number(existing.rows[0].price || 0);
    const nextPrice = Number(p.price || 0);
    if (Math.abs(currentPrice - nextPrice) > 0.001) {
      const error = new Error('Permissão insuficiente para alterar preço.');
      error.statusCode = 403;
      throw error;
    }
  }
  await db.execute({
    sql: "INSERT OR REPLACE INTO menu (id, name, description, price, category, category_id, image, visible, erp_code, remote_stock_id, schedule_config, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      productId,
      requireString(p.name, 'product.name'),
      p.description || '',
      requireNumber(p.price, 'product.price'),
      p.categoryId || '',
      p.categoryId || '',
      p.image || '',
      p.visible ? 1 : 0,
      p.erpCode || null,
      p.remoteStockId || null,
      p.schedule ? JSON.stringify(p.schedule) : null,
      Number(p.cost || 0),
    ],
  });

  if (Array.isArray(p.modifierGroups)) {
    const batch = [
      { sql: "DELETE FROM product_modifier_groups WHERE product_id = ?", args: [productId] },
      ...p.modifierGroups.map((group, index) => ({
        sql: "INSERT INTO product_modifier_groups (product_id, group_id, sort_order) VALUES (?, ?, ?)",
        args: [productId, requireString(group.id, 'modifierGroup.id'), index],
      })),
    ];
    await db.batch(batch, 'write');
  }

  return { catalogVersion: await bumpCatalogVersion() };
};

const deleteProduct = async ({ id }) => {
  requireString(id, 'id');
  await db.execute({ sql: "DELETE FROM menu WHERE id = ?", args: [id] });
  return { catalogVersion: await bumpCatalogVersion() };
};

const toggleProductVisibility = async ({ id, visible }) => {
  requireString(id, 'id');
  await db.execute({
    sql: "UPDATE menu SET visible = ? WHERE id = ?",
    args: [visible ? 1 : 0, id],
  });
  return { catalogVersion: await bumpCatalogVersion() };
};

const saveModifierGroup = async ({ group }) => {
  const safeGroup = group || {};
  const groupId = requireString(safeGroup.id, 'group.id');
  await db.execute({
    sql: "INSERT OR REPLACE INTO modifier_groups (id, name, description, min_choices, max_choices, is_required, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      groupId,
      requireString(safeGroup.name, 'group.name'),
      safeGroup.description || '',
      Number(safeGroup.minChoices || 0),
      Number(safeGroup.maxChoices || 1),
      safeGroup.isRequired ? 1 : 0,
      safeGroup.status || 'active',
    ],
  });

  if (Array.isArray(safeGroup.modifiers)) {
    const batch = [
      { sql: "DELETE FROM modifiers WHERE group_id = ?", args: [groupId] },
      ...safeGroup.modifiers.map((modifier, index) => ({
        sql: "INSERT INTO modifiers (id, group_id, name, price, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        args: [
          modifier.id || createId(),
          groupId,
          requireString(modifier.name, 'modifier.name'),
          Number(modifier.price || 0),
          modifier.status || 'active',
          index,
        ],
      })),
    ];
    await db.batch(batch, 'write');
  }

  return { catalogVersion: await bumpCatalogVersion() };
};

const deleteModifierGroup = async ({ id }) => {
  requireString(id, 'id');
  await db.execute({ sql: "UPDATE modifier_groups SET status = 'inactive' WHERE id = ?", args: [id] });
  return { catalogVersion: await bumpCatalogVersion() };
};

const linkModifierGroup = async ({ scope, targetId, groupId, linked }) => {
  requireString(targetId, 'targetId');
  requireString(groupId, 'groupId');
  const tableName = scope === 'category' ? 'category_modifier_groups' : 'product_modifier_groups';
  const idColumn = scope === 'category' ? 'category_id' : 'product_id';

  if (linked) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO ${tableName} (${idColumn}, group_id) VALUES (?, ?)`,
      args: [targetId, groupId],
    });
  } else {
    await db.execute({
      sql: `DELETE FROM ${tableName} WHERE ${idColumn} = ? AND group_id = ?`,
      args: [targetId, groupId],
    });
  }

  return { catalogVersion: await bumpCatalogVersion() };
};

const saveSettings = async ({ settings }) => {
  await db.execute({
    sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('settings', ?, CURRENT_TIMESTAMP)",
    args: [JSON.stringify(settings || {})],
  });
  return { saved: true };
};

const addAuditLog = async ({ id, action, details = '', tableNumber = null, origin = 'pdv', authorName = 'Sistema', timestamp }) => {
  const logId = id || createId();
  const createdAt = timestamp || new Date().toISOString();
  await db.execute({
    sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [logId, requireString(action, 'action'), details, tableNumber, origin, authorName, createdAt],
  });
  return {
    log: {
      id: logId,
      action,
      details,
      table_number: tableNumber,
      origin,
      author_name: authorName,
      timestamp: createdAt,
    },
  };
};

const createServiceRequest = async ({ id, tableId, type, message = '' }) => {
  const requestId = id || createId();
  const tableRes = await db.execute({ sql: "SELECT number FROM tables WHERE id = ? LIMIT 1", args: [tableId] });
  const tableNumber = Number(tableRes.rows[0]?.number || 0);
  await db.execute({
    sql: "INSERT INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, ?, ?, ?)",
    args: [requestId, requireString(tableId, 'tableId'), requireString(type, 'type'), 'pending', message],
  });
  return {
    request: {
      id: requestId,
      tableId,
      tableNumber,
      type,
      message,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  };
};

const resolveServiceRequest = async ({ requestId, tableId, type, message, currentStatus }) => {
  const newStatus = currentStatus === 'resolved' ? 'pending' : 'resolved';
  if (type === 'new_order') {
    await db.execute({
      sql: "UPDATE service_requests SET status = ? WHERE (id = ? OR (table_id = ? AND type = 'new_order' AND message = ? AND status = 'pending'))",
      args: [newStatus, requestId, tableId, message],
    });
  } else {
    await db.execute({
      sql: "UPDATE service_requests SET status = ? WHERE id = ?",
      args: [newStatus, requestId],
    });
  }
  return { status: newStatus };
};

const requestBill = async ({ tableId }) => {
  await db.execute({ sql: "UPDATE tables SET status = ? WHERE id = ?", args: ['bill_requested', tableId] });
  return { status: 'bill_requested' };
};

const updateTableStatus = async ({ tableId, status }) => {
  requireString(tableId, 'tableId');
  const allowed = new Set(['available', 'ordering', 'waiting', 'paid', 'bill_requested']);
  if (!allowed.has(status)) throw new Error('Status de mesa inválido.');
  await db.execute({ sql: "UPDATE tables SET status = ? WHERE id = ?", args: [status, tableId] });
  return { status };
};

const openTable = async ({ tableId, wasAvailable }) => {
  requireString(tableId, 'tableId');
  const batch = [];
  if (wasAvailable) {
    batch.push(
      { sql: "UPDATE orders SET status = 'closed' WHERE table_id = ? AND status != 'closed'", args: [tableId] },
      { sql: "UPDATE service_requests SET status = 'resolved' WHERE table_id = ? AND status != 'resolved'", args: [tableId] },
    );
  }
  batch.push({ sql: "UPDATE tables SET status = 'ordering', last_activity = CURRENT_TIMESTAMP WHERE id = ?", args: [tableId] });
  await db.batch(batch, 'write');
  return { status: 'ordering' };
};

const transferTable = async ({ fromTableId, toTableId }) => {
  requireString(fromTableId, 'fromTableId');
  requireString(toTableId, 'toTableId');
  await db.batch([
    { sql: "UPDATE orders SET table_id = ? WHERE table_id = ? AND status != 'closed'", args: [toTableId, fromTableId] },
    { sql: "UPDATE service_requests SET table_id = ? WHERE table_id = ? AND status != 'resolved'", args: [toTableId, fromTableId] },
    { sql: "UPDATE tables SET status = 'available' WHERE id = ?", args: [fromTableId] },
    { sql: "UPDATE tables SET status = 'ordering' WHERE id = ?", args: [toTableId] },
  ], 'write');
  return { moved: true };
};

const joinTables = async ({ tableIds, targetTableId }) => {
  if (!Array.isArray(tableIds) || tableIds.length === 0) throw new Error('tableIds inválido.');
  requireString(targetTableId, 'targetTableId');
  const sourceIds = tableIds.filter((id) => id !== targetTableId);
  const batch = [
    ...sourceIds.map((id) => ({ sql: "UPDATE orders SET table_id = ? WHERE table_id = ? AND status != 'closed'", args: [targetTableId, id] })),
    ...sourceIds.map((id) => ({ sql: "UPDATE service_requests SET table_id = ? WHERE table_id = ? AND status != 'resolved'", args: [targetTableId, id] })),
    ...sourceIds.map((id) => ({ sql: "UPDATE tables SET status = 'available' WHERE id = ?", args: [id] })),
    { sql: "UPDATE tables SET status = 'ordering' WHERE id = ?", args: [targetTableId] },
  ];
  await db.batch(batch, 'write');
  return { joined: true };
};

const openShift = async ({ id, openingBalance }) => {
  const shiftId = id || createId();
  await db.execute({
    sql: "INSERT INTO shifts (id, status, opening_balance) VALUES (?, ?, ?)",
    args: [shiftId, 'open', requireNumber(openingBalance, 'openingBalance')],
  });
  return { shift: { id: shiftId, status: 'open', openingBalance: Number(openingBalance) } };
};

const closeShift = async ({ id, closingBalance }) => {
  requireString(id, 'id');
  await db.execute({
    sql: "UPDATE shifts SET status = 'closed', closing_balance = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [requireNumber(closingBalance, 'closingBalance'), id],
  });
  return { closed: true };
};

const addSeller = async ({ seller }) => {
  const safeSeller = seller || {};
  const pin = requireString(safeSeller.pin, 'seller.pin');
  await db.execute({
    sql: "INSERT INTO sellers (id, name, nickname, status, role, permission, pin) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      requireString(safeSeller.id, 'seller.id'),
      requireString(safeSeller.name, 'seller.name'),
      safeSeller.nickname || '',
      safeSeller.status || 'active',
      safeSeller.role || 'atendente',
      safeSeller.permission || 'operator',
      isLegacyPlainPin(pin) ? hashPin(pin) : pin,
    ],
  });
  return { saved: true };
};

const updateSellerPin = async ({ id, pin }) => {
  requireString(id, 'id');
  const safePin = requireString(pin, 'pin');
  await db.execute({
    sql: "UPDATE sellers SET pin = ? WHERE id = ?",
    args: [isLegacyPlainPin(safePin) ? hashPin(safePin) : safePin, id],
  });
  return { updated: true };
};

const deleteSeller = async ({ id }) => {
  requireString(id, 'id');
  const hasBills = await db.execute({ sql: "SELECT id FROM closed_bills WHERE seller_id = ? LIMIT 1", args: [id] });
  if (hasBills.rows.length > 0) {
    return { deleted: false, reason: 'seller_has_bills' };
  }
  await db.execute({ sql: "DELETE FROM sellers WHERE id = ?", args: [id] });
  return { deleted: true };
};

const updateSellerStatus = async ({ id, status }) => {
  requireString(id, 'id');
  const safeStatus = status === 'inactive' ? 'inactive' : 'active';
  await db.execute({
    sql: "UPDATE sellers SET status = ? WHERE id = ?",
    args: [safeStatus, id],
  });
  return { status: safeStatus };
};

const syncBeveragesFromInventory = async () => {
  const stockRes = await db.execute("SELECT * FROM estoque_produtos WHERE categoria = 'Bebidas' AND ativo = 1");
  let categoryRes = await db.execute("SELECT id FROM categories WHERE name = 'Bebidas' LIMIT 1");
  let categoryId = categoryRes.rows[0]?.id;

  if (!categoryId) {
    categoryId = createId();
    await db.execute({
      sql: "INSERT INTO categories (id, name, sort_order, visible) VALUES (?, 'Bebidas', 0, 1)",
      args: [categoryId],
    });
  }

  const batch = [];
  for (const row of stockRes.rows) {
    const remoteId = row.id;
    const existing = await db.execute({
      sql: "SELECT id FROM menu WHERE remote_stock_id = ? LIMIT 1",
      args: [remoteId],
    });
    if (existing.rows[0]) {
      batch.push({
        sql: "UPDATE menu SET name = ?, price = ? WHERE remote_stock_id = ?",
        args: [row.nome, Number(row.preco_venda || 0), remoteId],
      });
    } else {
      batch.push({
        sql: "INSERT INTO menu (id, name, description, price, category_id, image, visible, erp_code, remote_stock_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          createId(),
          row.nome,
          'Sincronizado do Estoque OS',
          Number(row.preco_venda || 0),
          categoryId,
          'https://images.unsplash.com/photo-1544145945-f904253db0ad?w=400',
          1,
          null,
          remoteId,
        ],
      });
    }
  }

  if (batch.length > 0) await db.batch(batch, 'write');
  return { catalogVersion: await bumpCatalogVersion(), count: stockRes.rows.length };
};

const closeBillWithInventorySync = async (data) => {
  const tableId = requireString(data.tableId, 'tableId');
  const activeOrderItems = await getActiveOrderItemsForTable(tableId);
  const orderIds = Array.from(new Set(activeOrderItems.map((item) => item.orderId))).sort();
  const integrationId = `pdv_close_${tableId}_${orderIds.join('_') || 'no_orders'}`;

  const claimed = await claimIntegrationEvent(integrationId, 'pdv_close_bill', tableId, {
    tableNumber: data.tableNumber,
    orderIds,
    total: data.total,
  });

  if (!claimed) {
    return {
      skipped: true,
      integrationId,
      closedBill: null,
      inventorySync: null,
    };
  }

  try {
    const closedAt = new Date();
    const closedBill = {
      ...data,
      id: integrationId,
      closedAt: closedAt.toISOString(),
    };
    let osContext = null;
    let inventorySyncError = null;
    let movementPlans = [];
    const result = { movementCount: 0, unmatched: [], insufficient: [], critical: [] };
    const baseReason = `Venda PDV Mesa ${data.tableNumber} | Fechamento ${integrationId}`;

    try {
      osContext = await resolveOSContext();
    } catch (error) {
      inventorySyncError = error;
      result.unmatched.push(`Sincronização OS indisponível: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (osContext) {
      const { empresaId } = osContext;
      try {
        for (const item of activeOrderItems) {
          const requestedQuantity = toStockAmount(item.quantity);
          const productStock = await findStockProduct(empresaId, {
            id: item.remoteStockId || item.productId,
            name: item.name,
          });

          if (!productStock) {
            result.unmatched.push(`${item.quantity}x ${item.name}`);
          } else {
            const currentQuantity = toStockAmount(productStock.quantidade_atual);
            const nextQuantity = Math.max(0, currentQuantity - requestedQuantity);
            if (requestedQuantity > currentQuantity) result.insufficient.push(`${item.name} (estoque insuficiente)`);
            if (nextQuantity <= toStockAmount(productStock.estoque_minimo)) result.critical.push(item.name);
            if (currentQuantity > 0 && requestedQuantity > 0) {
              movementPlans.push({
                movementId: createId(),
                stockId: productStock.id,
                stockName: productStock.nome || item.name,
                orderId: item.orderId,
                orderItemId: item.id,
                sourceItemId: item.productId,
                sourceItemKind: 'product',
                requestedQuantity,
                previousQuantity: currentQuantity,
                nextQuantity,
                reason: baseReason,
              });
            }
          }

          for (const modifier of item.selectedModifiers || []) {
            const modifierStock = await findStockProduct(empresaId, {
              id: modifier.id,
              name: modifier.name,
            });

            if (!modifierStock) continue;

            const currentQuantity = toStockAmount(modifierStock.quantidade_atual);
            const nextQuantity = Math.max(0, currentQuantity - requestedQuantity);
            if (requestedQuantity > currentQuantity) result.insufficient.push(`${modifier.name} (estoque insuficiente)`);
            if (nextQuantity <= toStockAmount(modifierStock.estoque_minimo)) result.critical.push(modifier.name);
            if (currentQuantity > 0 && requestedQuantity > 0) {
              movementPlans.push({
                movementId: createId(),
                stockId: modifierStock.id,
                stockName: modifierStock.nome || modifier.name,
                orderId: item.orderId,
                orderItemId: item.id,
                sourceItemId: modifier.id,
                sourceItemKind: 'modifier',
                requestedQuantity,
                previousQuantity: currentQuantity,
                nextQuantity,
                reason: `${baseReason} | Opcional ${modifier.name}`,
              });
            }
          }
        }
      } catch (error) {
        inventorySyncError = error;
        movementPlans = [];
        result.unmatched.push(`Falha parcial na baixa de estoque OS: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    result.movementCount = movementPlans.length;

    const now = osTimestamp();
    const empresaId = osContext?.empresaId || null;
    const userId = osContext?.userId || null;
    const slug = osContext?.slug || OS_TENANT_SLUG;
    const batch = [
      {
        sql: "INSERT OR REPLACE INTO closed_bills (id, table_id, table_number, seller_id, seller_name, subtotal, service_fee, discount, discount_reason, total, payments, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          integrationId,
          tableId,
          data.tableNumber,
          data.sellerId,
          data.sellerName,
          data.subtotal,
          data.serviceFee,
          data.discount,
          data.discountReason || null,
          data.total,
          JSON.stringify(data.payments),
          closedAt.toISOString(),
        ],
      },
    ];

    for (const movement of movementPlans) {
      batch.push(
        {
          sql: `
            INSERT OR IGNORE INTO estoque_movimentacoes
              (id, empresa_id, produto_id, tipo_movimentacao, quantidade, quantidade_anterior, quantidade_nova, motivo, responsavel_id, created_at, closed_bill_id, order_id, order_item_id, origem, integration_event_id, source_item_id, source_item_kind)
            SELECT ?, empresa_id, id, 'saida', MIN(quantidade_atual, ?), quantidade_atual, MAX(0, quantidade_atual - ?), ?, ?, ?, ?, ?, ?, 'pdv', ?, ?, ?
            FROM estoque_produtos
            WHERE id = ? AND empresa_id = ? AND ativo = 1 AND quantidade_atual > 0
          `,
          args: [
            movement.movementId,
            movement.requestedQuantity,
            movement.requestedQuantity,
            movement.reason,
            userId,
            now,
            integrationId,
            movement.orderId,
            movement.orderItemId,
            integrationId,
            movement.sourceItemId,
            movement.sourceItemKind,
            movement.stockId,
            empresaId,
          ],
        },
        {
          sql: `
            UPDATE estoque_produtos
            SET quantidade_atual = MAX(0, quantidade_atual - ?),
                status = CASE WHEN MAX(0, quantidade_atual - ?) <= estoque_minimo THEN 'Crítico' ELSE 'Saudável' END,
                updated_at = ?
            WHERE id = ? AND changes() > 0
          `,
          args: [movement.requestedQuantity, movement.requestedQuantity, now, movement.stockId],
        },
      );
    }

    batch.push(
      {
        sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name, timestamp) VALUES (?, 'bill_closed', ?, ?, 'pdv', ?, ?, ?)",
        args: [
          createId(),
          `Fechamento: R$ ${Number(data.total || 0).toFixed(2)} | Estoque: ${result.movementCount} movimentação(ões) | Evento: ${integrationId}`,
          String(data.tableNumber),
          data.sellerId,
          data.sellerName,
          closedAt.toISOString(),
        ],
      },
      {
        sql: "UPDATE tables SET status = 'available', last_activity = ? WHERE id = ?",
        args: [closedAt.toISOString(), tableId],
      },
      {
        sql: "UPDATE orders SET status = 'closed' WHERE table_id = ? AND status != 'closed'",
        args: [tableId],
      },
      {
        sql: "UPDATE service_requests SET status = 'resolved' WHERE table_id = ? AND status != 'resolved'",
        args: [tableId],
      },
    );

    batch.push({
      sql: "UPDATE integration_events SET status = 'completed', payload = ?, error = NULL, updated_at = ? WHERE id = ?",
      args: [
        JSON.stringify({
          tableNumber: data.tableNumber,
          orderIds,
          inventorySync: result,
          inventorySyncError: inventorySyncError instanceof Error ? inventorySyncError.message : inventorySyncError ? String(inventorySyncError) : null,
          movementIds: movementPlans.map((movement) => movement.movementId),
        }),
        Date.now(),
        integrationId,
      ],
    });

    await db.batch(batch, 'write');

    const notificationContext = osContext || null;
    const notificationTasks = [];
    if (result.unmatched.length > 0) {
      notificationTasks.push(safeCreateOSNotification({
        context: notificationContext,
        title: 'Itens do PDV sem vínculo de estoque',
        message: `Mesa ${data.tableNumber}: ${result.unmatched.slice(0, 8).join(', ')}`,
        type: 'alert',
        link: `/${slug}/estoque`,
      }));
    }

    if (result.insufficient.length > 0) {
      notificationTasks.push(safeCreateOSNotification({
        context: notificationContext,
        title: 'Estoque insuficiente em venda PDV',
        message: `Mesa ${data.tableNumber}: ${result.insufficient.slice(0, 8).join(', ')}`,
        type: 'warning',
        link: `/${slug}/estoque`,
      }));
    }

    if (result.critical.length > 0) {
      notificationTasks.push(safeCreateOSNotification({
        context: notificationContext,
        title: 'Estoque crítico após venda PDV',
        message: `Mesa ${data.tableNumber}: ${Array.from(new Set(result.critical)).slice(0, 8).join(', ')}`,
        type: 'warning',
        link: `/${slug}/estoque`,
      }));
    }

    if (inventorySyncError) {
      notificationTasks.push(safeCreateOSNotification({
        context: notificationContext,
        title: 'Sincronização de estoque do PDV falhou',
        message: `Mesa ${data.tableNumber}: conta fechada, mas o estoque OS não sincronizou. ${inventorySyncError instanceof Error ? inventorySyncError.message : String(inventorySyncError)}`,
        type: 'error',
        link: `/${slug}/estoque`,
      }));
    }

    notificationTasks.push(safeCreateOSNotification({
      context: notificationContext,
      title: 'Conta fechada no PDV',
      message: `Mesa ${data.tableNumber}: ${result.movementCount} movimentações de estoque registradas.`,
      type: result.unmatched.length > 0 || inventorySyncError ? 'warning' : 'info',
      link: `/${slug}/dinheiro`,
    }));
    void Promise.all(notificationTasks);

    return {
      skipped: false,
      integrationId,
      closedBill,
      inventorySync: result,
    };
  } catch (error) {
    await failIntegrationEvent(integrationId, error);
    await notifyCloseBillSyncFailure({ tableNumber: data.tableNumber, integrationId, error });
    throw error;
  }
};

const requireSession = (session) => {
  if (!session) {
    const error = new Error('Sessão obrigatória.');
    error.statusCode = 401;
    throw error;
  }
};

const requirePermission = (session, permission) => {
  requireSession(session);
  if (!canSession(session, permission)) {
    const error = new Error('Permissão insuficiente.');
    error.statusCode = 403;
    throw error;
  }
};

const allowPublicOperationalOrigin = (body) => body?.origin === 'tablet' || body?.origin === 'qr';

const enforceRouteAccess = (routeKey, body, session, { operationAccessAllowed = true, req = null } = {}) => {
  if (
    routeKey === 'GET /api/app/init'
    || routeKey === 'POST /api/app/sync'
    || routeKey === 'POST /api/auth/login'
  ) {
    return;
  }

  if (!operationAccessAllowed && !isAdminSession(session)) {
    if (routeKey === 'POST /api/tablet/setup-login') throwIpRestricted(req);
    throwIpRestricted(req);
  }

  if (routeKey === 'POST /api/tablet/setup-login') {
    return;
  }

  if (routeKey === 'POST /api/orders/send-to-kitchen') {
    if (!allowPublicOperationalOrigin(body)) requireSession(session);
    return;
  }

  if (routeKey === 'POST /api/service-requests' || routeKey === 'POST /api/tables/request-bill') {
    return;
  }

  if (routeKey === 'POST /api/orders/status') {
    return;
  }

  if (routeKey === 'POST /api/audit-logs') {
    if (body?.origin === 'tablet' || body?.origin === 'qr') return;
    requireSession(session);
    return;
  }

  const permissionByRoute = {
    'POST /api/order-items/delete': 'cancelTableItem',
    'POST /api/bills/close': 'closeBill',
    'POST /api/catalog/category': 'addProduct',
    'POST /api/catalog/category/delete': 'deleteProduct',
    'POST /api/catalog/category/visibility': 'toggleProductVisibility',
    'POST /api/catalog/product': 'addProduct',
    'POST /api/catalog/product/delete': 'deleteProduct',
    'POST /api/catalog/product/visibility': 'toggleProductVisibility',
    'POST /api/catalog/modifier-group': 'manageOptionals',
    'POST /api/catalog/modifier-group/delete': 'manageOptionals',
    'POST /api/catalog/modifier-group/link': 'manageOptionals',
    'POST /api/settings': 'manageSettings',
    'POST /api/audit-logs/list': 'viewSalesTotals',
    'POST /api/sellers': 'manageTeam',
    'POST /api/sellers/pin': 'manageTeam',
    'POST /api/sellers/delete': 'manageTeam',
    'POST /api/sellers/status': 'manageTeam',
    'POST /api/inventory/sync-beverages': 'addProduct',
  };

  const requiredPermission = permissionByRoute[routeKey];
  if (requiredPermission) {
    requirePermission(session, requiredPermission);
    return;
  }

  requireSession(session);
};

const handlers = {
  'GET /api/app/init': async (_body, context) => getAppSnapshot({
    includeCatalog: true,
    includeAuditLimit: 50,
    view: context.url.searchParams.get('view') || 'pdv',
    session: context.session,
    operationAccessAllowed: context.operationAccessAllowed,
  }),
  'POST /api/app/sync': async (body, context) => getAppSnapshot({
    includeCatalog: Boolean(body.includeCatalog),
    includeAuditLimit: 0,
    view: body.view || 'pdv',
    session: context.session,
    operationAccessAllowed: context.operationAccessAllowed,
  }),
  'POST /api/auth/login': async (body, context) => login(body, context),
  'POST /api/tablet/setup-login': async (body, context) => validateTabletSetupPin(body, context),
  'POST /api/audit-logs/list': async (body) => ({ auditLogs: await getAuditLogs(Number(body.limit || 100)) }),
  'POST /api/orders/send-to-kitchen': async (body) => sendToKitchen(body),
  'POST /api/orders/status': async (body) => updateOrderStatus(body),
  'POST /api/order-items/delete': async (body) => deleteOrderItem(body),
  'POST /api/bills/close': async (body) => closeBillWithInventorySync(body),
  'POST /api/catalog/category': async (body) => upsertCategory(body),
  'POST /api/catalog/category/delete': async (body) => deleteCategory(body),
  'POST /api/catalog/category/visibility': async (body) => toggleCategoryVisibility(body),
  'POST /api/catalog/product': async (body, context) => upsertProduct(body, context.session),
  'POST /api/catalog/product/delete': async (body) => deleteProduct(body),
  'POST /api/catalog/product/visibility': async (body) => toggleProductVisibility(body),
  'POST /api/catalog/modifier-group': async (body) => saveModifierGroup(body),
  'POST /api/catalog/modifier-group/delete': async (body) => deleteModifierGroup(body),
  'POST /api/catalog/modifier-group/link': async (body) => linkModifierGroup(body),
  'POST /api/settings': async (body) => saveSettings(body),
  'POST /api/audit-logs': async (body) => addAuditLog(body),
  'POST /api/service-requests': async (body) => createServiceRequest(body),
  'POST /api/service-requests/resolve': async (body) => resolveServiceRequest(body),
  'POST /api/tables/request-bill': async (body) => requestBill(body),
  'POST /api/tables/status': async (body) => updateTableStatus(body),
  'POST /api/tables/open': async (body) => openTable(body),
  'POST /api/tables/transfer': async (body) => transferTable(body),
  'POST /api/tables/join': async (body) => joinTables(body),
  'POST /api/shifts/open': async (body) => openShift(body),
  'POST /api/shifts/close': async (body) => closeShift(body),
  'POST /api/sellers': async (body) => addSeller(body),
  'POST /api/sellers/pin': async (body) => updateSellerPin(body),
  'POST /api/sellers/delete': async (body) => deleteSeller(body),
  'POST /api/sellers/status': async (body) => updateSellerStatus(body),
  'POST /api/inventory/sync-beverages': async () => syncBeveragesFromInventory(),
};

const handleApi = async (req, res, url) => {
  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, version: process.env.VITE_APP_VERSION || process.env.APP_VERSION || 'unknown' });
    return;
  }

  try {
    assertSameOrigin(req);
    const routeKey = `${req.method} ${url.pathname}`;
    const handler = handlers[routeKey];
    if (!handler) {
      sendJson(res, 404, { ok: false, error: 'API route not found' });
      return;
    }

    if (isPinRateLimited(req, url.pathname)) {
      sendJson(res, 429, { ok: false, error: 'Muitas tentativas de PIN. Aguarde 1 minuto.' });
      return;
    }

    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json')) {
      sendJson(res, 415, { ok: false, error: 'Content-Type precisa ser application/json' });
      return;
    }

    const body = req.method === 'GET' ? {} : await readJsonBody(req);
    const session = getSessionFromRequest(req);
    const operationAccessAllowed = isOperationIpAllowed(req) || isAdminSession(session);
    enforceRouteAccess(routeKey, body, session, { operationAccessAllowed, req });
    const data = await handler(body, { req, url, session, operationAccessAllowed });
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    console.error('BFF error:', error);
    sendJson(res, error.statusCode || 400, { ok: false, error: error instanceof Error ? error.message : 'Erro interno' });
  }
};

const serveStatic = async (req, res, url) => {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(distDir, normalized);

  if (!existsSync(filePath) || normalized.endsWith('/')) {
    filePath = join(distDir, 'index.html');
  }

  const ext = extname(filePath);
  const headers = {
    ...securityHeaders,
    'content-type': mimeTypes[ext] || 'application/octet-stream',
  };

  if (filePath.endsWith('index.html')) {
    headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
  } else {
    headers['cache-control'] = 'public, max-age=31536000, immutable';
  }

  try {
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  } catch {
    const fallback = await readFile(join(distDir, 'index.html'));
    res.writeHead(200, { ...securityHeaders, 'content-type': mimeTypes['.html'] });
    res.end(fallback);
  }
};

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  await serveStatic(req, res, url);
}).listen(port, () => {
  console.log(`Becoartes PDV BFF listening on :${port}`);
});
