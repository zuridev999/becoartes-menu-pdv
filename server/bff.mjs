import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createClient } from '@libsql/client';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const port = Number(process.env.PORT || 80);

const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN;
const isLocalLibsqlUrl = /^file:/i.test(String(tursoUrl || ''));
const OS_EMPRESA_ID = process.env.OS_EMPRESA_ID || process.env.VITE_OS_EMPRESA_ID || 'e19cbcce-b2a7-4cc1-bf70-c06d2f8feb8a';
const OS_TENANT_SLUG = process.env.OS_TENANT_SLUG || process.env.VITE_OS_TENANT_SLUG || 'becoartes';
const OS_SYSTEM_USER_ID = process.env.OS_SYSTEM_USER_ID || process.env.VITE_OS_SYSTEM_USER_ID || '';
const DELIVERY_OS_CRM_SYNC = process.env.DELIVERY_OS_CRM_SYNC || 'disabled';
const DELIVERY_OS_CRM_URL = process.env.DELIVERY_OS_CRM_URL || 'https://os.becoartes.com/api/delivery/clientes';
const DELIVERY_OS_SYNC_SECRET = process.env.DELIVERY_OS_SYNC_SECRET || '';
const BOOTSTRAP_ADMIN_PIN = process.env.BOOTSTRAP_ADMIN_PIN || process.env.VITE_BOOTSTRAP_ADMIN_PIN || '';
const DEFAULT_MANAGER_PIN = process.env.DEFAULT_MANAGER_PIN || process.env.VITE_DEFAULT_MANAGER_PIN || '2020';
const DEFAULT_OPERATOR_PIN = process.env.DEFAULT_OPERATOR_PIN || process.env.VITE_DEFAULT_OPERATOR_PIN || '0040';
const TABLET_SETUP_PIN = process.env.TABLET_SETUP_PIN || process.env.VITE_TABLET_SETUP_PIN || '0040';
const ADMIN_BYPASS_PIN = process.env.ADMIN_BYPASS_PIN || '0719';
const ALLOWED_OPERATION_IPS = (process.env.ALLOWED_OPERATION_IPS || '')
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);
const ALLOWED_WEB_ORIGINS = (process.env.ALLOWED_WEB_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const SESSION_SECRET = process.env.BFF_SESSION_SECRET || process.env.JWT_SECRET || tursoAuthToken || (isLocalLibsqlUrl ? 'local-delivery-session-secret' : undefined);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PROCESSING_STALE_MS = 10 * 60 * 1000;
const SERVICE_REQUEST_LIMIT = Number(process.env.SERVICE_REQUEST_LIMIT || 150);
const CLOSED_BILLS_LIMIT = Number(process.env.CLOSED_BILLS_LIMIT || 200);
const AUDIT_LOG_LIMIT = Number(process.env.AUDIT_LOG_LIMIT || 100);
const CASH_SANDBOX_MODE = process.env.CASH_SANDBOX_MODE === '1';
const CASH_TABLE = CASH_SANDBOX_MODE ? 'pdv_cash_sandbox' : 'caixa_diario';
const DEFAULT_PAYMENT_METHOD = 'credit';
const DELIVERY_PAYMENT_PROVIDER = process.env.DELIVERY_PAYMENT_PROVIDER || 'mock';
const DELIVERY_LOGISTICS_PROVIDER = process.env.DELIVERY_LOGISTICS_PROVIDER || 'disabled';
const DELIVERY_KITCHEN_DISPATCH_MODE = process.env.DELIVERY_KITCHEN_DISPATCH_MODE || 'mock';
const DELIVERY_PUBLIC_STATUS = process.env.DELIVERY_PUBLIC_STATUS || 'building';
const PAGBANK_API_BASE_URL = process.env.PAGBANK_API_BASE_URL || 'https://api.pagseguro.com';
const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN || '';
const PAGBANK_NOTIFICATION_URL = process.env.PAGBANK_NOTIFICATION_URL || '';
const PAGBANK_REDIRECT_URL = process.env.PAGBANK_REDIRECT_URL || '';
const IFOOD_API_BASE_URL = process.env.IFOOD_API_BASE_URL || 'https://merchant-api.ifood.com.br';
const IFOOD_ACCESS_TOKEN = process.env.IFOOD_ACCESS_TOKEN || '';
const IFOOD_MERCHANT_ID = process.env.IFOOD_MERCHANT_ID || '';
const IFOOD_SHIPPING_MODE = process.env.IFOOD_SHIPPING_MODE || 'dry_run';
const IFOOD_PREPARATION_TIME_SECONDS = Number(process.env.IFOOD_PREPARATION_TIME_SECONDS || 900);
const DELIVERY_GEOCODER_PROVIDER = process.env.DELIVERY_GEOCODER_PROVIDER || 'mock';
const DELIVERY_MOCK_LATITUDE = Number(process.env.DELIVERY_MOCK_LATITUDE || -23.5505);
const DELIVERY_MOCK_LONGITUDE = Number(process.env.DELIVERY_MOCK_LONGITUDE || -46.6333);
const DELIVERY_POSTAL_CODE_PROVIDER = process.env.DELIVERY_POSTAL_CODE_PROVIDER || 'mock';
const DELIVERY_WEBHOOK_SECRET = process.env.DELIVERY_WEBHOOK_SECRET || '';
const DELIVERY_EMAIL_PROVIDER = process.env.DELIVERY_EMAIL_PROVIDER || 'mock';
const DELIVERY_SMS_PROVIDER = process.env.DELIVERY_SMS_PROVIDER || 'mock';
const DELIVERY_WHATSAPP_PROVIDER = process.env.DELIVERY_WHATSAPP_PROVIDER || 'mock';
const DELIVERY_EMAIL_WEBHOOK_URL = process.env.DELIVERY_EMAIL_WEBHOOK_URL || '';
const DELIVERY_SMS_WEBHOOK_URL = process.env.DELIVERY_SMS_WEBHOOK_URL || '';
const DELIVERY_WHATSAPP_WEBHOOK_URL = process.env.DELIVERY_WHATSAPP_WEBHOOK_URL || '';
const DELIVERY_NOTIFICATION_WEBHOOK_SECRET = process.env.DELIVERY_NOTIFICATION_WEBHOOK_SECRET || '';
const DELIVERY_VIRTUAL_TABLE_ID = 'delivery_virtual';
const DELIVERY_CLUB_CYCLE_SIZE = Math.max(1, Number(process.env.DELIVERY_CLUB_CYCLE_SIZE || 10));
const DELIVERY_CLUB_REWARD_LABEL = process.env.DELIVERY_CLUB_REWARD_LABEL || '1 prato gratuito';
const DELIVERY_DEFAULT_COUPONS = [
  { code: 'BECO10', type: 'percent', value: 10, maxDiscount: 30, minSubtotal: 0, label: '10% de desconto' },
];

if (!tursoUrl || (!tursoAuthToken && !isLocalLibsqlUrl)) {
  throw new Error('Missing Turso configuration for BFF runtime.');
}

const db = createClient({
  url: tursoUrl,
  ...(tursoAuthToken ? { authToken: tursoAuthToken } : {}),
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
const toStockAmount = (value) => Number(Math.max(0, Number(value || 0)).toFixed(4));
const getBusinessDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const formatMoneyForNotification = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hashToken = (value) => createHash('sha256').update(String(value || '')).digest('hex');
const generateNumericCode = () => String(Math.floor(100000 + Math.random() * 900000));
const DELIVERY_PASSWORD_KEYLEN = 64;
const hashDeliveryPassword = (password, salt = randomBytes(16).toString('hex')) => {
  const hash = scryptSync(String(password || ''), salt, DELIVERY_PASSWORD_KEYLEN).toString('hex');
  return `scrypt:${salt}:${hash}`;
};
const hashLegacyDeliveryPassword = (password, salt = createId()) => {
  const hash = createHash('sha256').update(`${salt}:${password}:becoartes_delivery_2026`).digest('hex');
  return `${salt}:${hash}`;
};
const verifyDeliveryPassword = (password, storedHash = '') => {
  const parts = String(storedHash || '').split(':');
  if (parts.length === 3 && parts[0] === 'scrypt') {
    const [, salt, stored] = parts;
    if (!salt || !stored) return { ok: false, needsRehash: false };
    const actual = scryptSync(String(password || ''), salt, DELIVERY_PASSWORD_KEYLEN);
    const expected = Buffer.from(stored, 'hex');
    return {
      ok: expected.length === actual.length && timingSafeEqual(expected, actual),
      needsRehash: false,
    };
  }
  const [salt] = parts;
  if (!salt) return { ok: false, needsRehash: false };
  return {
    ok: hashLegacyDeliveryPassword(password, salt) === storedHash,
    needsRehash: true,
  };
};

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

const normalizeDeliveryCoupon = (coupon = {}) => {
  const code = normalizeText(coupon.code).toUpperCase();
  if (!code) return null;
  const type = coupon.type === 'fixed' ? 'fixed' : 'percent';
  const value = Number(coupon.value || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const maxDiscount = coupon.maxDiscount === undefined || coupon.maxDiscount === null || coupon.maxDiscount === ''
    ? null
    : Math.max(0, Number(coupon.maxDiscount || 0));
  const minSubtotal = Math.max(0, Number(coupon.minSubtotal || 0));
  return {
    code,
    type,
    value,
    maxDiscount: Number.isFinite(maxDiscount) ? maxDiscount : null,
    minSubtotal,
    label: normalizeText(coupon.label) || (type === 'fixed' ? `R$ ${value} de desconto` : `${value}% de desconto`),
  };
};

const getDeliveryCoupons = () => {
  const configured = process.env.DELIVERY_COUPONS_JSON;
  if (!configured) return DELIVERY_DEFAULT_COUPONS;
  try {
    const parsed = JSON.parse(configured);
    const coupons = (Array.isArray(parsed) ? parsed : [])
      .map(normalizeDeliveryCoupon)
      .filter(Boolean);
    return coupons.length ? coupons : DELIVERY_DEFAULT_COUPONS;
  } catch (error) {
    console.error('DELIVERY_COUPONS_JSON invalido; usando cupom padrao.', error);
    return DELIVERY_DEFAULT_COUPONS;
  }
};

const hashPin = (pin) => createHash('sha256').update(`${pin}becoartes_salt_2024`).digest('hex');
const isLegacyPlainPin = (storedPin) => /^\d{4}$/.test(String(storedPin || ''));
const toSessionSeller = (seller) => ({ ...seller, pin: '' });
const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const DELIVERY_COUPONS = getDeliveryCoupons();
const normalizeSellerIdentity = (value) => normalizeText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();
const PDV_SYSTEM_SELLER_IDS = new Set(['admin-bootstrap', 'manager-default', 'operator-default']);
const isPdvSystemSeller = (seller) => PDV_SYSTEM_SELLER_IDS.has(String(seller?.id || ''));
const getSellerPriority = (seller) => {
  if (isPdvSystemSeller(seller)) return 0;
  if (seller?.source === 'os') return 1;
  return 2;
};
const dedupeSellersByIdentity = (sellers = []) => {
  const sorted = [...sellers].sort((a, b) => {
    const statusPriority = Number(b.status === 'active') - Number(a.status === 'active');
    if (statusPriority) return statusPriority;
    return getSellerPriority(a) - getSellerPriority(b);
  });
  const seen = new Set();
  const selectedIds = new Set();

  for (const seller of sorted) {
    const key = normalizeSellerIdentity(seller?.name || '');
    if (!key) {
      selectedIds.add(seller.id);
      continue;
    }

    if (isPdvSystemSeller(seller)) {
      selectedIds.add(seller.id);
      continue;
    }

    if (seen.has(key)) continue;
    seen.add(key);
    selectedIds.add(seller.id);
  }

  return sellers.filter((seller) => selectedIds.has(seller.id));
};
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
    manageCoupons: true,
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
    manageCoupons: false,
    manageRoles: false,
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
    manageCoupons: false,
    manageRoles: false,
    manageOptionals: true,
    addProduct: true,
    editProduct: true,
    editProductPrice: false,
    deleteProduct: false,
    toggleProductVisibility: true,
    manageCategories: true,
    sellUnavailableProduct: true,
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

const getEffectiveSessionPermissions = (session, settings = null) => {
  const profile = normalizePermission(session?.permission);
  const sessionId = String(session?.id || '').trim();
  const rawSessionId = sessionId.replace(/^os:/, '');
  const userPermissionAliases = Array.from(new Set([sessionId, rawSessionId, rawSessionId ? `os:${rawSessionId}` : ''].filter(Boolean)));
  const userPermissionOverrides = userPermissionAliases.reduce((acc, id) => ({
    ...acc,
    ...(settings?.pdvUserPermissions?.[id] || {}),
  }), {});
  return {
    ...(permissionsByProfile[profile] || permissionsByProfile.operator),
    ...(settings?.pdvPermissions?.[profile] || {}),
    ...userPermissionOverrides,
    ...(profile === 'admin' ? { accessPDV: true, manageSettings: true, managePDVPermissions: true, manageCoupons: true } : {}),
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

const getHeaderValue = (headers, name) => {
  const value = headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
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
    "CREATE TABLE IF NOT EXISTS sellers (id TEXT PRIMARY KEY, name TEXT NOT NULL, nickname TEXT, status TEXT NOT NULL, role TEXT NOT NULL, permission TEXT DEFAULT 'standard', pin TEXT DEFAULT '1234', notes TEXT, tipo_vinculo TEXT DEFAULT 'fixo', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, details TEXT, table_number TEXT, origin TEXT, author_id TEXT, author_name TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS closed_bills (id TEXT PRIMARY KEY, table_id TEXT, table_number INTEGER NOT NULL, seller_id TEXT, seller_name TEXT, subtotal REAL NOT NULL, service_fee REAL DEFAULT 0, discount REAL DEFAULT 0, discount_reason TEXT, coupon_code TEXT, coupon_amount REAL DEFAULT 0, coupon_benefit TEXT, total REAL NOT NULL, payments TEXT, closed_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS table_payments (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, table_number INTEGER NOT NULL, seller_id TEXT, seller_name TEXT, method TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, cancelled_at DATETIME, applied_closed_bill_id TEXT)",
    "CREATE TABLE IF NOT EXISTS pdv_coupons (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'active', note TEXT, created_by_id TEXT, created_by_name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, redeemed_at DATETIME, redeemed_table_id TEXT, redeemed_closed_bill_id TEXT, customer_id TEXT, customer_name TEXT, phone TEXT, campaign_name TEXT, valid_until DATETIME, min_order_value REAL DEFAULT 0, selected_benefit TEXT, used_by_employee_id TEXT, used_by_employee TEXT, table_number INTEGER, order_id TEXT, whatsapp_message TEXT, sent_at DATETIME, benefit_type TEXT, discount_type TEXT, target_category TEXT, target_product_id TEXT, target_product_name TEXT, free_item_name TEXT, benefit_label TEXT, rule_json TEXT)",
    "CREATE TABLE IF NOT EXISTS delivery_customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL, street TEXT, number TEXT, neighborhood TEXT, city TEXT, state TEXT, postal_code TEXT, complement TEXT, reference TEXT, latitude REAL, longitude REAL, join_club INTEGER DEFAULT 1, password_hash TEXT, email_verified INTEGER DEFAULT 0, phone_verified INTEGER DEFAULT 0, verification_code_hash TEXT, verification_code_expires_at DATETIME, reset_code_hash TEXT, reset_code_expires_at DATETIME, last_login_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS delivery_orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, subtotal REAL NOT NULL, delivery_fee REAL DEFAULT 0, discount REAL DEFAULT 0, total REAL NOT NULL, coupon_code TEXT, fulfillment TEXT NOT NULL DEFAULT 'delivery', payment_method TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'payment_pending', payment_provider TEXT, payment_external_id TEXT, checkout_url TEXT, kitchen_status TEXT NOT NULL DEFAULT 'pending', delivery_status TEXT NOT NULL DEFAULT 'pending', delivery_provider TEXT, delivery_external_id TEXT, production_order_id TEXT, customer_snapshot TEXT NOT NULL, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, paid_at DATETIME, kitchen_sent_at DATETIME, delivery_requested_at DATETIME)",
    "CREATE TABLE IF NOT EXISTS delivery_order_items (id TEXT PRIMARY KEY, delivery_order_id TEXT NOT NULL, product_id TEXT NOT NULL, name TEXT NOT NULL, quantity INTEGER NOT NULL, price_at_time REAL NOT NULL, selected_modifiers TEXT, notes TEXT)",
    "CREATE TABLE IF NOT EXISTS delivery_events (id TEXT PRIMARY KEY, delivery_order_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, provider TEXT, external_id TEXT, payload TEXT, error TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS delivery_customer_sessions (token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL)",
    "CREATE TABLE IF NOT EXISTS delivery_notifications (id TEXT PRIMARY KEY, delivery_order_id TEXT, customer_id TEXT, channel TEXT NOT NULL, type TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, destination TEXT, payload TEXT, error TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS estoque_produtos (id TEXT PRIMARY KEY, empresa_id TEXT, nome TEXT, categoria TEXT, ativo INTEGER DEFAULT 1, quantidade_atual REAL DEFAULT 0, estoque_minimo REAL DEFAULT 0, created_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS estoque_movimentacoes (id TEXT PRIMARY KEY, empresa_id TEXT, produto_id TEXT, tipo_movimentacao TEXT, quantidade REAL, quantidade_anterior REAL, quantidade_nova REAL, motivo TEXT, responsavel_id TEXT, created_at INTEGER, closed_bill_id TEXT, order_id TEXT, order_item_id TEXT, origem TEXT, integration_event_id TEXT, source_item_id TEXT, source_item_kind TEXT)",
    "CREATE TABLE IF NOT EXISTS notificacoes (id TEXT PRIMARY KEY, empresa_id TEXT, usuario_id TEXT, titulo TEXT, mensagem TEXT, tipo TEXT, lida INTEGER DEFAULT 0, link TEXT, created_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, empresa_id TEXT, nome TEXT, email TEXT, role TEXT, funcao TEXT, ativo INTEGER DEFAULT 1, pin TEXT, is_operador INTEGER DEFAULT 1, permitir_acesso_remoto INTEGER DEFAULT 0, tipo_vinculo TEXT, pdv_sell_enabled INTEGER DEFAULT 0, created_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS fichas_tecnicas (id TEXT PRIMARY KEY, empresa_id TEXT, nome_prato TEXT, status TEXT DEFAULT 'active')",
    "CREATE TABLE IF NOT EXISTS ficha_ingredientes (id TEXT PRIMARY KEY, ficha_tecnica_id TEXT, estoque_produto_id TEXT, nome_exibicao TEXT, nome_ingrediente TEXT, quantidade_usada REAL, quantidade_estoque_baixa REAL, unidade_medida TEXT, unidade_estoque_baixa TEXT)",
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
    "ALTER TABLE sellers ADD COLUMN tipo_vinculo TEXT DEFAULT 'fixo'",
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
    "ALTER TABLE closed_bills ADD COLUMN coupon_code TEXT",
    "ALTER TABLE closed_bills ADD COLUMN coupon_amount REAL DEFAULT 0",
    "ALTER TABLE closed_bills ADD COLUMN coupon_benefit TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN customer_id TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN customer_name TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN phone TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN campaign_name TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN valid_until DATETIME",
    "ALTER TABLE pdv_coupons ADD COLUMN min_order_value REAL DEFAULT 0",
    "ALTER TABLE pdv_coupons ADD COLUMN selected_benefit TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN used_by_employee_id TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN used_by_employee TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN table_number INTEGER",
    "ALTER TABLE pdv_coupons ADD COLUMN order_id TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN whatsapp_message TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN sent_at DATETIME",
    "ALTER TABLE pdv_coupons ADD COLUMN benefit_type TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN discount_type TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN target_category TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN target_product_id TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN target_product_name TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN free_item_name TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN benefit_label TEXT",
    "ALTER TABLE pdv_coupons ADD COLUMN rule_json TEXT",
    "ALTER TABLE delivery_orders ADD COLUMN payment_provider TEXT",
    "ALTER TABLE delivery_orders ADD COLUMN payment_external_id TEXT",
    "ALTER TABLE delivery_orders ADD COLUMN checkout_url TEXT",
    "ALTER TABLE delivery_orders ADD COLUMN production_order_id TEXT",
    "ALTER TABLE delivery_customers ADD COLUMN city TEXT",
    "ALTER TABLE delivery_customers ADD COLUMN state TEXT",
    "ALTER TABLE delivery_customers ADD COLUMN postal_code TEXT",
    "ALTER TABLE delivery_customers ADD COLUMN reference TEXT",
    "ALTER TABLE delivery_customers ADD COLUMN latitude REAL",
    "ALTER TABLE delivery_customers ADD COLUMN longitude REAL",
    "ALTER TABLE delivery_customers ADD COLUMN password_hash TEXT",
    "ALTER TABLE delivery_customers ADD COLUMN email_verified INTEGER DEFAULT 0",
    "ALTER TABLE delivery_customers ADD COLUMN phone_verified INTEGER DEFAULT 0",
    "ALTER TABLE delivery_customers ADD COLUMN verification_code_hash TEXT",
    "ALTER TABLE delivery_customers ADD COLUMN verification_code_expires_at DATETIME",
    "ALTER TABLE delivery_customers ADD COLUMN reset_code_hash TEXT",
    "ALTER TABLE delivery_customers ADD COLUMN reset_code_expires_at DATETIME",
    "ALTER TABLE delivery_customers ADD COLUMN last_login_at DATETIME",
    "ALTER TABLE estoque_produtos ADD COLUMN estoque_minimo REAL DEFAULT 0",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN closed_bill_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN order_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN order_item_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN origem TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN integration_event_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN source_item_id TEXT",
    "ALTER TABLE estoque_movimentacoes ADD COLUMN source_item_kind TEXT",
    "ALTER TABLE users ADD COLUMN nome TEXT",
    "ALTER TABLE users ADD COLUMN email TEXT",
    "ALTER TABLE users ADD COLUMN funcao TEXT",
    "ALTER TABLE users ADD COLUMN ativo INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN pin TEXT",
    "ALTER TABLE users ADD COLUMN is_operador INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN permitir_acesso_remoto INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN tipo_vinculo TEXT",
    "ALTER TABLE users ADD COLUMN pdv_sell_enabled INTEGER DEFAULT 0",
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
    "CREATE INDEX IF NOT EXISTS idx_table_payments_table_status ON table_payments(table_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_pdv_coupons_code_status ON pdv_coupons(code, status)",
    "CREATE INDEX IF NOT EXISTS idx_pdv_coupons_campaign_phone ON pdv_coupons(campaign_name, phone)",
    "CREATE INDEX IF NOT EXISTS idx_pdv_coupons_status_valid_until ON pdv_coupons(status, valid_until)",
    "CREATE INDEX IF NOT EXISTS idx_delivery_orders_status_created ON delivery_orders(payment_status, kitchen_status, delivery_status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_delivery_customers_phone_email ON delivery_customers(phone, email)",
    "CREATE INDEX IF NOT EXISTS idx_delivery_sessions_customer ON delivery_customer_sessions(customer_id, expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_delivery_notifications_order ON delivery_notifications(delivery_order_id, channel, type)",
    "CREATE INDEX IF NOT EXISTS idx_delivery_items_order ON delivery_order_items(delivery_order_id)",
    "CREATE INDEX IF NOT EXISTS idx_delivery_events_order ON delivery_events(delivery_order_id, type, status)",
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
  req.rawBody = raw;
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

const normalizePaymentsFingerprint = (payments = []) => JSON.stringify(
  (Array.isArray(payments) ? payments : [])
    .map((payment) => ({
      method: String(payment?.method || ''),
      amount: moneyToCents(payment?.amount || 0, 'payment.amount'),
    }))
    .sort((a, b) => a.method.localeCompare(b.method) || a.amount - b.amount),
);

const findRecentDuplicateClosedBill = async (data, windowSeconds = 30) => {
  const tableId = String(data.tableId || '');
  const tableNumber = Number(data.tableNumber || 0);
  if (!tableId || !tableNumber) return null;

  const duplicateWindowStart = Math.floor(Date.now() / 1000) - windowSeconds;
  const targetPayments = normalizePaymentsFingerprint(data.payments);
  const res = await db.execute({
    sql: `
      SELECT id, payments, closed_at
      FROM closed_bills
      WHERE table_id = ?
        AND table_number = ?
        AND ABS(subtotal - ?) < 0.005
        AND ABS(service_fee - ?) < 0.005
        AND ABS(discount - ?) < 0.005
        AND ABS(total - ?) < 0.005
        AND CAST(strftime('%s', closed_at) AS INTEGER) >= ?
      ORDER BY closed_at DESC
      LIMIT 10
    `,
    args: [
      tableId,
      tableNumber,
      Number(data.subtotal || 0),
      Number(data.serviceFee || 0),
      Number(data.discount || 0),
      Number(data.total || 0),
      duplicateWindowStart,
    ],
  });

  return res.rows.find((row) => normalizePaymentsFingerprint(parseJsonArray(row.payments)) === targetPayments) || null;
};

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
    employmentType: row.tipo_vinculo || 'fixo',
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
      SELECT id, nome, email, role, funcao, ativo, pin, is_operador, permitir_acesso_remoto, tipo_vinculo, pdv_sell_enabled
      FROM users
      WHERE empresa_id = ?
        AND COALESCE(ativo, 1) = 1
        AND (COALESCE(is_operador, 1) = 1 OR COALESCE(pdv_sell_enabled, 0) = 1)
        AND (
          (
            lower(trim(COALESCE(role, ''))) != 'freelancer'
            AND lower(trim(COALESCE(tipo_vinculo, ''))) != 'freelancer'
          )
          OR COALESCE(pdv_sell_enabled, 0) = 1
        )
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
      canSellInPdv: Boolean(Number(row.pdv_sell_enabled || 0)),
      employmentType: row.tipo_vinculo || '',
      source: 'os',
      email: row.email || '',
    }));
};

const listSellerCandidates = async () => {
  const activeSellerIds = new Set(
    (await getAuthSellers({ includePins: false }))
      .filter((seller) => seller.status === 'active')
      .map((seller) => seller.id)
  );
  const res = await db.execute({
    sql: `
      SELECT id, nome, email, role, funcao, ativo, pin, is_operador, tipo_vinculo, pdv_sell_enabled
      FROM users
      WHERE empresa_id = ?
        AND COALESCE(ativo, 1) = 1
      ORDER BY nome COLLATE NOCASE ASC
    `,
    args: [OS_EMPRESA_ID],
  });

  return res.rows
    .filter((row) => normalizeText(row.nome))
    .map((row) => ({
      id: String(row.id || ''),
      name: normalizeText(row.nome),
      email: String(row.email || ''),
      role: String(row.role || ''),
      funcao: String(row.funcao || ''),
      employmentType: String(row.tipo_vinculo || ''),
      canSellInPdv: Boolean(Number(row.pdv_sell_enabled || 0)) || activeSellerIds.has(`os:${row.id}`),
      isOperador: Boolean(Number(row.is_operador || 0)),
      hasPin: Boolean(String(row.pin || '').trim()),
    }));
};

const activateOsUserAsSeller = async ({ userId, pin }) => {
  const safeUserId = requireString(userId, 'userId');
  const safePin = String(pin || '').trim();
  if (safePin && !/^\d{4}$/.test(safePin) && !/^[a-f0-9]{64}$/i.test(safePin)) {
    const error = new Error('PIN deve ter 4 dígitos.');
    error.statusCode = 400;
    throw error;
  }

  const userRes = await db.execute({
    sql: `
      SELECT id, nome, pin, ativo
      FROM users
      WHERE empresa_id = ? AND id = ?
      LIMIT 1
    `,
    args: [OS_EMPRESA_ID, safeUserId],
  });
  const user = userRes.rows[0];
  if (!user || Number(user.ativo || 0) !== 1) {
    const error = new Error('Funcionário/freelancer não encontrado ou inativo no OS.');
    error.statusCode = 404;
    throw error;
  }

  const currentPin = String(user.pin || '').trim();
  const nextPin = currentPin || (safePin ? (isLegacyPlainPin(safePin) ? hashPin(safePin) : safePin) : '');
  if (!nextPin) {
    const error = new Error('Defina um PIN de 4 dígitos para ativar este vendedor.');
    error.statusCode = 400;
    throw error;
  }

  await db.execute({
    sql: `
      UPDATE users
      SET pdv_sell_enabled = 1,
          pin = ?
      WHERE empresa_id = ? AND id = ?
    `,
    args: [nextPin, OS_EMPRESA_ID, safeUserId],
  });

  await syncOperationalUsersToSellers();
  const sellers = await getAuthSellers({ includePins: false });
  const seller = sellers.find((item) => item.id === `os:${safeUserId}`);
  return { activated: true, seller };
};

const createOsUserAsSeller = async ({ name, pin, employmentType }) => {
  const safeName = requireString(name, 'name').trim();
  const safePin = requireString(pin, 'pin').trim();
  if (!safeName) {
    const error = new Error('Nome do vendedor é obrigatório.');
    error.statusCode = 400;
    throw error;
  }
  if (!/^\d{4}$/.test(safePin) && !/^[a-f0-9]{64}$/i.test(safePin)) {
    const error = new Error('PIN deve ter 4 dígitos.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedName = normalizeText(safeName).toLowerCase();
  const existingUsers = await db.execute({
    sql: `
      SELECT id, nome, pdv_sell_enabled
      FROM users
      WHERE empresa_id = ?
        AND COALESCE(ativo, 1) = 1
    `,
    args: [OS_EMPRESA_ID],
  });
  const existingUser = existingUsers.rows.find((row) => normalizeText(row.nome).toLowerCase() === normalizedName);
  if (existingUser) {
    const error = new Error('Já existe uma pessoa com esse nome no OS. Use vincular cadastro existente.');
    error.statusCode = 409;
    throw error;
  }

  const existingSellers = await getAuthSellers({ includePins: false });
  const existingSeller = existingSellers.find((seller) => normalizeText(seller.name).toLowerCase() === normalizedName);
  if (existingSeller) {
    const error = new Error('Já existe um vendedor com esse nome no PDV.');
    error.statusCode = 409;
    throw error;
  }

  const id = createId();
  const isFreelancer = String(employmentType || '').toLowerCase() === 'freelancer';
  const tipoVinculo = isFreelancer ? 'Freelancer' : 'CLT';
  const role = isFreelancer ? 'freelancer' : 'colaborador';
  const funcao = 'Vendedor';
  const hashedPin = isLegacyPlainPin(safePin) ? hashPin(safePin) : safePin;

  await db.execute({
    sql: `
      INSERT INTO users (
        id, empresa_id, nome, email, role, funcao, ativo, pin,
        is_operador, permitir_acesso_remoto, tipo_vinculo, pdv_sell_enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, 0, ?, 1, ?)
    `,
    args: [id, OS_EMPRESA_ID, safeName, '', role, funcao, hashedPin, tipoVinculo, osTimestamp()],
  });

  await syncOperationalUsersToSellers();
  const sellers = await getAuthSellers({ includePins: false });
  const seller = sellers.find((item) => item.id === `os:${id}`);
  return { created: true, seller };
};

const syncOperationalUsersToSellers = async () => {
  const operationalUsers = await getOperationalUsers({ includePins: true });
  for (const user of operationalUsers) {
    const mirrorId = `os:${user.id}`;
    const pin = String(user.pin || '').trim();
    await db.execute({
      sql: `
        INSERT INTO sellers (id, name, nickname, status, role, permission, pin, tipo_vinculo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          nickname = excluded.nickname,
          status = excluded.status,
          role = excluded.role,
          permission = excluded.permission,
          tipo_vinculo = excluded.tipo_vinculo,
          pin = CASE WHEN excluded.pin != '' THEN excluded.pin ELSE sellers.pin END
      `,
      args: [
        mirrorId,
        user.name,
        user.nickname,
        user.status,
        user.role,
        user.permission,
        pin ? (isLegacyPlainPin(pin) ? hashPin(pin) : pin) : '',
        user.employmentType || 'fixo',
      ],
    });
  }

  const freelancerUsers = await db.execute({
    sql: `
      SELECT id
      FROM users
      WHERE empresa_id = ?
        AND COALESCE(ativo, 1) = 1
        AND COALESCE(pdv_sell_enabled, 0) != 1
        AND (
          lower(trim(COALESCE(role, ''))) = 'freelancer'
          OR lower(trim(COALESCE(tipo_vinculo, ''))) = 'freelancer'
        )
    `,
    args: [OS_EMPRESA_ID],
  });
  for (const row of freelancerUsers.rows) {
    await db.execute({
      sql: "UPDATE sellers SET status = 'inactive' WHERE id = ?",
      args: [`os:${row.id}`],
    });
  }
};

const getAuthSellers = async ({ includePins = false } = {}) => {
  const [operationalUsers, pdvUsers] = await Promise.all([
    getOperationalUsers({ includePins }),
    getSellers({ includePins }),
  ]);
  const seenIds = new Set();
  const uniqueById = [...operationalUsers, ...pdvUsers].filter((seller) => {
    if (seenIds.has(seller.id)) return false;
    seenIds.add(seller.id);
    return true;
  });
  return dedupeSellersByIdentity(uniqueById);
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
    sql: "SELECT id, table_id, table_number, seller_id, seller_name, subtotal, service_fee, discount, discount_reason, coupon_code, coupon_amount, coupon_benefit, total, payments, strftime('%Y-%m-%dT%H:%M:%SZ', closed_at) as closed_at FROM closed_bills ORDER BY closed_at DESC LIMIT ?",
    args: [Math.min(Number(limit) || CLOSED_BILLS_LIMIT, CLOSED_BILLS_LIMIT)],
  });
  const bills = res.rows.map((row) => ({
    id: row.id,
    tableId: row.table_id || '',
    tableNumber: Number(row.table_number || 0),
    sellerId: row.seller_id || '',
    sellerName: row.seller_name || 'Sistema',
    subtotal: Number(row.subtotal || 0),
    serviceFee: Number(row.service_fee || 0),
    discount: Number(row.discount || 0),
    discountReason: row.discount_reason || '',
    couponCode: row.coupon_code || '',
    couponAmount: Number(row.coupon_amount || 0),
    couponBenefit: row.coupon_benefit || '',
    total: Number(row.total || 0),
    payments: parseJsonArray(row.payments),
    closedAt: row.closed_at || new Date().toISOString(),
  }));

  const orderIdsByBill = {};
  const allOrderIds = [];
  for (const bill of bills) {
    const prefix = `pdv_close_${bill.tableId}_`;
    const orderIds = String(bill.id || '').startsWith(prefix)
      ? String(bill.id).slice(prefix.length).split('_').filter(Boolean)
      : [];
    orderIdsByBill[bill.id] = orderIds;
    allOrderIds.push(...orderIds);
  }

  const uniqueOrderIds = Array.from(new Set(allOrderIds));
  if (uniqueOrderIds.length === 0) return bills.map((bill) => ({ ...bill, items: [] }));

  const placeholders = uniqueOrderIds.map(() => '?').join(',');
  const itemsRes = await db.execute({
    sql: `
      SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.price_at_time, oi.selected_modifiers, oi.notes,
             m.name, m.category_id, c.name as category_name
      FROM order_items oi
      LEFT JOIN menu m ON oi.product_id = m.id
      LEFT JOIN categories c ON m.category_id = c.id
      WHERE oi.order_id IN (${placeholders})
      ORDER BY oi.order_id ASC
    `,
    args: uniqueOrderIds,
  });

  const itemsByOrder = {};
  for (const row of itemsRes.rows) {
    if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
    itemsByOrder[row.order_id].push({
      id: row.id,
      orderId: row.order_id,
      productId: row.product_id,
      categoryId: row.category_id || '',
      categoryName: row.category_name || '',
      name: row.name || 'Item removido do cardapio',
      price: Number(row.price_at_time || 0),
      quantity: Number(row.quantity || 0),
      selectedModifiers: parseJsonArray(row.selected_modifiers),
      notes: row.notes || '',
    });
  }

  return bills.map((bill) => ({
    ...bill,
    items: (orderIdsByBill[bill.id] || []).flatMap((orderId) => itemsByOrder[orderId] || []),
  }));
};

const getSettings = async () => {
  const res = await db.execute("SELECT value FROM app_settings WHERE key = 'settings' LIMIT 1");
  return parseJsonObject(res.rows[0]?.value) || null;
};

const DEFAULT_PDV_LOCK_MESSAGE = 'PDV bloqueado. Consultar mensagens no celular.';

const getPdvLockState = async () => {
  const res = await db.execute("SELECT value, updated_at FROM app_settings WHERE key = 'pdv_lock_state' LIMIT 1");
  const value = parseJsonObject(res.rows[0]?.value) || {};
  return {
    locked: Boolean(value.locked),
    message: String(value.message || DEFAULT_PDV_LOCK_MESSAGE),
    lockedById: value.lockedById || '',
    lockedByName: value.lockedByName || '',
    updatedAt: value.updatedAt || res.rows[0]?.updated_at || '',
  };
};

const setPdvLockState = async ({ locked, message }, session = null) => {
  const state = {
    locked: Boolean(locked),
    message: String(message || DEFAULT_PDV_LOCK_MESSAGE),
    lockedById: session?.id || '',
    lockedByName: session?.name || 'Sistema',
    updatedAt: new Date().toISOString(),
  };

  await db.execute({
    sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('pdv_lock_state', ?, CURRENT_TIMESTAMP)",
    args: [JSON.stringify(state)],
  });

  await addAuditLog({
    id: createId(),
    action: state.locked ? 'pdv_locked' : 'pdv_unlocked',
    details: JSON.stringify({ message: state.message }),
    origin: 'pdv',
    authorId: session?.id || '',
    authorName: session?.name || 'Sistema',
    timestamp: new Date().toISOString(),
  });

  return state;
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
  const paymentsRes = await db.execute(`
    SELECT id, table_id, table_number, seller_id, seller_name, method, amount, status, strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at
    FROM table_payments
    WHERE status = 'active'
    ORDER BY created_at ASC
  `);
  const paymentsByTable = {};
  paymentsRes.rows.forEach((row) => {
    if (!paymentsByTable[row.table_id]) paymentsByTable[row.table_id] = [];
    paymentsByTable[row.table_id].push({
      id: row.id,
      tableId: row.table_id,
      tableNumber: Number(row.table_number || 0),
      sellerId: row.seller_id || '',
      sellerName: row.seller_name || 'Sistema',
      method: row.method,
      amount: Number(row.amount || 0),
      status: row.status,
      createdAt: row.created_at || new Date().toISOString(),
    });
  });

  return tableRes.rows.map((row) => ({
    id: row.id,
    number: Number(row.number),
    status: row.status,
    orders: ordersByTable[row.id] || [],
    payments: paymentsByTable[row.id] || [],
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
  await syncOperationalUsersToSellers();
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
  const safeView = ['tablet', 'qr', 'delivery', 'kitchen', 'bar', 'pdv', 'admin'].includes(view) ? view : 'pdv';
  const canViewSales = canSessionWithSettings(session, 'viewSalesTotals', snapshot.savedSettings);
  const canManageTeam = canSessionWithSettings(session, 'manageTeam', snapshot.savedSettings);

  if (safeView === 'tablet' || safeView === 'qr' || safeView === 'delivery') {
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
  const safeView = ['tablet', 'qr', 'delivery', 'kitchen', 'bar', 'pdv', 'admin'].includes(view) ? view : 'pdv';
  const isPublicCustomerView = safeView === 'qr' || safeView === 'delivery';

  if (!isPublicCustomerView && !operationAccessAllowed && !canAccessOutsideOperationIp(session)) {
    return getRestrictedSnapshot(safeView);
  }

  await ensureDatabaseReady();
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

  if (!sellerId && isAdminBypassPin(safePin)) {
    return createAdminBypassSession();
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

const resolveCashActorByPin = async (pin, requiredPermission) => {
  const safePin = String(pin || '');
  if (!/^\d{4}$/.test(safePin)) {
    const error = new Error('Digite o PIN de 4 dígitos para confirmar a ação do caixa.');
    error.statusCode = 403;
    throw error;
  }

  if (isAdminBypassPin(safePin)) {
    return { seller: createAdminBypassSession().seller, override: true };
  }

  const activeSellers = (await getAuthSellers({ includePins: true }))
    .filter((seller) => seller.status === 'active');

  for (const seller of activeSellers) {
    const storedPin = seller.pin || '';
    const isMatch = isLegacyPlainPin(storedPin) ? storedPin === safePin : storedPin === hashPin(safePin);
    if (!isMatch) continue;

    if (isLegacyPlainPin(storedPin)) {
      await updateSellerPin({ id: seller.id, pin: hashPin(safePin) });
    }

    const safeSeller = toSessionSeller(seller);
    if (!canSessionWithSettings(safeSeller, requiredPermission, await getSettings())) {
      const error = new Error('PIN reconhecido, mas sem permissão para esta ação do caixa.');
      error.statusCode = 403;
      throw error;
    }

    return { seller: safeSeller, override: false };
  }

  const error = new Error('PIN não encontrado ou usuário inativo.');
  error.statusCode = 403;
  throw error;
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
        COALESCE(c.name, '') as categoryName,
        COALESCE(m.category_id, '') as categoryId,
        COALESCE(m.remote_stock_id, '') as remoteStockId,
        oi.price_at_time as price,
        oi.quantity,
        oi.selected_modifiers as selectedModifiers
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN menu m ON oi.product_id = m.id
      LEFT JOIN categories c ON m.category_id = c.id
      WHERE o.table_id = ? AND o.status != 'closed'
    `,
    args: [tableId],
  });

  return res.rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    productId: row.productId,
    name: row.name || '',
    categoryId: row.categoryId || '',
    categoryName: row.categoryName || '',
    remoteStockId: row.remoteStockId || '',
    price: Number(row.price || 0),
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

const normalizeRecipeLookupName = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\b(pra|para)\s*(dois|2)\b/g, ' p2 ')
  .replace(/\bp\s*\/?\s*2\b/g, ' p2 ')
  .replace(/\b(pra|para)\s*(um|1)\b/g, ' p1 ')
  .replace(/\bp\s*\/?\s*1\b/g, ' p1 ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const stripRecipeServing = (value) => normalizeRecipeLookupName(value)
  .replace(/\bp[12]\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const getRecipeServing = (value) => {
  const normalized = normalizeRecipeLookupName(value);
  if (/\bp2\b/.test(normalized)) return 'p2';
  if (/\bp1\b/.test(normalized)) return 'p1';
  return '';
};

const hasConflictingFlavorToken = (soldName, fichaName) => {
  const soldTokens = new Set(normalizeRecipeLookupName(soldName).split(' ').filter(Boolean));
  const fichaTokens = normalizeRecipeLookupName(fichaName).split(' ').filter(Boolean);
  const flavorTokens = new Set(['zero', 'mango', 'loco', 'melancia', 'ipa', 'artesanal', 'premium', 'importado', 'nacional']);
  return fichaTokens.some((token) => flavorTokens.has(token) && !soldTokens.has(token));
};

const isLooseRecipeNameMatch = (soldName, fichaName) => {
  const soldBase = stripRecipeServing(soldName);
  const fichaBase = stripRecipeServing(fichaName);
  if (!soldBase || !fichaBase) return false;
  if (soldBase === fichaBase) return true;
  if (hasConflictingFlavorToken(soldName, fichaName)) return false;

  const ignored = new Set(['lata', 'long', 'neck', 'garrafa', 'ml', 'un', 'und']);
  const soldTokens = soldBase.split(' ').filter((token) => token && !ignored.has(token) && !/^\d+$/.test(token));
  const fichaTokens = new Set(fichaBase.split(' ').filter((token) => token && !ignored.has(token) && !/^\d+$/.test(token)));
  return soldTokens.length > 0 && soldTokens.every((token) => fichaTokens.has(token));
};

const findFichaTecnicaForSoldItem = async (empresaId, candidates) => {
  const soldId = String(candidates.id || '').trim();
  const soldName = String(candidates.name || '').trim();
  if (!soldId && !soldName) return null;

  const res = await db.execute({
    sql: `
      SELECT
        ft.*,
        COUNT(fi.id) AS ingredientes_count
      FROM fichas_tecnicas ft
      LEFT JOIN ficha_ingredientes fi ON fi.ficha_tecnica_id = ft.id
      WHERE ft.empresa_id = ?
      GROUP BY ft.id
    `,
    args: [empresaId],
  });

  const soldNorm = normalizeRecipeLookupName(soldName);
  const soldServing = getRecipeServing(soldName);
  const score = (row) => {
    const pdvName = String(row.pdv_product_name || '');
    const fichaName = String(row.nome_prato || '');
    const names = [pdvName, fichaName].filter(Boolean);
    const nameNorms = names.map(normalizeRecipeLookupName);
    const serving = getRecipeServing(`${pdvName} ${fichaName}`);

    if (soldNorm && nameNorms.includes(soldNorm)) return 0;
    if (soldName && names.some((name) => isLooseRecipeNameMatch(soldName, name))) {
      if (soldServing && serving && soldServing !== serving) return 999;
      return 1;
    }
    if (soldId && row.pdv_product_id === soldId) {
      if (soldServing && serving && soldServing !== serving) return 999;
      if (!soldServing && serving === 'p2') return 30;
      return 5;
    }
    return 999;
  };

  return res.rows
    .map((row) => ({ row, score: score(row) }))
    .filter((entry) => entry.score < 999)
    .sort((a, b) => (
      a.score - b.score
      || Number(b.row.ingredientes_count || 0) - Number(a.row.ingredientes_count || 0)
      || Number(b.row.custo_total || 0) - Number(a.row.custo_total || 0)
      || Number(a.row.created_at || 0) - Number(b.row.created_at || 0)
    ))[0]?.row || null;
};

const getFichaIngredientStockRows = async (fichaId) => {
  const res = await db.execute({
    sql: `
      SELECT
        fi.id AS ingrediente_id,
        COALESCE(fi.nome_exibicao, fi.nome_ingrediente) AS ingrediente_nome,
        fi.quantidade_usada,
        fi.quantidade_estoque_baixa,
        fi.unidade_medida,
        fi.unidade_estoque_baixa,
        ep.*
      FROM ficha_ingredientes fi
      JOIN estoque_produtos ep ON ep.id = fi.estoque_produto_id
      WHERE fi.ficha_tecnica_id = ?
        AND ep.ativo = 1
    `,
    args: [fichaId],
  });

  return res.rows || [];
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

const appendInventoryPlansForSoldItem = async ({
  empresaId,
  movementPlans,
  result,
  orderId,
  orderItemId,
  productId,
  remoteStockId,
  name,
  quantity,
  reason,
  sourceKind,
  reportUnmatched = true,
}) => {
  const requestedQuantity = toStockAmount(quantity);
  if (requestedQuantity <= 0) return;

  const directSourceId = productId || name;
  if (await hasPdvStockMovement({ orderItemId, sourceItemKind: sourceKind, sourceItemId: directSourceId })) {
    return;
  }

  const ficha = await findFichaTecnicaForSoldItem(empresaId, { id: productId, name });
  if (ficha) {
    const ingredientRows = await getFichaIngredientStockRows(String(ficha.id));
    if (ingredientRows.length === 0) {
      result.unmatched.push(`${quantity}x ${name} (CMV sem ingrediente vinculado ao estoque)`);
    } else {
      for (const row of ingredientRows) {
        const ingredientSourceId = String(row.ingrediente_id);
        if (await hasPdvStockMovement({ orderItemId, sourceItemKind: 'recipe', sourceItemId: ingredientSourceId })) {
          continue;
        }

        const unitQuantity = toStockAmount(row.quantidade_estoque_baixa || row.quantidade_usada);
        const recipeQuantity = toStockAmount(unitQuantity * requestedQuantity);
        if (recipeQuantity <= 0) continue;

        const currentQuantity = Number(row.quantidade_atual || 0);
        const nextQuantity = Number((currentQuantity - recipeQuantity).toFixed(4));
        const stockName = row.nome || row.ingrediente_nome || name;
        if (recipeQuantity > currentQuantity) result.insufficient.push(`${stockName} (estoque insuficiente)`);
        if (nextQuantity <= Number(row.estoque_minimo || 0)) result.critical.push(stockName);

        movementPlans.push({
          movementId: createId(),
          stockId: row.id,
          stockName,
          orderId,
          orderItemId,
          sourceItemId: ingredientSourceId,
          sourceItemKind: 'recipe',
          requestedQuantity: recipeQuantity,
          previousQuantity: currentQuantity,
          nextQuantity,
          reason: `${reason} | CMV ${ficha.nome_prato}${sourceKind === 'modifier' ? ` | Opcional ${name}` : ''}`,
        });
      }
      return;
    }
  }

  const directStock = await findStockProduct(empresaId, {
    id: remoteStockId || productId,
    name,
  });

  if (!directStock) {
    if (reportUnmatched) result.unmatched.push(`${quantity}x ${name}`);
    return;
  }

  const currentQuantity = Number(directStock.quantidade_atual || 0);
  const nextQuantity = Number((currentQuantity - requestedQuantity).toFixed(4));
  if (requestedQuantity > currentQuantity) result.insufficient.push(`${name} (estoque insuficiente)`);
  if (nextQuantity <= Number(directStock.estoque_minimo || 0)) result.critical.push(name);

  movementPlans.push({
    movementId: createId(),
    stockId: directStock.id,
    stockName: directStock.nome || name,
    orderId,
    orderItemId,
    sourceItemId: directSourceId,
    sourceItemKind: sourceKind,
    requestedQuantity,
    previousQuantity: currentQuantity,
    nextQuantity,
    reason: sourceKind === 'modifier' ? `${reason} | Opcional ${name}` : reason,
  });
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
    await appendInventoryPlansForSoldItem({
      empresaId,
      movementPlans,
      result,
      orderId: item.orderId,
      orderItemId: item.id,
      productId: item.productId,
      remoteStockId: item.remoteStockId,
      name: item.name,
      quantity: item.quantity,
      reason,
      sourceKind: 'product',
    });

    for (const modifier of item.selectedModifiers || []) {
      await appendInventoryPlansForSoldItem({
        empresaId,
        movementPlans,
        result,
        orderId: item.orderId,
        orderItemId: item.id,
        productId: modifier.id,
        name: modifier.name,
        quantity: item.quantity,
        reason,
        sourceKind: 'modifier',
        reportUnmatched: Number(modifier.price || 0) > 0,
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

const notifyOrderItemCancelled = async ({ tableNumber, itemName, quantity, sellerName, sellerPermission, reasonLabel, reasonNotes }) => {
  const reasonText = reasonLabel ? ` Motivo: ${reasonLabel}${reasonNotes ? ` (${reasonNotes})` : ''}.` : '';
  return safeCreateOSNotification({
    title: 'Item cancelado no PDV',
    message: `Mesa ${tableNumber}: ${quantity}x ${itemName} cancelado por ${sellerName} (${sellerPermission}).${reasonText}`,
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
  const safeCancelContext = cancelContext && typeof cancelContext === 'object' && !Array.isArray(cancelContext)
    ? cancelContext
    : null;
  const reasonCode = normalizeText(safeCancelContext?.reasonCode);
  const reasonLabel = normalizeText(safeCancelContext?.reasonLabel);
  const reasonNotes = normalizeText(safeCancelContext?.reasonNotes);
  if (!reasonCode || !reasonLabel || reasonNotes.length < 3) {
    const error = new Error('Informe o motivo e uma justificativa para cancelar o item.');
    error.statusCode = 400;
    throw error;
  }

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

  void notifyOrderItemCancelled({
    tableNumber: Number(safeCancelContext.tableNumber || 0),
    itemName: String(safeCancelContext.itemName || 'Item'),
    quantity: Number(safeCancelContext.quantity || 0),
    sellerName: String(safeCancelContext.sellerName || 'Sistema'),
    sellerPermission: String(safeCancelContext.sellerPermission || 'standard'),
    reasonLabel,
    reasonNotes,
  });

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

const normalizeDeliveryCustomer = (customer = {}) => ({
  name: normalizeText(customer.name),
  phone: normalizeText(customer.phone),
  email: normalizeText(customer.email).toLowerCase(),
  street: normalizeText(customer.street),
  number: normalizeText(customer.number),
  neighborhood: normalizeText(customer.neighborhood),
  city: normalizeText(customer.city),
  state: normalizeText(customer.state).toUpperCase().slice(0, 2),
  postalCode: normalizeText(customer.postalCode).replace(/\D/g, ''),
  complement: normalizeText(customer.complement),
  reference: normalizeText(customer.reference),
  latitude: customer.latitude === undefined || customer.latitude === null || customer.latitude === '' ? null : Number(customer.latitude),
  longitude: customer.longitude === undefined || customer.longitude === null || customer.longitude === '' ? null : Number(customer.longitude),
  quoteId: normalizeText(customer.quoteId),
  quoteExpiresAt: normalizeText(customer.quoteExpiresAt),
  notes: normalizeText(customer.notes),
  fulfillment: customer.fulfillment === 'pickup' ? 'pickup' : 'delivery',
  paymentMethod: ['pagbank', 'pix'].includes(customer.paymentMethod) ? customer.paymentMethod : 'pagbank',
  coupon: normalizeText(customer.coupon).toUpperCase(),
  joinClub: customer.joinClub !== false,
});

const getDeliveryCouponForCode = (code) => {
  const normalizedCode = normalizeText(code).toUpperCase();
  if (!normalizedCode) return null;
  return DELIVERY_COUPONS.find((coupon) => coupon.code === normalizedCode) || null;
};

const calculateDeliveryCouponDiscount = ({ subtotal, couponCode }) => {
  const coupon = getDeliveryCouponForCode(couponCode);
  if (!coupon) return { discount: 0, coupon: null, status: couponCode ? 'not_found' : 'empty' };
  if (subtotal < coupon.minSubtotal) {
    return { discount: 0, coupon, status: 'min_subtotal_not_reached' };
  }
  const rawDiscount = coupon.type === 'fixed' ? coupon.value : subtotal * (coupon.value / 100);
  const cappedDiscount = coupon.maxDiscount === null ? rawDiscount : Math.min(rawDiscount, coupon.maxDiscount);
  return {
    discount: Number(Math.min(subtotal, Math.max(0, cappedDiscount)).toFixed(2)),
    coupon,
    status: 'applied',
  };
};

const calculateDeliveryTotals = ({ items, customer }) => {
  const subtotal = items.reduce((acc, item) => {
    const modifiersTotal = (Array.isArray(item.selectedModifiers) ? item.selectedModifiers : [])
      .reduce((sum, modifier) => sum + Number(modifier.price || 0), 0);
    return acc + (requireNumber(item.price, 'item.price') + modifiersTotal) * requireNumber(item.quantity, 'item.quantity');
  }, 0);
  const coupon = calculateDeliveryCouponDiscount({ subtotal, couponCode: customer.coupon });
  const discount = coupon.discount;
  const deliveryFee = customer.fulfillment === 'delivery' && subtotal > 0 ? 8 : 0;
  const total = Math.max(0, subtotal + deliveryFee - discount);
  return { subtotal, deliveryFee, discount, total, coupon };
};

const calculateDeliverySubtotal = (items = []) => items.reduce((acc, item) => {
  const modifiersTotal = (Array.isArray(item.selectedModifiers) ? item.selectedModifiers : [])
    .reduce((sum, modifier) => sum + Number(modifier.price || 0), 0);
  return acc + (requireNumber(item.price, 'item.price') + modifiersTotal) * requireNumber(item.quantity, 'item.quantity');
}, 0);

const deliveryAddressIsComplete = (customer = {}) => Boolean(
  normalizeText(customer.street)
  && normalizeText(customer.number)
  && normalizeText(customer.neighborhood)
  && normalizeText(customer.city)
  && normalizeText(customer.state)
  && normalizeText(customer.postalCode)
);

const lookupDeliveryPostalCode = async ({ postalCode } = {}) => {
  const safePostalCode = normalizeText(postalCode).replace(/\D/g, '');
  if (safePostalCode.length !== 8) {
    return { status: 'invalid_postal_code', provider: DELIVERY_POSTAL_CODE_PROVIDER, postalCode: safePostalCode, address: null };
  }

  if (DELIVERY_POSTAL_CODE_PROVIDER === 'disabled') {
    return { status: 'disabled', provider: 'disabled', postalCode: safePostalCode, address: null };
  }

  if (DELIVERY_POSTAL_CODE_PROVIDER !== 'viacep') {
    return {
      status: 'mock_resolved',
      provider: 'mock',
      postalCode: safePostalCode,
      address: {
        street: 'Rua Becoartes Mock',
        neighborhood: 'Centro',
        city: 'Sao Paulo',
        state: 'SP',
      },
    };
  }

  const response = await fetch(`https://viacep.com.br/ws/${safePostalCode}/json/`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.erro) {
    return { status: 'not_found', provider: 'viacep', postalCode: safePostalCode, address: null };
  }
  return {
    status: 'resolved',
    provider: 'viacep',
    postalCode: safePostalCode,
    address: {
      street: normalizeText(payload.logradouro),
      neighborhood: normalizeText(payload.bairro),
      city: normalizeText(payload.localidade),
      state: normalizeText(payload.uf).toUpperCase().slice(0, 2),
    },
  };
};

const geocodeDeliveryAddress = async (customer = {}) => {
  const normalized = normalizeDeliveryCustomer(customer);
  if (normalized.latitude && normalized.longitude) {
    return {
      status: 'provided',
      provider: 'customer',
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      confidence: 'provided',
    };
  }

  if (!deliveryAddressIsComplete(normalized)) {
    return {
      status: 'missing_address',
      provider: DELIVERY_GEOCODER_PROVIDER,
      latitude: null,
      longitude: null,
      confidence: 'none',
    };
  }

  if (DELIVERY_GEOCODER_PROVIDER === 'disabled') {
    return {
      status: 'disabled',
      provider: 'disabled',
      latitude: null,
      longitude: null,
      confidence: 'none',
    };
  }

  if (DELIVERY_GEOCODER_PROVIDER !== 'mock') {
    return {
      status: 'ready_for_homologation',
      provider: DELIVERY_GEOCODER_PROVIDER,
      latitude: null,
      longitude: null,
      confidence: 'pending_provider',
      payload: {
        address: {
          street: normalized.street,
          number: normalized.number,
          neighborhood: normalized.neighborhood,
          city: normalized.city,
          state: normalized.state,
          postalCode: normalized.postalCode,
        },
      },
    };
  }

  return {
    status: 'mock_resolved',
    provider: 'mock',
    latitude: DELIVERY_MOCK_LATITUDE,
    longitude: DELIVERY_MOCK_LONGITUDE,
    confidence: 'mock',
  };
};

const getDeliveryIntegrationMode = () => ({
  publicStatus: DELIVERY_PUBLIC_STATUS,
  paymentProvider: DELIVERY_PAYMENT_PROVIDER,
  logisticsProvider: DELIVERY_LOGISTICS_PROVIDER,
  kitchenDispatchMode: DELIVERY_KITCHEN_DISPATCH_MODE,
  paymentReady: DELIVERY_PAYMENT_PROVIDER === 'mock' || Boolean(PAGBANK_TOKEN),
  logisticsReady: DELIVERY_LOGISTICS_PROVIDER === 'mock' || Boolean(IFOOD_ACCESS_TOKEN && IFOOD_MERCHANT_ID),
  ifoodShippingMode: IFOOD_SHIPPING_MODE,
  geocoderProvider: DELIVERY_GEOCODER_PROVIDER,
  postalCodeProvider: DELIVERY_POSTAL_CODE_PROVIDER,
});

const getDeliveryClubConfig = () => ({
  enabled: true,
  cycleSize: DELIVERY_CLUB_CYCLE_SIZE,
  rewardLabel: DELIVERY_CLUB_REWARD_LABEL,
});

const getDeliveryPublicConfig = () => ({
  mode: getDeliveryIntegrationMode(),
  club: getDeliveryClubConfig(),
  coupons: DELIVERY_COUPONS.map((coupon) => ({
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    maxDiscount: coupon.maxDiscount,
    minSubtotal: coupon.minSubtotal,
    label: coupon.label,
  })),
  routes: {
    checkout: '/api/delivery/checkout',
    quote: '/api/delivery/quote',
    postalCode: '/api/delivery/postal-code',
    geocode: '/api/delivery/geocode',
    orderStatus: '/api/delivery/order?orderId=...',
    pagbankWebhook: '/api/delivery/webhooks/pagbank',
  },
  webhookSecretEnabled: Boolean(DELIVERY_WEBHOOK_SECRET),
  notifications: {
    email: DELIVERY_EMAIL_PROVIDER,
    sms: DELIVERY_SMS_PROVIDER,
    whatsapp: DELIVERY_WHATSAPP_PROVIDER,
  },
});

const createPagBankCheckoutPayload = ({ orderId, customer, items, totals }) => {
  const amountInCents = Math.round(totals.total * 100);
  const phone = splitBrazilianPhone(customer.phone);
  const notificationUrls = PAGBANK_NOTIFICATION_URL ? [PAGBANK_NOTIFICATION_URL] : [];
  const paymentMethods = customer.paymentMethod === 'pix'
    ? [{ type: 'PIX' }]
    : [{ type: 'CREDIT_CARD' }, { type: 'DEBIT_CARD' }, { type: 'PIX' }];
  const payload = {
    reference_id: orderId.slice(0, 64),
    customer: {
      name: customer.name,
      email: customer.email,
      phones: phone.areaCode && phone.number ? [{
        country: phone.countryCode,
        area: phone.areaCode,
        number: phone.number,
        type: 'MOBILE',
      }] : [],
    },
    customer_modifiable: true,
    items: items.map((item) => ({
      reference_id: String(item.productId || item.id).slice(0, 64),
      name: String(item.name || 'Item').slice(0, 100),
      quantity: Number(item.quantity || 1),
      unit_amount: Math.round(Number(item.price || 0) * 100),
    })),
    additional_amount: Math.round(totals.deliveryFee * 100),
    discount_amount: Math.round(totals.discount * 100),
    payment_methods: paymentMethods,
    soft_descriptor: 'BECOARTES',
  };

  if (notificationUrls.length > 0) {
    payload.notification_urls = notificationUrls;
    payload.payment_notification_urls = notificationUrls;
  }
  if (PAGBANK_REDIRECT_URL) {
    payload.redirect_url = PAGBANK_REDIRECT_URL;
    payload.return_url = PAGBANK_REDIRECT_URL;
  }
  if (amountInCents <= 0) payload.payment_methods = [{ type: 'PIX' }];
  return payload;
};

const prepareDeliveryPayment = async ({ orderId, customer, items, totals }) => {
  if (DELIVERY_PAYMENT_PROVIDER === 'disabled') {
    return { status: 'disabled', provider: 'disabled', externalId: null, checkoutUrl: null, payload: null };
  }

  if (DELIVERY_PAYMENT_PROVIDER !== 'pagbank') {
    return {
      status: 'paid_mock',
      provider: 'mock',
      externalId: `pagbank_mock_${createId()}`,
      checkoutUrl: null,
      payload: { total: totals.total, paymentMethod: customer.paymentMethod },
    };
  }

  const payload = createPagBankCheckoutPayload({ orderId, customer, items, totals });
  if (!PAGBANK_TOKEN) {
    return { status: 'missing_credentials', provider: 'pagbank', externalId: null, checkoutUrl: null, payload };
  }

  // Chamada real mantida atras de env explicito. Em producao, o webhook confirma o pagamento.
  const response = await fetch(`${PAGBANK_API_BASE_URL}/checkouts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${PAGBANK_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result?.message || `PagBank recusou checkout (${response.status}).`);
    error.statusCode = 502;
    throw error;
  }

  const checkoutUrl = Array.isArray(result.links)
    ? result.links.find((link) => link?.rel === 'PAY' || link?.media === 'text/html')?.href || null
    : null;

  return {
    status: 'payment_pending',
    provider: 'pagbank',
    externalId: result.id || null,
    checkoutUrl,
    payload,
  };
};

const splitBrazilianPhone = (phone = '') => {
  const digits = String(phone).replace(/\D/g, '');
  const withoutCountry = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  return {
    countryCode: '55',
    areaCode: withoutCountry.slice(0, 2),
    number: withoutCountry.slice(2, 11),
    type: 'CUSTOMER',
  };
};

const createIFoodShippingPayload = ({ orderId, customer, items, totals, quoteId = customer.quoteId || 'QUOTE_ID_FROM_DELIVERY_AVAILABILITIES' }) => ({
  customer: {
    name: String(customer.name || '').slice(0, 50),
    phone: splitBrazilianPhone(customer.phone),
  },
  delivery: {
    merchantFee: Number(totals.deliveryFee || 0),
    preparationTime: IFOOD_PREPARATION_TIME_SECONDS,
    quoteId,
    deliveryAddress: {
      postalCode: customer.postalCode,
      streetNumber: String(customer.number || '').slice(0, 20),
      streetName: String(customer.street || '').slice(0, 50),
      complement: String(customer.complement || '').slice(0, 50),
      reference: String(customer.reference || '').slice(0, 70),
      neighborhood: String(customer.neighborhood || '').slice(0, 50),
      city: String(customer.city || '').slice(0, 50),
      state: customer.state,
      country: 'BR',
      coordinates: {
        latitude: customer.latitude,
        longitude: customer.longitude,
      },
    },
  },
  items: items.map((item) => {
    const quantity = Number(item.quantity || 1);
    const unitPrice = Number(item.price || 0);
    return {
      id: String(item.productId || item.id).slice(0, 64),
      name: String(item.name || 'Item').slice(0, 50),
      quantity,
      unitPrice,
      price: unitPrice * quantity,
      optionsPrice: 0,
      totalPrice: unitPrice * quantity,
    };
  }),
  metadata: {
    source: 'becoartes',
    externalId: String(orderId).slice(-20),
  },
});

const getDeliveryQuote = async ({ customer = {}, items = [] } = {}) => {
  await ensureDatabaseReady();
  const geocode = await geocodeDeliveryAddress(customer);
  const safeCustomer = normalizeDeliveryCustomer({
    ...customer,
    latitude: customer.latitude ?? geocode.latitude,
    longitude: customer.longitude ?? geocode.longitude,
  });
  const safeItems = Array.isArray(items) ? items : [];
  const subtotal = calculateDeliverySubtotal(safeItems);

  if (safeCustomer.fulfillment === 'pickup') {
    return {
      quote: {
        status: 'not_required_pickup',
        provider: 'none',
        deliveryFee: 0,
        quoteId: null,
        expiresAt: null,
        preparationTimeSeconds: 0,
        payload: null,
      },
    };
  }

  if (DELIVERY_LOGISTICS_PROVIDER === 'disabled') {
    return {
      quote: {
        status: 'disabled',
        provider: 'disabled',
        deliveryFee: 0,
        quoteId: null,
        expiresAt: null,
        preparationTimeSeconds: IFOOD_PREPARATION_TIME_SECONDS,
        payload: null,
      },
    };
  }

  if (DELIVERY_LOGISTICS_PROVIDER !== 'ifood') {
    return {
      quote: {
        status: 'available_mock',
        provider: 'ifood_mock',
        deliveryFee: subtotal > 0 ? 8 : 0,
        quoteId: `quote_mock_${createId()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        preparationTimeSeconds: IFOOD_PREPARATION_TIME_SECONDS,
        payload: { mode: 'mock', geocode },
      },
    };
  }

  const availabilityEndpoint = `${IFOOD_API_BASE_URL}/shipping/v1.0/merchants/${IFOOD_MERCHANT_ID || '{merchantId}'}/deliveryAvailabilities`;
  if (!IFOOD_ACCESS_TOKEN || !IFOOD_MERCHANT_ID) {
    return {
      quote: {
        status: 'missing_credentials',
        provider: 'ifood',
        deliveryFee: 0,
        quoteId: null,
        expiresAt: null,
        preparationTimeSeconds: IFOOD_PREPARATION_TIME_SECONDS,
        payload: { availabilityEndpoint: `${availabilityEndpoint}?latitude={lat}&longitude={lng}`, geocode },
      },
    };
  }

  if (!safeCustomer.latitude || !safeCustomer.longitude) {
    return {
      quote: {
        status: 'missing_coordinates',
        provider: 'ifood',
        deliveryFee: 0,
        quoteId: null,
        expiresAt: null,
        preparationTimeSeconds: IFOOD_PREPARATION_TIME_SECONDS,
        payload: { availabilityEndpoint: `${availabilityEndpoint}?latitude={lat}&longitude={lng}`, geocode },
      },
    };
  }

  if (IFOOD_SHIPPING_MODE !== 'live') {
    const quoteId = safeCustomer.quoteId || `quote_dry_run_${createId()}`;
    return {
      quote: {
        status: 'ready_for_homologation',
        provider: 'ifood',
        deliveryFee: 0,
        quoteId,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        preparationTimeSeconds: IFOOD_PREPARATION_TIME_SECONDS,
        payload: {
          mode: IFOOD_SHIPPING_MODE,
          availabilityEndpoint: `${availabilityEndpoint}?latitude=${safeCustomer.latitude}&longitude=${safeCustomer.longitude}`,
          geocode,
        },
      },
    };
  }

  return {
    quote: {
      status: 'ready_for_homologation',
      provider: 'ifood',
      deliveryFee: 0,
      quoteId: safeCustomer.quoteId || null,
      expiresAt: safeCustomer.quoteExpiresAt || null,
      preparationTimeSeconds: IFOOD_PREPARATION_TIME_SECONDS,
      payload: {
        mode: 'live_not_enabled_in_code_path',
        availabilityEndpoint: `${availabilityEndpoint}?latitude=${safeCustomer.latitude}&longitude=${safeCustomer.longitude}`,
        geocode,
      },
    },
  };
};

const getDeliveryClubSummary = async (customerId) => {
  if (!customerId) return null;
  const customerRes = await db.execute({
    sql: "SELECT join_club FROM delivery_customers WHERE id = ? LIMIT 1",
    args: [customerId],
  });
  const joinClub = customerRes.rows[0]?.join_club !== 0;
  if (!joinClub) {
    return {
      enrolled: false,
      paidOrders: 0,
      cycleSize: DELIVERY_CLUB_CYCLE_SIZE,
      remainingToReward: DELIVERY_CLUB_CYCLE_SIZE,
      rewardsEarned: 0,
      rewardLabel: DELIVERY_CLUB_REWARD_LABEL,
    };
  }

  const countRes = await db.execute({
    sql: "SELECT COUNT(*) as paid_orders FROM delivery_orders WHERE customer_id = ? AND payment_status LIKE 'paid%'",
    args: [customerId],
  });
  const paidOrders = Number(countRes.rows[0]?.paid_orders || 0);
  const cycleSize = DELIVERY_CLUB_CYCLE_SIZE;
  const remainder = paidOrders % cycleSize;
  return {
    enrolled: true,
    paidOrders,
    cycleSize,
    remainingToReward: remainder === 0 && paidOrders > 0 ? 0 : cycleSize - remainder,
    rewardsEarned: Math.floor(paidOrders / cycleSize),
    rewardLabel: DELIVERY_CLUB_REWARD_LABEL,
  };
};

const deliveryCustomerPublic = (row) => row ? ({
  id: row.id,
  name: row.name || '',
  phone: row.phone || '',
  email: row.email || '',
  street: row.street || '',
  number: row.number || '',
  neighborhood: row.neighborhood || '',
  city: row.city || '',
  state: row.state || '',
  postalCode: row.postal_code || '',
  complement: row.complement || '',
  reference: row.reference || '',
  joinClub: row.join_club !== 0,
  emailVerified: row.email_verified === 1,
  phoneVerified: row.phone_verified === 1,
}) : null;

const recordDeliveryNotification = async ({ orderId = null, customerId = null, channel, type, provider, status, destination = '', payload = {}, error = null }) => {
  await db.execute({
    sql: "INSERT INTO delivery_notifications (id, delivery_order_id, customer_id, channel, type, provider, status, destination, payload, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [createId(), orderId, customerId, channel, type, provider, status, destination, JSON.stringify(payload), error],
  });
};

const sendDeliveryNotification = async ({ orderId = null, customer = {}, channel, type, message, payload = {} }) => {
  const providerByChannel = {
    email: DELIVERY_EMAIL_PROVIDER,
    sms: DELIVERY_SMS_PROVIDER,
    whatsapp: DELIVERY_WHATSAPP_PROVIDER,
  };
  const webhookUrlByChannel = {
    email: DELIVERY_EMAIL_WEBHOOK_URL,
    sms: DELIVERY_SMS_WEBHOOK_URL,
    whatsapp: DELIVERY_WHATSAPP_WEBHOOK_URL,
  };
  const destination = channel === 'email' ? customer.email : customer.phone;
  const provider = providerByChannel[channel] || 'disabled';
  const notificationPayload = {
    orderId,
    customerId: customer.id || null,
    channel,
    type,
    destination,
    customer: {
      name: customer.name || '',
      email: customer.email || '',
      phone: customer.phone || '',
    },
    message,
    payload,
    createdAt: new Date().toISOString(),
  };
  if (provider === 'webhook') {
    const webhookUrl = webhookUrlByChannel[channel] || '';
    if (!webhookUrl) {
      await recordDeliveryNotification({
        orderId,
        customerId: customer.id || null,
        channel,
        type,
        provider,
        status: 'missing_webhook_url',
        destination,
        payload: notificationPayload,
        error: `Configure DELIVERY_${channel.toUpperCase()}_WEBHOOK_URL.`,
      });
      return { channel, provider, status: 'missing_webhook_url' };
    }
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(DELIVERY_NOTIFICATION_WEBHOOK_SECRET ? { 'x-beco-delivery-notification-secret': DELIVERY_NOTIFICATION_WEBHOOK_SECRET } : {}),
        },
        body: JSON.stringify(notificationPayload),
        signal: AbortSignal.timeout(5000),
      });
      const status = response.ok ? 'sent' : 'failed';
      await recordDeliveryNotification({
        orderId,
        customerId: customer.id || null,
        channel,
        type,
        provider,
        status,
        destination,
        payload: { ...notificationPayload, responseStatus: response.status },
        error: response.ok ? null : `Webhook retornou ${response.status}`,
      });
      return { channel, provider, status };
    } catch (error) {
      await recordDeliveryNotification({
        orderId,
        customerId: customer.id || null,
        channel,
        type,
        provider,
        status: 'failed',
        destination,
        payload: notificationPayload,
        error: error instanceof Error ? error.message : String(error),
      });
      return { channel, provider, status: 'failed' };
    }
  }
  const status = provider === 'disabled' ? 'disabled' : provider === 'mock' ? 'mock_logged' : 'ready_for_provider';
  await recordDeliveryNotification({
    orderId,
    customerId: customer.id || null,
    channel,
    type,
    provider,
    status,
    destination,
    payload: notificationPayload,
  });
  return { channel, provider, status };
};

const sendDeliveryCustomerCode = async ({ customer, type }) => {
  const code = generateNumericCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const columnPrefix = type === 'reset_password' ? 'reset' : 'verification';
  await db.execute({
    sql: `UPDATE delivery_customers SET ${columnPrefix}_code_hash = ?, ${columnPrefix}_code_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [hashToken(code), expiresAt, customer.id],
  });
  await sendDeliveryNotification({
    customer,
    channel: 'email',
    type,
    message: `Seu codigo Becoartes e ${code}. Ele vale por 15 minutos.`,
    payload: { codePreview: DELIVERY_EMAIL_PROVIDER === 'mock' ? code : undefined },
  });
  await sendDeliveryNotification({
    customer,
    channel: 'sms',
    type,
    message: `Becoartes: codigo ${code}`,
    payload: { codePreview: DELIVERY_SMS_PROVIDER === 'mock' ? code : undefined },
  });
  await sendDeliveryNotification({
    customer,
    channel: 'whatsapp',
    type,
    message: `Becoartes: seu codigo e ${code}`,
    payload: { codePreview: DELIVERY_WHATSAPP_PROVIDER === 'mock' ? code : undefined },
  });
  return { expiresAt, code: (DELIVERY_EMAIL_PROVIDER === 'mock' || DELIVERY_SMS_PROVIDER === 'mock' || DELIVERY_WHATSAPP_PROVIDER === 'mock') ? code : undefined };
};

const createDeliveryCustomerSession = async (customerId) => {
  const token = createId() + createId();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  await db.execute({
    sql: "INSERT INTO delivery_customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)",
    args: [hashToken(token), customerId, expiresAt],
  });
  await db.execute({
    sql: "UPDATE delivery_customers SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [customerId],
  });
  return { token, expiresAt };
};

const getDeliveryCustomerBySession = async (token = '') => {
  const safeToken = normalizeText(token);
  if (!safeToken) return null;
  const sessionRes = await db.execute({
    sql: "SELECT customer_id FROM delivery_customer_sessions WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP LIMIT 1",
    args: [hashToken(safeToken)],
  });
  const customerId = sessionRes.rows[0]?.customer_id;
  if (!customerId) return null;
  const customerRes = await db.execute({
    sql: "SELECT * FROM delivery_customers WHERE id = ? LIMIT 1",
    args: [customerId],
  });
  return customerRes.rows[0] || null;
};

const findDeliveryCustomerIdentity = async ({ email = '', phone = '' } = {}) => {
  const safeEmail = normalizeText(email).toLowerCase();
  const safePhone = normalizeText(phone).replace(/\D/g, '');
  if (!safeEmail && !safePhone) return null;
  const clauses = [];
  const args = [];
  if (safeEmail) {
    clauses.push('email = ?');
    args.push(safeEmail);
  }
  if (safePhone) {
    clauses.push("replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', '') = ?");
    args.push(safePhone);
  }
  const res = await db.execute({
    sql: `SELECT * FROM delivery_customers WHERE ${clauses.join(' OR ')} ORDER BY updated_at DESC LIMIT 1`,
    args,
  });
  return res.rows[0] || null;
};

const createDeliveryCustomerAccount = async ({ customer = {}, password = '' } = {}) => {
  await ensureDatabaseReady();
  const safeCustomer = normalizeDeliveryCustomer(customer);
  requireString(safeCustomer.name, 'name');
  requireString(safeCustomer.phone, 'phone');
  requireString(safeCustomer.email, 'email');
  requireString(password, 'password');
  if (String(password).length < 6) throw new Error('Senha precisa ter pelo menos 6 caracteres.');

  const customerId = createHash('sha256').update(`${safeCustomer.phone}|${safeCustomer.email}`).digest('hex').slice(0, 32);
  const existing = await findDeliveryCustomerIdentity({ email: safeCustomer.email, phone: safeCustomer.phone });
  const effectiveId = existing?.id || customerId;
  await db.execute({
    sql: `
      INSERT INTO delivery_customers (id, name, phone, email, street, number, neighborhood, city, state, postal_code, complement, reference, join_club, password_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        phone = excluded.phone,
        email = excluded.email,
        street = COALESCE(NULLIF(excluded.street, ''), delivery_customers.street),
        number = COALESCE(NULLIF(excluded.number, ''), delivery_customers.number),
        neighborhood = COALESCE(NULLIF(excluded.neighborhood, ''), delivery_customers.neighborhood),
        city = COALESCE(NULLIF(excluded.city, ''), delivery_customers.city),
        state = COALESCE(NULLIF(excluded.state, ''), delivery_customers.state),
        postal_code = COALESCE(NULLIF(excluded.postal_code, ''), delivery_customers.postal_code),
        complement = COALESCE(NULLIF(excluded.complement, ''), delivery_customers.complement),
        reference = COALESCE(NULLIF(excluded.reference, ''), delivery_customers.reference),
        join_club = excluded.join_club,
        password_hash = excluded.password_hash,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [effectiveId, safeCustomer.name, safeCustomer.phone, safeCustomer.email, safeCustomer.street, safeCustomer.number, safeCustomer.neighborhood, safeCustomer.city, safeCustomer.state, safeCustomer.postalCode, safeCustomer.complement, safeCustomer.reference, safeCustomer.joinClub ? 1 : 0, hashDeliveryPassword(password)],
  });
  const customerRow = (await db.execute({ sql: "SELECT * FROM delivery_customers WHERE id = ? LIMIT 1", args: [effectiveId] })).rows[0];
  const session = await createDeliveryCustomerSession(effectiveId);
  const verification = await sendDeliveryCustomerCode({ customer: customerRow, type: 'verify_account' });
  return { customer: deliveryCustomerPublic(customerRow), session, verification };
};

const loginDeliveryCustomer = async ({ identity = '', password = '' } = {}) => {
  await ensureDatabaseReady();
  const customer = await findDeliveryCustomerIdentity({ email: identity, phone: identity });
  const passwordCheck = customer ? verifyDeliveryPassword(password, customer.password_hash) : { ok: false, needsRehash: false };
  if (!customer || !passwordCheck.ok) {
    const error = new Error('E-mail/telefone ou senha invalidos.');
    error.statusCode = 401;
    throw error;
  }
  if (passwordCheck.needsRehash) {
    await db.execute({
      sql: "UPDATE delivery_customers SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [hashDeliveryPassword(password), customer.id],
    });
  }
  const session = await createDeliveryCustomerSession(customer.id);
  return { customer: deliveryCustomerPublic(customer), session };
};

const requestDeliveryPasswordReset = async ({ identity = '' } = {}) => {
  await ensureDatabaseReady();
  const customer = await findDeliveryCustomerIdentity({ email: identity, phone: identity });
  if (!customer) return { sent: true, status: 'not_found_hidden' };
  const reset = await sendDeliveryCustomerCode({ customer, type: 'reset_password' });
  return { sent: true, expiresAt: reset.expiresAt, code: reset.code };
};

const resetDeliveryCustomerPassword = async ({ identity = '', code = '', password = '' } = {}) => {
  await ensureDatabaseReady();
  const customer = await findDeliveryCustomerIdentity({ email: identity, phone: identity });
  if (!customer || !customer.reset_code_hash || customer.reset_code_hash !== hashToken(code) || new Date(customer.reset_code_expires_at).getTime() < Date.now()) {
    const error = new Error('Codigo invalido ou expirado.');
    error.statusCode = 400;
    throw error;
  }
  if (String(password).length < 6) throw new Error('Senha precisa ter pelo menos 6 caracteres.');
  await db.execute({
    sql: "UPDATE delivery_customers SET password_hash = ?, reset_code_hash = NULL, reset_code_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [hashDeliveryPassword(password), customer.id],
  });
  const session = await createDeliveryCustomerSession(customer.id);
  const updated = (await db.execute({ sql: "SELECT * FROM delivery_customers WHERE id = ? LIMIT 1", args: [customer.id] })).rows[0];
  return { customer: deliveryCustomerPublic(updated), session };
};

const verifyDeliveryCustomerCode = async ({ token = '', code = '' } = {}) => {
  await ensureDatabaseReady();
  const customer = await getDeliveryCustomerBySession(token);
  if (!customer || !customer.verification_code_hash || customer.verification_code_hash !== hashToken(code) || new Date(customer.verification_code_expires_at).getTime() < Date.now()) {
    const error = new Error('Codigo invalido ou expirado.');
    error.statusCode = 400;
    throw error;
  }
  await db.execute({
    sql: "UPDATE delivery_customers SET email_verified = 1, phone_verified = 1, verification_code_hash = NULL, verification_code_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [customer.id],
  });
  const updated = (await db.execute({ sql: "SELECT * FROM delivery_customers WHERE id = ? LIMIT 1", args: [customer.id] })).rows[0];
  return { customer: deliveryCustomerPublic(updated) };
};

const getDeliveryCustomerSession = async ({ token = '' } = {}) => {
  await ensureDatabaseReady();
  const customer = await getDeliveryCustomerBySession(token);
  return { customer: deliveryCustomerPublic(customer) };
};

const listDeliveryCustomerOrders = async ({ token = '' } = {}) => {
  await ensureDatabaseReady();
  const customer = await getDeliveryCustomerBySession(token);
  if (!customer) {
    const error = new Error('Sessao delivery obrigatoria.');
    error.statusCode = 401;
    throw error;
  }
  const ordersRes = await db.execute({
    sql: "SELECT *, strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at FROM delivery_orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50",
    args: [customer.id],
  });
  return { orders: ordersRes.rows.map((row) => rowToDeliveryOrder(row, [])) };
};

const syncDeliveryCustomerToOsCrm = async ({ orderId, customer, totalGasto = 0, source = 'checkout' } = {}) => {
  if (DELIVERY_OS_CRM_SYNC !== 'enabled') {
    return { status: 'disabled', provider: 'becoartes_os' };
  }

  if (!DELIVERY_OS_SYNC_SECRET) {
    return { status: 'missing_secret', provider: 'becoartes_os' };
  }

  const payload = {
    empresaId: OS_EMPRESA_ID,
    tenantSlug: OS_TENANT_SLUG,
    nome: customer?.name,
    telefone: customer?.phone,
    email: customer?.email,
    veioAtraves: 'delivery',
    totalGasto,
    ultimaVisita: new Date().toISOString(),
  };

  try {
    const response = await fetch(DELIVERY_OS_CRM_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-beco-delivery-secret': DELIVERY_OS_SYNC_SECRET,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json().catch(() => ({}));
    const status = response.ok && result?.ok ? 'synced' : 'failed';

    if (orderId) {
      await db.execute({
        sql: "INSERT INTO delivery_events (id, delivery_order_id, type, status, provider, external_id, payload, error) VALUES (?, ?, 'crm_sync', ?, 'becoartes_os', ?, ?, ?)",
        args: [
          createId(),
          orderId,
          status,
          result?.cliente?.id || null,
          JSON.stringify({ source, veioAtraves: 'delivery', totalGasto }),
          status === 'failed' ? (result?.error || `OS CRM recusou (${response.status})`) : null,
        ],
      });
    }

    return { status, provider: 'becoartes_os', externalId: result?.cliente?.id || null };
  } catch (error) {
    if (orderId) {
      await db.execute({
        sql: "INSERT INTO delivery_events (id, delivery_order_id, type, status, provider, payload, error) VALUES (?, ?, 'crm_sync', 'failed', 'becoartes_os', ?, ?)",
        args: [createId(), orderId, JSON.stringify({ source, veioAtraves: 'delivery', totalGasto }), error instanceof Error ? error.message : String(error)],
      });
    }
    return { status: 'failed', provider: 'becoartes_os', error: error instanceof Error ? error.message : String(error) };
  }
};

const requestDeliveryLogistics = async ({ orderId, customer, items, totals, paymentStatus }) => {
  if (customer.fulfillment === 'pickup') {
    return { status: 'not_required_pickup', provider: 'none', externalId: null, payload: null };
  }

  if (!String(paymentStatus || '').startsWith('paid')) {
    return { status: 'waiting_payment', provider: DELIVERY_LOGISTICS_PROVIDER, externalId: null, payload: null };
  }

  if (DELIVERY_LOGISTICS_PROVIDER === 'disabled') {
    return { status: 'disabled', provider: 'disabled', externalId: null, payload: null };
  }

  if (DELIVERY_LOGISTICS_PROVIDER !== 'ifood') {
    return {
      status: 'requested_mock',
      provider: 'ifood_mock',
      externalId: `ifood_mock_${createId()}`,
      payload: { dispatchMode: 'parallel_after_paid' },
    };
  }

  const payload = createIFoodShippingPayload({ orderId, customer, items, totals });
  if (!IFOOD_ACCESS_TOKEN || !IFOOD_MERCHANT_ID) {
    return { status: 'missing_credentials', provider: 'ifood', externalId: null, payload };
  }

  if (!customer.latitude || !customer.longitude) {
    return {
      status: 'missing_coordinates',
      provider: 'ifood',
      externalId: null,
      payload: {
        availabilityEndpoint: `${IFOOD_API_BASE_URL}/shipping/v1.0/merchants/${IFOOD_MERCHANT_ID}/deliveryAvailabilities?latitude={lat}&longitude={lng}`,
        orderEndpoint: `${IFOOD_API_BASE_URL}/shipping/v1.0/merchants/${IFOOD_MERCHANT_ID}/orders`,
        orderPayload: payload,
      },
    };
  }

  if (IFOOD_SHIPPING_MODE !== 'live') {
    return {
      status: 'ready_for_homologation',
      provider: 'ifood',
      externalId: null,
      payload: {
        mode: IFOOD_SHIPPING_MODE,
        availabilityEndpoint: `${IFOOD_API_BASE_URL}/shipping/v1.0/merchants/${IFOOD_MERCHANT_ID}/deliveryAvailabilities?latitude=${customer.latitude}&longitude=${customer.longitude}`,
        orderEndpoint: `${IFOOD_API_BASE_URL}/shipping/v1.0/merchants/${IFOOD_MERCHANT_ID}/orders`,
        orderPayload: payload,
      },
    };
  }

  return {
    status: 'ready_for_homologation',
    provider: 'ifood',
    externalId: null,
    payload: {
      mode: 'live_not_enabled_in_code_path',
      availabilityEndpoint: `${IFOOD_API_BASE_URL}/shipping/v1.0/merchants/${IFOOD_MERCHANT_ID}/deliveryAvailabilities?latitude=${customer.latitude}&longitude=${customer.longitude}`,
      orderEndpoint: `${IFOOD_API_BASE_URL}/shipping/v1.0/merchants/${IFOOD_MERCHANT_ID}/orders`,
      orderPayload: payload,
    },
  };
};

const rowToDeliveryOrder = (row, items = [], club = null) => {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.id,
    createdAt: row.created_at,
    total: Number(row.total || 0),
    subtotal: Number(row.subtotal || 0),
    deliveryFee: Number(row.delivery_fee || 0),
    discount: Number(row.discount || 0),
    couponCode: row.coupon_code || '',
    customer: parseJsonObject(row.customer_snapshot) || {},
    items,
    paymentStatus: row.payment_status,
    paymentProvider: row.payment_provider || null,
    paymentExternalId: row.payment_external_id || null,
    checkoutUrl: row.checkout_url || null,
    kitchenStatus: row.kitchen_status,
    deliveryStatus: row.delivery_status,
    kitchenSentAt: row.kitchen_sent_at || null,
    deliveryRequestedAt: row.delivery_requested_at || null,
    deliveryProvider: row.delivery_provider || null,
    deliveryExternalId: row.delivery_external_id || null,
    club,
  };
};

const getDeliveryOrder = async ({ orderId, includeEvents = false } = {}) => {
  await ensureDatabaseReady();
  const safeOrderId = requireString(orderId, 'orderId');
  const orderRes = await db.execute({
    sql: "SELECT *, strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at FROM delivery_orders WHERE id = ? LIMIT 1",
    args: [safeOrderId],
  });
  const row = orderRes.rows[0];
  if (!row) {
    const error = new Error('Pedido delivery não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  const itemsRes = await db.execute({
    sql: "SELECT id, delivery_order_id, product_id, name, quantity, price_at_time, selected_modifiers, notes FROM delivery_order_items WHERE delivery_order_id = ?",
    args: [safeOrderId],
  });
  const items = itemsRes.rows.map((item) => ({
    id: item.id,
    orderId: item.delivery_order_id,
    productId: item.product_id,
    name: item.name,
    price: Number(item.price_at_time || 0),
    quantity: Number(item.quantity || 0),
    selectedModifiers: parseJsonArray(item.selected_modifiers),
    notes: item.notes || '',
  }));
  const club = await getDeliveryClubSummary(row.customer_id);
  const order = rowToDeliveryOrder(row, items, club);
  if (!includeEvents) return { order };

  const eventsRes = await db.execute({
    sql: `
      SELECT id, delivery_order_id, type, status, provider, external_id, payload, error, strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at
      FROM delivery_events
      WHERE delivery_order_id = ?
      ORDER BY created_at ASC
    `,
    args: [safeOrderId],
  });
  return {
    order: {
      ...order,
      events: eventsRes.rows.map((event) => ({
        id: event.id,
        orderId: event.delivery_order_id,
        type: event.type,
        status: event.status,
        provider: event.provider || null,
        externalId: event.external_id || null,
        payload: parseJsonObject(event.payload) || parseJsonArray(event.payload) || null,
        error: event.error || null,
        createdAt: event.created_at || new Date().toISOString(),
      })),
    },
  };
};

const listDeliveryOrders = async ({ limit = 50 } = {}) => {
  await ensureDatabaseReady();
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 50)));
  const ordersRes = await db.execute({
    sql: `
      SELECT
        *,
        strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at
      FROM delivery_orders
      ORDER BY created_at DESC
      LIMIT ?
    `,
    args: [safeLimit],
  });
  return {
    orders: ordersRes.rows.map((row) => rowToDeliveryOrder(row, [])),
  };
};

const materializeDeliveryProductionOrder = async ({ orderId, items, total }) => {
  const productionOrderId = `delivery_prod_${orderId}`;
  await db.batch([
    {
      sql: "INSERT OR IGNORE INTO tables (id, number, status, last_activity) VALUES (?, ?, 'ordering', CURRENT_TIMESTAMP)",
      args: [DELIVERY_VIRTUAL_TABLE_ID, 0],
    },
    {
      sql: "INSERT OR IGNORE INTO orders (id, table_id, total, status, origin, created_by_id) VALUES (?, ?, ?, 'pending', 'delivery', NULL)",
      args: [productionOrderId, DELIVERY_VIRTUAL_TABLE_ID, total],
    },
    ...items.map((item) => ({
      sql: "INSERT OR IGNORE INTO order_items (id, order_id, product_id, quantity, price_at_time, selected_modifiers, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        `delivery_${item.id}`,
        productionOrderId,
        requireString(item.productId, 'item.productId'),
        requireNumber(item.quantity, 'item.quantity'),
        requireNumber(item.price, 'item.price'),
        JSON.stringify(item.selectedModifiers || []),
        item.notes || '',
      ],
    })),
    {
      sql: "UPDATE delivery_orders SET production_order_id = ?, kitchen_status = 'sent_production', kitchen_sent_at = COALESCE(kitchen_sent_at, ?) WHERE id = ?",
      args: [productionOrderId, new Date().toISOString(), orderId],
    },
    {
      sql: "INSERT OR IGNORE INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, 'new_order', 'pending', ?)",
      args: [`new_order_${productionOrderId}`, DELIVERY_VIRTUAL_TABLE_ID, `DELIVERY ${orderId}`],
    },
  ], 'write');

  return { productionOrderId, kitchenStatus: 'sent_production' };
};

