import type { Category, ClosedBill, ModifierGroup, OrderItem, Product, ServiceRequest } from '../types';

const SESSION_TOKEN_STORAGE_KEY = 'beco_bff_session_token';

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
};

type UpdateOrderStatusResult = {
  request: (Omit<ServiceRequest, 'createdAt'> & { createdAt: string }) | null;
};

const getSessionToken = () => {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || '';
};

export const setApiSessionToken = (token: string | null) => {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
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
  if (['tablet', 'pdv', 'kitchen', 'qr'].includes(path)) return path;
  if (host.startsWith('tablet.')) return 'tablet';
  if (host.startsWith('coz.')) return 'kitchen';
  if (host.startsWith('qr.')) return 'qr';
  return 'pdv';
};

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Falha na API (${response.status})`);
  }

  return payload.data as T;
};

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(path, { method: 'GET', headers: getAuthHeaders() });
  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Falha na API (${response.status})`);
  }

  return payload.data as T;
};

const hydrateServiceRequest = (request: UpdateOrderStatusResult['request']) => {
  if (!request) return null;
  return {
    ...request,
    createdAt: new Date(request.createdAt),
  } as ServiceRequest;
};

export const OperationalApi = {
  sendToKitchen(input: {
    orderId: string;
    tableId: string;
    total: number;
    origin: 'tablet' | 'pdv' | 'qr';
    sellerId: string | null;
    items: OrderItem[];
  }) {
    return postJson<SendToKitchenResult>('/api/orders/send-to-kitchen', input);
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

  login(pin: string, sellerId?: string) {
    return postJson<{ seller: any | null; sessionToken?: string; accessRestricted?: boolean }>('/api/auth/login', { pin, sellerId });
  },

  validateTabletSetupPin(pin: string) {
    return postJson<{ valid: boolean }>('/api/tablet/setup-login', { pin });
  },

  fetchAuditLogs(limit = 100) {
    return postJson<{ auditLogs: any[] }>('/api/audit-logs/list', { limit });
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
  saveSettings(settings: unknown) {
    return postJson<{ saved: boolean }>('/api/settings', { settings });
  },

  addSeller(seller: unknown) {
    return postJson<{ saved: boolean }>('/api/sellers', { seller });
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

  syncBeveragesFromInventory() {
    return postJson<{ catalogVersion: string; count: number }>('/api/inventory/sync-beverages', {});
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
    return postJson<{ log: any }>('/api/audit-logs', log);
  },

  createServiceRequest(input: { id?: string; tableId: string; type: string; message?: string }) {
    return postJson<{ request: Omit<ServiceRequest, 'createdAt'> & { createdAt: string } }>('/api/service-requests', input)
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

  requestBill(tableId: string) {
    return postJson<{ status: 'bill_requested' }>('/api/tables/request-bill', { tableId });
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
