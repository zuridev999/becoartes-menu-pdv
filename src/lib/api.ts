import type { Category, ClosedBill, CounterSaleInput, Coupon, CustomerTab, ModifierGroup, OrderItem, Product, ServiceRequest, TablePayment } from '../types';

const SESSION_TOKEN_STORAGE_KEY = 'beco_bff_session_token';
const TABLE_ACCESS_TOKEN_STORAGE_KEY = 'beco_public_table_access';

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type CloseBillResult = {
  skipped: boolean;
  integrationId: string;
  closedBill: (ClosedBill & { closedAt: string }) | null;
  inventorySync: {
    movementCount: number;
    unmatched: string[];
    insufficient: string[];
    critical: string[];
  } | null;
};

type SendToKitchenResult = {
  request: Omit<ServiceRequest, 'createdAt' | 'tableNumber'> & {
    createdAt: string;
    tableNumber?: number;
  };
  inventorySync?: {
    movementCount: number;
    unmatched: string[];
    insufficient: string[];
    critical: string[];
    catalogVersion?: string | null;
  } | null;
  inventorySyncError?: string | null;
};

type UpdateOrderStatusResult = {
  request: (Omit<ServiceRequest, 'createdAt'> & { createdAt: string }) | null;
};

export type PdvLockState = {
  locked: boolean;
  message: string;
  lockedById?: string;
  lockedByName?: string;
  updatedAt?: string;
};

export type CashState = {
  businessDate: string;
  isOpen: boolean;
  requiresClosing?: boolean;
  openDurationHours?: number;
  sandbox?: boolean;
  lastClosingBalance: number;
  hasPreviousClosing: boolean;
  current: null | {
    id: string;
    businessDate: string;
    openingBalance: number;
    closingBalance: number;
    totalHouse: number;
    responsibleId: string;
    notes: string;
    status: 'Aberto' | 'Fechado' | string;
    createdAt: string | number | null;
    updatedAt: string | number | null;
  };
};

export type SellerCandidate = {
  id: string;
  name: string;
  email: string;
  role: string;
  funcao: string;
  employmentType: string;
  canSellInPdv: boolean;
  isOperador: boolean;
  hasPin: boolean;
};

type PublicTableAccess = {
  token: string;
  tableId: string;
  tableNumber: number;
  origin: 'tablet' | 'qr';
  expiresAt?: string | null;
};

const getSessionToken = () => {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || '';
};

export const hasApiSessionToken = () => Boolean(getSessionToken());

export const setApiSessionToken = (token: string | null) => {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
};

const getPublicTableAccess = (): PublicTableAccess | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(TABLE_ACCESS_TOKEN_STORAGE_KEY) || 'null') as PublicTableAccess | null;
    if (!parsed?.token || !parsed.tableId || !parsed.origin) return null;
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const setPublicTableAccess = (access: PublicTableAccess | null) => {
  if (typeof localStorage === 'undefined') return;
  if (access?.token) localStorage.setItem(TABLE_ACCESS_TOKEN_STORAGE_KEY, JSON.stringify(access));
  else localStorage.removeItem(TABLE_ACCESS_TOKEN_STORAGE_KEY);
};

export const hasPublicTableAccess = (tableId: string, origin?: 'tablet' | 'qr') => {
  const access = getPublicTableAccess();
  return Boolean(access && access.tableId === tableId && (!origin || access.origin === origin));
};

const getPublicTableAccessToken = (tableId?: string, origin?: 'tablet' | 'qr') => {
  const access = getPublicTableAccess();
  if (!access) return '';
  if (tableId && access.tableId !== tableId) return '';
  if (origin && access.origin !== origin) return '';
  return access.token;
};

const getPublicTableAccessPayload = (tableId?: string) => {
  const access = getPublicTableAccess();
  if (!access) return {};
  if (tableId && access.tableId !== tableId) return {};
  return {
    origin: access.origin,
    publicAccessToken: access.token,
  };
};

const getAuthHeaders = () => {
  const token = getSessionToken();
  return token ? { 'X-Beco-Session': token } : {};
};