const DELIVERY_TERMINAL_DISPATCH_STATUSES = new Set([
  'disabled',
  'requested_mock',
  'requested',
  'not_required_pickup',
  'ready_for_homologation',
]);

const dispatchPaidDeliveryOrder = async ({ orderId, source = 'system' }) => {
  await ensureDatabaseReady();
  const safeOrderId = requireString(orderId, 'orderId');
  const orderRes = await db.execute({
    sql: "SELECT * FROM delivery_orders WHERE id = ? LIMIT 1",
    args: [safeOrderId],
  });
  const row = orderRes.rows[0];
  if (!row) throw new Error('Pedido delivery não encontrado.');
  if (row.payment_status !== 'paid') return { dispatched: false, reason: 'payment_not_paid' };

  const alreadyKitchenSent = Boolean(row.kitchen_sent_at) || ['sent_mock', 'sent_production'].includes(row.kitchen_status);
  const alreadyDeliveryRequested = Boolean(row.delivery_requested_at) || DELIVERY_TERMINAL_DISPATCH_STATUSES.has(row.delivery_status);
  if (alreadyKitchenSent && alreadyDeliveryRequested) {
    return {
      dispatched: false,
      reason: 'already_dispatched',
      kitchenStatus: row.kitchen_status,
      productionOrderId: row.production_order_id || null,
      deliveryStatus: row.delivery_status,
      deliveryProvider: row.delivery_provider || null,
      deliveryExternalId: row.delivery_external_id || null,
    };
  }

  const now = new Date().toISOString();
  const customer = parseJsonObject(row.customer_snapshot) || {};
  const itemsRes = await db.execute({
    sql: "SELECT id, product_id as productId, name, quantity, price_at_time as price, selected_modifiers as selectedModifiers, notes FROM delivery_order_items WHERE delivery_order_id = ?",
    args: [safeOrderId],
  });
  const items = itemsRes.rows.map((item) => ({
    ...item,
    price: Number(item.price || 0),
    quantity: Number(item.quantity || 0),
    selectedModifiers: parseJsonArray(item.selectedModifiers),
  }));
  const totals = {
    subtotal: Number(row.subtotal || 0),
    deliveryFee: Number(row.delivery_fee || 0),
    discount: Number(row.discount || 0),
    total: Number(row.total || 0),
  };
  const production = !alreadyKitchenSent && DELIVERY_KITCHEN_DISPATCH_MODE === 'production'
    ? await materializeDeliveryProductionOrder({ orderId: safeOrderId, items, total: totals.total })
    : null;
  const logistics = alreadyDeliveryRequested
    ? {
      status: row.delivery_status,
      provider: row.delivery_provider || DELIVERY_LOGISTICS_PROVIDER,
      externalId: row.delivery_external_id || null,
      payload: { source, idempotent: true },
    }
    : await requestDeliveryLogistics({ orderId: safeOrderId, customer, items, totals, paymentStatus: 'paid' });
  const kitchenStatus = production?.kitchenStatus || (row.kitchen_status === 'sent_mock' ? row.kitchen_status : 'sent_mock');
  const kitchenSentAt = row.kitchen_sent_at || now;
  const deliveryStatus = row.delivery_status === 'requested_mock' ? row.delivery_status : logistics.status;
  const deliveryRequestedAt = row.delivery_requested_at || (logistics.status === 'requested_mock' ? now : null);

  await db.batch([
    {
      sql: "UPDATE delivery_orders SET kitchen_status = ?, delivery_status = ?, delivery_provider = ?, delivery_external_id = ?, kitchen_sent_at = ?, delivery_requested_at = ? WHERE id = ?",
      args: [kitchenStatus, deliveryStatus, logistics.provider, logistics.externalId, kitchenSentAt, deliveryRequestedAt, safeOrderId],
    },
    {
      sql: "INSERT INTO delivery_events (id, delivery_order_id, type, status, payload) VALUES (?, ?, 'kitchen', ?, ?)",
      args: [createId(), safeOrderId, kitchenStatus, JSON.stringify({ source })],
    },
    {
      sql: "INSERT INTO delivery_events (id, delivery_order_id, type, status, provider, external_id, payload) VALUES (?, ?, 'delivery', ?, ?, ?, ?)",
      args: [createId(), safeOrderId, deliveryStatus, logistics.provider, logistics.externalId, JSON.stringify(logistics.payload || { source })],
    },
  ], 'write');

  await syncDeliveryCustomerToOsCrm({
    orderId: safeOrderId,
    customer,
    totalGasto: totals.total,
    source,
  });

  return { dispatched: true, kitchenStatus, productionOrderId: production?.productionOrderId || row.production_order_id || null, deliveryStatus, deliveryProvider: logistics.provider, deliveryExternalId: logistics.externalId };
};

