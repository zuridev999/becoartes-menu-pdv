const QR_ANALYTICS_EVENTS = new Set([
  'qr_visit_started',
  'menu_visible',
  'product_opened',
  'order_started',
  'order_sent',
  'comanda_opened',
]);

const normalizeVisitId = (value) => {
  const visitId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{16,80}$/.test(visitId) ? visitId : '';
};

const normalizeEvent = (value) => {
  const event = String(value || '').trim();
  return QR_ANALYTICS_EVENTS.has(event) ? event : '';
};

const normalizeProductId = (value) => String(value || '').trim().slice(0, 160);

const normalizeTableNumber = (value) => {
  const tableNumber = Math.trunc(Number(value || 0));
  return Number.isFinite(tableNumber) && tableNumber > 0 && tableNumber <= 50 ? tableNumber : 0;
};

const parseDateFilter = (value) => {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
};

export const createQrAnalyticsService = ({ db, createId, getBusinessDate }) => {
  const recordQrAnalyticsEvent = async ({
    visitId,
    event,
    tableId = '',
    tableNumber,
    productId = '',
  }) => {
    const safeVisitId = normalizeVisitId(visitId);
    const safeEvent = normalizeEvent(event);
    const safeTableNumber = normalizeTableNumber(tableNumber);
    if (!safeVisitId || !safeEvent || !safeTableNumber) {
      const error = new Error('Evento de análise do QR inválido.');
      error.statusCode = 400;
      throw error;
    }

    const businessDate = getBusinessDate();
    const occurredAt = new Date().toISOString();
    const result = await db.execute({
      sql: `
        INSERT OR IGNORE INTO qr_analytics_events
          (id, visit_id, event, table_id, table_number, product_id, business_date, occurred_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        createId(),
        safeVisitId,
        safeEvent,
        String(tableId || '').slice(0, 160) || null,
        safeTableNumber,
        normalizeProductId(productId),
        businessDate,
        occurredAt,
        Date.now(),
      ],
    });

    return { recorded: Number(result.rowsAffected || 0) > 0 };
  };

  const getQrAnalyticsFunnel = async ({ from = '', to = '' } = {}) => {
    const safeFrom = parseDateFilter(from);
    const safeTo = parseDateFilter(to);
    if ((from && !safeFrom) || (to && !safeTo)) {
      const error = new Error('Período de análise do QR inválido.');
      error.statusCode = 400;
      throw error;
    }
    if (safeFrom && safeTo && safeFrom > safeTo) {
      const error = new Error('A data inicial não pode ser maior que a data final.');
      error.statusCode = 400;
      throw error;
    }

    const where = [];
    const args = [];
    if (safeFrom) {
      where.push('business_date >= ?');
      args.push(safeFrom);
    }
    if (safeTo) {
      where.push('business_date <= ?');
      args.push(safeTo);
    }
    const result = await db.execute({
      sql: `
        SELECT
          business_date AS businessDate,
          COUNT(DISTINCT CASE WHEN event = 'qr_visit_started' THEN visit_id END) AS qrVisits,
          COUNT(DISTINCT CASE WHEN event = 'menu_visible' THEN visit_id END) AS menuVisible,
          COUNT(DISTINCT CASE WHEN event = 'product_opened' THEN visit_id END) AS productOpened,
          COUNT(DISTINCT CASE WHEN event = 'order_started' THEN visit_id END) AS orderStarted,
          COUNT(DISTINCT CASE WHEN event = 'order_sent' THEN visit_id END) AS orderSent,
          COUNT(DISTINCT CASE WHEN event = 'comanda_opened' THEN visit_id END) AS comandaOpened
        FROM qr_analytics_events
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY business_date
        ORDER BY business_date ASC
      `,
      args,
    });

    const days = (result.rows || []).map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        key === 'businessDate' ? String(value || '') : Number(value || 0),
      ]),
    ));
    return { days };
  };

  return { recordQrAnalyticsEvent, getQrAnalyticsFunnel };
};
