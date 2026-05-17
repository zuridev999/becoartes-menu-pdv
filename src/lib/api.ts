import type { Category, ClosedBill, ModifierGroup, OrderItem, Product, ServiceRequest } from '../types';

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

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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