const getPagBankWebhookStatus = (body = {}) => {
  const candidates = [
    body.status,
    body.payment_status,
    body.charges?.[0]?.status,
    body.charges?.[0]?.payment_response?.status,
  ].filter(Boolean).map((value) => String(value).toUpperCase());
  if (candidates.some((status) => ['PAID', 'AUTHORIZED', 'APPROVED'].includes(status))) return 'paid';
  if (candidates.some((status) => ['DECLINED', 'CANCELED', 'CANCELLED'].includes(status))) return 'payment_failed';
  return 'payment_pending';
};

const getPagBankWebhookReferenceId = (body = {}) => (
  body.reference_id
  || body.referenceId
  || body.order_id
  || body.id
  || body.charges?.[0]?.reference_id
  || ''
);

const isPagBankAuthenticityTokenValid = ({ headers, rawBody }) => {
  const authenticityToken = getHeaderValue(headers, 'x-authenticity-token').trim();
  if (!authenticityToken || !PAGBANK_TOKEN || !String(rawBody || '').trim()) return false;
  const expected = createHash('sha256').update(`${PAGBANK_TOKEN}-${rawBody}`).digest('hex');
  return safeEqual(authenticityToken.toLowerCase(), expected);
};

const handlePagBankDeliveryWebhook = async (body, context = {}) => {
  await ensureDatabaseReady();
  const receivedInternalSecret = getHeaderValue(context.req?.headers, 'x-beco-delivery-secret')
    || getHeaderValue(context.req?.headers, 'x-delivery-webhook-secret');
  const internalSecretOk = DELIVERY_WEBHOOK_SECRET && safeEqual(receivedInternalSecret, DELIVERY_WEBHOOK_SECRET);
  const pagBankSignatureOk = isPagBankAuthenticityTokenValid({
    headers: context.req?.headers,
    rawBody: context.rawBody,
  });
  if ((DELIVERY_WEBHOOK_SECRET || PAGBANK_TOKEN) && !internalSecretOk && !pagBankSignatureOk) {
    const error = new Error('Webhook delivery não autorizado.');
    error.statusCode = 401;
    throw error;
  }

  const referenceId = requireString(getPagBankWebhookReferenceId(body), 'reference_id');
  const status = getPagBankWebhookStatus(body);
  const paidAt = status === 'paid' ? new Date().toISOString() : null;

  const orderRes = await db.execute({
    sql: "SELECT id FROM delivery_orders WHERE id = ? OR payment_external_id = ? LIMIT 1",
    args: [referenceId, referenceId],
  });
  const deliveryOrderId = orderRes.rows[0]?.id;
  if (!deliveryOrderId) {
    const error = new Error('Pedido delivery do webhook não encontrado.');
    error.statusCode = 404;
    throw error;
  }

  await db.batch([
    {
      sql: "UPDATE delivery_orders SET payment_status = ?, paid_at = COALESCE(paid_at, ?) WHERE id = ?",
      args: [status, paidAt, deliveryOrderId],
    },
    {
      sql: "INSERT INTO delivery_events (id, delivery_order_id, type, status, provider, external_id, payload) VALUES (?, ?, 'payment_webhook', ?, 'pagbank', ?, ?)",
      args: [createId(), deliveryOrderId, status, body.id || null, JSON.stringify(body)],
    },
  ], 'write');

  const dispatch = status === 'paid'
    ? await dispatchPaidDeliveryOrder({ orderId: deliveryOrderId, source: 'pagbank_webhook' })
    : { dispatched: false, reason: status };

  return { orderId: deliveryOrderId, status, dispatch };
};