const getCurrentView = () => {
  if (typeof window === 'undefined') return 'pdv';
  const path = window.location.pathname.replace(/^\/+/, '');
  const host = window.location.hostname;
  if (path.startsWith('admin')) return 'admin';
  if (path.startsWith('delivery')) return 'delivery';
  if (path.startsWith('qr/') || path.startsWith('mesa/')) return 'qr';
  if (['tablet', 'pdv', 'kitchen', 'bar', 'qr', 'delivery'].includes(path)) return path;
  if (host.startsWith('tablet.')) return 'tablet';
  if (host.startsWith('coz.')) return 'kitchen';
  if (host.startsWith('bar.')) return 'bar';
  if (host.startsWith('qr.')) return 'qr';
  if (host.startsWith('delivery.')) return 'delivery';
  return 'pdv';
};

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  });

  const payload = await readApiEnvelope<T>(response);

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Falha na API (${response.status})`);
  }

  return payload.data as T;
};

const getJson = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, { ...options, method: 'GET', headers: { ...getAuthHeaders(), ...(options.headers || {}) } });
  const payload = await readApiEnvelope<T>(response);

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Falha na API (${response.status})`);
  }

  return payload.data as T;
};

const readApiEnvelope = async <T>(response: Response): Promise<ApiEnvelope<T>> => {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (contentType.includes('application/json')) {
    return JSON.parse(text) as ApiEnvelope<T>;
  }

  const lowerText = text.toLowerCase();
  if (response.status === 413 || lowerText.includes('request entity too large')) {
    return { ok: false, error: 'Arquivo ou imagem grande demais para salvar. Reduza a imagem e tente novamente.' };
  }

  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return { ok: false, error: 'Servidor do PDV indisponível no momento. Aguarde alguns segundos e tente novamente.' };
  }

  return { ok: false, error: `Resposta inesperada do servidor (${response.status}). Tente novamente.` };
};

const hydrateServiceRequest = (request: UpdateOrderStatusResult['request']) => {
  if (!request) return null;
  return {
    ...request,
    createdAt: new Date(request.createdAt),
  } as ServiceRequest;
};

const hydrateCustomerTab = (tab: CustomerTab) => ({
  ...tab,
  openedAt: tab.openedAt ? new Date(tab.openedAt) : tab.openedAt,
  paidAt: tab.paidAt ? new Date(tab.paidAt) : tab.paidAt,
  closedAt: tab.closedAt ? new Date(tab.closedAt) : tab.closedAt,
});

export const CustomerTabApi = {
  open(input: { customerName: string; phone: string; cpf: string }) {
    return postJson<{ tab: CustomerTab }>('/api/customer-tabs/open', { ...input, origin: 'qr' })
      .then(result => ({ tab: hydrateCustomerTab(result.tab) }));
  },

  recover(cpf: string) {
    return postJson<{ tab: CustomerTab }>('/api/customer-tabs/recover', { cpf, origin: 'qr' })
      .then(result => ({ tab: hydrateCustomerTab(result.tab) }));
  },

  lookup(query: string) {
    const q = encodeURIComponent(query);
    return getJson<{ tabs: CustomerTab[] }>(`/api/customer-tabs/lookup?q=${q}`)
      .then(result => ({ tabs: result.tabs.map(hydrateCustomerTab) }));
  },

  finalize(tabId: string) {
    return postJson<{ tab: CustomerTab }>('/api/customer-tabs/finalize', { tabId })
      .then(result => ({ tab: hydrateCustomerTab(result.tab) }));
  },

  createPaymentLink(input: {
    tabId: string;
    method: 'pix' | 'credit' | 'debit';
    returnUrl?: string;
  }) {
    return postJson<{
      checkoutUrl: string | null;
      externalId: string | null;
      status: string;
      amount: number;
      provider: string;
    }>('/api/customer-tabs/payment-link', input);
  },
};

