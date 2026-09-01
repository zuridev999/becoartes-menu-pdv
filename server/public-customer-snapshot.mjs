const sanitizePublicSchedule = (schedule) => schedule ? ({
  enabled: Boolean(schedule.enabled),
  days: schedule.days || {},
  hideTotally: Boolean(schedule.hideTotally),
  message: schedule.message || '',
}) : undefined;

const sanitizePublicModifier = (modifier) => ({
  id: modifier.id,
  name: modifier.name,
  price: Number(modifier.price || 0),
  status: modifier.status === 'inactive' ? 'inactive' : 'active',
});

const sanitizePublicModifierGroup = (group) => ({
  id: group.id,
  name: group.name,
  description: group.description || '',
  minChoices: Number(group.minChoices || 0),
  maxChoices: Number(group.maxChoices || 0),
  isRequired: Boolean(group.isRequired),
  status: group.status === 'inactive' ? 'inactive' : 'active',
  modifiers: (group.modifiers || []).map(sanitizePublicModifier),
});

const sanitizePublicMenuItem = (item) => ({
  id: item.id,
  name: item.name,
  description: item.description,
  price: item.price,
  categoryId: item.categoryId,
  categoryName: item.categoryName,
  image: item.image,
  visible: item.visible,
  deliveryVisible: item.deliveryVisible,
  sortOrder: item.sortOrder,
  schedule: sanitizePublicSchedule(item.schedule),
  modifierGroups: (item.modifierGroups || []).map(sanitizePublicModifierGroup),
});

const sanitizePublicCategory = (category) => ({
  id: category.id,
  name: category.name,
  visible: Boolean(category.visible),
  sortOrder: Number(category.sortOrder || 0),
  schedule: sanitizePublicSchedule(category.schedule),
});

export const sanitizePublicCatalog = (catalogData) => catalogData ? ({
  categories: (catalogData.categories || []).map(sanitizePublicCategory),
  menuItems: (catalogData.menuItems || []).map(sanitizePublicMenuItem),
  modifierGroups: (catalogData.modifierGroups || []).map(sanitizePublicModifierGroup),
  productMapping: catalogData.productMapping || {},
  categoryMapping: catalogData.categoryMapping || {},
  catalogVersion: catalogData.catalogVersion,
}) : null;

export const sanitizePublicSettings = (settings) => settings ? ({
  qrMode: settings.qrMode === 'comanda' ? 'comanda' : 'mesa',
  serviceTax: Number(settings.serviceTax || 0),
  publicLanguages: Array.isArray(settings.publicLanguages) ? settings.publicLanguages : [],
}) : null;

export const sanitizePublicTableReference = (table) => ({
  id: table.id,
  number: Number(table.number || 0),
  status: 'available',
  orders: [],
  payments: [],
  customerTab: null,
  cart: [],
  currentSellerId: '',
});

const sanitizePublicOrder = (order) => ({
  id: order.id,
  orderId: order.orderId,
  productId: order.productId,
  categoryId: order.categoryId,
  categoryName: order.categoryName,
  name: order.name,
  price: Number(order.price || 0),
  quantity: Number(order.quantity || 0),
  selectedModifiers: (order.selectedModifiers || []).map(sanitizePublicModifier),
  notes: order.notes || '',
  orderedAt: order.orderedAt,
  status: order.status,
});

const sanitizePublicPayment = (payment) => ({
  id: payment.id,
  method: payment.method,
  amount: Number(payment.amount || 0),
  status: payment.status,
  createdAt: payment.createdAt,
});

const sanitizePublicCustomerTab = (tab) => tab ? ({
  id: tab.id,
  customerName: tab.customerName,
  cpfMasked: tab.cpfMasked,
  cpfLast4: tab.cpfLast4,
  tableId: tab.tableId,
  tableNumber: Number(tab.tableNumber || 0),
  status: tab.status,
  openedAt: tab.openedAt,
  paidAt: tab.paidAt,
  totals: tab.totals,
}) : null;

export const sanitizeAuthorizedPublicTable = (table) => ({
  id: table.id,
  number: Number(table.number || 0),
  status: table.status,
  orders: (table.orders || []).map(sanitizePublicOrder),
  payments: (table.payments || []).map(sanitizePublicPayment),
  customerTab: sanitizePublicCustomerTab(table.customerTab),
  cart: [],
  lastActivity: table.lastActivity,
  currentSellerId: '',
});

const parsePublicModifiers = (value) => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(sanitizePublicModifier) : [];
  } catch {
    return [];
  }
};

