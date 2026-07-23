import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createClient } from '@libsql/client';
import { sendJson } from './http.mjs';
import { runSchemaMigrations } from './migrations/schema.mjs';
import { createApiHandler } from './routes/api-router.mjs';
import { createAccessGuards, createRouteAccessEnforcer } from './routes/access-policy.mjs';
import { createRouteHandlers } from './routes/handlers.mjs';
import { createStaticHandler } from './static-files.mjs';
import { businessDateKey, resolveBusinessTimeZone } from './business-time.mjs';
import {
  hashPin,
  isReservedSellerPin,
  normalizeStoredPin,
  safeSecretEqual,
  verifyPin,
} from './auth/pins.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const port = Number(process.env.PORT || 80);
const startedAt = Date.now();

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
const requireRuntimeSecret = (name, value) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`Missing required runtime secret: ${name}`);
  return normalized;
};
const DEFAULT_MANAGER_PIN = requireRuntimeSecret('DEFAULT_MANAGER_PIN', process.env.DEFAULT_MANAGER_PIN);
const DEFAULT_OPERATOR_PIN = requireRuntimeSecret('DEFAULT_OPERATOR_PIN', process.env.DEFAULT_OPERATOR_PIN);
const TABLET_SETUP_PIN = requireRuntimeSecret('TABLET_SETUP_PIN', process.env.TABLET_SETUP_PIN);
const ADMIN_BYPASS_PIN = String(process.env.ADMIN_BYPASS_PIN || '').trim();
const ADMIN_BYPASS_ENABLED = process.env.ADMIN_BYPASS_ENABLED === 'true';
const OS_CHECKLIST_ALERTS_URL = process.env.OS_CHECKLIST_ALERTS_URL || 'https://os.becoartes.com/api/operational/checklist-alerts?slug=becoartes';
const OS_OPERATIONAL_ALERTS_TOKEN = String(process.env.OS_OPERATIONAL_ALERTS_TOKEN || '').trim();
const MAX_JSON_BODY_BYTES = Math.max(64 * 1024, Number(process.env.MAX_JSON_BODY_BYTES || 2 * 1024 * 1024));
const ALLOWED_OPERATION_IPS = (process.env.ALLOWED_OPERATION_IPS || '')
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);
const ALLOWED_WEB_ORIGINS = (process.env.ALLOWED_WEB_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const SESSION_SECRET = isLocalLibsqlUrl
  ? (process.env.BFF_SESSION_SECRET || process.env.JWT_SECRET || 'local-delivery-session-secret')
  : requireRuntimeSecret('BFF_SESSION_SECRET', process.env.BFF_SESSION_SECRET || process.env.JWT_SECRET);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TABLET_TABLE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PROCESSING_STALE_MS = 10 * 60 * 1000;
const SERVICE_REQUEST_LIMIT = Number(process.env.SERVICE_REQUEST_LIMIT || 150);
const CLOSED_BILLS_LIMIT = Number(process.env.CLOSED_BILLS_LIMIT || 200);
const AUDIT_LOG_LIMIT = Number(process.env.AUDIT_LOG_LIMIT || 100);
const CASH_SANDBOX_MODE = process.env.CASH_SANDBOX_MODE === '1';
const CASH_TABLE = CASH_SANDBOX_MODE ? 'pdv_cash_sandbox' : 'caixa_diario';
const CASH_MAX_OPEN_HOURS = 18;
const CASH_MAX_OPEN_SECONDS = CASH_MAX_OPEN_HOURS * 60 * 60;
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
const APP_VERSION = process.env.APP_VERSION || process.env.VITE_APP_VERSION || 'unknown';
const APP_COMMIT = process.env.APP_COMMIT || process.env.VITE_APP_COMMIT || 'unknown';
const HEALTH_DB_TIMEOUT_MS = Math.max(250, Number(process.env.HEALTH_DB_TIMEOUT_MS || 3000));
const BUSINESS_TIME_ZONE = resolveBusinessTimeZone(process.env.BUSINESS_TIME_ZONE);

if (!tursoUrl || (!tursoAuthToken && !isLocalLibsqlUrl)) {
  throw new Error('Missing Turso configuration for BFF runtime.');
}

const db = createClient({
  url: tursoUrl,
  ...(tursoAuthToken ? { authToken: tursoAuthToken } : {}),
});

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://assets.pagseguro.com.br; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors https://os.becoartes.com",
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
const getBusinessDate = () => businessDateKey(new Date(), BUSINESS_TIME_ZONE);
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
const normalizeOperationalView = (view) => {
  const safeView = String(view || '').trim().toLowerCase();
  if (safeView === 'coz' || safeView === 'cozinha' || safeView === 'kitchen') return 'kitchen';
  if (safeView === 'bar' || safeView === 'bartender') return 'bar';
  if (safeView === 'pdv' || safeView === 'atendimento') return 'pdv';
  return '';
};
const isFreelancerUserRow = (row) => {
  const role = normalizeText(row?.role).toLowerCase();
  const employmentType = normalizeText(row?.tipo_vinculo).toLowerCase();
  return role === 'freelancer' || employmentType === 'freelancer';
};
const parseFreelancerOperationalAccess = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
};
const getValidFreelancerOperationalAccess = (row, view) => {
  const station = normalizeOperationalView(view);
  if (!station || !isFreelancerUserRow(row)) return null;
  const access = parseFreelancerOperationalAccess(row?.freelancer_operational_access);
  if (!access || normalizeOperationalView(access.station) !== station) return null;
  const startsAt = Date.parse(access.startsAt || '');
  const endsAt = Date.parse(access.endsAt || '');
  const now = Date.now();
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return null;
  if (now < startsAt || now >= endsAt) return null;
  return access;
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
    managePDVUsers: true,
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
    ...(profile === 'manager' ? { managePDVUsers: true } : {}),
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

const createSignedToken = (payload) => {
  const encoded = base64UrlJson(payload);
  return `${encoded}.${signSessionPayload(encoded)}`;
};

const decodeSignedToken = (token = '') => {
  if (!String(token).includes('.')) return null;
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature || !safeEqual(signature, signSessionPayload(payload))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
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

const getTableById = async (tableId) => {
  const tableRes = await db.execute({
    sql: "SELECT id, number FROM tables WHERE id = ? LIMIT 1",
    args: [String(tableId || '')],
  });
  return tableRes.rows[0] || null;
};

const getTableByNumber = async (tableNumber) => {
  const safeTableNumber = Math.trunc(Number(tableNumber || 0));
  if (!Number.isFinite(safeTableNumber) || safeTableNumber <= 0) return null;
  const tableRes = await db.execute({
    sql: "SELECT id, number FROM tables WHERE number = ? LIMIT 1",
    args: [String(safeTableNumber)],
  });
  return tableRes.rows[0] || null;
};

const createPublicTableToken = ({ source, tableId, tableNumber, revision = '', expiresAt = 0 }) => createSignedToken({
  typ: 'public_table_access',
  source,
  tableId: String(tableId || ''),
  tableNumber: Number(tableNumber || 0),
  revision: String(revision || ''),
  exp: expiresAt ? Number(expiresAt) : 0,
  iat: Date.now(),
});

const verifyPublicTableToken = async ({ token, source, tableId = '', tableNumber = '' }) => {
  const decoded = decodeSignedToken(token);
  if (!decoded || decoded.typ !== 'public_table_access') return null;
  if (decoded.source !== source) return null;
  if (decoded.exp && Number(decoded.exp) < Date.now()) return null;

  const table = tableId ? await getTableById(tableId) : await getTableByNumber(tableNumber || decoded.tableNumber);
  if (!table) return null;
  if (String(decoded.tableId) !== String(table.id)) return null;
  if (Number(decoded.tableNumber || 0) !== Number(table.number || 0)) return null;
  if (tableNumber && Number(tableNumber) !== Number(table.number || 0)) return null;

  if (source === 'qr') {
    const settings = await getSettings();
    const revision = settings?.qrCodes?.tableRevisions?.[String(table.number)] || '';
    if (String(decoded.revision || '') !== String(revision || '')) return null;
  }

  return {
    source,
    tableId: String(table.id),
    tableNumber: Number(table.number || 0),
  };
};

const createTableAccessToken = async ({ origin, tableId = '', tableNumber = '' }, session = null) => {
  const source = origin === 'tablet' ? 'tablet' : origin === 'qr' ? 'qr' : '';
  if (!source) throw new Error('Origem inválida para token de mesa.');

  if (source === 'tablet' && !session?.stationAccess && !isAdminSession(session)) {
    const error = new Error('Sessão do tablet inválida para vincular mesa.');
    error.statusCode = 403;
    throw error;
  }

  const table = tableId ? await getTableById(tableId) : await getTableByNumber(tableNumber);
  if (!table) throw new Error('Mesa não encontrada para token público.');

  const settings = await getSettings();
  const revision = source === 'qr' ? (settings?.qrCodes?.tableRevisions?.[String(table.number)] || '') : '';
  const expiresAt = source === 'tablet' ? Date.now() + TABLET_TABLE_TOKEN_TTL_MS : 0;

  return {
    tableId: String(table.id),
    tableNumber: Number(table.number || 0),
    origin: source,
    token: createPublicTableToken({
      source,
      tableId: table.id,
      tableNumber: table.number,
      revision,
      expiresAt,
    }),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
  };
};

const ensureDatabase = async () => {
  await db.batch([
    "CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, schedule_config TEXT, sort_order INTEGER DEFAULT 0, visible INTEGER DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS menu (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, price REAL NOT NULL, category_id TEXT, image TEXT, visible INTEGER DEFAULT 1, delivery_visible INTEGER DEFAULT 1, erp_code TEXT, remote_stock_id TEXT, schedule_config TEXT, cost REAL DEFAULT 0, sort_order INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS modifier_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, min_choices INTEGER DEFAULT 0, max_choices INTEGER DEFAULT 1, is_required INTEGER DEFAULT 0, status TEXT DEFAULT 'active')",
    "CREATE TABLE IF NOT EXISTS modifiers (id TEXT PRIMARY KEY, group_id TEXT, name TEXT NOT NULL, price REAL NOT NULL, status TEXT DEFAULT 'active', sort_order INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS product_modifier_groups (product_id TEXT, group_id TEXT, sort_order INTEGER DEFAULT 0, PRIMARY KEY(product_id, group_id))",
    "CREATE TABLE IF NOT EXISTS category_modifier_groups (category_id TEXT, group_id TEXT, sort_order INTEGER DEFAULT 0, PRIMARY KEY(category_id, group_id))",
    "CREATE TABLE IF NOT EXISTS tables (id TEXT PRIMARY KEY, number TEXT NOT NULL, status TEXT NOT NULL, last_activity DATETIME DEFAULT CURRENT_TIMESTAMP, current_seller_id TEXT)",
    "CREATE TABLE IF NOT EXISTS customer_tabs (id TEXT PRIMARY KEY, cpf TEXT NOT NULL, cpf_hash TEXT, cpf_last4 TEXT, customer_name TEXT NOT NULL, phone TEXT NOT NULL, table_id TEXT NOT NULL, table_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', opened_at DATETIME DEFAULT CURRENT_TIMESTAMP, paid_at DATETIME, closed_at DATETIME, closed_by_id TEXT, closed_by_name TEXT)",
    "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, table_id TEXT, total REAL NOT NULL, status TEXT NOT NULL, origin TEXT DEFAULT 'pdv', created_by_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, payment_method TEXT, client_request_id TEXT)",
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
    "CREATE TABLE IF NOT EXISTS estoque_produtos (id TEXT PRIMARY KEY, empresa_id TEXT, nome TEXT, categoria TEXT, ativo INTEGER DEFAULT 1, quantidade_atual REAL DEFAULT 0, estoque_minimo REAL DEFAULT 0, status TEXT DEFAULT 'Saudável', created_at INTEGER, updated_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS estoque_movimentacoes (id TEXT PRIMARY KEY, empresa_id TEXT, produto_id TEXT, tipo_movimentacao TEXT, quantidade REAL, quantidade_anterior REAL, quantidade_nova REAL, motivo TEXT, responsavel_id TEXT, created_at INTEGER, closed_bill_id TEXT, order_id TEXT, order_item_id TEXT, origem TEXT, integration_event_id TEXT, source_item_id TEXT, source_item_kind TEXT)",
    "CREATE TABLE IF NOT EXISTS notificacoes (id TEXT PRIMARY KEY, empresa_id TEXT, usuario_id TEXT, titulo TEXT, mensagem TEXT, tipo TEXT, lida INTEGER DEFAULT 0, link TEXT, created_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, empresa_id TEXT, nome TEXT, email TEXT, role TEXT, funcao TEXT, ativo INTEGER DEFAULT 1, pin TEXT, is_operador INTEGER DEFAULT 1, permitir_acesso_remoto INTEGER DEFAULT 0, tipo_vinculo TEXT, pdv_sell_enabled INTEGER DEFAULT 0, freelancer_operational_access TEXT, created_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS fichas_tecnicas (id TEXT PRIMARY KEY, empresa_id TEXT, nome_prato TEXT, status TEXT DEFAULT 'active')",
    "CREATE TABLE IF NOT EXISTS ficha_ingredientes (id TEXT PRIMARY KEY, ficha_tecnica_id TEXT, estoque_produto_id TEXT, nome_exibicao TEXT, nome_ingrediente TEXT, quantidade_usada REAL, quantidade_estoque_baixa REAL, unidade_medida TEXT, unidade_estoque_baixa TEXT)",
    "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS integration_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, table_id TEXT, ref_id TEXT, payload TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, status TEXT NOT NULL, opening_balance REAL NOT NULL, closing_balance REAL, total_sales REAL DEFAULT 0, opened_at DATETIME DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME, sort_order INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS pdv_cash_sandbox (id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL, data TEXT NOT NULL, saldo_inicial REAL NOT NULL DEFAULT 0, entradas_dinheiro REAL NOT NULL DEFAULT 0, saidas_dinheiro REAL NOT NULL DEFAULT 0, valor_caixa_final REAL NOT NULL DEFAULT 0, valor_envelopes REAL NOT NULL DEFAULT 0, total_na_casa REAL NOT NULL DEFAULT 0, responsavel_id TEXT NOT NULL, observacoes TEXT, status TEXT NOT NULL DEFAULT 'Aberto', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  ], 'write');

  await runSchemaMigrations(db);

  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_orders_table_status ON orders(table_id, status)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_request_id ON orders(client_request_id) WHERE client_request_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_production_tickets_order ON production_tickets(order_id, station, status)",
    "CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_menu_category_sort ON menu(category_id, sort_order)",
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
    "CREATE INDEX IF NOT EXISTS idx_customer_tabs_status_cpf ON customer_tabs(status, cpf)",
    "CREATE INDEX IF NOT EXISTS idx_customer_tabs_table_status ON customer_tabs(table_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_customer_tabs_lookup ON customer_tabs(cpf, phone, customer_name)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_tabs_active_cpf_unique ON customer_tabs(cpf) WHERE status IN ('open', 'paid')",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_tabs_active_table_unique ON customer_tabs(table_id) WHERE status IN ('open', 'paid')",
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
const isAdminBypassPin = (pin) => ADMIN_BYPASS_ENABLED && ADMIN_BYPASS_PIN && safeSecretEqual(pin, ADMIN_BYPASS_PIN);

const throwIpRestricted = (req) => {
  const error = new Error(`Acesso operacional permitido apenas na rede autorizada. IP detectado: ${getClientIp(req)}`);
  error.statusCode = 403;
  throw error;
};

const isPinRateLimited = (req, pathname) => {
  if (!['/api/auth/login', '/api/tablet/setup-login', '/api/cash/open', '/api/cash/close'].includes(pathname)) return false;

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
      c.sort_order as category_sort_order,
      ep.quantidade_atual as stock_quantity,
      ep.estoque_minimo as stock_minimum,
      ep.preco_custo as stock_cost,
      ft.id as cmv_id,
      ft.custo_total as cmv_cost,
      (SELECT COUNT(*) FROM ficha_ingredientes fi WHERE fi.ficha_tecnica_id = ft.id) as cmv_ingredient_count,
      (SELECT COUNT(*) FROM ficha_ingredientes fi WHERE fi.ficha_tecnica_id = ft.id AND fi.estoque_produto_id IS NULL) as cmv_unlinked_count
    FROM menu m
    LEFT JOIN categories c ON m.category_id = c.id
    LEFT JOIN estoque_produtos ep ON ep.id = m.remote_stock_id AND ep.ativo = 1
    LEFT JOIN fichas_tecnicas ft ON ft.id = (
      SELECT candidate.id
      FROM fichas_tecnicas candidate
      WHERE candidate.pdv_product_id = m.id
      ORDER BY
        CASE WHEN EXISTS (SELECT 1 FROM ficha_ingredientes fi2 WHERE fi2.ficha_tecnica_id = candidate.id) THEN 0 ELSE 1 END,
        candidate.updated_at DESC,
        candidate.created_at DESC
      LIMIT 1
    )
    ORDER BY COALESCE(c.sort_order, 0) ASC, COALESCE(m.sort_order, 0) ASC, m.rowid ASC
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
    deliveryVisible: row.delivery_visible !== 0,
    sortOrder: Number(row.sort_order || 0),
    schedule: parseJsonObject(row.schedule_config),
    erpCode: row.erp_code || '',
    remoteStockId: row.remote_stock_id || '',
    stockQuantity: row.remote_stock_id ? Number(row.stock_quantity || 0) : null,
    stockMinimum: row.remote_stock_id ? Number(row.stock_minimum || 0) : null,
    cost: row.cmv_id
      ? Number(row.cmv_cost || 0)
      : row.remote_stock_id
        ? Number(row.stock_cost || 0)
        : Number(row.cost || 0),
    costSource: row.cmv_id ? 'cmv' : row.remote_stock_id ? 'stock' : 'manual',
    cmvId: row.cmv_id || '',
    cmvIngredientCount: Number(row.cmv_ingredient_count || 0),
    cmvUnlinkedCount: Number(row.cmv_unlinked_count || 0),
    cmvStatus: row.cmv_id
      ? Number(row.cmv_ingredient_count || 0) === 0
        ? 'empty'
        : Number(row.cmv_unlinked_count || 0) > 0
          ? 'incomplete'
          : 'complete'
      : row.remote_stock_id
        ? 'direct_stock'
        : 'missing',
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

const getLatestClosedCashRow = async () => {
  const res = await db.execute({
    sql: `SELECT * FROM ${CASH_TABLE} WHERE empresa_id = ? AND status = 'Fechado' ORDER BY updated_at DESC, data DESC, created_at DESC LIMIT 1`,
    args: [OS_EMPRESA_ID],
  });
  return res.rows[0] || null;
};

const getCashOpenDurationSeconds = (cash) => Math.max(0, osTimestamp() - toUnixSeconds(cash?.created_at));

const assertCashOperationAllowed = async () => {
  const openCash = await getOpenCashRow();
  if (!openCash || getCashOpenDurationSeconds(openCash) < CASH_MAX_OPEN_SECONDS) return;

  const error = new Error('Caixa aberto desde ontem. Feche o caixa e faça uma nova abertura para continuar.');
  error.statusCode = 423;
  throw error;
};

const getCashState = async () => {
  await ensureDatabaseReady();
  const businessDate = getBusinessDate();
  const [openCashRow, todayRes, lastClosedRow] = await Promise.all([
    getOpenCashRow(),
    db.execute({
      sql: `SELECT * FROM ${CASH_TABLE} WHERE empresa_id = ? AND data = ? LIMIT 1`,
      args: [OS_EMPRESA_ID, businessDate],
    }),
    getLatestClosedCashRow(),
  ]);
  const current = mapCashRow(openCashRow || todayRes.rows[0]);
  const lastClosed = mapCashRow(lastClosedRow);
  const openDurationHours = openCashRow ? getCashOpenDurationSeconds(openCashRow) / (60 * 60) : 0;
  const requiresClosing = Boolean(openCashRow) && openDurationHours >= CASH_MAX_OPEN_HOURS;

  return {
    businessDate: current?.businessDate || businessDate,
    isOpen: current?.status === 'Aberto',
    current,
    lastClosingBalance: lastClosed?.closingBalance || 0,
    hasPreviousClosing: Boolean(lastClosed),
    sandbox: CASH_SANDBOX_MODE,
    requiresClosing,
    openDurationHours,
  };
};

const getOperationalUsers = async ({ includePins = false, view = '' } = {}) => {
  const res = await db.execute({
    sql: `
      SELECT id, nome, email, role, funcao, ativo, pin, is_operador, permitir_acesso_remoto, tipo_vinculo, pdv_sell_enabled, freelancer_operational_access
      FROM users
      WHERE empresa_id = ?
        AND COALESCE(ativo, 1) = 1
        AND (COALESCE(is_operador, 1) = 1 OR COALESCE(pdv_sell_enabled, 0) = 1 OR freelancer_operational_access IS NOT NULL)
      ORDER BY nome COLLATE NOCASE ASC
    `,
    args: [OS_EMPRESA_ID],
  });

  return res.rows
    .filter((row) => normalizeText(row.nome))
    .map((row) => ({
      row,
      temporaryAccess: getValidFreelancerOperationalAccess(row, view),
    }))
    .filter(({ row, temporaryAccess }) => {
      const isFreelancer = isFreelancerUserRow(row);
      if (!isFreelancer) {
        return Boolean(Number(row.is_operador || 0)) || Boolean(Number(row.pdv_sell_enabled || 0));
      }
      return Boolean(Number(row.pdv_sell_enabled || 0)) || Boolean(temporaryAccess);
    })
    .map((row) => ({
      id: row.row.id,
      name: normalizeText(row.row.nome),
      nickname: normalizeText(row.row.nome).split(' ')[0] || '',
      status: Number(row.row.ativo || 0) === 1 ? 'active' : 'inactive',
      role: mapOperationalRoleLabel(row.row.role, row.row.funcao),
      permission: row.temporaryAccess ? 'operator' : mapOperationalPermission(row.row.role, row.row.funcao),
      pin: includePins ? String(row.row.pin || '') : '',
      allowRemote: Boolean(Number(row.row.permitir_acesso_remoto || 0)),
      canSellInPdv: Boolean(Number(row.row.pdv_sell_enabled || 0)),
      employmentType: row.row.tipo_vinculo || '',
      temporaryOperationalAccess: row.temporaryAccess,
      stationAccess: row.temporaryAccess?.station || null,
      source: 'os',
      osRole: normalizeText(row.row.role).toLowerCase(),
      email: row.row.email || '',
    }));
};

const isEligibleOsSellerCandidate = (row) => {
  const name = normalizeText(row?.nome).toLowerCase();
  const role = normalizeText(row?.role).toLowerCase();
  if (!name) return false;
  if (['administrador', 'admin full', 'admin mestre', 'gui mameluco', 'operador', 'operacional'].includes(name)) return false;
  if (['super_admin', 'operacional'].includes(role)) return false;
  return true;
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
    .filter(isEligibleOsSellerCandidate)
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
  if (safePin && !/^\d{4}$/.test(safePin)) {
    const error = new Error('PIN deve ter 4 dígitos.');
    error.statusCode = 400;
    throw error;
  }
  if (safePin && isReservedSellerPin(safePin)) {
    const error = new Error('Escolha um PIN diferente de 1234.');
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
  const nextPin = currentPin ? normalizeStoredPin(currentPin) : (safePin ? hashPin(safePin) : '');
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
  const seller = sellers.find((item) => item.id === `os:${safeUserId}`) || {
    id: `os:${safeUserId}`,
    name: normalizeText(user.nome),
    nickname: normalizeText(user.nome).split(' ')[0] || '',
    status: 'active',
    role: 'outro',
    permission: 'operator',
    pin: '',
    employmentType: '',
    source: 'os',
  };
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
  if (!/^\d{4}$/.test(safePin)) {
    const error = new Error('PIN deve ter 4 dígitos.');
    error.statusCode = 400;
    throw error;
  }
  if (isReservedSellerPin(safePin)) {
    const error = new Error('Escolha um PIN diferente de 1234.');
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
  const hashedPin = hashPin(safePin);
  const timestamp = osTimestamp();
  const email = `pdv+${id}@becoartes.local`;
  const passwordHash = hashDeliveryPassword(randomBytes(24).toString('hex'));

  await db.execute({
    sql: `
      INSERT INTO users (
        id, empresa_id, nome, email, password_hash, role, funcao, ativo, pin,
        is_operador, permitir_acesso_remoto, tipo_vinculo, pdv_sell_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, 0, ?, 1, ?, ?)
    `,
    args: [id, OS_EMPRESA_ID, safeName, email, passwordHash, role, funcao, hashedPin, tipoVinculo, timestamp, timestamp],
  });

  await syncOperationalUsersToSellers();
  const sellers = await getAuthSellers({ includePins: false });
  const seller = sellers.find((item) => item.id === `os:${id}`) || {
    id: `os:${id}`,
    name: safeName,
    nickname: safeName.split(' ')[0] || '',
    status: 'active',
    role: mapOperationalRoleLabel(role, funcao),
    permission: mapOperationalPermission(role, funcao),
    pin: '',
    employmentType: tipoVinculo,
    source: 'os',
  };
  return { created: true, seller };
};

const syncOperationalUsersToSellers = async () => {
  const operationalUsers = await getOperationalUsers({ includePins: true });
  for (const user of operationalUsers) {
    const mirrorId = `os:${user.id}`;
    const pin = String(user.pin || '').trim();
    const normalizedPin = normalizeStoredPin(pin);
    if (pin && normalizedPin && normalizedPin !== pin) {
      await db.execute({
        sql: "UPDATE users SET pin = ? WHERE empresa_id = ? AND id = ?",
        args: [normalizedPin, OS_EMPRESA_ID, user.id],
      });
    }
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
        normalizedPin,
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

const getAuthSellers = async ({ includePins = false, view = '' } = {}) => {
  const [operationalUsers, pdvUsers] = await Promise.all([
    getOperationalUsers({ includePins, view }),
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

const getClosedBills = async (limit = 200, filters = {}) => {
  const where = [];
  const args = [];
  if (filters.from) {
    where.push('closed_at >= ?');
    args.push(filters.from);
  }
  if (filters.to) {
    where.push('closed_at <= ?');
    args.push(filters.to);
  }
  const maxLimit = filters.extended ? 10000 : CLOSED_BILLS_LIMIT;
  const cappedLimit = Math.min(Math.max(Number(limit) || CLOSED_BILLS_LIMIT, 1), maxLimit);
  args.push(cappedLimit);

  const res = await db.execute({
    sql: `
      SELECT id, table_id, table_number, seller_id, seller_name, subtotal, service_fee, discount, discount_reason, coupon_code, coupon_amount, coupon_benefit, total, payments, strftime('%Y-%m-%dT%H:%M:%SZ', closed_at) as closed_at
      FROM closed_bills
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY closed_at DESC
      LIMIT ?
    `,
    args,
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

const normalizeCpf = (cpf = '') => String(cpf || '').replace(/\D/g, '').slice(0, 11);

const isValidCpf = (cpf = '') => {
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const calcDigit = (base) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (base.length + 1 - i);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calcDigit(digits.slice(0, 9)) === Number(digits[9])
    && calcDigit(digits.slice(0, 10)) === Number(digits[10]);
};

const maskCpf = (cpf = '') => {
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11) return 'CPF não informado';
  return `${digits.slice(0, 3)}******${digits.slice(-2)}`;
};

const getCpfHash = (cpf = '') => createHash('sha256').update(`beco-cpf:${normalizeCpf(cpf)}`).digest('hex');

const ensureTablesUpTo = async (count = 50) => {
  const current = await db.execute("SELECT number FROM tables ORDER BY CAST(number AS INTEGER) ASC");
  const existingNumbers = new Set(current.rows.map((row) => Number(row.number || 0)));
  const placeholders = [];
  const values = [];
  for (let i = 1; i <= count; i++) {
    if (existingNumbers.has(i)) continue;
    placeholders.push('(?, ?, ?)');
    values.push(String(i), String(i), 'available');
  }
  if (placeholders.length > 0) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO tables (id, number, status) VALUES ${placeholders.join(', ')}`,
      args: values,
    });
  }
};

const getCustomerTabTotalsByTable = async (tableIds = []) => {
  const uniqueTableIds = [...new Set(tableIds.filter(Boolean).map(String))];
  if (!uniqueTableIds.length) return {};
  const placeholders = uniqueTableIds.map(() => '?').join(',');
  const [ordersRes, paymentsRes] = await Promise.all([
    db.execute({
      sql: `
        SELECT table_id, COALESCE(SUM(total), 0) AS total
        FROM orders
        WHERE table_id IN (${placeholders}) AND status != 'closed'
        GROUP BY table_id
      `,
      args: uniqueTableIds,
    }),
    db.execute({
      sql: `
        SELECT table_id, COALESCE(SUM(amount), 0) AS total
        FROM table_payments
        WHERE table_id IN (${placeholders}) AND status = 'active'
        GROUP BY table_id
      `,
      args: uniqueTableIds,
    }),
  ]);
  const totals = {};
  uniqueTableIds.forEach((id) => { totals[id] = { orders: 0, payments: 0, balance: 0 }; });
  ordersRes.rows.forEach((row) => {
    const tableId = String(row.table_id || '');
    totals[tableId] = totals[tableId] || { orders: 0, payments: 0, balance: 0 };
    totals[tableId].orders = Number(row.total || 0);
  });
  paymentsRes.rows.forEach((row) => {
    const tableId = String(row.table_id || '');
    totals[tableId] = totals[tableId] || { orders: 0, payments: 0, balance: 0 };
    totals[tableId].payments = Number(row.total || 0);
  });
  Object.values(totals).forEach((total) => {
    total.balance = Number(Math.max(0, total.orders - total.payments).toFixed(2));
  });
  return totals;
};

const sanitizeCustomerTab = (row, totals = null) => {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    customerName: String(row.customer_name || ''),
    phone: String(row.phone || ''),
    cpfMasked: maskCpf(row.cpf || ''),
    cpfLast4: String(row.cpf_last4 || normalizeCpf(row.cpf || '').slice(-4)),
    tableId: String(row.table_id || ''),
    tableNumber: Number(row.table_number || 0),
    status: String(row.status || 'open'),
    openedAt: row.opened_at || null,
    paidAt: row.paid_at || null,
    closedAt: row.closed_at || null,
    totals: totals || { orders: 0, payments: 0, balance: 0 },
  };
};

const getTables = async () => {
  await ensureTablesUpTo(200);
  const tableRes = await db.execute("SELECT * FROM tables ORDER BY CAST(number AS INTEGER) ASC");

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

  const tabsRes = await db.execute(`
    SELECT *
    FROM customer_tabs
    WHERE status IN ('open', 'paid')
    ORDER BY opened_at ASC
  `);
  const tabTotals = await getCustomerTabTotalsByTable(tabsRes.rows.map((row) => row.table_id));
  const tabsByTable = {};
  tabsRes.rows.forEach((row) => {
    const tableId = String(row.table_id || '');
    tabsByTable[tableId] = sanitizeCustomerTab(row, tabTotals[tableId]);
  });

  return tableRes.rows.map((row) => ({
    id: row.id,
    number: Number(row.number),
    status: row.status,
    orders: ordersByTable[row.id] || [],
    payments: paymentsByTable[row.id] || [],
    customerTab: tabsByTable[row.id] || null,
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
  const visibleTables = savedSettings?.qrMode === 'comanda'
    ? tables
    : tables.filter((table) => Number(table.number || 0) <= 50);

  return filterSnapshotForContext({
    catalogData,
    catalogVersion,
    sellers,
    kitchenData,
    serviceRequests,
    closedBills,
    savedSettings,
    cashState,
    tables: visibleTables,
    auditLogs,
  }, { view, session });
};

const isTransientSnapshotError = (error) => /fetch failed|timeout|timed out|etimedout|econnreset|socket hang up/i.test(String(error?.message || error || ''));

const getAppSnapshotWithRetry = async (options) => {
  try {
    return await getAppSnapshot(options);
  } catch (error) {
    if (!isTransientSnapshotError(error)) throw error;
    console.warn(`[sync-retry] view=${options?.view || 'pdv'} reason=${String(error?.message || error)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return getAppSnapshot(options);
  }
};

const getChecklistAlertsFromOs = async () => {
  if (!OS_OPERATIONAL_ALERTS_TOKEN) {
    return { success: false, degraded: true, alerts: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(OS_CHECKLIST_ALERTS_URL, {
      headers: { 'x-operational-alerts-token': OS_OPERATIONAL_ALERTS_TOKEN },
      signal: controller.signal,
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      const error = new Error(`Alertas do checklist indisponíveis (HTTP ${response.status}).`);
      error.statusCode = 503;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
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

const login = async ({ pin, sellerId, view }, { operationAccessAllowed = true, req = null } = {}) => {
  await ensureDatabaseReady();
  await ensureDefaultSellersReady();
  const safePin = String(pin || '');
  const safeView = normalizeOperationalView(view);

  const activeSellers = (await getAuthSellers({ includePins: true, view: safeView }))
    .filter((seller) => seller.status === 'active' && (!sellerId || seller.id === sellerId));
  let blockedNonAdminMatch = false;

  if (activeSellers.length === 0 && BOOTSTRAP_ADMIN_PIN && safeSecretEqual(safePin, BOOTSTRAP_ADMIN_PIN)) {
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
    const pinCheck = verifyPin(safePin, storedPin);
    if (!pinCheck.ok) continue;
    const safeSeller = toSessionSeller(seller);

    if (!operationAccessAllowed && !canAccessOutsideOperationIp(safeSeller)) {
      blockedNonAdminMatch = true;
      if (req && isOperationIpRestricted()) {
        console.warn(`Blocked non-admin login outside operation IP: ${getClientIp(req)} seller=${seller.id}`);
      }
      continue;
    }

    if (pinCheck.needsRehash) {
      await persistSellerPin(seller.id, safePin);
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
  if (safeSecretEqual(safePin, TABLET_SETUP_PIN) && operationAccessAllowed) return { valid: true, ...createProductionStationSession() };
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
  return verifyPin(safePin, storedPin).ok;
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
    const pinCheck = verifyPin(safePin, storedPin);
    if (!pinCheck.ok) continue;

    if (pinCheck.needsRehash) {
      await persistSellerPin(seller.id, safePin);
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

const resolveCashClosingActorByPin = async (pin) => {
  const cashActor = await resolveCashActorByPin(pin, 'closeCash');
  const isOsSuperAdmin = cashActor.seller?.source === 'os' && cashActor.seller?.osRole === 'super_admin';
  if (!cashActor.override && !isOsSuperAdmin) {
    const error = new Error('Somente o superadministrador pode fechar o caixa.');
    error.statusCode = 403;
    throw error;
  }
  return { ...cashActor, override: true };
};

const canAuthorizeQrMode = (session) => {
  const permission = normalizePermission(session?.permission);
  return permission === 'admin' || permission === 'manager';
};

const resolveQrModeAuthorizerByPin = async (pin) => {
  const safePin = String(pin || '');
  if (!/^\d{4}$/.test(safePin)) {
    const error = new Error('PIN inválido.');
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
    const pinCheck = verifyPin(safePin, storedPin);
    if (!pinCheck.ok) continue;

    if (pinCheck.needsRehash) {
      await persistSellerPin(seller.id, safePin);
    }

    const safeSeller = toSessionSeller(seller);
    if (!canAuthorizeQrMode(safeSeller)) {
      const error = new Error('PIN sem autorização.');
      error.statusCode = 403;
      throw error;
    }

    return { seller: safeSeller, override: false };
  }

  const error = new Error('PIN inválido.');
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

    if (soldId && row.pdv_product_id === soldId) {
      if (soldServing && serving && soldServing !== serving) return 999;
      if (!soldServing && serving === 'p2') return 5;
      return 0;
    }
    if (soldNorm && nameNorms.includes(soldNorm)) return 10;
    if (soldName && names.some((name) => isLooseRecipeNameMatch(soldName, name))) {
      if (soldServing && serving && soldServing !== serving) return 999;
      return 20;
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
          WHERE id = ? AND empresa_id = ? AND ativo = 1 AND changes() > 0
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
        m.delivery_visible,
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
    const isDeliveryVisible = Number(product.delivery_visible ?? 1) === 1;
    if (isPublicOrigin === 'delivery' && !isDeliveryVisible) {
      const error = new Error(`${productName} está indisponível no delivery.`);
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
    sql: `
      SELECT oi.order_id, oi.product_id, oi.quantity, oi.selected_modifiers,
             o.table_id, m.name, m.remote_stock_id
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN menu m ON m.id = oi.product_id
      WHERE oi.id = ?
      LIMIT 1
    `,
    args: [itemId],
  });
  const itemRow = itemRes.rows[0] || null;
  if (!itemRow) {
    const existingReversal = await db.execute({
      sql: `
        SELECT order_id
        FROM estoque_movimentacoes
        WHERE order_item_id = ? AND source_item_kind = 'cancel_reversal'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      args: [itemId],
    });
    return {
      orderId: existingReversal.rows[0]?.order_id || null,
      inventoryReversalCount: 0,
      idempotent: Boolean(existingReversal.rows[0]),
    };
  }
  const orderId = itemRow?.order_id;
  const tableId = itemRow?.table_id;
  if (tableId) {
    await ensureTableAccess(tableId, session);
  }

  const stockMovements = await db.execute({
    sql: `
      SELECT id, empresa_id, produto_id, quantidade, responsavel_id
      FROM estoque_movimentacoes
      WHERE origem = 'pdv'
        AND order_item_id = ?
        AND tipo_movimentacao = 'saida'
        AND COALESCE(source_item_kind, '') != 'cancel_reversal'
    `,
    args: [itemId],
  });
  const now = osTimestamp();
  let osUserId = null;
  if (stockMovements.rows.length > 0) {
    try {
      osUserId = (await resolveOSContext()).userId;
    } catch {
      osUserId = null;
    }
  }

  const cancellationBatch = [];
  for (const movement of stockMovements.rows) {
    const stockProduct = await db.execute({
      sql: "SELECT id FROM estoque_produtos WHERE id = ? AND empresa_id = ? LIMIT 1",
      args: [movement.produto_id, movement.empresa_id],
    });
    if (!stockProduct.rows[0]) {
      const error = new Error('Não foi possível estornar o item porque o produto vinculado não existe mais no estoque. Revise o vínculo antes de cancelar.');
      error.statusCode = 409;
      throw error;
    }
    const reversalId = `pdv_cancel_${movement.id}`;
    cancellationBatch.push(
      {
        sql: `
          INSERT OR IGNORE INTO estoque_movimentacoes
            (id, empresa_id, produto_id, tipo_movimentacao, quantidade,
             quantidade_anterior, quantidade_nova, motivo, responsavel_id,
             created_at, order_id, order_item_id, origem, source_item_id, source_item_kind)
          SELECT ?, empresa_id, id, 'entrada', ?, quantidade_atual, quantidade_atual + ?, ?, ?, ?, ?, ?, 'pdv', ?, 'cancel_reversal'
          FROM estoque_produtos
          WHERE id = ? AND empresa_id = ?
        `,
        args: [
          reversalId,
          Number(movement.quantidade || 0),
          Number(movement.quantidade || 0),
          `Estorno automático por cancelamento do item ${itemId}: ${reasonLabel}`,
          osUserId || movement.responsavel_id,
          now,
          orderId,
          itemId,
          String(movement.id),
          movement.produto_id,
          movement.empresa_id,
        ],
      },
      {
        sql: `
          UPDATE estoque_produtos
          SET quantidade_atual = quantidade_atual + ?,
              status = CASE WHEN quantidade_atual + ? <= estoque_minimo THEN 'Crítico' ELSE 'Saudável' END,
              updated_at = ?
          WHERE id = ? AND empresa_id = ? AND changes() > 0
        `,
        args: [Number(movement.quantidade || 0), Number(movement.quantidade || 0), now, movement.produto_id, movement.empresa_id],
      },
    );
  }
  cancellationBatch.push({ sql: "DELETE FROM order_items WHERE id = ?", args: [itemId] });
  await db.batch(cancellationBatch, 'write');
  if (stockMovements.rows.length > 0) await bumpCatalogVersion();

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

  return { orderId: orderId || null, inventoryReversalCount: stockMovements.rows.length };
};

const getExistingOrderSubmission = async (clientRequestId) => {
  if (!clientRequestId) return null;
  const result = await db.execute({
    sql: "SELECT id, table_id FROM orders WHERE client_request_id = ? LIMIT 1",
    args: [clientRequestId],
  });
  return result.rows?.[0] || null;
};

const orderSubmissionDuplicateResponse = (order, tableId, items = []) => {
  const orderId = String(order?.id || '');
  const requestId = `new_order_${orderId}`;
  return {
    duplicate: true,
    orderId,
    request: {
      id: requestId,
      tableId: String(order?.table_id || tableId),
      type: 'new_order',
      message: items.map((item) => `${item.quantity}x ${item.name}`).join(', '),
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
    inventorySync: null,
    inventorySyncError: null,
  };
};

const isConstraintError = (error) => /constraint|unique|primary key/i.test(String(error?.message || error || ''));

const sendToKitchen = async ({ orderId, tableId, total, origin, sellerId, clientRequestId, items }, session = null) => {
  requireString(orderId, 'orderId');
  requireString(tableId, 'tableId');
  const safeOrigin = origin === 'tablet' || origin === 'qr' ? origin : 'pdv';
  const safeClientRequestId = normalizeText(clientRequestId || orderId).slice(0, 120);
  const existingSubmission = await getExistingOrderSubmission(safeClientRequestId);
  if (existingSubmission) {
    return orderSubmissionDuplicateResponse(existingSubmission, tableId, Array.isArray(items) ? items : []);
  }
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
      sql: "INSERT INTO orders (id, table_id, total, status, origin, created_by_id, client_request_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [orderId, tableId, requireNumber(total, 'total'), 'pending', safeOrigin, effectiveSellerId, safeClientRequestId],
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

  try {
    await db.batch(batch, 'write');
  } catch (error) {
    if (safeClientRequestId && isConstraintError(error)) {
      const duplicateSubmission = await getExistingOrderSubmission(safeClientRequestId);
      if (duplicateSubmission) {
        return orderSubmissionDuplicateResponse(duplicateSubmission, tableId, safeItems);
      }
    }
    throw error;
  }

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
  taxId: normalizeText(customer.taxId || customer.tax_id).replace(/\D/g, ''),
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
  paymentMethod: customer.paymentMethod === 'pagbank'
    ? 'pix'
    : (['pix', 'credit', 'debit'].includes(customer.paymentMethod) ? customer.paymentMethod : 'pix'),
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

const createPagBankCustomerTabPayload = ({ referenceId, customer, items, amount, paymentMethod, returnUrl }) => {
  const methodMap = {
    pix: [{ type: 'PIX' }],
    credit: [{ type: 'CREDIT_CARD' }],
    debit: [{ type: 'DEBIT_CARD' }],
  };
  const phone = splitBrazilianPhone(customer.phone);
  const itemTotalCents = items.reduce((sum, item) => {
    return sum + Math.round(Number(item.price || 0) * 100) * Number(item.quantity || 1);
  }, 0);
  const amountCents = Math.round(Number(amount || 0) * 100);
  const payload = {
    reference_id: referenceId.slice(0, 64),
    customer: {
      name: customer.name,
      phones: phone.areaCode && phone.number ? [{
        country: phone.countryCode,
        area: phone.areaCode,
        number: phone.number,
        type: 'MOBILE',
      }] : [],
    },
    customer_modifiable: true,
    items: items.length > 0 ? items.map((item) => ({
      reference_id: String(item.productId || item.id).slice(0, 64),
      name: String(item.name || 'Item').slice(0, 100),
      quantity: Number(item.quantity || 1),
      unit_amount: Math.round(Number(item.price || 0) * 100),
    })) : [{
      reference_id: referenceId.slice(0, 64),
      name: 'Comanda Becoartes',
      quantity: 1,
      unit_amount: Math.round(Number(amount || 0) * 100),
    }],
    payment_methods: methodMap[paymentMethod] || [{ type: 'PIX' }, { type: 'CREDIT_CARD' }, { type: 'DEBIT_CARD' }],
    soft_descriptor: 'BECOARTES',
  };

  if (itemTotalCents > amountCents) {
    payload.discount_amount = itemTotalCents - amountCents;
  }

  const notificationUrls = PAGBANK_NOTIFICATION_URL ? [PAGBANK_NOTIFICATION_URL] : [];
  if (notificationUrls.length > 0) {
    payload.notification_urls = notificationUrls;
    payload.payment_notification_urls = notificationUrls;
  }

  const safeReturnUrl = String(returnUrl || PAGBANK_REDIRECT_URL || '').trim();
  if (safeReturnUrl) {
    payload.redirect_url = safeReturnUrl;
    payload.return_url = safeReturnUrl;
  }

  return payload;
};

const getPagBankPublicKey = async () => {
  if (!PAGBANK_TOKEN) {
    return { status: 'missing_credentials', provider: 'pagbank', publicKey: null };
  }
  const response = await fetch(`${PAGBANK_API_BASE_URL}/public-keys`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${PAGBANK_TOKEN}`,
    },
    body: JSON.stringify({ type: 'card' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const pagBankError = payload?.error_messages?.[0];
    const error = new Error(pagBankError?.description || payload?.message || `PagBank recusou chave pública (${response.status}).`);
    error.statusCode = 502;
    throw error;
  }
  const publicKey = payload.public_key || payload.publicKey;
  if (!publicKey) {
    const error = new Error('PagBank não retornou chave pública.');
    error.statusCode = 502;
    throw error;
  }
  return { status: 'ready', provider: 'pagbank', publicKey, createdAt: payload.created_at || null };
};

const createPagBankDeliveryOrderItems = ({ items, totals }) => {
  const totalCents = moneyToCents(totals.total, 'delivery.total');
  if (totals.discount > 0) {
    return [{
      reference_id: 'becoartes_delivery_total',
      name: 'Pedido Becoartes Delivery',
      quantity: 1,
      unit_amount: totalCents,
    }];
  }
  const orderItems = items.map((item) => ({
    reference_id: String(item.productId || item.id).slice(0, 64),
    name: String(item.name || 'Item').slice(0, 100),
    quantity: Number(item.quantity || 1),
    unit_amount: moneyToCents(Number(item.price || 0), 'delivery.item.price'),
  }));
  if (totals.deliveryFee > 0) {
    orderItems.push({
      reference_id: 'becoartes_delivery_fee',
      name: 'Taxa de entrega',
      quantity: 1,
      unit_amount: moneyToCents(totals.deliveryFee, 'delivery.deliveryFee'),
    });
  }
  return orderItems.length > 0 ? orderItems : [{
    reference_id: 'becoartes_delivery_total',
    name: 'Pedido Becoartes Delivery',
    quantity: 1,
    unit_amount: totalCents,
  }];
};

const createPagBankDeliveryOrderPayload = ({ orderId, customer, items, totals, payment = {} }) => {
  const totalCents = moneyToCents(totals.total, 'delivery.total');
  const phone = splitBrazilianPhone(customer.phone);
  const notificationUrls = PAGBANK_NOTIFICATION_URL ? [PAGBANK_NOTIFICATION_URL] : [];
  const basePayload = {
    reference_id: orderId.slice(0, 64),
    customer: {
      name: customer.name,
      email: customer.email,
      tax_id: customer.taxId,
      phones: phone.areaCode && phone.number ? [{
        country: phone.countryCode,
        area: phone.areaCode,
        number: phone.number,
        type: 'MOBILE',
      }] : [],
    },
    items: createPagBankDeliveryOrderItems({ items, totals }),
  };
  if (notificationUrls.length > 0) basePayload.notification_urls = notificationUrls;

  if (customer.paymentMethod === 'pix') {
    return {
      ...basePayload,
      qr_codes: [{
        amount: { value: totalCents },
        expiration_date: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }],
    };
  }

  const paymentType = customer.paymentMethod === 'debit' ? 'DEBIT_CARD' : 'CREDIT_CARD';
  const card = payment?.card || {};
  const encryptedCard = normalizeText(card.encrypted);
  requireString(encryptedCard, 'payment.card.encrypted');
  const holderName = normalizeText(card.holderName || customer.name);
  const holderTaxId = normalizeText(card.holderTaxId || customer.taxId).replace(/\D/g, '');
  requireString(holderName, 'payment.card.holderName');
  requireString(holderTaxId, 'payment.card.holderTaxId');

  const paymentMethod = {
    type: paymentType,
    installments: Math.max(1, Number(card.installments || 1)),
    capture: true,
    card: {
      encrypted: encryptedCard,
      store: false,
    },
    holder: {
      name: holderName,
      tax_id: holderTaxId,
    },
  };
  if (customer.paymentMethod === 'debit' && card.authenticationMethod) {
    paymentMethod.authentication_method = card.authenticationMethod;
  }

  return {
    ...basePayload,
    charges: [{
      reference_id: `${orderId.slice(0, 48)}_charge`,
      description: 'Becoartes Delivery',
      amount: {
        value: totalCents,
        currency: 'BRL',
      },
      payment_method: paymentMethod,
    }],
  };
};

const getPagBankPaymentStatusFromOrder = (method, result = {}) => {
  if (method === 'pix') return 'payment_pending';
  const statuses = [
    result.charges?.[0]?.status,
    result.charges?.[0]?.payment_response?.status,
  ].filter(Boolean).map((value) => String(value).toUpperCase());
  if (statuses.some((status) => ['PAID', 'AUTHORIZED', 'APPROVED'].includes(status))) return 'paid';
  if (statuses.some((status) => ['DECLINED', 'CANCELED', 'CANCELLED'].includes(status))) return 'payment_failed';
  return 'payment_pending';
};

const createPagBankPaymentInstructions = (method, result = {}) => {
  if (method === 'pix') {
    const qrCode = Array.isArray(result.qr_codes) ? result.qr_codes[0] : null;
    const imageLink = Array.isArray(qrCode?.links) ? qrCode.links.find((link) => link.rel === 'QRCODE.PNG' || link.media === 'image/png') : null;
    return {
      type: 'pix',
      status: 'payment_pending',
      qrCodeText: qrCode?.text || '',
      qrCodeImage: imageLink?.href || null,
      expiresAt: qrCode?.expiration_date || null,
      message: 'Pague o Pix para acionar cozinha e entrega.',
    };
  }
  const charge = Array.isArray(result.charges) ? result.charges[0] : null;
  const status = getPagBankPaymentStatusFromOrder(method, result);
  return {
    type: method,
    status,
    chargeStatus: charge?.status || null,
    message: status === 'paid'
      ? 'Pagamento aprovado.'
      : status === 'payment_failed'
        ? (charge?.payment_response?.message || 'Pagamento recusado.')
        : 'Aguardando confirmação do pagamento.',
  };
};

const prepareDeliveryPayment = async ({ orderId, customer, items, totals, payment }) => {
  if (DELIVERY_PAYMENT_PROVIDER === 'disabled') {
    return { status: 'disabled', provider: 'disabled', externalId: null, checkoutUrl: null, payload: null, instructions: null };
  }

  if (DELIVERY_PAYMENT_PROVIDER !== 'pagbank') {
    return {
      status: 'paid_mock',
      provider: 'mock',
      externalId: `pagbank_mock_${createId()}`,
      checkoutUrl: null,
      payload: { total: totals.total, paymentMethod: customer.paymentMethod },
      instructions: { type: customer.paymentMethod, status: 'paid_mock', message: 'Pagamento mock aprovado.' },
    };
  }

  const payload = createPagBankDeliveryOrderPayload({ orderId, customer, items, totals, payment });
  if (!PAGBANK_TOKEN) {
    return { status: 'missing_credentials', provider: 'pagbank', externalId: null, checkoutUrl: null, payload, instructions: null };
  }

  // Chamada real mantida atras de env explicito. Em producao, o webhook confirma o pagamento.
  const response = await fetch(`${PAGBANK_API_BASE_URL}/orders`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${PAGBANK_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const pagBankError = result?.error_messages?.[0];
    const code = pagBankError?.error || '';
    const description = pagBankError?.description || result?.message || '';
    const allowlistMessage = code === 'allowlist_access_required'
      ? 'PagBank ainda não liberou esta conta para criar pedidos por API Orders em produção.'
      : '';
    const error = new Error(allowlistMessage || description || `PagBank recusou pagamento (${response.status}).`);
    error.statusCode = 502;
    throw error;
  }

  return {
    status: getPagBankPaymentStatusFromOrder(customer.paymentMethod, result),
    provider: 'pagbank',
    externalId: result.id || null,
    checkoutUrl: null,
    payload,
    instructions: createPagBankPaymentInstructions(customer.paymentMethod, result),
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

const rowToDeliveryOrder = (row, items = [], club = null, paymentInstructions = null) => {
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
    paymentInstructions,
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
  const paymentEventRes = await db.execute({
    sql: "SELECT payload FROM delivery_events WHERE delivery_order_id = ? AND type = 'payment' ORDER BY created_at DESC LIMIT 1",
    args: [safeOrderId],
  });
  const paymentPayload = parseJsonObject(paymentEventRes.rows[0]?.payload) || {};
  const order = rowToDeliveryOrder(row, items, club, paymentPayload.instructions || null);
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

const getPagBankWebhookAmount = (body = {}) => {
  const candidates = [
    body.amount?.value,
    body.amount,
    body.charges?.[0]?.amount?.value,
    body.charges?.[0]?.paid_amount?.value,
    body.charges?.[0]?.summary?.paid,
  ];
  const value = candidates.find((candidate) => Number.isFinite(Number(candidate)) && Number(candidate) > 0);
  if (!value) return 0;
  const numeric = Number(value);
  return numeric > 1000 ? centsToMoney(numeric) : numeric;
};

const getPagBankWebhookPaymentMethod = (body = {}) => {
  const raw = String(
    body.payment_method?.type
    || body.paymentMethod?.type
    || body.charges?.[0]?.payment_method?.type
    || body.charges?.[0]?.paymentMethod?.type
    || ''
  ).toUpperCase();
  if (raw.includes('CREDIT')) return 'credit';
  if (raw.includes('DEBIT')) return 'debit';
  if (raw.includes('PIX')) return 'pix';
  return 'pix';
};

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

  if (String(referenceId).startsWith('customer_tab_')) {
    return handlePagBankCustomerTabWebhook({ referenceId, status, body });
  }

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

const handlePagBankCustomerTabWebhook = async ({ referenceId, status, body }) => {
  const match = String(referenceId || '').match(/^customer_tab_(.+)_\d+$/);
  const tabId = match?.[1] || '';
  if (!tabId) return null;

  const tabRes = await db.execute({ sql: "SELECT * FROM customer_tabs WHERE id = ? LIMIT 1", args: [tabId] });
  const row = tabRes.rows[0];
  if (!row) {
    const error = new Error('Comanda do webhook não encontrada.');
    error.statusCode = 404;
    throw error;
  }

  const balance = await getCustomerTabPayableBalance(row.table_id);
  const paidAt = new Date().toISOString();
  const paymentId = `pagbank_${String(body.id || referenceId).slice(0, 80)}`;
  const amount = getPagBankWebhookAmount(body) || balance;
  const method = getPagBankWebhookPaymentMethod(body);

  if (status !== 'paid') {
    await db.execute({
      sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, 'customer_tab_payment_webhook', ?, ?, 'pagbank', 'PagBank', ?)",
      args: [
        createId(),
        JSON.stringify({ tabId, referenceId, status, externalId: body.id || null }),
        String(row.table_number),
        paidAt,
      ],
    });
    return { tabId, status, applied: false };
  }

  await db.batch([
    {
      sql: `
        INSERT OR IGNORE INTO table_payments
          (id, table_id, table_number, seller_id, seller_name, method, amount, status, created_at)
        VALUES (?, ?, ?, 'pagbank', 'PagBank', ?, ?, 'active', ?)
      `,
      args: [paymentId, row.table_id, Number(row.table_number || 0), method, amount, paidAt],
    },
    {
      sql: "UPDATE customer_tabs SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE id = ? AND status = 'open'",
      args: [paidAt, tabId],
    },
    {
      sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, 'customer_tab_payment_registered', ?, ?, 'pagbank', 'PagBank', ?)",
      args: [
        createId(),
        JSON.stringify({ tabId, referenceId, paymentId, method, amount, externalId: body.id || null }),
        String(row.table_number),
        paidAt,
      ],
    },
  ], 'write');

  return { tabId, status, applied: true, paymentId };
};

const createDeliveryCheckout = async ({ orderId, customer, items, payment }) => {
  await ensureDatabaseReady();
  const safeCustomer = normalizeDeliveryCustomer(customer);
  requireString(safeCustomer.name, 'customer.name');
  requireString(safeCustomer.phone, 'customer.phone');
  requireString(safeCustomer.email, 'customer.email');
  if (['credit', 'debit'].includes(safeCustomer.paymentMethod)) {
    requireString(safeCustomer.taxId, 'customer.taxId');
  }
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
    isPublicOrigin: 'delivery',
  });

  const deliveryOrderId = String(orderId || `delivery_${createId()}`);
  const customerId = createHash('sha256')
    .update(`${safeCustomer.phone}|${safeCustomer.email}`)
    .digest('hex')
    .slice(0, 32);
  const now = new Date().toISOString();
  const totals = calculateDeliveryTotals({ items: safeItems, customer: safeCustomer });
  const { subtotal, deliveryFee, discount, total } = totals;
  const paymentResult = await prepareDeliveryPayment({ orderId: deliveryOrderId, customer: safeCustomer, items: safeItems, totals, payment });
  const logistics = await requestDeliveryLogistics({ orderId: deliveryOrderId, customer: safeCustomer, items: safeItems, totals, paymentStatus: paymentResult.status });
  const isPaid = String(paymentResult.status).startsWith('paid');
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
        paymentResult.status, paymentResult.provider, paymentResult.externalId, paymentResult.checkoutUrl, kitchenStatus, logistics.status, logistics.provider, logistics.externalId, productionOrderId, customerSnapshot, safeCustomer.notes, paidAt, kitchenSentAt, deliveryRequestedAt,
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
      args: [createId(), deliveryOrderId, paymentResult.status, paymentResult.provider, paymentResult.externalId, JSON.stringify({
        request: paymentResult.payload || { paymentMethod: safeCustomer.paymentMethod, total },
        instructions: paymentResult.instructions || null,
      })],
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
      paymentStatus: paymentResult.status,
      paymentProvider: paymentResult.provider,
      paymentExternalId: paymentResult.externalId,
      checkoutUrl: paymentResult.checkoutUrl,
      paymentInstructions: paymentResult.instructions || null,
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
    sql: "SELECT name, description, price, cost, category_id, image, visible, delivery_visible, erp_code, remote_stock_id, schedule_config, sort_order FROM menu WHERE id = ? LIMIT 1",
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
      || Number(currentProduct.sort_order || 0) !== Number(p.sortOrder || 0)
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

    const currentDeliveryVisible = Number(currentProduct.delivery_visible ?? 1) === 1;
    if (currentDeliveryVisible !== (p.deliveryVisible !== false)) {
      requirePermission(session, 'toggleProductVisibility', settings);
    }
  }

  await db.execute({
    sql: "INSERT OR REPLACE INTO menu (id, name, description, price, category, category_id, image, visible, delivery_visible, erp_code, remote_stock_id, schedule_config, cost, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      productId,
      requireString(p.name, 'product.name'),
      p.description || '',
      requireNumber(p.price, 'product.price'),
      p.categoryId || '',
      p.categoryId || '',
      p.image || '',
      p.visible ? 1 : 0,
      p.deliveryVisible === false ? 0 : 1,
      p.erpCode || null,
      p.remoteStockId || null,
      p.schedule ? JSON.stringify(p.schedule) : null,
      Number(p.cost || 0),
      Number(p.sortOrder || 0),
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

const ensureCmvForMenuProduct = async ({ productId }, session = null) => {
  const id = requireString(productId, 'productId');
  const settings = await getSettings();
  requirePermission(session, 'editProduct', settings);
  const productResult = await db.execute({
    sql: `
      SELECT m.id, m.name, m.price, c.name AS category_name
      FROM menu m
      LEFT JOIN categories c ON c.id = m.category_id
      WHERE m.id = ?
      LIMIT 1
    `,
    args: [id],
  });
  const product = productResult.rows[0];
  if (!product) {
    const error = new Error('Produto do PDV não encontrado.');
    error.statusCode = 404;
    throw error;
  }

  const existing = await db.execute({
    sql: "SELECT id, custo_total FROM fichas_tecnicas WHERE pdv_product_id = ? ORDER BY updated_at DESC LIMIT 1",
    args: [id],
  });
  if (existing.rows[0]) {
    return { created: false, cmvId: existing.rows[0].id, cost: Number(existing.rows[0].custo_total || 0) };
  }

  const { empresaId, userId } = await resolveOSContext();
  const cmvId = `ficha-pdv-${id}-${Date.now()}`;
  const now = osTimestamp();
  await db.execute({
    sql: `
      INSERT INTO fichas_tecnicas (
        id, empresa_id, nome_prato, categoria, subcategoria, preco_venda,
        custo_total, cmv_percentual, modo_preparo, criado_por_id,
        pdv_product_id, pdv_product_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, 0, 0, '', ?, ?, ?, ?, ?)
    `,
    args: [
      cmvId,
      empresaId,
      String(product.name || 'Produto PDV'),
      String(product.category_name || 'Outros'),
      Number(product.price || 0),
      userId,
      id,
      String(product.name || 'Produto PDV'),
      now,
      now,
    ],
  });
  await bumpCatalogVersion();
  return { created: true, cmvId, cost: 0 };
};

const DELETED_PRODUCT_SUFFIX = ' (produto deletado)';

const deleteProduct = async ({ id }, session = null) => {
  if (normalizePermission(session?.permission) !== 'admin') {
    const error = new Error('Somente admin full access pode excluir produtos.');
    error.statusCode = 403;
    throw error;
  }

  requireString(id, 'id');

  const productRes = await db.execute({
    sql: "SELECT id, name FROM menu WHERE id = ? LIMIT 1",
    args: [id],
  });
  const product = productRes.rows[0];
  if (!product) {
    return { catalogVersion: await bumpCatalogVersion(), deleted: false, reason: 'not_found' };
  }

  const currentName = String(product.name || 'Produto');
  const archivedName = currentName.endsWith(DELETED_PRODUCT_SUFFIX)
    ? currentName
    : `${currentName}${DELETED_PRODUCT_SUFFIX}`;

  await db.batch([
    {
      sql: `
        UPDATE menu
        SET name = ?, visible = 0, delivery_visible = 0, category_id = NULL, sort_order = 999999
        WHERE id = ?
      `,
      args: [archivedName, id],
    },
    {
      sql: "DELETE FROM product_modifier_groups WHERE product_id = ?",
      args: [id],
    },
    {
      sql: "UPDATE delivery_order_items SET name = ? WHERE product_id = ?",
      args: [archivedName, id],
    },
  ], 'write');

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

const toggleProductDeliveryVisibility = async ({ id, deliveryVisible }) => {
  requireString(id, 'id');
  await db.execute({
    sql: "UPDATE menu SET delivery_visible = ? WHERE id = ?",
    args: [deliveryVisible ? 1 : 0, id],
  });
  return { catalogVersion: await bumpCatalogVersion() };
};

// Reordena produtos em lote: uma transação, um bump de versão de catálogo.
// Substitui o fluxo antigo de um upsert completo por produto a cada passo de ordenação.
const reorderCatalogProducts = async ({ items }, session = null) => {
  const settings = await getSettings();
  requirePermission(session, 'editProduct', settings);

  const safeItems = (Array.isArray(items) ? items : []).map((item) => ({
    id: requireString(item?.id, 'item.id'),
    sortOrder: requireNumber(item?.sortOrder, 'item.sortOrder'),
  }));

  if (safeItems.length > 0) {
    await db.batch(
      safeItems.map((item) => ({
        sql: "UPDATE menu SET sort_order = ? WHERE id = ?",
        args: [item.sortOrder, item.id],
      })),
      'write'
    );
  }

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

const saveQrMode = async ({ qrMode, authorizationPin }, session = null) => {
  requireSession(session);

  const nextMode = qrMode === 'comanda' ? 'comanda' : qrMode === 'mesa' ? 'mesa' : '';
  if (!nextMode) {
    const error = new Error('Modo do QR inválido.');
    error.statusCode = 400;
    throw error;
  }

  const currentSettings = await getSettings();
  let authorizer = session;

  if (!canAuthorizeQrMode(session)) {
    const resolved = await resolveQrModeAuthorizerByPin(authorizationPin);
    authorizer = resolved.seller;
  }

  const nextSettings = {
    ...(currentSettings || {}),
    qrMode: nextMode,
  };

  await db.execute({
    sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('settings', ?, CURRENT_TIMESTAMP)",
    args: [JSON.stringify(nextSettings)],
  });

  await addAuditLog({
    id: createId(),
    action: 'qr_mode_changed',
    details: JSON.stringify({
      qrMode: nextMode,
      requestedById: session?.id || '',
      requestedByName: session?.name || 'Sistema',
      authorizedById: authorizer?.id || '',
      authorizedByName: authorizer?.name || 'Sistema',
    }),
    origin: 'pdv',
    authorId: authorizer?.id || session?.id || '',
    authorName: authorizer?.name || session?.name || 'Sistema',
    timestamp: new Date().toISOString(),
  });

  return { saved: true, settings: nextSettings };
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

const getActiveTablePaymentBalance = async (tableId) => {
  const [items, settings, paymentsRes] = await Promise.all([
    getActiveOrderItemsForTable(tableId),
    getSettings(),
    db.execute({
      sql: "SELECT COALESCE(SUM(amount), 0) AS total FROM table_payments WHERE table_id = ? AND status = 'active'",
      args: [tableId],
    }),
  ]);
  const subtotalCents = items.reduce((sum, item) => sum + moneyToCents(getOrderItemLineTotal(item), 'table.subtotal'), 0);
  const serviceFeePercent = clampServiceFeePercent(Number(settings?.serviceTax ?? MAX_SERVICE_FEE_PERCENT));
  const serviceFeeCents = Math.round(subtotalCents * (serviceFeePercent / 100));
  const paidCents = moneyToCents(paymentsRes.rows[0]?.total || 0, 'tablePayments.total');
  return {
    subtotalCents,
    serviceFeeCents,
    paidCents,
    balanceCents: Math.max(0, subtotalCents + serviceFeeCents - paidCents),
  };
};

const isSameTablePayment = (row, { tableId, method, amountCents }) => (
  String(row.table_id || '') === String(tableId || '')
  && String(row.method || '') === String(method || '')
  && moneyToCents(row.amount || 0, 'existingPayment.amount') === amountCents
);

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

  const existingRes = await db.execute({
    sql: "SELECT id, table_id, table_number, seller_id, seller_name, method, amount, status, strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at FROM table_payments WHERE id = ? LIMIT 1",
    args: [id],
  });
  const existingPayment = existingRes.rows[0];
  if (existingPayment) {
    if (!isSameTablePayment(existingPayment, { tableId, method, amountCents })) {
      const error = new Error('ID de pagamento já existe com dados diferentes.');
      error.statusCode = 409;
      throw error;
    }
    return { payment: formatTablePayment(existingPayment), idempotent: true };
  }

  const { balanceCents } = await getActiveTablePaymentBalance(tableId);
  if (amountCents > balanceCents) {
    throw new Error(`Pagamento parcial maior que o saldo aberto da mesa (${formatMoneyBRL(centsToMoney(balanceCents))}).`);
  }

  await db.batch([
    {
      sql: `
        INSERT INTO table_payments
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
  let closedCustomerTabs = 0;
  if (status === 'available') {
    const activeTabs = await db.execute({
      sql: "SELECT id, customer_name, cpf, table_number FROM customer_tabs WHERE table_id = ? AND status IN ('open', 'paid')",
      args: [tableId],
    });
    if (activeTabs.rows.length > 0) {
      const totals = await getCustomerTabTotalsByTable([tableId]);
      const balance = Number(totals[tableId]?.balance || 0);
      if (balance > 0.009) {
        throw new Error(`Mesa ainda tem comanda com saldo em aberto: ${formatMoneyBRL(balance)}.`);
      }
      const now = new Date().toISOString();
      const closeCommands = activeTabs.rows.map((tab) => ({
        sql: "UPDATE customer_tabs SET status = 'closed', closed_at = COALESCE(closed_at, ?), closed_by_id = ?, closed_by_name = ? WHERE id = ? AND status IN ('open', 'paid')",
        args: [now, session?.id || '', session?.name || 'Sistema', tab.id],
      }));
      await db.batch([
        ...closeCommands,
        {
          sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name, timestamp) VALUES (?, 'table_status_closed_empty_customer_tabs', ?, ?, 'pdv', ?, ?, ?)",
          args: [
            createId(),
            JSON.stringify({
              tableId,
              status,
              closedCustomerTabs: activeTabs.rows.length,
              customers: activeTabs.rows.map((tab) => ({
                id: tab.id,
                name: tab.customer_name,
                cpfLast4: tab.cpf ? normalizeCpf(tab.cpf).slice(-4) : '',
              })),
            }),
            String(activeTabs.rows[0]?.table_number || tableId),
            session?.id || '',
            session?.name || 'Sistema',
            now,
          ],
        },
      ], 'write');
      closedCustomerTabs = activeTabs.rows.length;
    }
  }
  const clearsOwner = status === 'available' || status === 'paid';
  await db.execute({
    sql: `UPDATE tables SET status = ?, current_seller_id = ${clearsOwner ? 'NULL' : 'current_seller_id'} WHERE id = ?`,
    args: [status, tableId],
  });
  return { status, closedCustomerTabs };
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
  const requestedOpeningCents = moneyToCents(openingBalance, 'openingBalance');
  const latestClosedCash = await getLatestClosedCashRow();
  const requiredOpeningCents = latestClosedCash
    ? moneyToCents(latestClosedCash.valor_caixa_final || 0, 'lastClosingBalance')
    : requestedOpeningCents;
  if (latestClosedCash && requestedOpeningCents !== requiredOpeningCents) {
    const error = new Error(`O caixa deve ser aberto com o valor exato do último fechamento: ${formatMoneyBRL(centsToMoney(requiredOpeningCents))}.`);
    error.statusCode = 409;
    throw error;
  }
  const normalizedOpeningBalance = centsToMoney(requiredOpeningCents);
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
  const cashActor = await resolveCashClosingActorByPin(confirmationPin);
  const effectiveSession = cashActor.seller;

  const cash = await getOpenCashRow();
  if (!cash) throw new Error('Não existe caixa aberto.');

  const closingCents = moneyToCents(closingBalance, 'closingBalance');
  const closeSummary = await getExpectedClosingCents(cash);

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
  if (!/^\d{4}$/.test(pin)) {
    const error = new Error('PIN deve ter 4 dígitos.');
    error.statusCode = 400;
    throw error;
  }
  if (isReservedSellerPin(pin)) {
    const error = new Error('Escolha um PIN diferente de 1234.');
    error.statusCode = 400;
    throw error;
  }
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
      hashPin(pin),
      employmentType,
    ],
  });
  return { saved: true };
};

const persistSellerPin = async (id, rawPin) => {
  const hashedPin = hashPin(rawPin);
  await db.execute({
    sql: "UPDATE sellers SET pin = ? WHERE id = ?",
    args: [hashedPin, id],
  });
  if (String(id).startsWith('os:')) {
    await db.execute({
      sql: "UPDATE users SET pin = ? WHERE empresa_id = ? AND id = ?",
      args: [hashedPin, OS_EMPRESA_ID, String(id).slice(3)],
    });
  }
};

const updateSellerPin = async ({ id, pin }) => {
  const safeId = requireString(id, 'id');
  const safePin = requireString(pin, 'pin').trim();
  if (!/^\d{4}$/.test(safePin) || isReservedSellerPin(safePin)) {
    const error = new Error('PIN deve ter 4 dígitos e ser diferente de 1234.');
    error.statusCode = 400;
    throw error;
  }
  await persistSellerPin(safeId, safePin);
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
    if (!/^\d{4}$/.test(pin)) {
      const error = new Error('PIN deve ter 4 dígitos.');
      error.statusCode = 400;
      throw error;
    }
    fields.push('pin = ?');
    args.push(hashPin(pin));
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
            WHERE id = ? AND empresa_id = ? AND ativo = 1 AND changes() > 0
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
      {
        sql: "UPDATE customer_tabs SET status = 'paid', paid_at = ? WHERE table_id = ? AND status = 'open'",
        args: [closedAt.toISOString(), tableId],
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

const closeCounterSaleWithInventorySync = async (data, session = null) => {
  const settings = await getSettings();
  requirePermission(session, 'closeBill', settings);

  const safeItems = Array.isArray(data.items) ? data.items : [];
  if (safeItems.length === 0) throw new Error('Venda balcão sem itens.');

  await validateOrderItemsAvailability({
    items: safeItems,
    session,
    settings,
    isPublicOrigin: false,
  });

  const subtotalCents = moneyToCents(data.subtotal || 0, 'subtotal');
  const totalCents = moneyToCents(data.total || 0, 'total');
  const payments = Array.isArray(data.payments) ? data.payments : [];
  const calculatedSubtotalCents = safeItems.reduce((sum, item) => (
    sum + moneyToCents(getOrderItemLineTotal(item), 'item.total')
  ), 0);

  if (subtotalCents <= 0) throw new Error('Subtotal da venda balcão inválido.');
  if (subtotalCents !== calculatedSubtotalCents) {
    throw new Error('Subtotal da venda balcão não confere com os itens.');
  }
  if (totalCents !== subtotalCents) {
    throw new Error('Venda balcão não possui taxa de serviço ou desconto. Total precisa ser igual ao subtotal.');
  }
  if (payments.length === 0) {
    throw new Error('Lance ao menos um pagamento antes de fechar a venda balcão.');
  }

  requirePermission(session, 'launchPayment', settings);
  if (payments.length > 1) requirePermission(session, 'splitPayment', settings);

  const validPaymentMethods = new Set(['credit', 'debit', 'cash', 'pix']);
  let paymentTotalCents = 0;
  let hasCashPayment = false;
  let usesNonDefaultPaymentMethod = false;
  const normalizedPayments = payments.map((payment) => {
    if (!validPaymentMethods.has(payment?.method)) throw new Error('Forma de pagamento inválida.');
    if (payment.method !== DEFAULT_PAYMENT_METHOD) usesNonDefaultPaymentMethod = true;
    if (payment.method === 'cash') hasCashPayment = true;
    const amountCents = moneyToCents(payment.amount || 0, 'payment.amount');
    if (amountCents <= 0) throw new Error('Pagamento precisa ter valor maior que zero.');
    paymentTotalCents += amountCents;
    return {
      id: payment.id ? String(payment.id) : undefined,
      method: payment.method,
      amount: centsToMoney(amountCents),
    };
  });

  if (usesNonDefaultPaymentMethod) requirePermission(session, 'changePaymentMethod', settings);
  if (paymentTotalCents < totalCents) throw new Error('Pagamentos lançados não cobrem o total da venda balcão.');
  if (paymentTotalCents > totalCents && !hasCashPayment) {
    throw new Error('Troco só pode existir quando houver pagamento em dinheiro.');
  }

  const orderId = String(data.orderId || `counter_${createId()}`);
  const tableId = `counter:${orderId}`;
  const tableNumber = 0;
  const integrationId = `pdv_counter_${orderId}`;
  const sellerId = session?.id || 'counter-sale';
  const sellerName = session?.name || 'Venda Balcão';
  const persistedItems = safeItems.map((item) => ({
    ...item,
    id: item.id || createId(),
    orderId,
  }));

  const duplicateProbe = {
    tableId,
    tableNumber,
    sellerId,
    sellerName,
    subtotal: centsToMoney(subtotalCents),
    serviceFee: 0,
    discount: 0,
    couponAmount: 0,
    total: centsToMoney(totalCents),
    payments: normalizedPayments,
  };
  const recentDuplicate = await findRecentDuplicateClosedBill(duplicateProbe, 30);
  if (recentDuplicate) {
    return {
      skipped: true,
      integrationId: String(recentDuplicate.id),
      closedBill: null,
      inventorySync: null,
    };
  }

  const claimed = await claimIntegrationEvent(integrationId, 'pdv_counter_sale', tableId, {
    itemCount: persistedItems.length,
    total: centsToMoney(totalCents),
    sellerId,
    sellerName,
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
      id: integrationId,
      tableId,
      tableNumber,
      sellerId,
      sellerName,
      subtotal: centsToMoney(subtotalCents),
      serviceFee: 0,
      discount: 0,
      discountReason: null,
      couponCode: null,
      couponAmount: 0,
      couponBenefit: null,
      total: centsToMoney(totalCents),
      payments: normalizedPayments,
      closedAt: closedAt.toISOString(),
    };

    await db.batch([
      {
        sql: "INSERT INTO orders (id, table_id, total, status, origin, created_by_id) VALUES (?, ?, ?, ?, ?, ?)",
        args: [orderId, tableId, centsToMoney(totalCents), 'closed', 'counter', sellerId],
      },
      ...persistedItems.map((item) => ({
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
    ], 'write');

    let inventorySync = { movementCount: 0, unmatched: [], insufficient: [], critical: [], catalogVersion: null };
    try {
      inventorySync = await syncPdvOrderItemsToInventory({
        items: persistedItems,
        integrationId,
        tableNumber,
        reason: `Venda Balcão | Fechamento ${integrationId}`,
        closedBillId: integrationId,
      });
    } catch (error) {
      inventorySync.unmatched.push(`Sincronização OS indisponível: ${error instanceof Error ? error.message : String(error)}`);
      void safeCreateOSNotification({
        title: 'Baixa de estoque na venda balcão falhou',
        message: `Venda ${integrationId}: ${error instanceof Error ? error.message : String(error)}`,
        type: 'error',
        link: `/${OS_TENANT_SLUG}/estoque`,
      });
    }

    const batch = [
      {
        sql: "INSERT OR REPLACE INTO closed_bills (id, table_id, table_number, seller_id, seller_name, subtotal, service_fee, discount, discount_reason, coupon_code, coupon_amount, coupon_benefit, total, payments, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          closedBill.id,
          closedBill.tableId,
          closedBill.tableNumber,
          closedBill.sellerId,
          closedBill.sellerName,
          closedBill.subtotal,
          closedBill.serviceFee,
          closedBill.discount,
          null,
          null,
          0,
          null,
          closedBill.total,
          JSON.stringify(closedBill.payments),
          closedBill.closedAt,
        ],
      },
      {
        sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name, timestamp) VALUES (?, 'counter_sale_closed', ?, 'BALCAO', 'pdv', ?, ?, ?)",
        args: [
          createId(),
          JSON.stringify({
            subtotal: closedBill.subtotal,
            serviceFee: 0,
            total: closedBill.total,
            paid: centsToMoney(paymentTotalCents),
            change: centsToMoney(Math.max(0, paymentTotalCents - totalCents)),
            payments: closedBill.payments,
            itemCount: persistedItems.length,
            inventoryMovements: inventorySync.movementCount,
            eventId: integrationId,
          }),
          sellerId,
          sellerName,
          closedBill.closedAt,
        ],
      },
      {
        sql: "UPDATE integration_events SET status = 'completed', payload = ?, error = NULL, updated_at = ? WHERE id = ?",
        args: [
          JSON.stringify({
            tableNumber: 'BALCAO',
            orderId,
            inventorySync,
          }),
          Date.now(),
          integrationId,
        ],
      },
    ];

    await db.batch(batch, 'write');

    return {
      skipped: false,
      integrationId,
      closedBill,
      inventorySync,
    };
  } catch (error) {
    await failIntegrationEvent(integrationId, error);
    throw error;
  }
};

const findCustomerTabByCpf = async (cpf, statuses = ['open', 'paid']) => {
  const normalizedCpf = normalizeCpf(cpf);
  const placeholders = statuses.map(() => '?').join(',');
  const res = await db.execute({
    sql: `
      SELECT *
      FROM customer_tabs
      WHERE cpf = ? AND status IN (${placeholders})
      ORDER BY opened_at DESC
      LIMIT 1
    `,
    args: [normalizedCpf, ...statuses],
  });
  const row = res.rows[0] || null;
  if (!row) return null;
  const totals = await getCustomerTabTotalsByTable([row.table_id]);
  return sanitizeCustomerTab(row, totals[row.table_id]);
};

const findAvailableCustomerTabTable = async () => {
  await ensureTablesUpTo(200);
  const res = await db.execute(`
    SELECT t.id, t.number
    FROM tables t
    LEFT JOIN customer_tabs ct
      ON ct.table_id = t.id
      AND ct.status IN ('open', 'paid')
    WHERE CAST(t.number AS INTEGER) BETWEEN 1 AND 200
      AND ct.id IS NULL
    ORDER BY CAST(t.number AS INTEGER) ASC
    LIMIT 1
  `);
  const table = res.rows[0];
  if (!table) throw new Error('Todas as comandas técnicas estão ocupadas.');
  return { id: String(table.id), number: Number(table.number) };
};

const openCustomerTab = async ({ customerName, phone, cpf }) => {
  const normalizedCpf = normalizeCpf(cpf);
  if (!isValidCpf(normalizedCpf)) throw new Error('CPF inválido. Confira os números e tente novamente.');
  const safeName = requireString(customerName, 'customerName').trim().slice(0, 120);
  const safePhone = requireString(phone, 'phone').trim().slice(0, 40);

  const existing = await findCustomerTabByCpf(normalizedCpf, ['open', 'paid']);
  if (existing) return { tab: existing, recovered: true };

  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const table = await findAvailableCustomerTabTable();
    const id = createId();
    const openedAt = new Date().toISOString();
    try {
      await db.batch([
        {
          sql: `
            INSERT INTO customer_tabs (
              id, cpf, cpf_hash, cpf_last4, customer_name, phone, table_id, table_number, status, opened_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
          `,
          args: [id, normalizedCpf, getCpfHash(normalizedCpf), normalizedCpf.slice(-4), safeName, safePhone, table.id, table.number, openedAt],
        },
        {
          sql: "UPDATE tables SET status = 'ordering', last_activity = ?, current_seller_id = NULL WHERE id = ?",
          args: [openedAt, table.id],
        },
        {
          sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, 'customer_tab_opened', ?, ?, 'qr', 'Cliente QR', ?)",
          args: [
            createId(),
            JSON.stringify({ customerName: safeName, phone: safePhone, cpfLast4: normalizedCpf.slice(-4), tableId: table.id }),
            String(table.number),
            openedAt,
          ],
        },
      ], 'write');

      const tab = await findCustomerTabByCpf(normalizedCpf, ['open', 'paid']);
      return { tab, recovered: false };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/constraint|unique/i.test(message)) throw error;
      const racedExisting = await findCustomerTabByCpf(normalizedCpf, ['open', 'paid']);
      if (racedExisting) return { tab: racedExisting, recovered: true };
      // Duas pessoas podem clicar no mesmo instante e disputar a mesma mesa técnica.
      // O índice único protege a base; este retry avança para a próxima comanda livre.
    }
  }

  throw lastError || new Error('Não foi possível abrir a comanda agora. Tente novamente.');
};

const recoverCustomerTab = async ({ cpf }) => {
  const normalizedCpf = normalizeCpf(cpf);
  if (!isValidCpf(normalizedCpf)) throw new Error('CPF inválido. Confira os números e tente novamente.');
  const tab = await findCustomerTabByCpf(normalizedCpf, ['open', 'paid']);
  if (!tab) throw new Error('Nenhuma comanda aberta para este CPF.');
  return { tab };
};

const getCustomerTabOrderItems = async (tableId) => {
  const res = await db.execute({
    sql: `
      SELECT
        oi.id,
        oi.order_id,
        oi.product_id,
        oi.quantity,
        oi.price_at_time,
        oi.selected_modifiers,
        oi.notes,
        m.name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN menu m ON oi.product_id = m.id
      WHERE o.table_id = ? AND o.status != 'closed'
      ORDER BY o.created_at ASC, oi.rowid ASC
    `,
    args: [tableId],
  });
  return res.rows.map((row) => {
    const modifiers = parseJsonArray(row.selected_modifiers);
    const modifiersTotal = modifiers.reduce((sum, modifier) => sum + Number(modifier?.price || 0), 0);
    return {
      id: String(row.id || ''),
      orderId: String(row.order_id || ''),
      productId: String(row.product_id || ''),
      name: String(row.name || 'Item Becoartes'),
      quantity: Number(row.quantity || 1),
      price: Number(row.price_at_time || 0) + modifiersTotal,
      selectedModifiers: modifiers,
      notes: row.notes || '',
    };
  });
};

const getCustomerTabPayableBalance = async (tableId, items = null) => {
  const orderItems = Array.isArray(items) ? items : await getCustomerTabOrderItems(tableId);
  const subtotal = orderItems.reduce((sum, item) => {
    return sum + Number(item.price || 0) * Number(item.quantity || 1);
  }, 0);
  const settings = await getSettings();
  const serviceFeePercent = clampServiceFeePercent(Number(settings?.serviceTax ?? MAX_SERVICE_FEE_PERCENT));
  const serviceFee = subtotal * (serviceFeePercent / 100);
  const paymentsRes = await db.execute({
    sql: `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM table_payments
      WHERE table_id = ? AND status = 'active'
    `,
    args: [tableId],
  });
  const paid = Number(paymentsRes.rows[0]?.total || 0);
  return Number(Math.max(0, subtotal + serviceFee - paid).toFixed(2));
};

const createCustomerTabPaymentLink = async ({ tabId, method = 'pix', returnUrl = '' }) => {
  await ensureDatabaseReady();
  const safeTabId = requireString(tabId, 'tabId');
  const safeMethod = String(method || 'pix');
  if (!['pix', 'credit', 'debit'].includes(safeMethod)) throw new Error('Forma de pagamento inválida.');

  const tabRes = await db.execute({ sql: "SELECT * FROM customer_tabs WHERE id = ? LIMIT 1", args: [safeTabId] });
  const row = tabRes.rows[0];
  if (!row) throw new Error('Comanda não encontrada.');
  if (!['open', 'paid'].includes(String(row.status))) throw new Error('Esta comanda não está aberta para pagamento.');

  const items = await getCustomerTabOrderItems(row.table_id);
  const balance = await getCustomerTabPayableBalance(row.table_id, items);
  if (balance <= 0.009) throw new Error('Esta comanda não tem saldo em aberto.');
  if (!PAGBANK_TOKEN) {
    const error = new Error('PagBank não está configurado neste ambiente.');
    error.statusCode = 503;
    throw error;
  }

  const referenceId = `customer_tab_${safeTabId}_${Date.now()}`;
  const payload = createPagBankCustomerTabPayload({
    referenceId,
    customer: {
      name: row.customer_name,
      phone: row.phone,
    },
    items,
    amount: balance,
    paymentMethod: safeMethod,
    returnUrl,
  });

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
    const pagBankError = result?.error_messages?.[0];
    const code = pagBankError?.error || '';
    const description = pagBankError?.description || result?.message || '';
    const allowlistMessage = code === 'allowlist_access_required'
      ? 'PagBank ainda não liberou esta conta para criar checkouts por API. Peça a homologação/liberação da API Checkout em produção.'
      : '';
    const error = new Error(allowlistMessage || description || `PagBank recusou checkout (${response.status}).`);
    error.statusCode = 502;
    throw error;
  }

  const checkoutUrl = Array.isArray(result.links)
    ? result.links.find((link) => link?.rel === 'PAY' || link?.media === 'text/html')?.href || null
    : null;
  if (!checkoutUrl) throw new Error('PagBank não retornou link de pagamento.');

  await db.execute({
    sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, 'customer_tab_payment_link_created', ?, ?, 'qr', 'Cliente QR', ?)",
    args: [
      createId(),
      JSON.stringify({
        tabId: safeTabId,
        referenceId,
        paymentExternalId: result.id || null,
        method: safeMethod,
        amount: balance,
      }),
      String(row.table_number),
      new Date().toISOString(),
    ],
  });

  return {
    checkoutUrl,
    externalId: result.id || null,
    status: 'payment_pending',
    amount: balance,
    provider: 'pagbank',
  };
};

const lookupCustomerTabs = async ({ query = '' }) => {
  const rawQuery = String(query || '').trim();
  const normalizedCpf = normalizeCpf(rawQuery);
  const digitsQuery = rawQuery.replace(/\D/g, '');
  const like = `%${rawQuery.toLowerCase()}%`;
  const args = [];
  const where = ["status IN ('open', 'paid')"];
  if (rawQuery) {
    where.push(`(
      cpf = ?
      OR phone LIKE ?
      OR replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
      OR lower(customer_name) LIKE ?
      OR cpf_last4 = ?
    )`);
    args.push(normalizedCpf, `%${rawQuery}%`, `%${digitsQuery}%`, like, normalizedCpf.slice(-4));
  }
  const res = await db.execute({
    sql: `
      SELECT *
      FROM customer_tabs
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE status WHEN 'open' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END,
        opened_at DESC
      LIMIT 40
    `,
    args,
  });
  const totals = await getCustomerTabTotalsByTable(res.rows.map((row) => row.table_id));
  return { tabs: res.rows.map((row) => sanitizeCustomerTab(row, totals[row.table_id])) };
};

const finalizeCustomerTab = async ({ tabId }, session) => {
  requireString(tabId, 'tabId');
  const res = await db.execute({ sql: "SELECT * FROM customer_tabs WHERE id = ? LIMIT 1", args: [tabId] });
  const row = res.rows[0];
  if (!row) throw new Error('Comanda não encontrada.');
  const totals = await getCustomerTabTotalsByTable([row.table_id]);
  const balance = totals[row.table_id]?.balance || 0;
  if (balance > 0.009 && row.status !== 'paid') {
    throw new Error(`Comanda ainda tem saldo em aberto: ${formatMoneyBRL(balance)}.`);
  }
  const now = new Date().toISOString();
  await db.batch([
    {
      sql: "UPDATE customer_tabs SET status = 'closed', closed_at = ?, closed_by_id = ?, closed_by_name = ? WHERE id = ?",
      args: [now, session?.id || '', session?.name || 'Sistema', tabId],
    },
    {
      sql: "UPDATE tables SET status = 'available', current_seller_id = NULL, last_activity = ? WHERE id = ?",
      args: [now, row.table_id],
    },
    {
      sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name, timestamp) VALUES (?, 'customer_tab_finalized', ?, ?, 'pdv', ?, ?, ?)",
      args: [
        createId(),
        JSON.stringify({ tabId, customerName: row.customer_name, cpfLast4: row.cpf_last4 || normalizeCpf(row.cpf).slice(-4) }),
        String(row.table_number),
        session?.id || '',
        session?.name || 'Sistema',
        now,
      ],
    },
  ], 'write');
  const updated = await db.execute({ sql: "SELECT * FROM customer_tabs WHERE id = ? LIMIT 1", args: [tabId] });
  return { tab: sanitizeCustomerTab(updated.rows[0], totals[row.table_id]) };
};

const { requireSession, requirePermission } = createAccessGuards({ canSessionWithSettings });

const enforceRouteAccess = createRouteAccessEnforcer({
  verifyPublicTableToken,
  canAccessOutsideOperationIp,
  throwIpRestricted,
  getSettings,
  requireSession,
  requirePermission,
});

const handlers = createRouteHandlers({
  activateOsUserAsSeller,
  addAuditLog,
  addSeller,
  cancelTablePayment,
  clearServiceRequest,
  closeBillWithInventorySync,
  closeCash,
  closeCounterSaleWithInventorySync,
  closeShift,
  createCoupon,
  createCustomerTabPaymentLink,
  createDeliveryCheckout,
  createDeliveryCustomerAccount,
  createOsUserAsSeller,
  createServiceRequest,
  createTableAccessToken,
  createTablePayment,
  deleteCategory,
  deleteModifierGroup,
  deleteOrderItem,
  deleteProduct,
  deleteSeller,
  ensureCmvForMenuProduct,
  finalizeCustomerTab,
  geocodeDeliveryAddress,
  getAppSnapshotWithRetry,
  getAuditLogs,
  getCashState,
  getChecklistAlertsFromOs,
  getClosedBills,
  getDeliveryCustomerSession,
  getDeliveryOrder,
  getDeliveryPublicConfig,
  getDeliveryQuote,
  getPagBankPublicKey,
  getPdvLockState,
  handlePagBankDeliveryWebhook,
  joinTables,
  linkModifierGroup,
  listCoupons,
  listDeliveryCustomerOrders,
  listDeliveryOrders,
  listSellerCandidates,
  login,
  loginDeliveryCustomer,
  lookupCustomerTabs,
  lookupDeliveryPostalCode,
  openCash,
  openCustomerTab,
  openShift,
  openTable,
  recoverCustomerTab,
  regenerateTableQr,
  reorderCatalogProducts,
  requestBill,
  requestDeliveryPasswordReset,
  resetDeliveryCustomerPassword,
  resolveServiceRequest,
  saveModifierGroup,
  saveQrMode,
  saveSettings,
  sendToKitchen,
  setPdvLockState,
  syncBeveragesFromInventory,
  syncOpenOrdersInventory,
  toggleCategoryVisibility,
  toggleProductDeliveryVisibility,
  toggleProductVisibility,
  transferTable,
  updateOrderStatus,
  updateSeller,
  updateSellerPin,
  updateSellerStatus,
  updateTableStatus,
  upsertCategory,
  upsertProduct,
  validateCoupon,
  validateTabletSetupPin,
  verifyDeliveryCustomerCode,
});

const handleApi = createApiHandler({
  db,
  startedAt,
  appVersion: APP_VERSION,
  appCommit: APP_COMMIT,
  healthDbTimeoutMs: HEALTH_DB_TIMEOUT_MS,
  allowedWebOrigins: ALLOWED_WEB_ORIGINS,
  ensureDatabaseReady,
  handlers,
  isPinRateLimited,
  getSessionFromRequest,
  isOperationIpAllowed,
  isAdminSession,
  enforceRouteAccess,
  assertCashOperationAllowed,
  maxJsonBodyBytes: MAX_JSON_BODY_BYTES,
});

const serveStatic = createStaticHandler({
  distDir,
  securityHeaders,
  mimeTypes,
});

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