export const OperationalApi = {
  sendToKitchen(input: {
    orderId: string;
    tableId: string;
    total: number;
    origin: 'tablet' | 'pdv' | 'qr';
    sellerId: string | null;
    clientRequestId?: string;
    items: OrderItem[];
  }) {
    return postJson<SendToKitchenResult>('/api/orders/send-to-kitchen', {
      ...input,
      publicAccessToken: input.origin === 'pdv' ? undefined : getPublicTableAccessToken(input.tableId, input.origin),
    });
  },

  updateOrderStatus(orderId: string, status: 'pending' | 'preparing' | 'ready' | 'closed') {
    return postJson<UpdateOrderStatusResult>('/api/orders/status', { orderId, status })
      .then(result => ({
        ...result,
        request: hydrateServiceRequest(result.request),
      }));
  },

  deleteOrderItem(input: {
    itemId: string;
    cancelContext?: {
      tableNumber: number;
      itemName: string;
      quantity: number;
      sellerName?: string;
      sellerPermission?: string;
      reasonCode?: string;
      reasonLabel?: string;
      reasonNotes?: string;
    };
  }) {
    return postJson<{ orderId: string | null }>('/api/order-items/delete', input);
  },

  closeBill(data: Omit<ClosedBill, 'id' | 'closedAt'>) {
    return postJson<CloseBillResult>('/api/bills/close', data)
      .then(result => ({
        ...result,
        closedBill: result.closedBill
          ? { ...result.closedBill, closedAt: new Date(result.closedBill.closedAt) }
          : null,
      }));
  },

  closeCounterSale(data: CounterSaleInput) {
    return postJson<CloseBillResult>('/api/counter-sales/close', data)
      .then(result => ({
        ...result,
        closedBill: result.closedBill
          ? { ...result.closedBill, closedAt: new Date(result.closedBill.closedAt) }
          : null,
      }));
  },

  createTablePayment(input: {
    id?: string;
    tableId: string;
    tableNumber: number;
    method: TablePayment['method'];
    amount: number;
    sellerId?: string;
    sellerName?: string;
  }) {
    return postJson<{ payment: Omit<TablePayment, 'createdAt'> & { createdAt: string } }>('/api/table-payments', input)
      .then(result => ({
        payment: { ...result.payment, createdAt: new Date(result.payment.createdAt) } as TablePayment,
      }));
  },

  cancelTablePayment(id: string, cancelContext?: { reasonCode?: string; reasonLabel?: string; reasonNotes?: string }) {
    return postJson<{ cancelled: boolean }>('/api/table-payments/cancel', { id, cancelContext });
  },

  validateCoupon(input: {
    code: string;
    tableId: string;
    subtotal: number;
    serviceFee: number;
    discount: number;
    selectedBenefit?: string;
  }) {
    return postJson<{
      coupon: {
        id: string;
        code: string;
        amount: number;
        appliedAmount: number;
        customerName?: string;
        campaignName?: string;
        validUntil?: string;
        minOrderValue?: number;
        selectedBenefit?: string;
        benefitLabel?: string;
        requiresBenefitChoice?: boolean;
        benefitOptions?: Array<{ id: string; label: string }>;
      }
    }>('/api/coupons/validate', input);
  },

  getCashStatus() {
    return getJson<{ cashState: CashState }>('/api/cash/status');
  },

  openCash(openingBalance: number, notes = '', confirmationPin = '') {
    return postJson<{ cashState: CashState }>('/api/cash/open', { openingBalance, notes, confirmationPin });
  },

  closeCash(closingBalance: number, notes = '', confirmationPin = '') {
    return postJson<{ cashState: CashState }>('/api/cash/close', { closingBalance, notes, confirmationPin });
  },
};

export type DeliveryCheckoutInput = {
  orderId: string;
  customer: {
    name: string;
    phone: string;
    email: string;
    taxId?: string;
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    postalCode: string;
    complement: string;
    reference: string;
    latitude?: number | null;
    longitude?: number | null;
    quoteId?: string;
    quoteExpiresAt?: string;
    notes: string;
    fulfillment: 'delivery' | 'pickup';
    paymentMethod: 'pagbank' | 'pix' | 'credit' | 'debit';
    coupon: string;
    joinClub: boolean;
  };
  items: OrderItem[];
  payment?: {
    card?: {
      encrypted: string;
      holderName: string;
      holderTaxId: string;
      installments?: number;
      authenticationMethod?: unknown;
    };
  };
};

export type DeliveryQuoteResult = {
  quote: {
    status: string;
    provider: string;
    deliveryFee: number;
    quoteId: string | null;
    expiresAt: string | null;
    preparationTimeSeconds: number;
    payload?: unknown;
  };
};