const createDeliveryCheckout = async ({ orderId, customer, items }) => {
  await ensureDatabaseReady();
  const safeCustomer = normalizeDeliveryCustomer(customer);
  requireString(safeCustomer.name, 'customer.name');
  requireString(safeCustomer.phone, 'customer.phone');
  requireString(safeCustomer.email, 'customer.email');
  if (safeCustomer.fulfillment === 'delivery') {
    requireString(safeCustomer.street, 'customer.street');
    requireString(safeCustomer.number, 'customer.number');
    requireString(safeCustomer.neighborhood, 'customer.neighborhood');
    requireString(safeCustomer.city, 'customer.city');
    requireString(safeCustomer.state, 'customer.state');
    requireString(safeCustomer.postalCode, 'customer.postalCode');
  }

  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) throw new Error('Pedido delivery sem itens.');
  await validateOrderItemsAvailability({
    items: safeItems,
    session: null,
    settings: await getSettings(),
    isPublicOrigin: true,
  });

  const deliveryOrderId = String(orderId || `delivery_${createId()}`);
  const customerId = createHash('sha256')
    .update(`${safeCustomer.phone}|${safeCustomer.email}`)
    .digest('hex')
    .slice(0, 32);
  const now = new Date().toISOString();
  const totals = calculateDeliveryTotals({ items: safeItems, customer: safeCustomer });
  const { subtotal, deliveryFee, discount, total } = totals;
  const payment = await prepareDeliveryPayment({ orderId: deliveryOrderId, customer: safeCustomer, items: safeItems, totals });
  const logistics = await requestDeliveryLogistics({ orderId: deliveryOrderId, customer: safeCustomer, items: safeItems, totals, paymentStatus: payment.status });
  const isPaid = String(payment.status).startsWith('paid');
  const paidAt = isPaid ? now : null;
  const productionOrderId = isPaid && DELIVERY_KITCHEN_DISPATCH_MODE === 'production' ? `delivery_prod_${deliveryOrderId}` : null;
  const kitchenStatus = isPaid ? (productionOrderId ? 'sent_production' : 'sent_mock') : 'waiting_payment';
  const kitchenSentAt = isPaid ? now : null;
  const deliveryRequestedAt = logistics.status === 'requested_mock' ? now : null;
  const persistedItems = safeItems.map((item) => ({
    ...item,
    id: item.id || createId(),
    orderId: deliveryOrderId,
  }));
  const customerSnapshot = JSON.stringify(safeCustomer);

  await db.batch([
    {
      sql: `
        INSERT INTO delivery_customers (id, name, phone, email, street, number, neighborhood, city, state, postal_code, complement, reference, latitude, longitude, join_club, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          phone = excluded.phone,
          email = excluded.email,
          street = excluded.street,
          number = excluded.number,
          neighborhood = excluded.neighborhood,
          city = excluded.city,
          state = excluded.state,
          postal_code = excluded.postal_code,
          complement = excluded.complement,
          reference = excluded.reference,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          join_club = excluded.join_club,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [customerId, safeCustomer.name, safeCustomer.phone, safeCustomer.email, safeCustomer.street, safeCustomer.number, safeCustomer.neighborhood, safeCustomer.city, safeCustomer.state, safeCustomer.postalCode, safeCustomer.complement, safeCustomer.reference, safeCustomer.latitude, safeCustomer.longitude, safeCustomer.joinClub ? 1 : 0],
    },
    {
      sql: `
        INSERT INTO delivery_orders (
          id, customer_id, subtotal, delivery_fee, discount, total, coupon_code, fulfillment, payment_method,
          payment_status, payment_provider, payment_external_id, checkout_url, kitchen_status, delivery_status, delivery_provider, delivery_external_id, production_order_id,
          customer_snapshot, notes, paid_at, kitchen_sent_at, delivery_requested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        deliveryOrderId, customerId, subtotal, deliveryFee, discount, total, safeCustomer.coupon, safeCustomer.fulfillment, safeCustomer.paymentMethod,
        payment.status, payment.provider, payment.externalId, payment.checkoutUrl, kitchenStatus, logistics.status, logistics.provider, logistics.externalId, productionOrderId, customerSnapshot, safeCustomer.notes, paidAt, kitchenSentAt, deliveryRequestedAt,
      ],
    },
    ...persistedItems.map((item) => ({
      sql: "INSERT INTO delivery_order_items (id, delivery_order_id, product_id, name, quantity, price_at_time, selected_modifiers, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        requireString(item.id, 'item.id'),
        deliveryOrderId,
        requireString(item.productId, 'item.productId'),
        requireString(item.name, 'item.name'),
        requireNumber(item.quantity, 'item.quantity'),
        requireNumber(item.price, 'item.price'),
        JSON.stringify(item.selectedModifiers || []),
        item.notes || '',
      ],
    })),
    {
      sql: "INSERT INTO delivery_events (id, delivery_order_id, type, status, provider, external_id, payload) VALUES (?, ?, 'payment', ?, ?, ?, ?)",
      args: [createId(), deliveryOrderId, payment.status, payment.provider, payment.externalId, JSON.stringify(payment.payload || { paymentMethod: safeCustomer.paymentMethod, total })],
    },
    {
      sql: "INSERT INTO delivery_events (id, delivery_order_id, type, status, payload) VALUES (?, ?, 'kitchen', ?, ?)",
      args: [createId(), deliveryOrderId, kitchenStatus, JSON.stringify({ dispatchMode: 'parallel_after_paid' })],
    },
    {
      sql: "INSERT INTO delivery_events (id, delivery_order_id, type, status, provider, external_id, payload) VALUES (?, ?, 'delivery', ?, ?, ?, ?)",
      args: [createId(), deliveryOrderId, logistics.status, logistics.provider, logistics.externalId, JSON.stringify(logistics.payload || {})],
    },
  ], 'write');

  await syncDeliveryCustomerToOsCrm({
    orderId: deliveryOrderId,
    customer: safeCustomer,
    totalGasto: isPaid ? total : 0,
    source: isPaid ? 'checkout_paid' : 'checkout_pending',
  });

  const notificationCustomer = { id: customerId, ...safeCustomer };
  await Promise.all([
    sendDeliveryNotification({
      orderId: deliveryOrderId,
      customer: notificationCustomer,
      channel: 'email',
      type: 'order_created',
      message: `Recebemos seu pedido ${deliveryOrderId}. Total: ${formatMoneyForNotification(total)}.`,
    }),
    sendDeliveryNotification({
      orderId: deliveryOrderId,
      customer: notificationCustomer,
      channel: 'sms',
      type: 'order_created',
      message: `Becoartes: pedido ${deliveryOrderId} recebido.`,
    }),
    sendDeliveryNotification({
      orderId: deliveryOrderId,
      customer: notificationCustomer,
      channel: 'whatsapp',
      type: 'order_created',
      message: `Becoartes: recebemos seu pedido ${deliveryOrderId}.`,
    }),
  ]);

  if (productionOrderId) {
    await materializeDeliveryProductionOrder({ orderId: deliveryOrderId, items: persistedItems, total });
  }

  const club = await getDeliveryClubSummary(customerId);

  return {
    order: {
      id: deliveryOrderId,
      orderId: deliveryOrderId,
      createdAt: now,
      total,
      subtotal,
      deliveryFee,
      discount,
      couponCode: safeCustomer.coupon,
      customer: safeCustomer,
      items: persistedItems,
      paymentStatus: payment.status,
      paymentProvider: payment.provider,
      paymentExternalId: payment.externalId,
      checkoutUrl: payment.checkoutUrl,
      kitchenStatus,
      deliveryStatus: logistics.status,
      kitchenSentAt,
      deliveryRequestedAt,
      deliveryProvider: logistics.provider,
      deliveryExternalId: logistics.externalId,
      integrationMode: getDeliveryIntegrationMode(),
      club,
    },
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
  const nextUserPermissions = JSON.stringify(settings?.pdvUserPermissions || {});
  const currentUserPermissions = JSON.stringify(currentSettings?.pdvUserPermissions || {});
  if (nextPermissions !== currentPermissions || nextUserPermissions !== currentUserPermissions) {
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

const normalizeCouponCode = (code = '') => String(code)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]/gi, '')
  .toUpperCase()
  .slice(0, 24);