const maskPublicCpf = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  return digits.length === 11 ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**` : '';
};

const loadAuthorizedPublicTable = async (db, tableId) => {
  const [tableResult, ordersResult, paymentsResult, tabResult] = await Promise.all([
    db.execute({ sql: 'SELECT id, number, status, last_activity FROM tables WHERE id = ? LIMIT 1', args: [tableId] }),
    db.execute({
      sql: `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.price_at_time, oi.selected_modifiers,
        oi.notes, o.created_at, o.status, m.name, m.category_id, c.name AS category_name
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN menu m ON m.id = oi.product_id
        LEFT JOIN categories c ON c.id = m.category_id
        WHERE o.table_id = ? AND o.status != 'closed'
        ORDER BY o.created_at ASC, oi.rowid ASC`,
      args: [tableId],
    }),
    db.execute({
      sql: `SELECT id, method, amount, status, created_at FROM table_payments
        WHERE table_id = ? AND status = 'active' ORDER BY created_at ASC`,
      args: [tableId],
    }),
    db.execute({
      sql: `SELECT id, customer_name, cpf, cpf_last4, table_id, table_number, status, opened_at, paid_at
        FROM customer_tabs WHERE table_id = ? AND status IN ('open', 'paid') LIMIT 1`,
      args: [tableId],
    }),
  ]);
  const table = tableResult.rows[0];
  if (!table) return null;
  const orders = ordersResult.rows.map((order) => ({
    id: order.id,
    orderId: order.order_id,
    productId: order.product_id,
    categoryId: order.category_id,
    categoryName: order.category_name,
    name: order.name || '',
    price: Number(order.price_at_time || 0),
    quantity: Number(order.quantity || 0),
    selectedModifiers: parsePublicModifiers(order.selected_modifiers),
    notes: order.notes || '',
    orderedAt: order.created_at,
    status: order.status,
  }));
  const payments = paymentsResult.rows.map((payment) => ({
    id: payment.id,
    method: payment.method,
    amount: Number(payment.amount || 0),
    status: payment.status,
    createdAt: payment.created_at,
  }));
  const tab = tabResult.rows[0];
  const orderTotal = orders.reduce((sum, order) => sum + (order.price
    + order.selectedModifiers.reduce((modifierSum, modifier) => modifierSum + modifier.price, 0)) * order.quantity, 0);
  const paymentTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
  return {
    id: table.id,
    number: Number(table.number || 0),
    status: table.status,
    lastActivity: table.last_activity,
    orders,
    payments,
    customerTab: tab ? {
      id: tab.id,
      customerName: tab.customer_name,
      cpfMasked: maskPublicCpf(tab.cpf),
      cpfLast4: tab.cpf_last4 || String(tab.cpf || '').slice(-4),
      tableId: tab.table_id,
      tableNumber: Number(tab.table_number || 0),
      status: tab.status,
      openedAt: tab.opened_at,
      paidAt: tab.paid_at,
      totals: { orders: orderTotal, payments: paymentTotal, balance: Math.max(0, orderTotal - paymentTotal) },
    } : null,
    cart: [],
  };
};

export const createPublicTableStateService = ({ db, verifyCustomerTabOrderContext, verifyPublicTableToken }) => async ({
  tableId,
  tableNumber,
  origin = 'qr',
  publicAccessToken = '',
  customerTabId = '',
  customerTabAccessToken = '',
  sourceTableId = '',
  sourceTableNumber = '',
}) => {
  let targetTableId = tableId;
  if (customerTabId) {
    await verifyCustomerTabOrderContext({
      tableId, origin, customerTabId, customerTabAccessToken,
      sourceTableId, sourceTableNumber, publicAccessToken,
    });
  } else {
    const access = await verifyPublicTableToken({ token: publicAccessToken, source: origin, tableId, tableNumber });
    if (!access) {
      const error = new Error('Acesso à mesa expirado. Escaneie o QR novamente.');
      error.statusCode = 401;
      throw error;
    }
    targetTableId = access.tableId;
  }
  const table = await loadAuthorizedPublicTable(db, targetTableId);
  if (!table) {
    const error = new Error('Esta mesa não está disponível agora.');
    error.statusCode = 404;
    throw error;
  }
  return { table: sanitizeAuthorizedPublicTable(table) };
};

export const sanitizePublicCustomerSnapshot = (snapshot, view) => ({
  ...snapshot,
  catalogData: sanitizePublicCatalog(snapshot.catalogData),
  kitchenData: { orders: [], serverNow: snapshot.kitchenData?.serverNow || new Date().toISOString() },
  sellers: [],
  serviceRequests: [],
  closedBills: [],
  auditLogs: [],
  cashState: null,
  inventoryReconciliation: null,
  savedSettings: sanitizePublicSettings(snapshot.savedSettings),
  tables: view === 'qr'
    ? (snapshot.tables || [])
      .filter((table) => Number(table.number || 0) >= 1 && Number(table.number || 0) <= 50)
      .map(sanitizePublicTableReference)
    : [],
});

export const rethrowCustomerTabWriteError = (error) => {
  if (!/customer_tab_not_active/i.test(String(error?.message || error || ''))) throw error;
  const conflict = new Error('Esta comanda foi encerrada. Escaneie o QR da mesa novamente.');
  conflict.statusCode = 409;
  throw conflict;
};
