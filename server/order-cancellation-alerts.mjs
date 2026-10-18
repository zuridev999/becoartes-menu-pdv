import { sendZuriWhatsAppMessage } from './notifications/zuri-whatsapp.mjs';

export const cancellationAlertSchema = [
  `CREATE TABLE IF NOT EXISTS order_cancellation_alerts (
    audit_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    message_id TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_order_cancellation_alerts_status ON order_cancellation_alerts(status, created_at)",
];

const describeCancellation = (row) => {
  const details = JSON.parse(String(row.details || '{}'));
  const mesa = String(row.table_number || '?');
  const item = String(details.itemName || details.modifierName || details.productName || 'item');
  const quantity = Number(details.quantity || 1);
  const actor = String(row.author_name || 'operador');
  const reason = [details.reasonLabel, details.reasonNotes].filter(Boolean).join(' — ');
  return `Cancelamento no PDV: mesa ${mesa}, ${quantity}x ${item}. Responsável: ${actor}. Motivo: ${reason || 'não informado'}.`;
};

export const createOrderCancellationAlertService = ({
  db, bridge, ownerPhone, logger = console, send = sendZuriWhatsAppMessage,
}) => {
  const dispatch = async ({ limit = 20 } = {}) => {
    if (!ownerPhone || !bridge?.bridgeUrl) {
      logger.error('[cancellation-alert] owner phone or Zuri bridge is not configured');
      return { sent: 0, blocked: true };
    }
    // The audit row is committed with the cancellation. Reconstruct the outbox
    // after process crashes; older audit rows are not replayed.
    const audits = await db.execute({
      sql: `SELECT a.id FROM audit_logs a
            LEFT JOIN order_cancellation_alerts n ON n.audit_id = a.id
            WHERE n.audit_id IS NULL
              AND a.action IN ('order_item_cancelled', 'order_modifier_cancelled',
                               'order_item_product_cancelled_modifier_kept')
              AND CASE WHEN json_valid(a.details)
                       THEN json_extract(a.details, '$.ownerAlertVersion')
                       ELSE NULL END = 1
            ORDER BY a.timestamp ASC LIMIT ?`,
      args: [Math.max(1, Math.min(100, limit))],
    });
    for (const row of audits.rows) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO order_cancellation_alerts (audit_id) VALUES (?)",
        args: [row.id],
      });
    }
    const pending = await db.execute({
      sql: `SELECT n.audit_id, a.details, a.table_number, a.author_name
            FROM order_cancellation_alerts n JOIN audit_logs a ON a.id = n.audit_id
            WHERE n.status = 'pending' ORDER BY n.created_at ASC LIMIT ?`,
      args: [Math.max(1, Math.min(100, limit))],
    });
    let sent = 0;
    for (const row of pending.rows) {
      const claimed = await db.execute({
        sql: `UPDATE order_cancellation_alerts SET status = 'sending', attempts = attempts + 1,
              updated_at = CURRENT_TIMESTAMP WHERE audit_id = ? AND status = 'pending'`,
        args: [row.audit_id],
      });
      if (Number(claimed.rowsAffected) !== 1) continue;
      try {
        const receipt = await send({
          ...bridge, phone: ownerPhone, message: describeCancellation(row),
        });
        await db.execute({
          sql: `UPDATE order_cancellation_alerts SET status = 'sent', message_id = ?,
                error = NULL, updated_at = CURRENT_TIMESTAMP WHERE audit_id = ? AND status = 'sending'`,
          args: [receipt.messageId, row.audit_id],
        });
        sent += 1;
      } catch (error) {
        // A timeout can occur after WhatsApp accepted the message. Never retry
        // blindly and risk duplicate alerts; surface the uncertain attempt.
        await db.execute({
          sql: `UPDATE order_cancellation_alerts SET status = 'uncertain', error = ?,
                updated_at = CURRENT_TIMESTAMP WHERE audit_id = ? AND status = 'sending'`,
          args: [String(error?.message || error).slice(0, 500), row.audit_id],
        });
        logger.error('[cancellation-alert] delivery uncertain', row.audit_id, error);
      }
    }
    return { sent, scanned: pending.rows.length };
  };
  return { dispatch };
};
