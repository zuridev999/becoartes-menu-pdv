const safeText = (value, maxLength) => String(value || '').trim().slice(0, maxLength);

export const createQrOrderAuditService = ({ db, createId }) => async ({
  origin,
  orderId,
  clientRequestId,
  qrVisitId,
  sourceIp,
  userAgent,
  tableId,
  customerTabContext,
}) => {
  if (origin !== 'qr') return null;
  const sourceTableNumber = Number(customerTabContext?.sourceTableNumber || 0)
    || Number((await db.execute({
      sql: 'SELECT number FROM tables WHERE id = ? LIMIT 1',
      args: [tableId],
    })).rows[0]?.number || 0);

  return {
    sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, 'qr_order_submitted', ?, ?, 'qr', 'Cliente QR', ?)",
    args: [
      createId(),
      JSON.stringify({
        orderId,
        clientRequestId,
        qrVisitId: safeText(qrVisitId, 80),
        sourceIp: safeText(sourceIp, 64),
        userAgent: safeText(userAgent, 512),
        sourceTableId: customerTabContext?.sourceTableId || tableId,
        sourceTableNumber,
        customerTabId: customerTabContext?.customerTabId || null,
      }),
      String(sourceTableNumber || ''),
      new Date().toISOString(),
    ],
  };
};