const COUPON_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const COUPON_BENEFITS = new Set(['discount_20', 'free_drink', 'discount_value', 'free_item', 'order_value', 'order_percent', 'category_discount', 'item_discount']);

const generateCouponCode = () => Array.from({ length: 6 }, () => (
  COUPON_ALPHABET[Math.floor(Math.random() * COUPON_ALPHABET.length)]
)).join('');

const normalizeCouponBenefit = (benefit = '') => {
  const normalized = String(benefit || '').trim();
  return COUPON_BENEFITS.has(normalized) ? normalized : '';
};

const isCouponExpired = (validUntil) => {
  if (!validUntil) return false;
  const timestamp = Date.parse(String(validUntil));
  return Number.isFinite(timestamp) && Date.now() > timestamp;
};

const formatCouponBenefit = (benefit) => (
  benefit === 'free_drink' || benefit === 'free_item' ? '1 drink cortesia' : 'R$30 OFF'
);

const normalizeCouponText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const parseCouponRule = (coupon = {}) => {
  if (coupon.rule_json) {
    try {
      const parsed = JSON.parse(String(coupon.rule_json));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  const benefitType = String(coupon.benefit_type || '').trim();
  if (benefitType) {
    return {
      type: benefitType,
      discountType: coupon.discount_type || 'value',
      amount: Number(coupon.amount || 0),
      percent: Number(coupon.percent || 0),
      targetCategory: coupon.target_category || '',
      targetProductId: coupon.target_product_id || '',
      targetProductName: coupon.target_product_name || '',
      itemName: coupon.free_item_name || '',
      label: coupon.benefit_label || '',
    };
  }
  if (coupon.campaign_name) {
    return {
      type: 'choice',
      options: [
        { id: 'discount_20', type: 'order_value', amount: Number(coupon.amount || 30), label: `R$${Number(coupon.amount || 30).toFixed(2)} OFF` },
        { id: 'free_drink', type: 'free_item', itemName: '1 drink cortesia', label: '1 drink cortesia' },
      ],
    };
  }
  return { type: 'order_value', amount: Number(coupon.amount || 0), label: coupon.benefit_label || '' };
};

const getOrderItemLineTotal = (item) => {
  const modifiersTotal = (item.selectedModifiers || []).reduce((sum, modifier) => sum + Number(modifier.price || 0), 0);
  return (Number(item.price || 0) + modifiersTotal) * Number(item.quantity || 0);
};

const getEligibleSubtotalForRule = (rule, activeItems = []) => {
  const normalizedCategory = normalizeCouponText(rule.targetCategory);
  const normalizedProductName = normalizeCouponText(rule.targetProductName);
  const targetProductId = String(rule.targetProductId || '');
  return activeItems.reduce((sum, item) => {
    const categoryMatches = normalizedCategory && normalizeCouponText(item.categoryName).includes(normalizedCategory);
    const productMatches = (targetProductId && String(item.productId || '') === targetProductId)
      || (normalizedProductName && normalizeCouponText(item.name).includes(normalizedProductName));
    if (rule.type === 'category_discount' && categoryMatches) return sum + getOrderItemLineTotal(item);
    if (rule.type === 'item_discount' && productMatches) return sum + getOrderItemLineTotal(item);
    return sum;
  }, 0);
};

const computeCouponApplication = ({ coupon, subtotalCents, serviceFeeCents, discountCents, selectedBenefit, activeItems = [] }) => {
  const rule = parseCouponRule(coupon);
  const selected = normalizeCouponBenefit(selectedBenefit || coupon.selected_benefit || '');
  const baseCents = Math.max(0, subtotalCents + serviceFeeCents - discountCents);
  let effectiveRule = rule;
  let effectiveBenefit = selected;
  let requiresBenefitChoice = false;
  let benefitOptions = [];

  if (rule.type === 'choice') {
    benefitOptions = (rule.options || []).map((option) => ({
      id: String(option.id || option.type || ''),
      label: String(option.label || formatCouponBenefit(option.id || option.type || '')),
    })).filter((option) => option.id);
    if (!selected) {
      requiresBenefitChoice = true;
      effectiveRule = null;
    } else {
      effectiveRule = (rule.options || []).find((option) => normalizeCouponBenefit(option.id || option.type) === selected) || null;
      effectiveBenefit = selected;
    }
  }

  if (requiresBenefitChoice || !effectiveRule) {
    return {
      appliedCents: 0,
      selectedBenefit: effectiveBenefit,
      benefitLabel: '',
      requiresBenefitChoice,
      benefitOptions,
    };
  }

  const type = effectiveRule.type || 'order_value';
  let appliedCents = 0;
  const label = effectiveRule.label || coupon.benefit_label || '';

  if (type === 'free_item') {
    appliedCents = 0;
    effectiveBenefit = effectiveBenefit || 'free_item';
  } else if (type === 'order_percent') {
    appliedCents = Math.round(baseCents * (Math.max(0, Number(effectiveRule.percent || 0)) / 100));
    effectiveBenefit = effectiveBenefit || 'order_percent';
  } else if (type === 'category_discount' || type === 'item_discount') {
    const eligibleCents = moneyToCents(getEligibleSubtotalForRule(effectiveRule, activeItems), 'coupon.eligibleSubtotal');
    if (eligibleCents <= 0) {
      throw new Error(type === 'category_discount' ? 'Este cupom não encontrou item dessa categoria na mesa.' : 'Este cupom não encontrou o item específico na mesa.');
    }
    appliedCents = effectiveRule.discountType === 'percent'
      ? Math.round(eligibleCents * (Math.max(0, Number(effectiveRule.percent || 0)) / 100))
      : moneyToCents(effectiveRule.amount || coupon.amount || 0, 'coupon.amount');
    appliedCents = Math.min(appliedCents, eligibleCents, baseCents);
    effectiveBenefit = effectiveBenefit || type;
  } else {
    appliedCents = Math.min(moneyToCents(effectiveRule.amount || coupon.amount || 0, 'coupon.amount'), baseCents);
    effectiveBenefit = effectiveBenefit || 'discount_20';
  }

  return {
    appliedCents: Math.min(appliedCents, baseCents),
    selectedBenefit: effectiveBenefit,
    benefitLabel: label || formatCouponBenefit(effectiveBenefit),
    requiresBenefitChoice: false,
    benefitOptions,
  };
};

const formatTablePayment = (row) => ({
  id: row.id,
  tableId: row.table_id,
  tableNumber: Number(row.table_number || 0),
  sellerId: row.seller_id || '',
  sellerName: row.seller_name || 'Sistema',
  method: row.method,
  amount: Number(row.amount || 0),
  status: row.status,
  createdAt: row.created_at || new Date().toISOString(),
});

const createTablePayment = async (data, session) => {
  requirePermission(session, 'launchPayment', await getSettings());
  const tableId = requireString(data.tableId, 'tableId');
  await ensureTableAccess(tableId, session);
  const method = requireString(data.method, 'method');
  if (!['credit', 'debit', 'cash', 'pix'].includes(method)) throw new Error('Forma de pagamento inválida.');
  const amountCents = moneyToCents(data.amount || 0, 'amount');
  if (amountCents <= 0) throw new Error('Pagamento precisa ter valor maior que zero.');

  const tableRes = await db.execute({ sql: "SELECT number, status FROM tables WHERE id = ? LIMIT 1", args: [tableId] });
  const table = tableRes.rows[0];
  if (!table) throw new Error('Mesa não encontrada.');
  if (table.status === 'available') throw new Error('Abra a mesa antes de lançar pagamento.');

  const id = data.id ? String(data.id) : createId();
  const createdAt = new Date().toISOString();
  const sellerId = session?.id || String(data.sellerId || '');
  const sellerName = session?.name || String(data.sellerName || 'Sistema');

  await db.batch([
    {
      sql: `
        INSERT OR IGNORE INTO table_payments
          (id, table_id, table_number, seller_id, seller_name, method, amount, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `,
      args: [id, tableId, Number(table.number || data.tableNumber || 0), sellerId, sellerName, method, centsToMoney(amountCents), createdAt],
    },
    {
      sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, 'partial_payment_registered', ?, ?, 'pdv', ?, ?)",
      args: [
        createId(),
        JSON.stringify({ paymentId: id, method, amount: centsToMoney(amountCents), tableId, sellerId }),
        String(table.number || data.tableNumber || ''),
        sellerName,
        createdAt,
      ],
    },
  ], 'write');

  const rowRes = await db.execute({
    sql: "SELECT id, table_id, table_number, seller_id, seller_name, method, amount, status, strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at FROM table_payments WHERE id = ? LIMIT 1",
    args: [id],
  });
  return { payment: formatTablePayment(rowRes.rows[0]) };
};

const cancelTablePayment = async (data, session) => {
  requirePermission(session, 'cancelPayment', await getSettings());
  const id = requireString(data.id, 'id');
  const paymentRes = await db.execute({ sql: "SELECT * FROM table_payments WHERE id = ? LIMIT 1", args: [id] });
  const payment = paymentRes.rows[0];
  if (!payment) throw new Error('Pagamento não encontrado.');
  if (payment.status !== 'active') throw new Error('Este pagamento já foi aplicado ou cancelado.');
  await ensureTableAccess(payment.table_id, session);

  const cancelledAt = new Date().toISOString();
  const cancelContext = data.cancelContext && typeof data.cancelContext === 'object' && !Array.isArray(data.cancelContext)
    ? data.cancelContext
    : {};
  await db.batch([
    { sql: "UPDATE table_payments SET status = 'cancelled', cancelled_at = ? WHERE id = ?", args: [cancelledAt, id] },
    {
      sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, 'partial_payment_cancelled', ?, ?, 'pdv', ?, ?)",
      args: [
        createId(),
        JSON.stringify({
          paymentId: id,
          method: payment.method,
          amount: Number(payment.amount || 0),
          tableId: payment.table_id,
          sellerId: session?.id || '',
          reasonCode: cancelContext.reasonCode || '',
          reasonLabel: cancelContext.reasonLabel || '',
          reasonNotes: cancelContext.reasonNotes || '',
        }),
        String(payment.table_number || ''),
        session?.name || 'Sistema',
        cancelledAt,
      ],
    },
  ], 'write');
  return { cancelled: true };
};

