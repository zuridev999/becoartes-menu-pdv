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
const ALLOWED_WEB_ORIGINS = (process.env.ALLOWED_WEB_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const SESSION_SECRET = process.env.BFF_SESSION_SECRET || process.env.JWT_SECRET || tursoAuthToken;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PROCESSING_STALE_MS = 10 * 60 * 1000;
const SERVICE_REQUEST_LIMIT = Number(process.env.SERVICE_REQUEST_LIMIT || 150);
const CLOSED_BILLS_LIMIT = Number(process.env.CLOSED_BILLS_LIMIT || 200);
const AUDIT_LOG_LIMIT = Number(process.env.AUDIT_LOG_LIMIT || 100);
const CASH_SANDBOX_MODE = process.env.CASH_SANDBOX_MODE === '1';
const CASH_TABLE = CASH_SANDBOX_MODE ? 'pdv_cash_sandbox' : 'caixa_diario';
const DEFAULT_PAYMENT_METHOD = 'credit';

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
const getBusinessDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

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
const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const normalizePermission = (permission) => {
  if (permission === 'admin') return 'admin';
  if (permission === 'manager' || permission === 'standard') return 'manager';
  return 'operator';
};
const mapOperationalPermission = (role, funcao = '') => {
  const safeRole = String(role || '').trim().toLowerCase();
  const safeFuncao = String(funcao || '').trim().toLowerCase();
  if (safeRole === 'super_admin' || safeRole === 'admin') return 'admin';
  if (safeRole === 'gerente' || safeFuncao.includes('gerente')) return 'manager';
  return 'operator';
};
const mapOperationalRoleLabel = (role, funcao = '') => {
  const safeRole = String(role || '').trim().toLowerCase();
  const safeFuncao = String(funcao || '').trim().toLowerCase();
  if (safeRole === 'gerente' || safeFuncao.includes('gerente')) return 'gerente';
  if (safeFuncao.includes('gar')) return 'garçom';
  if (safeRole === 'colaborador' || safeRole === 'operacional' || safeFuncao.includes('atend')) return 'atendente';
  return 'outro';
};
const canAccessOutsideOperationIp = (session) => Boolean(
  session && (normalizePermission(session.permission) === 'admin' || session.allowRemote)
);

const permissionsByProfile = {
  admin: {
    accessPDV: true,
    viewSalesTotals: true,
    viewCashSummary: true,
    viewFinancialReports: true,
    manageSettings: true,
    manageTeam: true,
    managePDVUsers: true,
    managePDVPermissions: true,
    manageRoles: true,
    manageOptionals: true,
    addProduct: true,
    editProduct: true,
    editProductPrice: true,
    deleteProduct: true,
    toggleProductVisibility: true,
    manageCategories: true,
    sellUnavailableProduct: true,
    viewZeroStockProducts: true,
    openCash: true,
    closeCash: true,
    cashWithdrawal: true,
    cashSupply: true,
    applyDiscount: true,
    editServiceFee: true,
    openTable: true,
    updateTableStatus: true,
    transferTable: true,
    joinTables: true,
    splitBill: true,
    reopenPaidBill: true,
    viewOtherOperatorTables: true,
    resolveServiceRequest: true,
    addOrderItem: true,
    removeCartItem: true,
    changeItemQuantity: true,
    editItemNotes: true,
    sendOrderToProduction: true,
    cancelTableItem: true,
    cancelOrder: true,
    cancelSale: true,
    launchPayment: true,
    changePaymentMethod: true,
    splitPayment: true,
    cancelPayment: true,
    refundPayment: true,
    closeBill: true,
    viewStock: true,
    adjustStock: true,
    confirmPurchaseEntry: true,
    editPurchaseEntry: true,
    cancelPurchaseEntry: true,
    viewNegativeStock: true,
    receiveStockAlerts: true,
    manageShifts: true,
    viewSchedule: true,
    editSchedule: true,
    manageFreelancers: true,
    approveFreelancerHours: true,
    manageFreelancerPayments: true,
    reprintReceipt: true,
    viewSalesHistory: true,
    accessFullReports: true,
    accessSensitiveData: true,
  },
  manager: {
    accessPDV: true,
    viewSalesTotals: true,
    viewCashSummary: true,
    viewFinancialReports: true,
    manageSettings: false,
    manageTeam: false,
    managePDVUsers: false,
    managePDVPermissions: false,
    manageRoles: false,
    manageOptionals: true,
    addProduct: true,
    editProduct: true,
    editProductPrice: true,
    deleteProduct: true,
    toggleProductVisibility: true,
    manageCategories: true,
    sellUnavailableProduct: false,
    viewZeroStockProducts: true,
    openCash: true,
    closeCash: true,
    cashWithdrawal: true,
    cashSupply: true,
    applyDiscount: true,
    editServiceFee: true,
    openTable: true,
    updateTableStatus: true,
    transferTable: true,
    joinTables: true,
    splitBill: true,
    reopenPaidBill: true,
    viewOtherOperatorTables: true,
    resolveServiceRequest: true,
    addOrderItem: true,
    removeCartItem: true,
    changeItemQuantity: true,
    editItemNotes: true,
    sendOrderToProduction: true,
    cancelTableItem: true,
    cancelOrder: true,
    cancelSale: true,
    launchPayment: true,
    changePaymentMethod: true,
    splitPayment: true,
    cancelPayment: true,
    refundPayment: true,
    closeBill: true,
    viewStock: true,
    adjustStock: true,
    confirmPurchaseEntry: true,
    editPurchaseEntry: true,
    cancelPurchaseEntry: true,
    viewNegativeStock: true,
    receiveStockAlerts: true,
    manageShifts: true,
    viewSchedule: true,
    editSchedule: true,
    manageFreelancers: true,
    approveFreelancerHours: true,
    manageFreelancerPayments: true,
    reprintReceipt: true,
    viewSalesHistory: true,
    accessFullReports: true,
    accessSensitiveData: false,
  },
  operator: {
    accessPDV: true,
    viewSalesTotals: false,
    viewCashSummary: false,
    viewFinancialReports: false,
    manageSettings: false,
    manageTeam: false,
    managePDVUsers: false,
    managePDVPermissions: false,
    manageRoles: false,
    manageOptionals: true,
    addProduct: true,
    editProduct: true,
    editProductPrice: false,
    deleteProduct: false,
    toggleProductVisibility: true,
    manageCategories: true,
    sellUnavailableProduct: false,
    viewZeroStockProducts: false,
    openCash: true,
    closeCash: true,
    cashWithdrawal: false,
    cashSupply: false,
    applyDiscount: false,
    editServiceFee: true,
    openTable: true,
    updateTableStatus: true,
    transferTable: true,
    joinTables: true,
    splitBill: true,
    reopenPaidBill: false,
    viewOtherOperatorTables: true,
    resolveServiceRequest: true,
    addOrderItem: true,
    removeCartItem: true,
    changeItemQuantity: true,
    editItemNotes: true,
    sendOrderToProduction: true,
    cancelTableItem: false,
    cancelOrder: false,
    cancelSale: false,
    launchPayment: true,
    changePaymentMethod: true,
    splitPayment: true,
    cancelPayment: true,
    refundPayment: false,
    closeBill: true,
    viewStock: false,
    adjustStock: false,
    confirmPurchaseEntry: false,
    editPurchaseEntry: false,
    cancelPurchaseEntry: false,
    viewNegativeStock: false,
    receiveStockAlerts: true,
    manageShifts: true,
    viewSchedule: true,
    editSchedule: false,
    manageFreelancers: false,
    approveFreelancerHours: false,
    manageFreelancerPayments: false,
    reprintReceipt: true,
    viewSalesHistory: false,
    accessFullReports: false,
    accessSensitiveData: false,
  },
};

const canSession = (session, permission) => {
  if (!session) return false;
  return Boolean(permissionsByProfile[normalizePermission(session.permission)]?.[permission]);
};

const getEffectiveSessionPermissions = (session, settings = null) => {
  const profile = normalizePermission(session?.permission);
  return {
    ...(permissionsByProfile[profile] || permissionsByProfile.operator),
    ...(settings?.pdvPermissions?.[profile] || {}),
    ...(profile === 'admin' ? { accessPDV: true, manageSettings: true, managePDVPermissions: true } : {}),
  };
};

const canSessionWithSettings = (session, permission, settings = null) => {
  if (!session) return false;
  return Boolean(getEffectiveSessionPermissions(session, settings)[permission]);
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
    allowRemote: Boolean(seller.allowRemote),
    stationAccess: Boolean(seller.stationAccess),
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
      allowRemote: Boolean(decoded.allowRemote),
      stationAccess: Boolean(decoded.stationAccess),
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
    "CREATE TABLE IF NOT EXISTS tables (id TEXT PRIMARY KEY, number TEXT NOT NULL, status TEXT NOT NULL, last_activity DATETIME DEFAULT CURRENT_TIMESTAMP, current_seller_id TEXT)",
    "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, table_id TEXT, total REAL NOT NULL, status TEXT NOT NULL, origin TEXT DEFAULT 'pdv', created_by_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, payment_method TEXT)",
    "CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT, product_id TEXT, quantity INTEGER NOT NULL, price_at_time REAL NOT NULL, selected_modifiers TEXT, notes TEXT)",
    "CREATE TABLE IF NOT EXISTS production_tickets (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, station TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS service_requests (id TEXT PRIMARY KEY, table_id TEXT, type TEXT NOT NULL, status TEXT NOT NULL, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS sellers (id TEXT PRIMARY KEY, name TEXT NOT NULL, nickname TEXT, status TEXT NOT NULL, role TEXT NOT NULL, permission TEXT DEFAULT 'standard', pin TEXT DEFAULT '1234', notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, details TEXT, table_number TEXT, origin TEXT, author_id TEXT, author_name TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS closed_bills (id TEXT PRIMARY KEY, table_id TEXT, table_number INTEGER NOT NULL, seller_id TEXT, seller_name TEXT, subtotal REAL NOT NULL, service_fee REAL DEFAULT 0, discount REAL DEFAULT 0, discount_reason TEXT, total REAL NOT NULL, payments TEXT, closed_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS integration_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, table_id TEXT, ref_id TEXT, payload TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, status TEXT NOT NULL, opening_balance REAL NOT NULL, closing_balance REAL, total_sales REAL DEFAULT 0, opened_at DATETIME DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME, sort_order INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS pdv_cash_sandbox (id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL, data TEXT NOT NULL, saldo_inicial REAL NOT NULL DEFAULT 0, entradas_dinheiro REAL NOT NULL DEFAULT 0, saidas_dinheiro REAL NOT NULL DEFAULT 0, valor_caixa_final REAL NOT NULL DEFAULT 0, valor_envelopes REAL NOT NULL DEFAULT 0, total_na_casa REAL NOT NULL DEFAULT 0, responsavel_id TEXT NOT NULL, observacoes TEXT, status TEXT NOT NULL DEFAULT 'Aberto', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
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
    "ALTER TABLE tables ADD COLUMN current_seller_id TEXT",
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
    "CREATE INDEX IF NOT EXISTS idx_production_tickets_order ON production_tickets(order_id, station, status)",
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
  if (origin !== expectedHttp && origin !== expectedHttps && !ALLOWED_WEB_ORIGINS.includes(origin)) {
    throw new Error('Origem não autorizada.');
  }
};

const pinAttemptBuckets = new Map();
const PIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PIN_RATE_LIMIT_MAX = 12;

const normalizeClientIp = (ip) => String(ip || '')
  .replace(/^::ffff:/, '')
  .trim();

const isTrustedProxyIp = (ip) => {
  const normalized = normalizeClientIp(ip);
  if (normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost') return true;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  const match = normalized.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
};

const getClientIp = (req) => {
  if (!req) return 'unknown';
  const remoteAddress = normalizeClientIp(req.socket.remoteAddress || 'unknown');
  const forwardedFor = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map(part => normalizeClientIp(part.trim()))
    .filter(Boolean);
  // Nginx appends the real client address to any incoming XFF value. Use the
  // right-most forwarded address so a client cannot spoof the allowlist by
  // sending a fake first X-Forwarded-For entry.
  const proxiedClientIp = forwardedFor[forwardedFor.length - 1];
  return normalizeClientIp(isTrustedProxyIp(remoteAddress) && proxiedClientIp ? proxiedClientIp : remoteAddress);
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

const toUnixSeconds = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value > 9999999999 ? Math.floor(value / 1000) : Math.floor(value);
  const parsedNumber = Number(value);
  if (Number.isFinite(parsedNumber) && parsedNumber > 0) {
    return parsedNumber > 9999999999 ? Math.floor(parsedNumber / 1000) : Math.floor(parsedNumber);
  }
  const parsedDate = Date.parse(String(value));
  return Number.isFinite(parsedDate) ? Math.floor(parsedDate / 1000) : 0;
};

const moneyToCents = (value, field = 'money') => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Campo numérico inválido: ${field}`);
    return Math.round(value * 100);
  }

  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`Campo numérico inválido: ${field}`);
  return Math.round(parsed * 100);
};

const centsToMoney = (cents) => Math.round(Number(cents || 0)) / 100;

const formatMoneyBRL = (value) => (
  centsToMoney(moneyToCents(value)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
);

const MAX_SERVICE_FEE_PERCENT = 13;
const clampServiceFeePercent = (value) => {
  if (!Number.isFinite(Number(value))) return MAX_SERVICE_FEE_PERCENT;
  return Math.min(MAX_SERVICE_FEE_PERCENT, Math.max(0, Number(value)));
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
    SELECT
      m.*,
      c.name as category_name,
      ep.quantidade_atual as stock_quantity,
      ep.estoque_minimo as stock_minimum
    FROM menu m
    LEFT JOIN categories c ON m.category_id = c.id
    LEFT JOIN estoque_produtos ep ON ep.id = m.remote_stock_id AND ep.ativo = 1
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
    stockQuantity: row.remote_stock_id ? Number(row.stock_quantity || 0) : null,
    stockMinimum: row.remote_stock_id ? Number(row.stock_minimum || 0) : null,
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
    WHERE mg.status = 'active'

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
    allowRemote: false,
    source: 'pdv',
  }));
};

const mapCashRow = (row) => row ? ({
  id: row.id,
  empresaId: row.empresa_id,
  businessDate: row.data,
  openingBalance: Number(row.saldo_inicial || 0),
  closingBalance: Number(row.valor_caixa_final || 0),
  totalHouse: Number(row.total_na_casa || 0),
  responsibleId: row.responsavel_id || '',
  notes: row.observacoes || '',
  status: row.status || 'Fechado',
  createdAt: row.created_at || null,
  updatedAt: row.updated_at || null,
}) : null;

const getOpenCashRow = async () => {
  const res = await db.execute({
    sql: `SELECT * FROM ${CASH_TABLE} WHERE empresa_id = ? AND status = 'Aberto' ORDER BY created_at DESC LIMIT 1`,
    args: [OS_EMPRESA_ID],
  });
  return res.rows[0] || null;
};

const getCashState = async () => {
  await ensureDatabaseReady();
  const businessDate = getBusinessDate();
  const [openCashRow, todayRes, lastClosedRes] = await Promise.all([
    getOpenCashRow(),
    db.execute({
      sql: `SELECT * FROM ${CASH_TABLE} WHERE empresa_id = ? AND data = ? LIMIT 1`,
      args: [OS_EMPRESA_ID, businessDate],
    }),
    db.execute({
      sql: `SELECT * FROM ${CASH_TABLE} WHERE empresa_id = ? AND status = 'Fechado' AND data != ? ORDER BY data DESC LIMIT 1`,
      args: [OS_EMPRESA_ID, businessDate],
    }),
  ]);
  const current = mapCashRow(openCashRow || todayRes.rows[0]);
  const lastClosed = mapCashRow(lastClosedRes.rows[0]);

  return {
    businessDate: current?.businessDate || businessDate,
    isOpen: current?.status === 'Aberto',
    current,
    lastClosingBalance: lastClosed?.closingBalance || 0,
    sandbox: CASH_SANDBOX_MODE,
  };
};

const getOperationalUsers = async ({ includePins = false } = {}) => {
  const res = await db.execute({
    sql: `
      SELECT id, nome, email, role, funcao, ativo, pin, is_operador, permitir_acesso_remoto
      FROM users
      WHERE empresa_id = ?
        AND COALESCE(ativo, 1) = 1
        AND COALESCE(is_operador, 1) = 1
      ORDER BY nome COLLATE NOCASE ASC
    `,
    args: [OS_EMPRESA_ID],
  });

  return res.rows
    .filter((row) => normalizeText(row.nome))
    .map((row) => ({
      id: row.id,
      name: normalizeText(row.nome),
      nickname: normalizeText(row.nome).split(' ')[0] || '',
      status: Number(row.ativo || 0) === 1 ? 'active' : 'inactive',
      role: mapOperationalRoleLabel(row.role, row.funcao),
      permission: mapOperationalPermission(row.role, row.funcao),
      pin: includePins ? String(row.pin || '') : '',
      allowRemote: Boolean(Number(row.permitir_acesso_remoto || 0)),
      source: 'os',
      email: row.email || '',
    }));
};

const getAuthSellers = async ({ includePins = false } = {}) => {
  const [operationalUsers, pdvUsers] = await Promise.all([
    getOperationalUsers({ includePins }),
    getSellers({ includePins }),
  ]);
  const seenIds = new Set();
  return [...operationalUsers, ...pdvUsers].filter((seller) => {
    if (seenIds.has(seller.id)) return false;
    seenIds.add(seller.id);
    return true;
  });
};

const PRODUCTION_STATIONS = new Set(['kitchen', 'bar']);
const BEVERAGE_TERMS = [
  'bebida', 'bebidas', 'drink', 'drinks', 'cerveja', 'chopp', 'chope', 'long neck',
  'refrigerante', 'coca', 'guarana', 'fanta', 'sprite', 'soda', 'tonica',
  'agua', 'água', 'suco', 'energetico', 'energético', 'destilado', 'gin',
  'vodka', 'whisky', 'rum', 'tequila', 'vinho', 'aperol', 'caipirinha', 'saquerinha',
];
const FOOD_TERMS = [
  'comida', 'comidas', 'cozinha', 'porcao', 'porção', 'porcoes', 'porções',
  'burguer', 'burger', 'hamburguer', 'hambúrguer', 'prato', 'salgado', 'sobremesa',
  'acai', 'açaí', 'frango', 'carne', 'batata', 'cheddar', 'bacon', 'queijo',
  'arroz', 'feijao', 'feijão', 'molho',
];

const normalizeProductionText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const textHasAny = (value, terms) => {
  const normalized = normalizeProductionText(value);
  return terms.some((term) => normalized.includes(normalizeProductionText(term)));
};

const resolveProductionStation = ({ categoryName = '', name = '', fallback = 'kitchen' } = {}) => {
  const source = `${categoryName} ${name}`;
  if (textHasAny(source, BEVERAGE_TERMS)) return 'bar';
  if (textHasAny(source, FOOD_TERMS)) return 'kitchen';
  return PRODUCTION_STATIONS.has(fallback) ? fallback : 'kitchen';
};

const splitItemsByProductionStation = (items = []) => {
  const result = { kitchen: [], bar: [] };

  for (const item of items) {
    const itemStation = resolveProductionStation({
      categoryName: item.categoryName || item.category_name || '',
      name: item.name || '',
      fallback: 'kitchen',
    });
    const sameStationModifiers = [];

    for (const modifier of item.selectedModifiers || []) {
      const modifierStation = resolveProductionStation({
        name: modifier?.name || '',
        fallback: itemStation,
      });

      if (modifierStation === itemStation) {
        sameStationModifiers.push(modifier);
        continue;
      }

      result[modifierStation].push({
        ...item,
        id: `${item.id}:${modifier.id || normalizeProductionText(modifier.name || 'modifier')}`,
        productId: modifier.id || item.productId,
        name: modifier.name || 'Adicional',
        price: Number(modifier.price || 0),
        selectedModifiers: [],
        notes: item.notes ? `${item.notes} | Adicional de ${item.name}` : `Adicional de ${item.name}`,
      });
    }

    result[itemStation].push({
      ...item,
      selectedModifiers: sameStationModifiers,
    });
  }

  return Object.fromEntries(
    Object.entries(result).filter(([, stationItems]) => stationItems.length > 0)
  );
};

const getKitchenOrders = async (view = 'pdv') => {
  const stationFilter = view === 'bar' ? 'bar' : view === 'kitchen' ? 'kitchen' : null;
  const [ordersRes, itemsRes, nowRes] = await Promise.all([
    db.execute("SELECT o.id, o.status, o.table_id, o.origin, strftime('%Y-%m-%dT%H:%M:%SZ', o.created_at) as created_at, t.number as tableNumber FROM orders o JOIN tables t ON o.table_id = t.id WHERE o.status IN ('pending', 'preparing') ORDER BY o.created_at ASC"),
    db.execute(`
      SELECT oi.*, m.name, m.category_id, c.name as category_name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN menu m ON oi.product_id = m.id
      LEFT JOIN categories c ON m.category_id = c.id
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
      categoryId: row.category_id,
      categoryName: row.category_name,
      name: row.name || '',
      price: Number(row.price_at_time || 0),
      quantity: Number(row.quantity || 0),
      selectedModifiers: parseJsonArray(row.selected_modifiers),
      notes: row.notes || '',
    });
  });

  const ticketStatements = [];
  const orderById = {};
  const ticketsByOrder = {};
  ordersRes.rows.forEach((row) => {
    const split = splitItemsByProductionStation(itemsByOrder[row.id] || []);
    orderById[row.id] = { row, split };
    for (const station of Object.keys(split)) {
      const ticketId = `${row.id}:${station}`;
      if (!ticketsByOrder[row.id]) ticketsByOrder[row.id] = {};
      ticketsByOrder[row.id][station] = {
        id: ticketId,
        orderId: row.id,
        station,
        status: row.status,
        createdAt: row.created_at,
      };
      ticketStatements.push({
        sql: "INSERT OR IGNORE INTO production_tickets (id, order_id, station, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)",
        args: [ticketId, row.id, station, row.created_at],
      });
    }
  });

  if (ticketStatements.length > 0) {
    await db.batch(ticketStatements, 'write');
  }

  const orderIds = ordersRes.rows.map((row) => row.id);
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    const ticketsRes = await db.execute({
      sql: `SELECT id, order_id, station, status, strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at FROM production_tickets WHERE order_id IN (${placeholders})`,
      args: orderIds,
    });
    ticketsRes.rows.forEach((ticket) => {
      if (!ticketsByOrder[ticket.order_id]) ticketsByOrder[ticket.order_id] = {};
      ticketsByOrder[ticket.order_id][ticket.station] = {
        id: ticket.id,
        orderId: ticket.order_id,
        station: ticket.station,
        status: ticket.status,
        createdAt: ticket.created_at,
      };
    });
  }

  const productionOrders = [];
  for (const orderId of Object.keys(orderById)) {
    const { row, split } = orderById[orderId];
    for (const [station, stationItems] of Object.entries(split)) {
      if (stationFilter && station !== stationFilter) continue;
      const ticket = ticketsByOrder[orderId]?.[station] || {};
      if (ticket.status === 'ready') continue;
      productionOrders.push({
        id: ticket.id || `${orderId}:${station}`,
        orderId,
        station,
        tableId: row.table_id,
        tableNumber: Number(row.tableNumber),
        status: ticket.status || row.status,
        origin: row.origin || 'pdv',
        createdAt: ticket.createdAt || row.created_at,
        items: stationItems,
      });
    }
  }

  return {
    orders: productionOrders,
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

const getAuditLogs = async ({ limit = 50, startDate = '', endDate = '', author = '', action = '' } = {}) => {
  const where = [];
  const args = [];

  if (startDate) {
    where.push("datetime(timestamp) >= datetime(?)");
    args.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    where.push("datetime(timestamp) <= datetime(?)");
    args.push(`${endDate} 23:59:59`);
  }
  if (author) {
    where.push("author_name = ?");
    args.push(author);
  }
  if (action) {
    where.push("action = ?");
    args.push(action);
  }

  const res = await db.execute({
    sql: `SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY timestamp DESC LIMIT ?`,
    args: [...args, Math.min(Number(limit) || 50, AUDIT_LOG_LIMIT)],
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
    currentSellerId: row.current_seller_id || '',
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
  const safeView = ['tablet', 'qr', 'kitchen', 'bar', 'pdv', 'admin'].includes(view) ? view : 'pdv';
  const canViewSales = canSessionWithSettings(session, 'viewSalesTotals', snapshot.savedSettings);
  const canManageTeam = canSessionWithSettings(session, 'manageTeam', snapshot.savedSettings);

  if (safeView === 'tablet' || safeView === 'qr') {
    return {
      ...snapshot,
      sellers: [],
      serviceRequests: [],
      closedBills: [],
      auditLogs: [],
    };
  }

  if (safeView === 'kitchen' || safeView === 'bar') {
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
          source: seller.source || 'pdv',
          allowRemote: Boolean(seller.allowRemote),
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
  cashState: null,
  tables: [],
  auditLogs: [],
  accessRestricted: true,
  view,
});

const getAppSnapshot = async ({ includeCatalog = true, includeAuditLimit = 50, view = 'pdv', session = null, operationAccessAllowed = true } = {}) => {
  if (!operationAccessAllowed && !canAccessOutsideOperationIp(session)) {
    return getRestrictedSnapshot(view);
  }

  await ensureDatabaseReady();
  const safeView = ['tablet', 'qr', 'kitchen', 'bar', 'pdv', 'admin'].includes(view) ? view : 'pdv';
  const needsOperationalPanel = safeView === 'pdv' || safeView === 'admin';
  const needsSellers = needsOperationalPanel;
  const needsSalesData = needsOperationalPanel;
  if (needsSellers) await ensureDefaultSellersReady();
  const [catalogData, sellers, kitchenData, serviceRequests, closedBills, savedSettings, tables, auditLogs, catalogVersion, cashState] = await Promise.all([
    includeCatalog ? getCatalogData() : Promise.resolve(null),
    needsSellers ? getAuthSellers() : Promise.resolve([]),
    getKitchenOrders(safeView),
    needsOperationalPanel ? getServiceRequests() : Promise.resolve([]),
    needsSalesData ? getClosedBills() : Promise.resolve([]),
    getSettings(),
    getTables(),
    needsSalesData ? getAuditLogs(includeAuditLimit) : Promise.resolve([]),
    getCatalogVersion(),
    needsOperationalPanel ? getCashState() : Promise.resolve(null),
  ]);

  return filterSnapshotForContext({
    catalogData,
    catalogVersion,
    sellers,
    kitchenData,
    serviceRequests,
    closedBills,
    savedSettings,
    cashState,
    tables,
    auditLogs,
  }, { view, session });
};

const createAdminBypassSession = () => {
  const seller = {
    id: 'admin-bypass',
    name: 'Admin Full',
    nickname: 'Admin',
    status: 'active',
    role: 'gerente',
    permission: 'admin',
    pin: '',
    allowRemote: true,
  };
  return {
    seller,
    sessionToken: createSessionToken(seller),
  };
};

const createProductionStationSession = () => {
  const seller = {
    id: 'production-station',
    name: 'Estação de Produção',
    nickname: 'Produção',
    status: 'active',
    role: 'produção',
    permission: 'operator',
    pin: '',
    allowRemote: false,
    stationAccess: true,
  };
  return {
    seller,
    sessionToken: createSessionToken(seller),
  };
};

const login = async ({ pin, sellerId }, { operationAccessAllowed = true, req = null } = {}) => {
  await ensureDatabaseReady();
  await ensureDefaultSellersReady();
  const safePin = String(pin || '');

  // O PIN super admin é reservado: ele não deve autenticar um colaborador que
  // tenha recebido o mesmo PIN por engano no cadastro do PDV/OS.
  if (isAdminBypassPin(safePin)) {
    return createAdminBypassSession();
  }

  const activeSellers = (await getAuthSellers({ includePins: true }))
    .filter((seller) => seller.status === 'active' && (!sellerId || seller.id === sellerId));
  let blockedNonAdminMatch = false;

  if (activeSellers.length === 0 && BOOTSTRAP_ADMIN_PIN && safePin === BOOTSTRAP_ADMIN_PIN) {
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
    const isMatch = isLegacyPlainPin(storedPin) ? storedPin === safePin : storedPin === hashPin(safePin);
    if (!isMatch) continue;
    const safeSeller = toSessionSeller(seller);

    if (!operationAccessAllowed && !canAccessOutsideOperationIp(safeSeller)) {
      blockedNonAdminMatch = true;
      if (req && isOperationIpRestricted()) {
        console.warn(`Blocked non-admin login outside operation IP: ${getClientIp(req)} seller=${seller.id}`);
      }
      continue;
    }

    if (isLegacyPlainPin(storedPin)) {
      await updateSellerPin({ id: seller.id, pin: hashPin(safePin) });
    }

    return {
      seller: safeSeller,
      sessionToken: createSessionToken(safeSeller),
    };
  }

  return { seller: null, sessionToken: null, accessRestricted: blockedNonAdminMatch };
};

const validateTabletSetupPin = async ({ pin }, { operationAccessAllowed = true } = {}) => {
  const safePin = String(pin || '');
  if (safePin === TABLET_SETUP_PIN && operationAccessAllowed) return { valid: true, ...createProductionStationSession() };
  if (isAdminBypassPin(safePin)) return { valid: true, ...createAdminBypassSession() };
  return { valid: false, sessionToken: null };
};

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

const validateSessionPin = async (session, pin) => {
  requireSession(session);
  const safePin = String(pin || '');
  if (!/^\d{4}$/.test(safePin)) return false;
  if (session.id === 'admin-bypass') return isAdminBypassPin(safePin);

  const sellers = await getAuthSellers({ includePins: true });
  const seller = sellers.find((item) => item.id === session.id && item.status === 'active');
  if (!seller) return false;

  const storedPin = seller.pin || '';
  return isLegacyPlainPin(storedPin) ? storedPin === safePin : storedPin === hashPin(safePin);
};

const validateCashClosingPin = async (session, pin) => {
  const safePin = String(pin || '');
  if (!/^\d{4}$/.test(safePin)) return { valid: false, override: false };
  if (isAdminBypassPin(safePin)) return { valid: true, override: true };
  return { valid: await validateSessionPin(session, safePin), override: false };
};

const resolveCashResponsibleId = async (session) => {
  const sessionId = session?.id || '';
  if (sessionId) {
    const userRes = await db.execute({
      sql: "SELECT id FROM users WHERE empresa_id = ? AND id = ? LIMIT 1",
      args: [OS_EMPRESA_ID, sessionId],
    });
    if (userRes.rows[0]?.id) return userRes.rows[0].id;
  }

  const { userId } = await resolveOSContext();
  return userId;
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

const getOpenOrderItems = async () => {
  const res = await db.execute({
    sql: `
      SELECT
        oi.id,
        oi.order_id as orderId,
        oi.product_id as productId,
        COALESCE(m.name, '') as name,
        COALESCE(m.remote_stock_id, '') as remoteStockId,
        oi.quantity,
        oi.selected_modifiers as selectedModifiers,
        t.number as tableNumber
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN tables t ON t.id = o.table_id
      LEFT JOIN menu m ON oi.product_id = m.id
      WHERE o.status != 'closed'
    `,
  });

  return res.rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    productId: row.productId,
    name: row.name || '',
    remoteStockId: row.remoteStockId || '',
    quantity: Number(row.quantity || 0),
    selectedModifiers: parseJsonArray(row.selectedModifiers),
    tableNumber: Number(row.tableNumber || 0),
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

const hasPdvStockMovement = async ({ orderItemId, sourceItemKind, sourceItemId }) => {
  if (!orderItemId || !sourceItemKind || !sourceItemId) return false;
  const res = await db.execute({
    sql: `
      SELECT id
      FROM estoque_movimentacoes
      WHERE origem = 'pdv'
        AND order_item_id = ?
        AND source_item_kind = ?
        AND source_item_id = ?
      LIMIT 1
    `,
    args: [orderItemId, sourceItemKind, sourceItemId],
  });
  return Boolean(res.rows[0]?.id);
};

const syncPdvOrderItemsToInventory = async ({ items, integrationId, tableNumber, reason, closedBillId = null }) => {
  const result = { movementCount: 0, unmatched: [], insufficient: [], critical: [], catalogVersion: null };
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) return result;

  const osContext = await resolveOSContext();
  const { empresaId, userId, slug } = osContext;
  const now = osTimestamp();
  const movementPlans = [];

  for (const item of safeItems) {
    const requestedQuantity = toStockAmount(item.quantity);
    if (requestedQuantity <= 0) continue;

    const productSourceId = item.productId;
    const alreadyMovedProduct = await hasPdvStockMovement({
      orderItemId: item.id,
      sourceItemKind: 'product',
      sourceItemId: productSourceId,
    });

    if (!alreadyMovedProduct) {
      const productStock = await findStockProduct(empresaId, {
        id: item.remoteStockId || item.productId,
        name: item.name,
      });

      if (!productStock) {
        result.unmatched.push(`${item.quantity}x ${item.name}`);
      } else {
        const currentQuantity = Number(productStock.quantidade_atual || 0);
        const nextQuantity = currentQuantity - requestedQuantity;
        if (requestedQuantity > currentQuantity) result.insufficient.push(`${item.name} (estoque insuficiente)`);
        if (nextQuantity <= Number(productStock.estoque_minimo || 0)) result.critical.push(item.name);
        movementPlans.push({
          movementId: createId(),
          stockId: productStock.id,
          stockName: productStock.nome || item.name,
          orderId: item.orderId,
          orderItemId: item.id,
          sourceItemId: productSourceId,
          sourceItemKind: 'product',
          requestedQuantity,
          previousQuantity: currentQuantity,
          nextQuantity,
          reason,
        });
      }
    }

    for (const modifier of item.selectedModifiers || []) {
      const modifierSourceId = modifier.id;
      const alreadyMovedModifier = await hasPdvStockMovement({
        orderItemId: item.id,
        sourceItemKind: 'modifier',
        sourceItemId: modifierSourceId,
      });
      if (alreadyMovedModifier) continue;

      const modifierStock = await findStockProduct(empresaId, {
        id: modifierSourceId,
        name: modifier.name,
      });
      if (!modifierStock) continue;

      const currentQuantity = Number(modifierStock.quantidade_atual || 0);
      const nextQuantity = currentQuantity - requestedQuantity;
      if (requestedQuantity > currentQuantity) result.insufficient.push(`${modifier.name} (estoque insuficiente)`);
      if (nextQuantity <= Number(modifierStock.estoque_minimo || 0)) result.critical.push(modifier.name);
      movementPlans.push({
        movementId: createId(),
        stockId: modifierStock.id,
        stockName: modifierStock.nome || modifier.name,
        orderId: item.orderId,
        orderItemId: item.id,
        sourceItemId: modifierSourceId,
        sourceItemKind: 'modifier',
        requestedQuantity,
        previousQuantity: currentQuantity,
        nextQuantity,
        reason: `${reason} | Opcional ${modifier.name}`,
      });
    }
  }

  const batch = [];
  for (const movement of movementPlans) {
    batch.push(
      {
        sql: `
          INSERT OR IGNORE INTO estoque_movimentacoes
            (id, empresa_id, produto_id, tipo_movimentacao, quantidade, quantidade_anterior, quantidade_nova, motivo, responsavel_id, created_at, closed_bill_id, order_id, order_item_id, origem, integration_event_id, source_item_id, source_item_kind)
          SELECT ?, empresa_id, id, 'saida', ?, quantidade_atual, quantidade_atual - ?, ?, ?, ?, ?, ?, ?, 'pdv', ?, ?, ?
          FROM estoque_produtos
          WHERE id = ? AND empresa_id = ? AND ativo = 1
        `,
        args: [
          movement.movementId,
          movement.requestedQuantity,
          movement.requestedQuantity,
          movement.reason,
          userId,
          now,
          closedBillId,
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
          SET quantidade_atual = quantidade_atual - ?,
              status = CASE WHEN quantidade_atual - ? <= estoque_minimo THEN 'Crítico' ELSE 'Saudável' END,
              updated_at = ?
          WHERE id = ? AND empresa_id = ? AND ativo = 1
        `,
        args: [movement.requestedQuantity, movement.requestedQuantity, now, movement.stockId, empresaId],
      },
    );
  }

  if (batch.length > 0) {
    await db.batch(batch, 'write');
    result.catalogVersion = await bumpCatalogVersion();
  }

  result.movementCount = movementPlans.length;

  const notificationTasks = [];
  if (result.unmatched.length > 0) {
    notificationTasks.push(safeCreateOSNotification({
      context: osContext,
      title: 'Itens do PDV sem vínculo de estoque',
      message: `Mesa ${tableNumber}: ${result.unmatched.slice(0, 8).join(', ')}`,
      type: 'alert',
      link: `/${slug}/estoque`,
    }));
  }
  if (result.insufficient.length > 0) {
    notificationTasks.push(safeCreateOSNotification({
      context: osContext,
      title: 'Estoque negativo em venda PDV',
      message: `Mesa ${tableNumber}: ${result.insufficient.slice(0, 8).join(', ')}`,
      type: 'warning',
      link: `/${slug}/estoque`,
    }));
  }
  if (result.critical.length > 0) {
    notificationTasks.push(safeCreateOSNotification({
      context: osContext,
      title: 'Estoque crítico após lançamento PDV',
      message: `Mesa ${tableNumber}: ${Array.from(new Set(result.critical)).slice(0, 8).join(', ')}`,
      type: 'warning',
      link: `/${slug}/estoque`,
    }));
  }
  void Promise.all(notificationTasks);

  return result;
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

const validateOrderItemsAvailability = async ({ items, session, settings, isPublicOrigin }) => {
  const productIds = Array.from(new Set((items || []).map((item) => item.productId).filter(Boolean)));
  if (productIds.length === 0) return;

  const productRes = await db.execute({
    sql: `
      SELECT
        m.id,
        m.name,
        m.visible,
        m.remote_stock_id,
        ep.quantidade_atual as stock_quantity
      FROM menu m
      LEFT JOIN estoque_produtos ep ON ep.id = m.remote_stock_id AND ep.ativo = 1
      WHERE m.id IN (${productIds.map(() => '?').join(',')})
    `,
    args: productIds,
  });
  const productById = new Map(productRes.rows.map((row) => [row.id, row]));
  const canSellUnavailable = !isPublicOrigin && canSessionWithSettings(session, 'sellUnavailableProduct', settings);

  for (const productId of productIds) {
    const product = productById.get(productId);
    if (!product) throw new Error('Produto não encontrado no cardápio.');
    const productName = String(product.name || 'Produto');
    const isVisible = Number(product.visible || 0) === 1;
    if (!isVisible && !canSellUnavailable) {
      const error = new Error(`${productName} está invisível no PDV.`);
      error.statusCode = 403;
      throw error;
    }
    if (product.remote_stock_id && Number(product.stock_quantity || 0) <= 0 && !canSellUnavailable) {
      const error = new Error(`${productName} está sem estoque disponível.`);
      error.statusCode = 403;
      throw error;
    }
  }
};

const deleteOrderItem = async ({ itemId, cancelContext }, session = null) => {
  const itemRes = await db.execute({
    sql: "SELECT oi.order_id, o.table_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ? LIMIT 1",
    args: [itemId],
  });
  const orderId = itemRes.rows[0]?.order_id;
  const tableId = itemRes.rows[0]?.table_id;
  if (tableId) {
    await ensureTableAccess(tableId, session);
  }

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

const sendToKitchen = async ({ orderId, tableId, total, origin, sellerId, items }, session = null) => {
  requireString(orderId, 'orderId');
  requireString(tableId, 'tableId');
  const safeOrigin = origin === 'tablet' || origin === 'qr' ? origin : 'pdv';
  const settings = await getSettings();
  if (safeOrigin === 'pdv') {
    await ensureTableAccess(tableId, session);
  }
  const effectiveSellerId = safeOrigin === 'pdv' ? (session?.id || sellerId || null) : (sellerId || null);
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) throw new Error('Pedido sem itens.');
  await validateOrderItemsAvailability({
    items: safeItems,
    session,
    settings,
    isPublicOrigin: safeOrigin === 'tablet' || safeOrigin === 'qr',
  });

  const batch = [
    {
      sql: "INSERT INTO orders (id, table_id, total, status, origin, created_by_id) VALUES (?, ?, ?, ?, ?, ?)",
      args: [orderId, tableId, requireNumber(total, 'total'), 'pending', safeOrigin, effectiveSellerId],
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
      sql: "UPDATE tables SET status = ?, current_seller_id = COALESCE(current_seller_id, ?) WHERE id = ?",
      args: ['ordering', effectiveSellerId, tableId],
    },
  ];

  const requestId = `new_order_${orderId}`;
  const itemsList = safeItems.map((item) => `${item.quantity}x ${item.name}`).join(', ');
  batch.push({
    sql: "INSERT OR IGNORE INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, ?, ?, ?)",
    args: [requestId, tableId, 'new_order', 'pending', itemsList],
  });

  await db.batch(batch, 'write');

  let inventorySync = null;
  let inventorySyncError = null;
  try {
    const tableRes = await db.execute({ sql: "SELECT number FROM tables WHERE id = ? LIMIT 1", args: [tableId] });
    const tableNumber = Number(tableRes.rows[0]?.number || 0);
    inventorySync = await syncPdvOrderItemsToInventory({
      items: safeItems.map((item) => ({ ...item, orderId })),
      integrationId: `pdv_order_${orderId}`,
      tableNumber,
      reason: `Venda PDV Mesa ${tableNumber} | Lançamento ${orderId}`,
    });
  } catch (error) {
    inventorySyncError = error;
    console.error('Falha ao baixar estoque no lançamento do pedido:', error);
    void safeCreateOSNotification({
      title: 'Baixa de estoque no lançamento falhou',
      message: `Pedido ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
      type: 'error',
      link: `/${OS_TENANT_SLUG}/estoque`,
    });
  }

  return {
    request: {
      id: requestId,
      tableId,
      type: 'new_order',
      message: itemsList,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
    inventorySync,
    inventorySyncError: inventorySyncError instanceof Error ? inventorySyncError.message : inventorySyncError ? String(inventorySyncError) : null,
  };
};

const createOrderReadyRequest = async (orderId) => {
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
      SELECT oi.quantity, COALESCE(m.name, 'Item') as name, oi.selected_modifiers
      FROM order_items oi
      LEFT JOIN menu m ON oi.product_id = m.id
      WHERE oi.order_id = ?
    `,
    args: [orderId],
  });
  const itemsList = itemsRes.rows.map((item) => {
    const modifiers = parseJsonArray(item.selected_modifiers)
      .map((modifier) => modifier?.name)
      .filter(Boolean);
    return `${item.quantity}x ${item.name}${modifiers.length ? ` (+ ${modifiers.join(', ')})` : ''}`;
  }).join(', ');
  const id = `order_ready_${orderId}`;

  await db.execute({
    sql: "INSERT OR IGNORE INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, ?, ?, ?)",
    args: [id, order.table_id, 'order_ready', 'pending', itemsList],
  });

  const requestRes = await db.execute({
    sql: "SELECT id, table_id, type, status, message, strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at FROM service_requests WHERE id = ? LIMIT 1",
    args: [id],
  });
  const request = requestRes.rows[0];

  return {
    request: {
      id: request?.id || id,
      tableId: request?.table_id || order.table_id,
      tableNumber: Number(order.tableNumber || 0),
      type: 'order_ready',
      message: request?.message || itemsList,
      status: request?.status || 'pending',
      createdAt: request?.created_at || new Date().toISOString(),
    },
  };
};

const updateOrderStatus = async ({ orderId, status }) => {
  requireString(orderId, 'orderId');
  const safeStatus = ['pending', 'preparing', 'ready', 'closed'].includes(status) ? status : null;
  if (!safeStatus) throw new Error('Status inválido.');

  const ticketRes = await db.execute({
    sql: "SELECT id, order_id FROM production_tickets WHERE id = ? LIMIT 1",
    args: [orderId],
  });
  const ticket = ticketRes.rows[0];

  if (ticket) {
    await db.execute({
      sql: "UPDATE production_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [safeStatus, orderId],
    });

    if (safeStatus !== 'ready') return { request: null };

    const remainingRes = await db.execute({
      sql: "SELECT COUNT(*) as count FROM production_tickets WHERE order_id = ? AND status != 'ready'",
      args: [ticket.order_id],
    });
    if (Number(remainingRes.rows[0]?.count || 0) > 0) return { request: null };

    await db.execute({
      sql: "UPDATE orders SET status = 'ready' WHERE id = ?",
      args: [ticket.order_id],
    });

    return createOrderReadyRequest(ticket.order_id);
  }

  await db.execute({
    sql: "UPDATE orders SET status = ? WHERE id = ?",
    args: [safeStatus, orderId],
  });

  if (safeStatus !== 'ready') return { request: null };
  return createOrderReadyRequest(orderId);
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
  const settings = await getSettings();
  const existing = await db.execute({
    sql: "SELECT name, description, price, cost, category_id, image, visible, erp_code, remote_stock_id, schedule_config FROM menu WHERE id = ? LIMIT 1",
    args: [productId],
  });
  const currentProduct = existing.rows[0] || null;
  if (!currentProduct) {
    requirePermission(session, 'addProduct', settings);
  }

  if (currentProduct) {
    const nextSchedule = p.schedule ? JSON.stringify(p.schedule) : null;
    const productDataChanged = (
      String(currentProduct.name || '') !== String(p.name || '')
      || String(currentProduct.description || '') !== String(p.description || '')
      || String(currentProduct.category_id || '') !== String(p.categoryId || '')
      || String(currentProduct.image || '') !== String(p.image || '')
      || String(currentProduct.erp_code || '') !== String(p.erpCode || '')
      || String(currentProduct.remote_stock_id || '') !== String(p.remoteStockId || '')
      || String(currentProduct.schedule_config || '') !== String(nextSchedule || '')
      || Array.isArray(p.modifierGroups)
    );
    if (productDataChanged) {
      requirePermission(session, 'editProduct', settings);
    }

    const currentPrice = Number(currentProduct.price || 0);
    const nextPrice = Number(p.price || 0);
    if (Math.abs(currentPrice - nextPrice) > 0.001) {
      requirePermission(session, 'editProductPrice', settings);
    }

    const currentCost = Number(currentProduct.cost || 0);
    const nextCost = Number(p.cost || 0);
    if (Math.abs(currentCost - nextCost) > 0.001) {
      requirePermission(session, 'editProductPrice', settings);
    }

    const currentVisible = Number(currentProduct.visible || 0) === 1;
    if (currentVisible !== Boolean(p.visible)) {
      requirePermission(session, 'toggleProductVisibility', settings);
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

const saveSettings = async ({ settings }, session = null) => {
  const currentSettings = await getSettings();
  const nextPermissions = JSON.stringify(settings?.pdvPermissions || {});
  const currentPermissions = JSON.stringify(currentSettings?.pdvPermissions || {});
  if (nextPermissions !== currentPermissions) {
    requirePermission(session, 'managePDVPermissions', currentSettings);
  }

  await db.execute({
    sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('settings', ?, CURRENT_TIMESTAMP)",
    args: [JSON.stringify(settings || {})],
  });
  return { saved: true };
};

const regenerateTableQr = async ({ tableNumber, adminPin }, session = null) => {
  const settings = await getSettings();
  requirePermission(session, 'managePDVPermissions', settings);

  if (!isAdminSession(session)) {
    const error = new Error('Apenas admin pode gerar novo QR Code de mesa.');
    error.statusCode = 403;
    throw error;
  }

  const safeTableNumber = Math.trunc(Number(tableNumber || 0));
  if (!Number.isFinite(safeTableNumber) || safeTableNumber <= 0 || safeTableNumber > 999) {
    throw new Error('Número da mesa inválido.');
  }

  const pinIsValid = await validateSessionPin(session, adminPin);
  if (!pinIsValid) {
    const error = new Error('PIN admin não confere. QR Code não foi alterado.');
    error.statusCode = 403;
    throw error;
  }

  const tableRes = await db.execute({
    sql: 'SELECT id FROM tables WHERE number = ? LIMIT 1',
    args: [String(safeTableNumber)],
  });
  if (!tableRes.rows[0]) {
    throw new Error(`Mesa ${safeTableNumber} não encontrada.`);
  }

  const tableKey = String(safeTableNumber);
  const revision = createId().replace(/-/g, '').slice(0, 12);
  const rotatedAt = new Date().toISOString();
  const nextQrCodes = {
    ...(settings?.qrCodes || {}),
    tableRevisions: {
      ...(settings?.qrCodes?.tableRevisions || {}),
      [tableKey]: revision,
    },
    lastRotatedAt: {
      ...(settings?.qrCodes?.lastRotatedAt || {}),
      [tableKey]: rotatedAt,
    },
  };
  const nextSettings = {
    ...(settings || {}),
    qrCodes: nextQrCodes,
  };

  await db.execute({
    sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('settings', ?, CURRENT_TIMESTAMP)",
    args: [JSON.stringify(nextSettings)],
  });

  await addAuditLog({
    action: 'qr_table_regenerated',
    details: JSON.stringify({ tableNumber: safeTableNumber, revision }),
    tableNumber: String(safeTableNumber),
    origin: 'pdv',
    authorName: session?.name || 'Admin',
  });

  return { tableNumber: safeTableNumber, revision, qrCodes: nextQrCodes };
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

const resolveServiceRequest = async ({ requestId, tableId, type, message }) => {
  const newStatus = 'resolved';
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

const clearServiceRequest = async ({ requestId }) => {
  const safeRequestId = requireString(requestId, 'requestId');
  const result = await db.execute({
    sql: "DELETE FROM service_requests WHERE id = ? AND status = 'resolved'",
    args: [safeRequestId],
  });

  return {
    requestId: safeRequestId,
    cleared: Number(result.rowsAffected || 0) > 0,
  };
};

const requestBill = async ({ tableId }) => {
  await db.execute({ sql: "UPDATE tables SET status = ? WHERE id = ?", args: ['bill_requested', tableId] });
  return { status: 'bill_requested' };
};

const ensureTableAccess = async (tableId, session) => {
  requireString(tableId, 'tableId');
  requireSession(session);
  const tableRes = await db.execute({
    sql: "SELECT current_seller_id FROM tables WHERE id = ? LIMIT 1",
    args: [tableId],
  });
  const ownerId = tableRes.rows[0]?.current_seller_id || '';
  if (!ownerId || ownerId === session.id) return;
  if (canSessionWithSettings(session, 'viewOtherOperatorTables', await getSettings())) return;
  const error = new Error('Mesa vinculada a outro operador.');
  error.statusCode = 403;
  throw error;
};

const updateTableStatus = async ({ tableId, status }, session) => {
  requireString(tableId, 'tableId');
  const allowed = new Set(['available', 'ordering', 'waiting', 'paid', 'bill_requested']);
  if (!allowed.has(status)) throw new Error('Status de mesa inválido.');
  await ensureTableAccess(tableId, session);
  const clearsOwner = status === 'available' || status === 'paid';
  await db.execute({
    sql: `UPDATE tables SET status = ?, current_seller_id = ${clearsOwner ? 'NULL' : 'current_seller_id'} WHERE id = ?`,
    args: [status, tableId],
  });
  return { status };
};

const openTable = async ({ tableId, wasAvailable }, session) => {
  requireString(tableId, 'tableId');
  await ensureTableAccess(tableId, session);
  const batch = [];
  if (wasAvailable) {
    batch.push(
      { sql: "UPDATE orders SET status = 'closed' WHERE table_id = ? AND status != 'closed'", args: [tableId] },
      { sql: "UPDATE service_requests SET status = 'resolved' WHERE table_id = ? AND status != 'resolved'", args: [tableId] },
    );
  }
  batch.push({
    sql: "UPDATE tables SET status = 'ordering', last_activity = CURRENT_TIMESTAMP, current_seller_id = COALESCE(current_seller_id, ?) WHERE id = ?",
    args: [session?.id || null, tableId],
  });
  await db.batch(batch, 'write');
  return { status: 'ordering' };
};

const transferTable = async ({ fromTableId, toTableId }, session) => {
  requireString(fromTableId, 'fromTableId');
  requireString(toTableId, 'toTableId');
  await ensureTableAccess(fromTableId, session);
  await ensureTableAccess(toTableId, session);
  const ownerRes = await db.execute({ sql: "SELECT current_seller_id FROM tables WHERE id = ? LIMIT 1", args: [fromTableId] });
  const ownerId = ownerRes.rows[0]?.current_seller_id || session?.id || null;
  await db.batch([
    { sql: "UPDATE orders SET table_id = ? WHERE table_id = ? AND status != 'closed'", args: [toTableId, fromTableId] },
    { sql: "UPDATE service_requests SET table_id = ? WHERE table_id = ? AND status != 'resolved'", args: [toTableId, fromTableId] },
    { sql: "UPDATE tables SET status = 'available', current_seller_id = NULL WHERE id = ?", args: [fromTableId] },
    { sql: "UPDATE tables SET status = 'ordering', current_seller_id = ? WHERE id = ?", args: [ownerId, toTableId] },
  ], 'write');
  return { moved: true };
};

const joinTables = async ({ tableIds, targetTableId }, session) => {
  if (!Array.isArray(tableIds) || tableIds.length === 0) throw new Error('tableIds inválido.');
  requireString(targetTableId, 'targetTableId');
  for (const id of tableIds) {
    await ensureTableAccess(id, session);
  }
  await ensureTableAccess(targetTableId, session);
  const sourceIds = tableIds.filter((id) => id !== targetTableId);
  const ownerRes = await db.execute({
    sql: `SELECT current_seller_id FROM tables WHERE id IN (${tableIds.map(() => '?').join(',')}) AND current_seller_id IS NOT NULL LIMIT 1`,
    args: tableIds,
  });
  const ownerId = ownerRes.rows[0]?.current_seller_id || session?.id || null;
  const batch = [
    ...sourceIds.map((id) => ({ sql: "UPDATE orders SET table_id = ? WHERE table_id = ? AND status != 'closed'", args: [targetTableId, id] })),
    ...sourceIds.map((id) => ({ sql: "UPDATE service_requests SET table_id = ? WHERE table_id = ? AND status != 'resolved'", args: [targetTableId, id] })),
    ...sourceIds.map((id) => ({ sql: "UPDATE tables SET status = 'available', current_seller_id = NULL WHERE id = ?", args: [id] })),
    { sql: "UPDATE tables SET status = 'ordering', current_seller_id = COALESCE(current_seller_id, ?) WHERE id = ?", args: [ownerId, targetTableId] },
  ];
  await db.batch(batch, 'write');
  return { joined: true };
};

const openCash = async ({ openingBalance, notes }, session) => {
  requireSession(session);
  const businessDate = getBusinessDate();
  const openCashRow = await getOpenCashRow();
  if (openCashRow) {
    throw new Error(`Já existe caixa aberto desde ${openCashRow.data}. Feche o caixa aberto antes de iniciar outro.`);
  }

  const existing = await db.execute({
    sql: `SELECT id, status, observacoes FROM ${CASH_TABLE} WHERE empresa_id = ? AND data = ? LIMIT 1`,
    args: [OS_EMPRESA_ID, businessDate],
  });
  const existingCash = existing.rows[0];
  if (existingCash?.status === 'Aberto') {
    throw new Error('O caixa de hoje já está aberto.');
  }

  const now = osTimestamp();
  const normalizedOpeningBalance = requireNumber(openingBalance, 'openingBalance');
  const responsibleId = await resolveCashResponsibleId(session);

  if (existingCash) {
    await db.execute({
      sql: `
        UPDATE ${CASH_TABLE}
        SET saldo_inicial = ?,
            entradas_dinheiro = 0,
            saidas_dinheiro = 0,
            valor_caixa_final = 0,
            valor_envelopes = 0,
            total_na_casa = 0,
            vendas_dinheiro_goomer = 0,
            vendas_credito_goomer = 0,
            vendas_debito_goomer = 0,
            vendas_pix_goomer = 0,
            responsavel_id = ?,
            observacoes = ?,
            status = 'Aberto',
            created_at = ?,
            updated_at = ?
        WHERE id = ?
      `,
      args: [
        normalizedOpeningBalance,
        responsibleId,
        notes || existingCash.observacoes || '',
        now,
        now,
        existingCash.id,
      ],
    });
  } else {
    await db.execute({
      sql: `
        INSERT INTO ${CASH_TABLE}
          (id, empresa_id, data, saldo_inicial, responsavel_id, observacoes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Aberto', ?, ?)
      `,
      args: [
        createId(),
        OS_EMPRESA_ID,
        businessDate,
        normalizedOpeningBalance,
        responsibleId,
        notes || '',
        now,
        now,
      ],
    });
  }

  await addAuditLog({
    id: createId(),
    action: 'cash_opened',
    details: JSON.stringify({ openingBalance: normalizedOpeningBalance, reopened: Boolean(existingCash), sandbox: CASH_SANDBOX_MODE }),
    origin: 'pdv',
    authorName: session.name,
    timestamp: new Date().toISOString(),
  });

  return { cashState: await getCashState() };
};

const getCashSalesCentsSince = async (openedAt) => {
  const openedAtUnix = toUnixSeconds(openedAt);
  const res = await db.execute({
    sql: `
      SELECT payments
      FROM closed_bills
      WHERE CAST(strftime('%s', closed_at) AS INTEGER) >= ?
    `,
    args: [openedAtUnix],
  });

  return res.rows.reduce((total, row) => {
    const payments = parseJsonArray(row.payments);
    const cashCents = payments.reduce((sum, payment) => {
      if (payment?.method !== 'cash') return sum;
      return sum + moneyToCents(payment.amount || 0, 'payment.amount');
    }, 0);
    return total + cashCents;
  }, 0);
};

const getExpectedClosingCents = async (cash) => {
  const openingCents = moneyToCents(cash.saldo_inicial || 0, 'saldo_inicial');
  const cashSalesCents = await getCashSalesCentsSince(cash.created_at);
  const manualInCents = moneyToCents(cash.entradas_dinheiro || 0, 'entradas_dinheiro');
  const manualOutCents = moneyToCents(cash.saidas_dinheiro || 0, 'saidas_dinheiro');

  return {
    openingCents,
    cashSalesCents,
    manualInCents,
    manualOutCents,
    expectedCents: openingCents + cashSalesCents + manualInCents - manualOutCents,
  };
};

const closeCash = async ({ closingBalance, notes, confirmationPin }, session) => {
  requireSession(session);
  const pinValidation = await validateCashClosingPin(session, confirmationPin);
  if (!pinValidation.valid) {
    const error = new Error('PIN do usuário logado não confere. Use o PIN da sessão ou o PIN super admin autorizado.');
    error.statusCode = 403;
    throw error;
  }

  const cash = await getOpenCashRow();
  if (!cash) throw new Error('Não existe caixa aberto.');

  const closingCents = moneyToCents(closingBalance, 'closingBalance');
  const closeSummary = await getExpectedClosingCents(cash);
  const missingCents = closeSummary.expectedCents - closingCents;

  if (missingCents > 0) {
    await addAuditLog({
      id: createId(),
      action: 'cash_close_blocked',
      details: JSON.stringify({
        expected: centsToMoney(closeSummary.expectedCents),
        declared: centsToMoney(closingCents),
        missing: centsToMoney(missingCents),
        opening: centsToMoney(closeSummary.openingCents),
        cashSales: centsToMoney(closeSummary.cashSalesCents),
        manualIn: centsToMoney(closeSummary.manualInCents),
        manualOut: centsToMoney(closeSummary.manualOutCents),
        adminOverride: pinValidation.override,
        sandbox: CASH_SANDBOX_MODE,
      }),
      origin: 'pdv',
      authorName: session.name,
      timestamp: new Date().toISOString(),
    });

    await safeCreateOSNotification({
      title: 'Bloqueio: falta de dinheiro no caixa',
      message: `${session.name || 'Usuário'} tentou fechar o caixa com ${formatMoneyBRL(centsToMoney(missingCents))} abaixo do esperado.`,
      type: 'alert',
      link: `/${OS_TENANT_SLUG}/controle-dinheiro`,
    });

    const error = new Error('Dinheiro físico abaixo do esperado. Chame o responsável para conferir o caixa.');
    error.statusCode = 409;
    throw error;
  }

  const now = osTimestamp();
  await db.execute({
    sql: `
      UPDATE ${CASH_TABLE}
      SET valor_caixa_final = ?, status = 'Fechado', observacoes = ?, updated_at = ?
      WHERE id = ?
    `,
    args: [
      centsToMoney(closingCents),
      notes || cash.observacoes || '',
      now,
      cash.id,
    ],
  });

  await addAuditLog({
    id: createId(),
    action: 'cash_closed',
    details: JSON.stringify({
      closingBalance: centsToMoney(closingCents),
      expected: centsToMoney(closeSummary.expectedCents),
      difference: centsToMoney(closingCents - closeSummary.expectedCents),
      opening: centsToMoney(closeSummary.openingCents),
      cashSales: centsToMoney(closeSummary.cashSalesCents),
      manualIn: centsToMoney(closeSummary.manualInCents),
      manualOut: centsToMoney(closeSummary.manualOutCents),
      adminOverride: pinValidation.override,
      sandbox: CASH_SANDBOX_MODE,
    }),
    origin: 'pdv',
    authorName: session.name,
    timestamp: new Date().toISOString(),
  });

  return { cashState: await getCashState() };
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

const syncOpenOrdersInventory = async () => {
  const items = await getOpenOrderItems();
  const byTable = new Map();
  for (const item of items) {
    const tableItems = byTable.get(item.tableNumber) || [];
    tableItems.push(item);
    byTable.set(item.tableNumber, tableItems);
  }

  const results = [];
  for (const [tableNumber, tableItems] of byTable.entries()) {
    try {
      const result = await syncPdvOrderItemsToInventory({
        items: tableItems,
        integrationId: `pdv_open_orders_backfill_${tableNumber}`,
        tableNumber,
        reason: `Baixa retroativa PDV Mesa ${tableNumber}`,
      });
      results.push({ tableNumber, ...result });
    } catch (error) {
      results.push({
        tableNumber,
        movementCount: 0,
        unmatched: [],
        insufficient: [],
        critical: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    tables: results.length,
    movementCount: results.reduce((sum, result) => sum + Number(result.movementCount || 0), 0),
    results,
  };
};

const closeBillWithInventorySync = async (data, session = null) => {
  const tableId = requireString(data.tableId, 'tableId');
  const settings = await getSettings();
  await ensureTableAccess(tableId, session);
  const subtotalCents = moneyToCents(data.subtotal || 0, 'subtotal');
  const serviceFeeCents = moneyToCents(data.serviceFee || 0, 'serviceFee');
  const discountCents = moneyToCents(data.discount || 0, 'discount');
  const totalCents = moneyToCents(data.total || 0, 'total');
  const payments = Array.isArray(data.payments) ? data.payments : [];

  if (subtotalCents < 0) throw new Error('Subtotal inválido.');
  if (serviceFeeCents < 0) throw new Error('Taxa de serviço não pode ser negativa.');
  if (discountCents < 0) throw new Error('Desconto não pode ser negativo.');
  if (totalCents < 0) throw new Error('Total da conta não pode ser negativo.');

  const defaultServiceFeePercent = clampServiceFeePercent(settings?.serviceTax ?? MAX_SERVICE_FEE_PERCENT);
  const defaultServiceFeeCents = Math.round(subtotalCents * (defaultServiceFeePercent / 100));
  const maxServiceFeeCents = Math.round(subtotalCents * (MAX_SERVICE_FEE_PERCENT / 100));

  if (serviceFeeCents > maxServiceFeeCents) {
    throw new Error(`Taxa de serviço não pode passar de ${MAX_SERVICE_FEE_PERCENT}%.`);
  }

  if (serviceFeeCents !== defaultServiceFeeCents) {
    requirePermission(session, 'editServiceFee', settings);
  }

  if (discountCents > 0) {
    requirePermission(session, 'applyDiscount', settings);
  }

  if (payments.length === 0 && totalCents > 0) {
    throw new Error('Lance ao menos um pagamento antes de fechar a conta.');
  }

  if (payments.length > 0) {
    requirePermission(session, 'launchPayment', settings);
  }

  if (payments.length > 1) {
    requirePermission(session, 'splitPayment', settings);
  }

  const validPaymentMethods = new Set(['credit', 'debit', 'cash', 'pix']);
  let paymentTotalCents = 0;
  let hasCashPayment = false;
  let usesNonDefaultPaymentMethod = false;
  for (const payment of payments) {
    if (!validPaymentMethods.has(payment?.method)) {
      throw new Error('Forma de pagamento inválida.');
    }
    if (payment.method !== DEFAULT_PAYMENT_METHOD) {
      usesNonDefaultPaymentMethod = true;
    }
    const paymentCents = moneyToCents(payment.amount || 0, 'payment.amount');
    if (paymentCents <= 0) throw new Error('Pagamento precisa ter valor maior que zero.');
    paymentTotalCents += paymentCents;
    if (payment.method === 'cash') hasCashPayment = true;
  }

  if (usesNonDefaultPaymentMethod) {
    requirePermission(session, 'changePaymentMethod', settings);
  }

  const expectedTotalCents = subtotalCents + serviceFeeCents - discountCents;
  if (expectedTotalCents < 0) {
    throw new Error('Desconto não pode ser maior que subtotal mais taxa de serviço.');
  }

  if (totalCents !== expectedTotalCents) {
    throw new Error('Total da conta não confere com subtotal, taxa de serviço e desconto.');
  }

  if (paymentTotalCents < totalCents) {
    throw new Error('Pagamentos lançados não cobrem o total da conta.');
  }

  if (paymentTotalCents > totalCents && !hasCashPayment) {
    throw new Error('Troco só pode existir quando houver pagamento em dinheiro.');
  }

  data.subtotal = centsToMoney(subtotalCents);
  data.serviceFee = centsToMoney(serviceFeeCents);
  data.discount = centsToMoney(discountCents);
  data.total = centsToMoney(totalCents);
  data.payments = payments.map((payment) => ({
    method: payment.method,
    amount: centsToMoney(moneyToCents(payment.amount || 0, 'payment.amount')),
  }));

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
          const alreadyMovedProduct = await hasPdvStockMovement({
            orderItemId: item.id,
            sourceItemKind: 'product',
            sourceItemId: item.productId,
          });

          if (!alreadyMovedProduct) {
            const productStock = await findStockProduct(empresaId, {
              id: item.remoteStockId || item.productId,
              name: item.name,
            });

            if (!productStock) {
              result.unmatched.push(`${item.quantity}x ${item.name}`);
            } else {
              const currentQuantity = Number(productStock.quantidade_atual || 0);
              const nextQuantity = currentQuantity - requestedQuantity;
              if (requestedQuantity > currentQuantity) result.insufficient.push(`${item.name} (estoque insuficiente)`);
              if (nextQuantity <= Number(productStock.estoque_minimo || 0)) result.critical.push(item.name);
              if (requestedQuantity > 0) {
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
          }

          for (const modifier of item.selectedModifiers || []) {
            const alreadyMovedModifier = await hasPdvStockMovement({
              orderItemId: item.id,
              sourceItemKind: 'modifier',
              sourceItemId: modifier.id,
            });
            if (alreadyMovedModifier) continue;

            const modifierStock = await findStockProduct(empresaId, {
              id: modifier.id,
              name: modifier.name,
            });

            if (!modifierStock) continue;

            const currentQuantity = Number(modifierStock.quantidade_atual || 0);
            const nextQuantity = currentQuantity - requestedQuantity;
            if (requestedQuantity > currentQuantity) result.insufficient.push(`${modifier.name} (estoque insuficiente)`);
            if (nextQuantity <= Number(modifierStock.estoque_minimo || 0)) result.critical.push(modifier.name);
            if (requestedQuantity > 0) {
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
            SELECT ?, empresa_id, id, 'saida', ?, quantidade_atual, quantidade_atual - ?, ?, ?, ?, ?, ?, ?, 'pdv', ?, ?, ?
            FROM estoque_produtos
            WHERE id = ? AND empresa_id = ? AND ativo = 1
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
            SET quantidade_atual = quantidade_atual - ?,
                status = CASE WHEN quantidade_atual - ? <= estoque_minimo THEN 'Crítico' ELSE 'Saudável' END,
                updated_at = ?
            WHERE id = ? AND empresa_id = ? AND ativo = 1
          `,
          args: [movement.requestedQuantity, movement.requestedQuantity, now, movement.stockId, empresaId],
        },
      );
    }

    const serviceFeePercent = subtotalCents > 0 ? Number(((serviceFeeCents / subtotalCents) * 100).toFixed(2)) : 0;
    const auditAuthorId = session?.id || data.sellerId;
    const auditAuthorName = session?.name || data.sellerName || 'Sistema';
    const auditEntries = [
      {
        action: 'bill_closed',
        details: {
          subtotal: data.subtotal,
          serviceFee: data.serviceFee,
          serviceFeePercent,
          discount: data.discount,
          total: data.total,
          paid: centsToMoney(paymentTotalCents),
          change: centsToMoney(Math.max(0, paymentTotalCents - totalCents)),
          payments: data.payments,
          sellerName: data.sellerName,
          inventoryMovements: result.movementCount,
          eventId: integrationId,
        },
      },
    ];

    if (serviceFeeCents !== defaultServiceFeeCents) {
      auditEntries.push({
        action: 'service_tax_changed',
        details: {
          defaultPercent: defaultServiceFeePercent,
          appliedPercent: serviceFeePercent,
          defaultAmount: centsToMoney(defaultServiceFeeCents),
          appliedAmount: data.serviceFee,
          delta: centsToMoney(serviceFeeCents - defaultServiceFeeCents),
        },
      });
    }

    if (discountCents > 0) {
      auditEntries.push({
        action: 'discount_applied',
        details: {
          discount: data.discount,
          discountReason: data.discountReason || 'Sem motivo informado',
          totalBeforeDiscount: centsToMoney(subtotalCents + serviceFeeCents),
          totalAfterDiscount: data.total,
        },
      });
    }

    auditEntries.push({
      action: 'payment_registered',
      details: {
        total: data.total,
        paid: centsToMoney(paymentTotalCents),
        change: centsToMoney(Math.max(0, paymentTotalCents - totalCents)),
        payments: data.payments,
      },
    });

    batch.push(
      ...auditEntries.map((entry) => ({
        sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name, timestamp) VALUES (?, ?, ?, ?, 'pdv', ?, ?, ?)",
        args: [
          createId(),
          entry.action,
          JSON.stringify(entry.details),
          String(data.tableNumber),
          auditAuthorId,
          auditAuthorName,
          closedAt.toISOString(),
        ],
      })),
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
    if (result.movementCount > 0) await bumpCatalogVersion();

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

const requirePermission = (session, permission, settings = null) => {
  requireSession(session);
  if (!canSessionWithSettings(session, permission, settings)) {
    const error = new Error('Permissão insuficiente.');
    error.statusCode = 403;
    throw error;
  }
};

const allowPublicOperationalOrigin = (body) => body?.origin === 'tablet' || body?.origin === 'qr';

const enforceRouteAccess = async (routeKey, body, session, { operationAccessAllowed = true, req = null } = {}) => {
  if (
    routeKey === 'GET /api/app/init'
    || routeKey === 'POST /api/app/sync'
    || routeKey === 'POST /api/auth/login'
    || routeKey === 'POST /api/tablet/setup-login'
  ) {
    return;
  }

  if (!operationAccessAllowed && !canAccessOutsideOperationIp(session)) {
    throwIpRestricted(req);
  }

  if (routeKey === 'POST /api/orders/send-to-kitchen') {
    if (allowPublicOperationalOrigin(body)) return;
    const settings = await getSettings();
    requirePermission(session, 'addOrderItem', settings);
    requirePermission(session, 'sendOrderToProduction', settings);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.some((item) => Number(item?.quantity || 0) !== 1)) {
      requirePermission(session, 'changeItemQuantity', settings);
    }
    if (items.some((item) => String(item?.notes || '').trim())) {
      requirePermission(session, 'editItemNotes', settings);
    }
    return;
  }

  if (routeKey === 'POST /api/service-requests' || routeKey === 'POST /api/tables/request-bill') {
    return;
  }

  if (routeKey === 'POST /api/orders/status') {
    if (allowPublicOperationalOrigin(body)) return;
    if (session?.stationAccess && body?.status === 'ready') return;
    requirePermission(session, 'sendOrderToProduction', await getSettings());
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
    'POST /api/service-requests/resolve': 'resolveServiceRequest',
    'POST /api/catalog/category': 'manageCategories',
    'POST /api/catalog/category/delete': 'manageCategories',
    'POST /api/catalog/category/visibility': 'manageCategories',
    'POST /api/catalog/product/delete': 'deleteProduct',
    'POST /api/catalog/product/visibility': 'toggleProductVisibility',
    'POST /api/catalog/modifier-group': 'manageOptionals',
    'POST /api/catalog/modifier-group/delete': 'manageOptionals',
    'POST /api/catalog/modifier-group/link': 'manageOptionals',
    'POST /api/settings': 'manageSettings',
    'POST /api/qrcodes/regenerate': 'managePDVPermissions',
    'POST /api/service-requests/clear': 'manageSettings',
    'POST /api/audit-logs/list': 'viewSalesTotals',
    'POST /api/sellers': 'managePDVUsers',
    'POST /api/sellers/pin': 'managePDVUsers',
    'POST /api/sellers/delete': 'managePDVUsers',
    'POST /api/sellers/status': 'managePDVUsers',
    'POST /api/inventory/sync-beverages': 'confirmPurchaseEntry',
    'POST /api/inventory/sync-open-orders': 'manageSettings',
    'POST /api/tables/status': 'updateTableStatus',
    'POST /api/tables/open': 'openTable',
    'POST /api/tables/transfer': 'transferTable',
    'POST /api/tables/join': 'joinTables',
    'POST /api/cash/open': 'openCash',
    'POST /api/cash/close': 'closeCash',
  };

  const requiredPermission = permissionByRoute[routeKey];
  if (requiredPermission) {
    requirePermission(session, requiredPermission, await getSettings());
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
  'POST /api/audit-logs/list': async (body) => ({
    auditLogs: await getAuditLogs({
      limit: Number(body.limit || 100),
      startDate: String(body.startDate || ''),
      endDate: String(body.endDate || ''),
      author: String(body.author || ''),
      action: String(body.action || ''),
    })
  }),
  'POST /api/orders/send-to-kitchen': async (body, context) => sendToKitchen(body, context.session),
  'POST /api/orders/status': async (body) => updateOrderStatus(body),
  'POST /api/order-items/delete': async (body, context) => deleteOrderItem(body, context.session),
  'POST /api/bills/close': async (body, context) => closeBillWithInventorySync(body, context.session),
  'POST /api/catalog/category': async (body) => upsertCategory(body),
  'POST /api/catalog/category/delete': async (body) => deleteCategory(body),
  'POST /api/catalog/category/visibility': async (body) => toggleCategoryVisibility(body),
  'POST /api/catalog/product': async (body, context) => upsertProduct(body, context.session),
  'POST /api/catalog/product/delete': async (body) => deleteProduct(body),
  'POST /api/catalog/product/visibility': async (body) => toggleProductVisibility(body),
  'POST /api/catalog/modifier-group': async (body) => saveModifierGroup(body),
  'POST /api/catalog/modifier-group/delete': async (body) => deleteModifierGroup(body),
  'POST /api/catalog/modifier-group/link': async (body) => linkModifierGroup(body),
  'POST /api/settings': async (body, context) => saveSettings(body, context.session),
  'POST /api/qrcodes/regenerate': async (body, context) => regenerateTableQr(body, context.session),
  'POST /api/audit-logs': async (body) => addAuditLog(body),
  'POST /api/service-requests': async (body) => createServiceRequest(body),
  'POST /api/service-requests/resolve': async (body) => resolveServiceRequest(body),
  'POST /api/service-requests/clear': async (body) => clearServiceRequest(body),
  'POST /api/tables/request-bill': async (body) => requestBill(body),
  'POST /api/tables/status': async (body, context) => updateTableStatus(body, context.session),
  'POST /api/tables/open': async (body, context) => openTable(body, context.session),
  'POST /api/tables/transfer': async (body, context) => transferTable(body, context.session),
  'POST /api/tables/join': async (body, context) => joinTables(body, context.session),
  'GET /api/cash/status': async () => ({ cashState: await getCashState() }),
  'POST /api/cash/open': async (body, context) => openCash(body, context.session),
  'POST /api/cash/close': async (body, context) => closeCash(body, context.session),
  'POST /api/shifts/open': async (body) => openShift(body),
  'POST /api/shifts/close': async (body) => closeShift(body),
  'POST /api/sellers': async (body) => addSeller(body),
  'POST /api/sellers/pin': async (body) => updateSellerPin(body),
  'POST /api/sellers/delete': async (body) => deleteSeller(body),
  'POST /api/sellers/status': async (body) => updateSellerStatus(body),
  'POST /api/inventory/sync-beverages': async () => syncBeveragesFromInventory(),
  'POST /api/inventory/sync-open-orders': async () => syncOpenOrdersInventory(),
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
    const isLoginRoute = routeKey === 'POST /api/auth/login' || routeKey === 'POST /api/tablet/setup-login';
    // Login por PIN nunca deve herdar permissão de uma sessão antiga. Isso evita
    // que um token admin salvo no navegador libere PIN de colaborador fora da rede.
    const operationAccessAllowed = isOperationIpAllowed(req) || (!isLoginRoute && isAdminSession(session));
    await enforceRouteAccess(routeKey, body, session, { operationAccessAllowed, req });
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
