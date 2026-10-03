const httpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const createClearTableService = ({
  db,
  createId,
  getCustomerTabTotalsByTable,
  isSuperAdminSession,
}) => async ({ tableId }, session) => {
  const safeTableId = String(tableId || '').trim();
  if (!safeTableId) throw httpError('tableId é obrigatório.', 400);
  if (!(await isSuperAdminSession(session))) {
    throw httpError('Apenas o superadmin pode limpar uma mesa.', 403);
  }

  const tableRes = await db.execute({
    sql: 'SELECT id, number, status FROM tables WHERE id = ? LIMIT 1',
    args: [safeTableId],
  });
  const table = tableRes.rows[0];
  if (!table) throw httpError('Mesa não encontrada.', 404);

  const [ordersRes, tabsRes, paymentsRes, totals] = await Promise.all([
    db.execute({
      sql: "SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM orders WHERE table_id = ? AND status != 'closed'",
      args: [safeTableId],
    }),
    db.execute({
      sql: "SELECT COUNT(*) AS count FROM customer_tabs WHERE table_id = ? AND status IN ('open', 'paid')",
      args: [safeTableId],
    }),
    db.execute({
      sql: "SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM table_payments WHERE table_id = ? AND status = 'active'",
      args: [safeTableId],
    }),
    getCustomerTabTotalsByTable([safeTableId]),
  ]);

  const now = new Date().toISOString();
  const ordersCount = Number(ordersRes.rows[0]?.count || 0);
  const ordersTotal = Number(ordersRes.rows[0]?.total || 0);
  const customerTabsCount = Number(tabsRes.rows[0]?.count || 0);
  const paymentsCount = Number(paymentsRes.rows[0]?.count || 0);
  const paymentsTotal = Number(paymentsRes.rows[0]?.total || 0);
  const balance = Number(totals[safeTableId]?.balance || 0);

  await db.batch([
    {
      sql: "UPDATE orders SET status = 'closed' WHERE table_id = ? AND status != 'closed'",
      args: [safeTableId],
    },
    {
      sql: "UPDATE customer_tabs SET status = 'closed', closed_at = COALESCE(closed_at, ?), closed_by_id = ?, closed_by_name = ? WHERE table_id = ? AND status IN ('open', 'paid')",
      args: [now, session?.id || '', session?.name || 'Superadmin', safeTableId],
    },
    {
      sql: "UPDATE table_payments SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, ?) WHERE table_id = ? AND status = 'active'",
      args: [now, safeTableId],
    },
    {
      sql: `UPDATE tables
        SET status = 'available', current_seller_id = NULL,
            qr_flow_override = CASE WHEN qr_flow_override = 'mesa' THEN 'mesa' ELSE NULL END,
            qr_session_revision = COALESCE(qr_session_revision, 1) + 1
        WHERE id = ?`,
      args: [safeTableId],
    },
    {
      sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name, timestamp) VALUES (?, 'table_force_cleared', ?, ?, 'pdv', ?, ?, ?)",
      args: [
        createId(),
        JSON.stringify({
          tableId: safeTableId,
          previousStatus: table.status,
          closedOrders: ordersCount,
          closedCustomerTabs: customerTabsCount,
          cancelledPayments: paymentsCount,
          ordersTotal: Number(ordersTotal.toFixed(2)),
          paymentsTotal: Number(paymentsTotal.toFixed(2)),
          outstandingBalance: Number(balance.toFixed(2)),
        }),
        String(table.number || safeTableId),
        session?.id || '',
        session?.name || 'Superadmin',
        now,
      ],
    },
  ], 'write');

  return {
    tableId: String(table.id),
    tableNumber: Number(table.number || 0),
    status: 'available',
    closedOrders: ordersCount,
    closedCustomerTabs: customerTabsCount,
    cancelledPayments: paymentsCount,
    outstandingBalance: Number(balance.toFixed(2)),
  };
};