const listCoupons = async () => {
  const res = await db.execute(`
    SELECT id, code, amount, status, note, created_by_name,
           customer_id, customer_name, phone, campaign_name, valid_until, min_order_value,
           selected_benefit, used_by_employee, table_number, order_id, whatsapp_message, sent_at,
           benefit_type, discount_type, target_category, target_product_id, target_product_name,
           free_item_name, benefit_label, rule_json,
           strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at,
           strftime('%Y-%m-%dT%H:%M:%SZ', redeemed_at) as redeemed_at, redeemed_table_id, redeemed_closed_bill_id
    FROM pdv_coupons
    ORDER BY created_at DESC
    LIMIT 200
  `);
  return {
    coupons: res.rows.map((row) => ({
      id: row.id,
      code: row.code,
      amount: Number(row.amount || 0),
      status: row.status,
      note: row.note || '',
      createdByName: row.created_by_name || '',
      customerId: row.customer_id || '',
      customerName: row.customer_name || '',
      phone: row.phone || '',
      campaignName: row.campaign_name || '',
      validUntil: row.valid_until || '',
      minOrderValue: Number(row.min_order_value || 0),
      selectedBenefit: row.selected_benefit || '',
      usedByEmployee: row.used_by_employee || '',
      tableNumber: row.table_number ? Number(row.table_number) : null,
      orderId: row.order_id || '',
      whatsappMessage: row.whatsapp_message || '',
      benefitType: row.benefit_type || '',
      discountType: row.discount_type || '',
      targetCategory: row.target_category || '',
      targetProductId: row.target_product_id || '',
      targetProductName: row.target_product_name || '',
      freeItemName: row.free_item_name || '',
      benefitLabel: row.benefit_label || '',
      ruleJson: row.rule_json || '',
      sentAt: row.sent_at || null,
      createdAt: row.created_at || new Date().toISOString(),
      redeemedAt: row.redeemed_at || null,
      redeemedTableId: row.redeemed_table_id || null,
      redeemedClosedBillId: row.redeemed_closed_bill_id || null,
    })),
  };
};