export type DeliveryPostalCodeResult = {
  postalCode: {
    status: string;
    provider: string;
    postalCode: string;
    address: null | {
      street: string;
      neighborhood: string;
      city: string;
      state: string;
    };
  };
};

export type DeliveryCouponConfig = {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  maxDiscount: number | null;
  minSubtotal: number;
  label: string;
};

type DeliveryClubSummary = {
  enrolled: boolean;
  paidOrders: number;
  cycleSize: number;
  remainingToReward: number;
  rewardsEarned: number;
  rewardLabel?: string;
} | null;

export type DeliveryOrderEvent = {
  id: string;
  orderId: string;
  type: string;
  status: string;
  provider: string | null;
  externalId: string | null;
  payload: unknown;
  error: string | null;
  createdAt: string;
};

export type DeliveryOrderSummary = {
  id: string;
  orderId: string;
  createdAt: string;
  total: number;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  couponCode?: string;
  customer: DeliveryCheckoutInput['customer'];
  items: OrderItem[];
  paymentStatus: string;
  paymentProvider?: string | null;
  paymentExternalId?: string | null;
  checkoutUrl?: string | null;
  paymentInstructions?: {
    type: string;
    status: string;
    qrCodeText?: string;
    qrCodeImage?: string | null;
    expiresAt?: string | null;
    chargeStatus?: string | null;
    message?: string;
  } | null;
  kitchenStatus: string;
  deliveryStatus: string;
  kitchenSentAt: string | null;
  deliveryRequestedAt: string | null;
  deliveryProvider: string | null;
  deliveryExternalId: string | null;
  club?: DeliveryClubSummary;
  events?: DeliveryOrderEvent[];
};

export type DeliveryCustomerAccount = {
  id: string;
  name: string;
  phone: string;
  email: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  complement: string;
  reference: string;
  joinClub: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
};

export type DeliveryCustomerSession = {
  token: string;
  expiresAt: string;
};

