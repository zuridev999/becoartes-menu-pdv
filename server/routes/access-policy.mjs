const PUBLIC_BOOTSTRAP_ROUTES = new Set([
  'GET /api/app/init',
  'POST /api/app/sync',
  'POST /api/auth/login',
  'POST /api/tablet/setup-login',
  'POST /api/pdv-terminal/challenge',
  'POST /api/pdv-terminal/authorize',
  'POST /api/table-access-token',
  'POST /api/qr/resolve',
]);

const PUBLIC_CUSTOMER_ROUTES = new Set([
  'POST /api/delivery/checkout',
  'POST /api/delivery/checkout/mock',
  'POST /api/delivery/quote',
  'POST /api/delivery/postal-code',
  'POST /api/delivery/geocode',
  'POST /api/delivery/webhooks/pagbank',
  'POST /api/webhooks/pagbank',
  'GET /api/delivery/order',
  'GET /api/delivery/customer/session',
  'GET /api/delivery/customer/orders',
  'GET /api/delivery/config',
  'GET /api/delivery/pagbank/public-key',
  'POST /api/customer-tabs/open',
  'POST /api/customer-tabs/recover',
  'POST /api/customer-tabs/payment-link',
]);

const PUBLIC_TABLE_ROUTES = new Set([
  'POST /api/orders/send-to-kitchen',
  'POST /api/orders/status',
  'POST /api/audit-logs',
  'POST /api/service-requests',
  'POST /api/tables/request-bill',
  'POST /api/public-table/state',
]);

export const PERMISSION_BY_ROUTE = Object.freeze({
  'POST /api/order-items/delete': 'cancelTableItem',
  'POST /api/bills/close': 'closeBill',
  'POST /api/service-requests/resolve': 'resolveServiceRequest',
  'POST /api/catalog/category': 'manageCategories',
  'POST /api/catalog/category/delete': 'manageCategories',
  'POST /api/catalog/category/visibility': 'manageCategories',
  'POST /api/catalog/product/delete': 'deleteProduct',
  'POST /api/catalog/product/visibility': 'toggleProductVisibility',
  'POST /api/catalog/product/delivery-visibility': 'toggleProductVisibility',
  'POST /api/catalog/products/reorder': 'editProduct',
  'POST /api/catalog/product/cmv': 'editProduct',
  'POST /api/catalog/modifier-group': 'manageOptionals',
  'POST /api/catalog/modifier-group/delete': 'manageOptionals',
  'POST /api/catalog/modifier-group/link': 'manageOptionals',
  'POST /api/settings': 'manageSettings',
  'POST /api/pdv-lock': 'manageSettings',
  'POST /api/os-lock': 'manageSettings',
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
  'POST /api/inventory/reconcile-pending': 'manageSettings',
  'POST /api/tables/status': 'updateTableStatus',
  'POST /api/tables/open': 'openTable',
  'POST /api/tables/transfer': 'transferTable',
  'POST /api/tables/join': 'joinTables',
  'POST /api/cash/open': 'openCash',
  'POST /api/cash/close': 'closeCash',
  'POST /api/shifts/open': 'manageShifts',
  'POST /api/shifts/close': 'manageShifts',
  'POST /api/table-payments': 'launchPayment',
  'POST /api/table-payments/cancel': 'cancelPayment',
  'POST /api/coupons/create': 'manageCoupons',
  'GET /api/coupons/list': 'manageCoupons',
  'GET /api/delivery/orders': 'viewSalesTotals',
  'GET /api/delivery/order-detail': 'viewSalesTotals',
  'GET /api/closed-bills': 'viewSalesTotals',
  'GET /api/customer-tabs/lookup': 'viewSalesTotals',
  'POST /api/customer-tabs/finalize': 'closeBill',
});

const isPublicCustomerRoute = (routeKey) => (
  PUBLIC_CUSTOMER_ROUTES.has(routeKey)
  || routeKey.startsWith('POST /api/delivery/customer/')
);

const isPublicOperationalOrigin = (body) => body?.origin === 'tablet' || body?.origin === 'qr';

export const createRouteAccessEnforcer = ({
  verifyPublicTableToken,
  canAccessOutsideOperationIp,
  throwIpRestricted,
  getSettings,
  requireSession,
  requirePermission,
}) => {
  const requirePublicTableAccess = async (body) => {
    if (!isPublicOperationalOrigin(body)) return false;
    const isCustomerTabOrder = Boolean(body?.customerTabId);
    const access = await verifyPublicTableToken({
      token: body?.publicAccessToken,
      source: body.origin,
      tableId: isCustomerTabOrder ? (body?.sourceTableId || '') : (body?.tableId || ''),
      tableNumber: isCustomerTabOrder ? (body?.sourceTableNumber || '') : (body?.tableNumber || ''),
    });
    if (access) return true;
    const error = new Error('Token público da mesa inválido ou ausente.');
    error.statusCode = 401;
    throw error;
  };

  return async (routeKey, body, session, { operationAccessAllowed = true, req = null } = {}) => {
    if (PUBLIC_BOOTSTRAP_ROUTES.has(routeKey) || isPublicCustomerRoute(routeKey)) return;

    if (PUBLIC_TABLE_ROUTES.has(routeKey) && await requirePublicTableAccess(body)) return;

    if (!operationAccessAllowed && !canAccessOutsideOperationIp(session)) {
      throwIpRestricted(req);
    }

    if (routeKey === 'POST /api/orders/send-to-kitchen') {
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

    if (routeKey === 'POST /api/counter-sales/close') {
      const settings = await getSettings();
      requirePermission(session, 'addOrderItem', settings);
      requirePermission(session, 'launchPayment', settings);
      requirePermission(session, 'closeBill', settings);
      const items = Array.isArray(body?.items) ? body.items : [];
      if (items.some((item) => Number(item?.quantity || 0) !== 1)) {
        requirePermission(session, 'changeItemQuantity', settings);
      }
      if (items.some((item) => String(item?.notes || '').trim())) {
        requirePermission(session, 'editItemNotes', settings);
      }
      return;
    }

    if (routeKey === 'POST /api/orders/status') {
      if (session?.stationAccess && body?.status === 'ready') return;
      requirePermission(session, 'sendOrderToProduction', await getSettings());
      return;
    }

    if (routeKey === 'POST /api/audit-logs') {
      requireSession(session);
      return;
    }

    if (routeKey === 'POST /api/service-requests' || routeKey === 'POST /api/tables/request-bill') {
      requireSession(session);
      return;
    }

    if (routeKey === 'POST /api/cash/open' || routeKey === 'POST /api/cash/close') return;

    const requiredPermission = PERMISSION_BY_ROUTE[routeKey];
    if (requiredPermission) {
      requirePermission(session, requiredPermission, await getSettings());
      return;
    }

    requireSession(session);
  };
};

export const createAccessGuards = ({ canSessionWithSettings }) => {
  const requireSession = (session) => {
    if (session) return;
    const error = new Error('Sessão obrigatória.');
    error.statusCode = 401;
    throw error;
  };

  const requirePermission = (session, permission, settings = null) => {
    requireSession(session);
    if (canSessionWithSettings(session, permission, settings)) return;
    const error = new Error('Permissão insuficiente.');
    error.statusCode = 403;
    throw error;
  };

  return { requireSession, requirePermission };
};