const createCoupon = async (data, session) => {
  requirePermission(session, 'manageCoupons', await getSettings());
  const amountCents = moneyToCents(data.amount || 0, 'amount');
  if (amountCents <= 0) throw new Error('Cupom precisa ter valor maior que zero.');

  let code = normalizeCouponCode(data.code || '');
  if (!code) code = generateCouponCode();
  const id = createId();
  const createdAt = new Date().toISOString();
  await db.execute({
    sql: `
      INSERT INTO pdv_coupons (
        id, code, amount, status, note, created_by_id, created_by_name, created_at,
        customer_id, customer_name, phone, campaign_name, valid_until, min_order_value, whatsapp_message,
        benefit_type, discount_type, target_category, target_product_id, target_product_name,
        free_item_name, benefit_label, rule_json
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      code,
      centsToMoney(amountCents),
      String(data.note || ''),
      session?.id || '',
      session?.name || 'Sistema',
      createdAt,
      data.customerId ? String(data.customerId) : null,
      data.customerName ? String(data.customerName) : null,
      data.phone ? String(data.phone).replace(/\D/g, '') : null,
      data.campaignName ? String(data.campaignName) : null,
      data.validUntil ? String(data.validUntil) : null,
      data.minOrderValue ? centsToMoney(moneyToCents(data.minOrderValue, 'minOrderValue')) : 0,
      data.whatsappMessage ? String(data.whatsappMessage) : null,
      data.benefitType ? String(data.benefitType) : null,
      data.discountType ? String(data.discountType) : null,
      data.targetCategory ? String(data.targetCategory) : null,
      data.targetProductId ? String(data.targetProductId) : null,
      data.targetProductName ? String(data.targetProductName) : null,
      data.freeItemName ? String(data.freeItemName) : null,
      data.benefitLabel ? String(data.benefitLabel) : null,
      data.ruleJson ? String(data.ruleJson) : null,
    ],
  });
  return { coupon: (await listCoupons()).coupons.find((coupon) => coupon.id === id) };
};

const validateCoupon = async (data, session) => {
  requireSession(session);
  const code = normalizeCouponCode(data.code || '');
  if (!code) throw new Error('Informe o cupom.');
  const tableId = data.tableId ? String(data.tableId) : '';
  if (tableId) await ensureTableAccess(tableId, session);

  const res = await db.execute({
    sql: `
      SELECT id, code, amount, status, customer_name, campaign_name, valid_until, min_order_value, selected_benefit,
             benefit_type, discount_type, target_category, target_product_id, target_product_name,
             free_item_name, benefit_label, rule_json
      FROM pdv_coupons
      WHERE code = ?
      LIMIT 1
    `,
    args: [code],
  });
  const coupon = res.rows[0];
  if (!coupon) throw new Error('Cupom não encontrado.');
  if (coupon.status !== 'active') throw new Error('Cupom já usado ou inativo.');
  if (isCouponExpired(coupon.valid_until)) throw new Error('Cupom expirado.');

  const subtotalCents = moneyToCents(data.subtotal || 0, 'subtotal');
  const serviceFeeCents = moneyToCents(data.serviceFee || 0, 'serviceFee');
  const discountCents = moneyToCents(data.discount || 0, 'discount');
  const minOrderCents = moneyToCents(coupon.min_order_value || 0, 'coupon.minOrderValue');
  if (minOrderCents > 0 && subtotalCents < minOrderCents) {
    throw new Error(`Pedido mínimo de ${formatMoneyBRL(centsToMoney(minOrderCents))} para usar este cupom.`);
  }

  const activeItems = tableId ? await getActiveOrderItemsForTable(tableId) : [];
  const couponApplication = computeCouponApplication({
    coupon,
    subtotalCents,
    serviceFeeCents,
    discountCents,
    selectedBenefit: data.selectedBenefit,
    activeItems,
  });

  return {
    coupon: {
      id: coupon.id,
      code: coupon.code,
      amount: centsToMoney(moneyToCents(coupon.amount || 0, 'coupon.amount')),
      appliedAmount: centsToMoney(couponApplication.appliedCents),
      customerName: coupon.customer_name || '',
      campaignName: coupon.campaign_name || '',
      validUntil: coupon.valid_until || '',
      minOrderValue: centsToMoney(minOrderCents),
      selectedBenefit: couponApplication.selectedBenefit,
      benefitLabel: couponApplication.benefitLabel,
      requiresBenefitChoice: couponApplication.requiresBenefitChoice,
      benefitOptions: couponApplication.benefitOptions.length
        ? couponApplication.benefitOptions
        : [{ id: couponApplication.selectedBenefit || 'discount_20', label: couponApplication.benefitLabel || 'Cupom' }],
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

const openCash = async ({ openingBalance, notes, confirmationPin }) => {
  const cashActor = await resolveCashActorByPin(confirmationPin, 'openCash');
  const effectiveSession = cashActor.seller;
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
  const responsibleId = await resolveCashResponsibleId(effectiveSession);

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
    details: JSON.stringify({
      openingBalance: normalizedOpeningBalance,
      reopened: Boolean(existingCash),
      adminOverride: cashActor.override,
      sandbox: CASH_SANDBOX_MODE,
    }),
    origin: 'pdv',
    authorId: effectiveSession.id,
    authorName: effectiveSession.name,
    timestamp: new Date().toISOString(),
  });

  return { cashState: await getCashState() };
};

const getCashSalesCentsSince = async (openedAt) => {
  const openedAtUnix = toUnixSeconds(openedAt);
  const res = await db.execute({
    sql: `
      SELECT total, payments
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
    if (cashCents <= 0) return total;

    const nonCashCents = payments.reduce((sum, payment) => {
      if (!payment || payment.method === 'cash') return sum;
      return sum + moneyToCents(payment.amount || 0, 'payment.amount');
    }, 0);
    const billTotalCents = moneyToCents(row.total || 0, 'closed_bills.total');
    const payableInCashCents = Math.max(0, billTotalCents - nonCashCents);

    return total + Math.min(cashCents, payableInCashCents);
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

const closeCash = async ({ closingBalance, notes, confirmationPin }) => {
  const cashActor = await resolveCashActorByPin(confirmationPin, 'closeCash');
  const effectiveSession = cashActor.seller;

  const cash = await getOpenCashRow();
  if (!cash) throw new Error('Não existe caixa aberto.');

  const closingCents = moneyToCents(closingBalance, 'closingBalance');
  const closeSummary = await getExpectedClosingCents(cash);
  const missingCents = closeSummary.expectedCents - closingCents;

  if (missingCents > 0 && !cashActor.override) {
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
        adminOverride: cashActor.override,
        sandbox: CASH_SANDBOX_MODE,
      }),
      origin: 'pdv',
      authorId: effectiveSession.id,
      authorName: effectiveSession.name,
      timestamp: new Date().toISOString(),
    });

    await safeCreateOSNotification({
      title: 'Bloqueio: falta de dinheiro no caixa',
      message: `${effectiveSession.name || 'Usuário'} tentou fechar o caixa com ${formatMoneyBRL(centsToMoney(missingCents))} abaixo do esperado.`,
      type: 'alert',
      link: `/${OS_TENANT_SLUG}/controle-dinheiro`,
    });

    const error = new Error('Dinheiro físico abaixo do esperado. Solicite liberação administrativa para autorizar este fechamento.');
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
      adminOverride: cashActor.override,
      sandbox: CASH_SANDBOX_MODE,
    }),
    origin: 'pdv',
    authorId: effectiveSession.id,
    authorName: effectiveSession.name,
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