export const DeliveryApi = {
  config() {
    return getJson<{
      mode: Record<string, unknown>;
      club: {
        enabled: boolean;
        cycleSize: number;
        rewardLabel: string;
      };
      coupons: DeliveryCouponConfig[];
      routes: Record<string, string>;
      webhookSecretEnabled: boolean;
      notifications?: Record<string, string>;
    }>('/api/delivery/config');
  },

  pagbankPublicKey() {
    return getJson<{ status: string; provider: string; publicKey: string | null; createdAt?: string | null }>('/api/delivery/pagbank/public-key');
  },

  quote(input: Pick<DeliveryCheckoutInput, 'customer' | 'items'>) {
    return postJson<DeliveryQuoteResult>('/api/delivery/quote', input);
  },

  lookupPostalCode(postalCode: string) {
    return postJson<DeliveryPostalCodeResult>('/api/delivery/postal-code', { postalCode });
  },

  checkout(input: DeliveryCheckoutInput) {
    return postJson<{
      order: {
        id: string;
        orderId: string;
        createdAt: string;
        total: number;
        subtotal: number;
        deliveryFee: number;
        discount: number;
        couponCode?: string;
        customer: DeliveryCheckoutInput['customer'];
        items: OrderItem[];
        paymentStatus: string;
        paymentProvider?: string;
        paymentExternalId?: string | null;
        checkoutUrl?: string | null;
        paymentInstructions?: DeliveryOrderSummary['paymentInstructions'];
        kitchenStatus: string;
        deliveryStatus: string;
        kitchenSentAt: string | null;
        deliveryRequestedAt: string | null;
        deliveryProvider: string;
        deliveryExternalId: string | null;
        club?: DeliveryClubSummary;
      };
    }>('/api/delivery/checkout', input);
  },

  checkoutMock(input: DeliveryCheckoutInput) {
    return this.checkout(input);
  },

  getOrder(orderId: string) {
    return getJson<{ order: DeliveryOrderSummary }>(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`);
  },

  getOrderDetail(orderId: string) {
    return getJson<{ order: DeliveryOrderSummary }>(`/api/delivery/order-detail?orderId=${encodeURIComponent(orderId)}`);
  },

  listOrders(limit = 50) {
    return getJson<{ orders: DeliveryOrderSummary[] }>(`/api/delivery/orders?limit=${encodeURIComponent(String(limit))}`);
  },

  registerCustomer(input: { customer: DeliveryCheckoutInput['customer']; password: string }) {
    return postJson<{ customer: DeliveryCustomerAccount; session: DeliveryCustomerSession; verification?: { expiresAt: string; code?: string } }>('/api/delivery/customer/register', input);
  },

  loginCustomer(input: { identity: string; password: string }) {
    return postJson<{ customer: DeliveryCustomerAccount; session: DeliveryCustomerSession }>('/api/delivery/customer/login', input);
  },

  forgotPassword(identity: string) {
    return postJson<{ sent: boolean; expiresAt?: string; code?: string }>('/api/delivery/customer/forgot-password', { identity });
  },

  resetPassword(input: { identity: string; code: string; password: string }) {
    return postJson<{ customer: DeliveryCustomerAccount; session: DeliveryCustomerSession }>('/api/delivery/customer/reset-password', input);
  },

  verifyCustomerCode(input: { token: string; code: string }) {
    return postJson<{ customer: DeliveryCustomerAccount }>('/api/delivery/customer/verify-code', input);
  },

  getCustomerSession(token: string) {
    return getJson<{ customer: DeliveryCustomerAccount | null }>('/api/delivery/customer/session', {
      headers: { 'X-Beco-Delivery-Session': token },
    });
  },

  listCustomerOrders(token: string) {
    return getJson<{ orders: DeliveryOrderSummary[] }>('/api/delivery/customer/orders', {
      headers: { 'X-Beco-Delivery-Session': token },
    });
  },

};

const hydrateSnapshot = (snapshot: any) => ({
  ...snapshot,
  kitchenData: snapshot.kitchenData
    ? {
        ...snapshot.kitchenData,
        serverNow: new Date(snapshot.kitchenData.serverNow),
        orders: (snapshot.kitchenData.orders || []).map((order: any) => ({
          ...order,
          createdAt: new Date(order.createdAt),
        })),
      }
    : snapshot.kitchenData,
  serviceRequests: (snapshot.serviceRequests || []).map((request: any) => ({
    ...request,
    createdAt: new Date(request.createdAt),
  })),
  closedBills: (snapshot.closedBills || []).map((bill: any) => ({
    ...bill,
    closedAt: new Date(bill.closedAt),
  })),
  tables: (snapshot.tables || []).map((table: any) => ({
    ...table,
    customerTab: table.customerTab ? hydrateCustomerTab(table.customerTab) : null,
    payments: (table.payments || []).map((payment: any) => ({
      ...payment,
      createdAt: payment.createdAt ? new Date(payment.createdAt) : new Date(),
    })),
    lastActivity: table.lastActivity ? new Date(table.lastActivity) : new Date(),
  })),
});

export const AppApi = {
  init() {
    return getJson<any>(`/api/app/init?view=${encodeURIComponent(getCurrentView())}`).then(hydrateSnapshot);
  },

  sync(includeCatalog: boolean) {
    return postJson<any>('/api/app/sync', { includeCatalog, view: getCurrentView() }).then(hydrateSnapshot);
  },

  getChecklistAlerts<T>() {
    return getJson<T>('/api/checklist-alerts');
  },

  login(pin: string, sellerId?: string) {
    return postJson<{ seller: any | null; sessionToken?: string; accessRestricted?: boolean }>('/api/auth/login', { pin, sellerId, view: getCurrentView() });
  },

  validateTabletSetupPin(pin: string) {
    return postJson<{ valid: boolean; sessionToken?: string | null; seller?: any | null }>('/api/tablet/setup-login', { pin });
  },

  createTableAccessToken(input: { origin: 'tablet' | 'qr'; tableId?: string; tableNumber?: number }) {
    return postJson<PublicTableAccess>('/api/table-access-token', input);
  },

  fetchAuditLogs(limit = 100, filters: { startDate?: string; endDate?: string; author?: string; action?: string } = {}) {
    return postJson<{ auditLogs: any[] }>('/api/audit-logs/list', { limit, ...filters });
  },

  fetchClosedBills(filters: { from?: string; to?: string; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.limit) params.set('limit', String(filters.limit));
    const query = params.toString();
    return getJson<{ closedBills: any[] }>(`/api/closed-bills${query ? `?${query}` : ''}`)
      .then(result => ({
        closedBills: (result.closedBills || []).map((bill: any) => ({
          ...bill,
          closedAt: new Date(bill.closedAt),
        })),
      }));
  },

  getPdvLockState() {
    return getJson<PdvLockState>('/api/pdv-lock/status');
  },

  setPdvLockState(locked: boolean, message = 'PDV bloqueado. Consultar mensagens no celular.') {
    return postJson<PdvLockState>('/api/pdv-lock', { locked, message });
  },
};

export const CatalogApi = {
  upsertCategory(category: Category) {
    return postJson<{ catalogVersion: string }>('/api/catalog/category', { category });
  },

  deleteCategory(id: string) {
    return postJson<{ catalogVersion: string }>('/api/catalog/category/delete', { id });
  },

  toggleCategoryVisibility(id: string, visible: boolean) {
    return postJson<{ catalogVersion: string }>('/api/catalog/category/visibility', { id, visible });
  },

  upsertProduct(product: Product) {
    return postJson<{ catalogVersion: string }>('/api/catalog/product', { product });
  },

  deleteProduct(id: string) {
    return postJson<{ catalogVersion: string }>('/api/catalog/product/delete', { id });
  },

  toggleProductVisibility(id: string, visible: boolean) {
    return postJson<{ catalogVersion: string }>('/api/catalog/product/visibility', { id, visible });
  },

  reorderProducts(items: Array<{ id: string; sortOrder: number }>) {
    return postJson<{ catalogVersion: string }>('/api/catalog/products/reorder', { items });
  },

  toggleProductDeliveryVisibility(id: string, deliveryVisible: boolean) {
    return postJson<{ catalogVersion: string }>('/api/catalog/product/delivery-visibility', { id, deliveryVisible });
  },

  saveModifierGroup(group: ModifierGroup) {
    return postJson<{ catalogVersion: string }>('/api/catalog/modifier-group', { group });
  },

  deleteModifierGroup(id: string) {
    return postJson<{ catalogVersion: string }>('/api/catalog/modifier-group/delete', { id });
  },

  linkModifierGroup(scope: 'product' | 'category', targetId: string, groupId: string, linked: boolean) {
    return postJson<{ catalogVersion: string }>('/api/catalog/modifier-group/link', {
      scope,
      targetId,
      groupId,
      linked,
    });
  },
};

export const AdminApi = {
  ensureProductCmv(productId: string) {
    return postJson<{ created: boolean; cmvId: string; cost: number }>('/api/catalog/product/cmv', { productId });
  },

  saveSettings(settings: unknown) {
    return postJson<{ saved: boolean }>('/api/settings', { settings });
  },

  setQrMode(qrMode: 'mesa' | 'comanda', authorizationPin?: string) {
    return postJson<{ saved: boolean; settings: unknown }>('/api/settings/qr-mode', { qrMode, authorizationPin });
  },

  addSeller(seller: unknown) {
    return postJson<{ saved: boolean }>('/api/sellers', { seller });
  },

  updateSeller(id: string, seller: unknown) {
    return postJson<{ updated: boolean }>('/api/sellers/update', { id, seller });
  },

  updateSellerPin(id: string, pin: string) {
    return postJson<{ updated: boolean }>('/api/sellers/pin', { id, pin });
  },

  deleteSeller(id: string) {
    return postJson<{ deleted: boolean; reason?: string }>('/api/sellers/delete', { id });
  },

  updateSellerStatus(id: string, status: 'active' | 'inactive') {
    return postJson<{ status: 'active' | 'inactive' }>('/api/sellers/status', { id, status });
  },

  listSellerCandidates() {
    return getJson<{ candidates: SellerCandidate[] }>('/api/sellers/candidates');
  },

  activateSellerCandidate(userId: string, pin?: string) {
    return postJson<{ activated: boolean; seller: any }>('/api/sellers/activate-os-user', { userId, pin });
  },

  createOsSeller(data: { name: string; pin: string; employmentType: 'fixo' | 'freelancer' }) {
    return postJson<{ created: boolean; seller: any }>('/api/sellers/create-os-user', data);
  },

  regenerateTableQr(tableNumber: number, adminPin: string) {
    return postJson<{
      tableNumber: number;
      revision: string;
      qrCodes: {
        tableRevisions: Record<string, string>;
        lastRotatedAt: Record<string, string>;
      };
    }>('/api/qrcodes/regenerate', { tableNumber, adminPin });
  },

  syncBeveragesFromInventory() {
    return postJson<{ catalogVersion: string; count: number }>('/api/inventory/sync-beverages', {});
  },

  listCoupons() {
    return getJson<{ coupons: (Omit<Coupon, 'createdAt' | 'redeemedAt'> & { createdAt: string; redeemedAt?: string | null })[] }>('/api/coupons/list')
      .then(result => ({
        coupons: result.coupons.map((coupon) => ({
          ...coupon,
          createdAt: new Date(coupon.createdAt),
          redeemedAt: coupon.redeemedAt ? new Date(coupon.redeemedAt) : null,
        })) as Coupon[],
      }));
  },

  createCoupon(input: {
    amount: number;
    code?: string;
    note?: string;
    customerId?: string;
    customerName?: string;
    phone?: string;
    campaignName?: string;
    validUntil?: string;
    minOrderValue?: number;
    whatsappMessage?: string;
  }) {
    return postJson<{ coupon: Omit<Coupon, 'createdAt' | 'redeemedAt'> & { createdAt: string; redeemedAt?: string | null } }>('/api/coupons/create', input)
      .then(result => ({
        coupon: {
          ...result.coupon,
          createdAt: new Date(result.coupon.createdAt),
          redeemedAt: result.coupon.redeemedAt ? new Date(result.coupon.redeemedAt) : null,
        } as Coupon,
      }));
  },
};

export const OpsApi = {
  addAuditLog(log: {
    id?: string;
    action: string;
    details?: string;
    tableNumber?: string | null;
    origin?: string;
    authorName?: string;
    timestamp?: string;
  }) {
    const origin = log.origin === 'tablet' || log.origin === 'qr' ? log.origin : undefined;
    return postJson<{ log: any }>('/api/audit-logs', {
      ...log,
      publicAccessToken: origin ? getPublicTableAccessToken(undefined, origin) : undefined,
    });
  },

  createServiceRequest(input: { id?: string; tableId: string; type: string; message?: string }) {
    return postJson<{ request: Omit<ServiceRequest, 'createdAt'> & { createdAt: string } }>('/api/service-requests', {
      ...input,
      ...getPublicTableAccessPayload(input.tableId),
    })
      .then(result => ({
        request: {
          ...result.request,
          createdAt: new Date(result.request.createdAt),
        } as ServiceRequest,
      }));
  },

  resolveServiceRequest(input: {
    requestId: string;
    tableId: string;
    type: string;
    message: string;
    currentStatus: string;
  }) {
    return postJson<{ status: 'pending' | 'resolved' }>('/api/service-requests/resolve', input);
  },

  clearServiceRequest(requestId: string) {
    return postJson<{ requestId: string; cleared: boolean }>('/api/service-requests/clear', { requestId });
  },

  requestBill(tableId: string) {
    return postJson<{ status: 'bill_requested' }>('/api/tables/request-bill', {
      tableId,
      ...getPublicTableAccessPayload(tableId),
    });
  },

  updateTableStatus(tableId: string, status: string) {
    return postJson<{ status: string }>('/api/tables/status', { tableId, status });
  },

  openTable(tableId: string, wasAvailable: boolean) {
    return postJson<{ status: 'ordering' }>('/api/tables/open', { tableId, wasAvailable });
  },

  transferTable(fromTableId: string, toTableId: string) {
    return postJson<{ moved: boolean }>('/api/tables/transfer', { fromTableId, toTableId });
  },

  joinTables(tableIds: string[], targetTableId: string) {
    return postJson<{ joined: boolean }>('/api/tables/join', { tableIds, targetTableId });
  },

  openShift(id: string, openingBalance: number) {
    return postJson<{ shift: { id: string; status: 'open'; openingBalance: number } }>('/api/shifts/open', { id, openingBalance });
  },

  closeShift(id: string, closingBalance: number) {
    return postJson<{ closed: boolean }>('/api/shifts/close', { id, closingBalance });
  },
};
