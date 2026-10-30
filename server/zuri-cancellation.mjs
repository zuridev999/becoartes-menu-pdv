const fail = (message, statusCode = 409) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
};

const requesterNames = new Map([
  ['5511974717013', 'Guilherme'],
  ['5561983440871', 'Matheus Alencar'],
  ['556183440871', 'Matheus Alencar'],
]);

const canonicalRequester = (value) => String(value || '').replace(/\D/g, '');

const authorizeRequester = (requesterPhone) => {
  const phone = canonicalRequester(requesterPhone);
  const name = requesterNames.get(phone);
  if (!name) fail('Solicitante não habilitado para este fluxo.', 403);
  return { phone, name };
};

const parseModifiers = (value) => {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map((modifier) => ({
      name: String(modifier?.name || '').trim(),
      price: Number(modifier?.price || 0),
    })).filter((modifier) => modifier.name) : [];
  } catch {
    return [];
  }
};

export const createZuriCancellationServices = ({ db, token, safeSecretEqual, cancelItem }) => {
  const authenticate = (req) => {
    if (!token) fail('Integração de cancelamento da Zuri indisponível.', 503);
    const supplied = String(req?.headers?.['x-zuri-pdv-token'] || '');
    if (!supplied || !safeSecretEqual(supplied, token)) fail('Acesso não autorizado.', 403);
  };

  const getTable = async (tableNumber, { allowActivePayment = false } = {}) => {
    const number = Number(tableNumber);
    if (!Number.isInteger(number) || number < 1 || number > 200) fail('Informe o número da mesa.', 400);
    const row = (await db.execute({
      sql: 'SELECT id, number FROM tables WHERE CAST(number AS INTEGER) = ? LIMIT 1',
      args: [number],
    })).rows[0];
    if (!row) fail('Mesa não encontrada.', 404);
    const payment = (await db.execute({
      sql: `SELECT id FROM table_payments WHERE table_id = ? AND status = 'active' LIMIT 1`,
      args: [row.id],
    })).rows[0];
    const paymentActive = Boolean(payment);
    if (paymentActive && !allowActivePayment) {
      fail('Esta mesa já tem pagamento lançado; revisão manual necessária.');
    }
    return { ...row, paymentActive };
  };

  const itemsForTable = async (tableId) => (await db.execute({
    sql: `SELECT oi.id AS item_id, oi.order_id, oi.quantity, oi.selected_modifiers,
                 oi.price_at_time, m.name AS item_name, o.status AS order_status,
                 o.created_at AS ordered_at
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
          LEFT JOIN menu m ON m.id = oi.product_id
          WHERE o.table_id = ? AND o.status != 'closed'
          ORDER BY o.created_at, oi.id LIMIT 100`,
    args: [tableId],
  })).rows.map((row) => {
    const modifiers = parseModifiers(row.selected_modifiers);
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.price_at_time || 0)
      + modifiers.reduce((total, modifier) => total + modifier.price, 0);
    return {
      itemId: String(row.item_id), orderId: String(row.order_id),
      name: String(row.item_name || 'Item'), quantity,
      modifiers: modifiers.map((modifier) => modifier.name),
      orderedAt: String(row.ordered_at || ''),
      unitPrice,
      lineTotal: unitPrice * quantity,
    };
  });

  const lookup = async ({ tableNumber, requesterPhone }, req) => {
    authenticate(req);
    authorizeRequester(requesterPhone);
    const table = await getTable(tableNumber, { allowActivePayment: true });
    const items = await itemsForTable(table.id);
    return {
      tableNumber: Number(table.number),
      items,
      currentTotal: items.reduce((total, item) => total + item.lineTotal, 0),
      paymentActive: table.paymentActive,
    };
  };

  const commit = async ({ tableNumber, itemId, reasonNotes, requesterPhone, sourceMessageId }, req) => {
    authenticate(req);
    const requester = authorizeRequester(requesterPhone);
    const reason = String(reasonNotes || '').trim();
    if (reason.length < 10 || reason.length > 500 || /^(cliente (?:desistiu|cancelou)|desistiu|cancelou|erro|cancelar)$/i.test(reason)) {
      fail('Motivo insuficiente; explique brevemente a situação antes de cancelar.', 400);
    }
    if (!sourceMessageId || String(sourceMessageId).length > 180) fail('Mensagem de confirmação ausente.', 400);
    const table = await getTable(tableNumber);
    const items = await itemsForTable(table.id);
    const item = items.find(entry => entry.itemId === String(itemId));
    if (!item) fail('O item já não está nesta mesa aberta. Atualize a consulta.', 409);
    if (item.quantity !== 1 || item.modifiers.length) {
      fail('Linha com quantidade múltipla ou adicionais exige revisão do superadmin; nada foi cancelado.', 409);
    }
    const session = {
      id: 'admin-bootstrap',
      name: `${requester.name} via Zuri`,
      permission: 'admin',
    };
    const outcome = await cancelItem({ itemId: item.itemId, cancelContext: {
      tableNumber: Number(table.number), itemName: item.name, quantity: item.quantity,
      reasonCode: 'freelancer_request', reasonLabel: 'Solicitação da equipe', reasonNotes: reason,
      requesterPhone: requester.phone, sourceMessageId: String(sourceMessageId),
    } }, session);
    if (!outcome?.orderId || outcome.idempotent) {
      fail('Não foi possível confirmar um novo cancelamento. Confira a mesa antes de responder.', 409);
    }
    const remainingItems = await itemsForTable(table.id);
    return {
      cancelled: true,
      tableNumber: Number(table.number),
      itemName: item.name,
      quantity: item.quantity,
      currentTotal: remainingItems.reduce((total, entry) => total + entry.lineTotal, 0),
    };
  };

  return { lookup, commit };
};