const addSeller = async ({ seller }, session = null) => {
  const safeSeller = seller || {};
  const pin = requireString(safeSeller.pin, 'seller.pin');
  const employmentType = safeSeller.employmentType === 'freelancer' || safeSeller.tipo_vinculo === 'freelancer'
    ? 'freelancer'
    : 'fixo';
  const requestedPermission = safeSeller.permission || 'operator';
  const permission = normalizePermission(session?.permission) === 'admin'
    ? requestedPermission
    : 'operator';
  await db.execute({
    sql: "INSERT INTO sellers (id, name, nickname, status, role, permission, pin, tipo_vinculo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      requireString(safeSeller.id, 'seller.id'),
      requireString(safeSeller.name, 'seller.name'),
      safeSeller.nickname || '',
      safeSeller.status || 'active',
      safeSeller.role || 'atendente',
      permission,
      isLegacyPlainPin(pin) ? hashPin(pin) : pin,
      employmentType,
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

const updateSeller = async ({ id, seller }, session = null) => {
  const safeId = requireString(id, 'id');
  const safeSeller = seller || {};
  const fields = [];
  const args = [];

  if (safeSeller.name !== undefined) {
    const name = requireString(safeSeller.name, 'seller.name').trim();
    if (!name) {
      const error = new Error('Nome do usuário é obrigatório.');
      error.statusCode = 400;
      throw error;
    }
    fields.push('name = ?');
    args.push(name);
  }

  if (safeSeller.nickname !== undefined) {
    fields.push('nickname = ?');
    args.push(String(safeSeller.nickname || '').trim());
  }

  if (safeSeller.role !== undefined) {
    const role = ['garçom', 'atendente', 'gerente', 'outro'].includes(safeSeller.role)
      ? safeSeller.role
      : 'atendente';
    fields.push('role = ?');
    args.push(role);
  }

  if (safeSeller.permission !== undefined) {
    if (normalizePermission(session?.permission) !== 'admin') {
      const error = new Error('Somente admin pode alterar perfil de permissão.');
      error.statusCode = 403;
      throw error;
    }
    const permission = ['admin', 'manager', 'operator', 'standard', 'restricted'].includes(safeSeller.permission)
      ? safeSeller.permission
      : 'operator';
    fields.push('permission = ?');
    args.push(permission);
  }

  if (safeSeller.status !== undefined) {
    fields.push('status = ?');
    args.push(safeSeller.status === 'inactive' ? 'inactive' : 'active');
  }

  if (safeSeller.employmentType !== undefined || safeSeller.tipo_vinculo !== undefined) {
    const employmentType = safeSeller.employmentType === 'freelancer' || safeSeller.tipo_vinculo === 'freelancer'
      ? 'freelancer'
      : 'fixo';
    fields.push('tipo_vinculo = ?');
    args.push(employmentType);
  }

  if (safeSeller.pin !== undefined && String(safeSeller.pin).trim()) {
    const pin = requireString(safeSeller.pin, 'seller.pin').trim();
    if (!/^\d{4}$/.test(pin) && !/^[a-f0-9]{64}$/i.test(pin)) {
      const error = new Error('PIN deve ter 4 dígitos.');
      error.statusCode = 400;
      throw error;
    }
    fields.push('pin = ?');
    args.push(isLegacyPlainPin(pin) ? hashPin(pin) : pin);
  }

  if (fields.length === 0) {
    return { updated: true };
  }

  args.push(safeId);
  const result = await db.execute({
    sql: `UPDATE sellers SET ${fields.join(', ')} WHERE id = ?`,
    args,
  });

  if (result.rowsAffected === 0) {
    const error = new Error('Usuário próprio do PDV não encontrado.');
    error.statusCode = 404;
    throw error;
  }

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
  const sellerId = normalizeText(data.sellerId || '');
  const sellerName = normalizeText(data.sellerName || '');
  const isSelfServiceSeller = sellerId === 'self-service' || sellerName.toLowerCase() === 'cliente pediu sozinho';
  const subtotalCents = moneyToCents(data.subtotal || 0, 'subtotal');
  const serviceFeeCents = moneyToCents(data.serviceFee || 0, 'serviceFee');
  const discountCents = moneyToCents(data.discount || 0, 'discount');
  const couponCode = normalizeCouponCode(data.couponCode || '');
  const couponBenefit = normalizeCouponBenefit(data.couponBenefit || '');
  let couponCents = moneyToCents(data.couponAmount || 0, 'couponAmount');
  const totalCents = moneyToCents(data.total || 0, 'total');
  const payments = Array.isArray(data.payments) ? data.payments : [];

  if (!sellerId || !sellerName) {
    const error = new Error('Selecione o vendedor responsável antes de fechar a conta.');
    error.statusCode = 400;
    throw error;
  }

  const activeSeller = isSelfServiceSeller
    ? { id: 'self-service', name: 'Cliente pediu sozinho' }
    : (await getAuthSellers({ includePins: false }))
      .find((seller) => seller.id === sellerId && seller.status === 'active');
  if (!activeSeller) {
    const error = new Error('Vendedor responsável não encontrado ou inativo.');
    error.statusCode = 400;
    throw error;
  }

  if (subtotalCents < 0) throw new Error('Subtotal inválido.');
  if (serviceFeeCents < 0) throw new Error('Taxa de serviço não pode ser negativa.');
  if (discountCents < 0) throw new Error('Desconto não pode ser negativo.');
  if (couponCents < 0) throw new Error('Cupom não pode ser negativo.');
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

  const activeOrderItems = await getActiveOrderItemsForTable(tableId);
  let couponRow = null;
  if (couponCode || couponCents > 0) {
    if (!couponCode) throw new Error('Informe o código do cupom.');
    const couponRes = await db.execute({
      sql: `
        SELECT id, code, amount, status, campaign_name, valid_until, min_order_value, selected_benefit,
               benefit_type, discount_type, target_category, target_product_id, target_product_name,
               free_item_name, benefit_label, rule_json
        FROM pdv_coupons
        WHERE code = ?
        LIMIT 1
      `,
      args: [couponCode],
    });
    couponRow = couponRes.rows[0];
    if (!couponRow) throw new Error('Cupom não encontrado.');
    if (couponRow.status !== 'active') throw new Error('Cupom já usado ou inativo.');
    if (isCouponExpired(couponRow.valid_until)) throw new Error('Cupom expirado.');
    const minOrderCents = moneyToCents(couponRow.min_order_value || 0, 'coupon.minOrderValue');
    if (minOrderCents > 0 && subtotalCents < minOrderCents) {
      throw new Error(`Pedido mínimo de ${formatMoneyBRL(centsToMoney(minOrderCents))} para usar este cupom.`);
    }
    const couponApplication = computeCouponApplication({
      coupon: couponRow,
      subtotalCents,
      serviceFeeCents,
      discountCents,
      selectedBenefit: couponBenefit,
      activeItems: activeOrderItems,
    });
    if (couponApplication.requiresBenefitChoice) {
      throw new Error('Escolha o benefício do cupom antes de fechar a conta.');
    }
    couponCents = couponApplication.appliedCents;
    data.couponBenefit = couponApplication.selectedBenefit || 'discount_20';
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

  const expectedTotalCents = subtotalCents + serviceFeeCents - discountCents - couponCents;
  if (expectedTotalCents < 0) {
    throw new Error('Desconto/cupom não pode ser maior que subtotal mais taxa de serviço.');
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
  data.couponCode = couponCode;
  data.couponAmount = centsToMoney(couponCents);
  data.couponBenefit = data.couponBenefit || '';
  data.total = centsToMoney(totalCents);
  data.sellerId = activeSeller.id;
  data.sellerName = activeSeller.name;
  data.payments = payments.map((payment) => ({
    id: payment.id ? String(payment.id) : undefined,
    method: payment.method,
    amount: centsToMoney(moneyToCents(payment.amount || 0, 'payment.amount')),
  }));

  const recentDuplicate = await findRecentDuplicateClosedBill(data, 30);
  if (recentDuplicate) {
    return {
      skipped: true,
      integrationId: String(recentDuplicate.id),
      closedBill: null,
      inventorySync: null,
    };
  }

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
          await appendInventoryPlansForSoldItem({
            empresaId,
            movementPlans,
            result,
            orderId: item.orderId,
            orderItemId: item.id,
            productId: item.productId,
            remoteStockId: item.remoteStockId,
            name: item.name,
            quantity: item.quantity,
            reason: baseReason,
            sourceKind: 'product',
          });

          for (const modifier of item.selectedModifiers || []) {
            await appendInventoryPlansForSoldItem({
              empresaId,
              movementPlans,
              result,
              orderId: item.orderId,
              orderItemId: item.id,
              productId: modifier.id,
              name: modifier.name,
              quantity: item.quantity,
              reason: baseReason,
              sourceKind: 'modifier',
              reportUnmatched: Number(modifier.price || 0) > 0,
            });
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
        sql: "INSERT OR REPLACE INTO closed_bills (id, table_id, table_number, seller_id, seller_name, subtotal, service_fee, discount, discount_reason, coupon_code, coupon_amount, coupon_benefit, total, payments, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
          data.couponCode || null,
          data.couponAmount || 0,
          data.couponBenefit || null,
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
          couponCode: data.couponCode || '',
          couponAmount: data.couponAmount || 0,
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

    if (couponRow && data.couponCode) {
      auditEntries.push({
        action: 'coupon_applied',
        details: {
          couponCode: data.couponCode,
          couponAmount: data.couponAmount,
          couponBenefit: data.couponBenefit || '',
          couponBenefitLabel: data.couponBenefit ? formatCouponBenefit(data.couponBenefit) : '',
          totalAfterCoupon: data.total,
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
      {
        sql: "UPDATE table_payments SET status = 'applied', applied_closed_bill_id = ? WHERE table_id = ? AND status = 'active'",
        args: [integrationId, tableId],
      },
    );

    if (couponRow && data.couponCode) {
      batch.push({
        sql: "UPDATE pdv_coupons SET status = 'redeemed', selected_benefit = ?, used_by_employee_id = ?, used_by_employee = ?, table_number = ?, order_id = ?, redeemed_at = ?, redeemed_table_id = ?, redeemed_closed_bill_id = ? WHERE code = ? AND status = 'active'",
        args: [
          data.couponBenefit || 'discount_20',
          auditAuthorId,
          auditAuthorName,
          data.tableNumber,
          orderIds.join(','),
          closedAt.toISOString(),
          tableId,
          integrationId,
          data.couponCode,
        ],
      });
    }

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

const isPublicCustomerRoute = (routeKey, body) => {
  if (routeKey === 'POST /api/delivery/checkout') return true;
  if (routeKey === 'POST /api/delivery/checkout/mock') return true;
  if (routeKey === 'POST /api/delivery/quote') return true;
  if (routeKey === 'POST /api/delivery/postal-code') return true;
  if (routeKey === 'POST /api/delivery/geocode') return true;
  if (routeKey === 'POST /api/delivery/webhooks/pagbank') return true;
  if (routeKey.startsWith('POST /api/delivery/customer/')) return true;
  if (routeKey === 'GET /api/delivery/order') return true;
  if (routeKey === 'GET /api/delivery/customer/session') return true;
  if (routeKey === 'GET /api/delivery/customer/orders') return true;
  if (routeKey === 'GET /api/delivery/config') return true;
  if (routeKey === 'POST /api/service-requests' || routeKey === 'POST /api/tables/request-bill') return true;
  if (routeKey === 'POST /api/orders/send-to-kitchen' || routeKey === 'POST /api/orders/status') {
    return allowPublicOperationalOrigin(body);
  }
  if (routeKey === 'POST /api/audit-logs') return allowPublicOperationalOrigin(body);
  return false;
};

const enforceRouteAccess = async (routeKey, body, session, { operationAccessAllowed = true, req = null } = {}) => {
  if (
    routeKey === 'GET /api/app/init'
    || routeKey === 'POST /api/app/sync'
    || routeKey === 'POST /api/auth/login'
    || routeKey === 'POST /api/tablet/setup-login'
  ) {
    return;
  }

  if (isPublicCustomerRoute(routeKey, body)) {
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
    requireSession(session);
    return;
  }

  if (routeKey === 'POST /api/cash/open' || routeKey === 'POST /api/cash/close') {
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
    'POST /api/pdv-lock': 'manageSettings',
    'POST /api/qrcodes/regenerate': 'managePDVPermissions',
    'POST /api/service-requests/clear': 'manageSettings',
    'POST /api/audit-logs/list': 'viewSalesTotals',
    'POST /api/sellers': 'managePDVUsers',
    'POST /api/sellers/update': 'managePDVUsers',
    'POST /api/sellers/pin': 'managePDVUsers',
    'POST /api/sellers/delete': 'managePDVUsers',
    'POST /api/sellers/status': 'managePDVUsers',
    'GET /api/sellers/candidates': 'managePDVUsers',
    'POST /api/sellers/activate-os-user': 'managePDVUsers',
    'POST /api/sellers/create-os-user': 'managePDVUsers',
    'POST /api/inventory/sync-beverages': 'confirmPurchaseEntry',
    'POST /api/inventory/sync-open-orders': 'manageSettings',
    'POST /api/tables/status': 'updateTableStatus',
    'POST /api/tables/open': 'openTable',
    'POST /api/tables/transfer': 'transferTable',
    'POST /api/tables/join': 'joinTables',
    'POST /api/cash/open': 'openCash',
    'POST /api/cash/close': 'closeCash',
    'POST /api/table-payments': 'launchPayment',
    'POST /api/table-payments/cancel': 'cancelPayment',
    'POST /api/coupons/create': 'manageCoupons',
    'GET /api/coupons/list': 'manageCoupons',
    'GET /api/delivery/orders': 'viewSalesTotals',
    'GET /api/delivery/order-detail': 'viewSalesTotals',
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
  'POST /api/delivery/quote': async (body) => getDeliveryQuote(body),
  'POST /api/delivery/postal-code': async (body) => ({ postalCode: await lookupDeliveryPostalCode(body) }),
  'POST /api/delivery/geocode': async (body) => ({ geocode: await geocodeDeliveryAddress(body?.customer || body) }),
  'POST /api/delivery/checkout': async (body) => createDeliveryCheckout(body),
  'POST /api/delivery/checkout/mock': async (body) => createDeliveryCheckout(body),
  'POST /api/delivery/webhooks/pagbank': async (body, context) => handlePagBankDeliveryWebhook(body, context),
  'POST /api/delivery/customer/register': async (body) => createDeliveryCustomerAccount(body),
  'POST /api/delivery/customer/login': async (body) => loginDeliveryCustomer(body),
  'POST /api/delivery/customer/forgot-password': async (body) => requestDeliveryPasswordReset(body),
  'POST /api/delivery/customer/reset-password': async (body) => resetDeliveryCustomerPassword(body),
  'POST /api/delivery/customer/verify-code': async (body) => verifyDeliveryCustomerCode(body),
  'GET /api/delivery/customer/session': async (_body, context) => getDeliveryCustomerSession({ token: context.req?.headers['x-beco-delivery-session'] || '' }),
  'GET /api/delivery/customer/orders': async (_body, context) => listDeliveryCustomerOrders({ token: context.req?.headers['x-beco-delivery-session'] || '' }),
  'GET /api/delivery/order': async (_body, context) => getDeliveryOrder({ orderId: context.url.searchParams.get('orderId') || '' }),
  'GET /api/delivery/order-detail': async (_body, context) => getDeliveryOrder({ orderId: context.url.searchParams.get('orderId') || '', includeEvents: true }),
  'GET /api/delivery/config': async () => getDeliveryPublicConfig(),
  'GET /api/delivery/orders': async (_body, context) => listDeliveryOrders({ limit: context.url.searchParams.get('limit') || 50 }),
  'POST /api/orders/status': async (body) => updateOrderStatus(body),
  'POST /api/order-items/delete': async (body, context) => deleteOrderItem(body, context.session),
  'POST /api/table-payments': async (body, context) => createTablePayment(body, context.session),
  'POST /api/table-payments/cancel': async (body, context) => cancelTablePayment(body, context.session),
  'GET /api/coupons/list': async () => listCoupons(),
  'POST /api/coupons/create': async (body, context) => createCoupon(body, context.session),
  'POST /api/coupons/validate': async (body, context) => validateCoupon(body, context.session),
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
  'GET /api/pdv-lock/status': async () => getPdvLockState(),
  'POST /api/pdv-lock': async (body, context) => setPdvLockState(body, context.session),
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
  'POST /api/sellers': async (body, context) => addSeller(body, context.session),
  'POST /api/sellers/update': async (body, context) => updateSeller(body, context.session),
  'POST /api/sellers/pin': async (body) => updateSellerPin(body),
  'POST /api/sellers/delete': async (body) => deleteSeller(body),
  'POST /api/sellers/status': async (body) => updateSellerStatus(body),
  'GET /api/sellers/candidates': async () => ({ candidates: await listSellerCandidates() }),
  'POST /api/sellers/activate-os-user': async (body) => activateOsUserAsSeller(body),
  'POST /api/sellers/create-os-user': async (body) => createOsUserAsSeller(body),
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
    const data = await handler(body, { req, url, session, operationAccessAllowed, rawBody: req.rawBody || '' });
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
