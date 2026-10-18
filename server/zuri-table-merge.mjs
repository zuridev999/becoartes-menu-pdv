import { randomUUID } from 'node:crypto';

const allowedRequester = new Set(['5561983440871', '556183440871']);

const fail = (message, statusCode = 409) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
};

export const zuriTableMergeSchema = [
  `CREATE TABLE IF NOT EXISTS zuri_table_merges (
    source_message_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL UNIQUE,
    from_table_id TEXT NOT NULL,
    to_table_id TEXT NOT NULL,
    requester_phone TEXT NOT NULL,
    had_open_work INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

export const createZuriTableMergeServices = ({ db, token, safeSecretEqual }) => {
  const authenticate = (req) => {
    if (!token) fail('Integração de mesas da Zuri indisponível.', 503);
    const supplied = String(req?.headers?.['x-zuri-pdv-token'] || '');
    if (!supplied || !safeSecretEqual(supplied, token)) fail('Acesso não autorizado.', 403);
  };

  const numberOf = (value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 200) {
      fail('Informe dois números de mesa válidos.', 400);
    }
    return number;
  };

  const getState = async (firstNumber, secondNumber) => {
    const first = numberOf(firstNumber);
    const second = numberOf(secondNumber);
    if (first === second) fail('Escolha duas mesas diferentes.', 400);
    const rows = (await db.execute({
      sql: `SELECT id, number, status, qr_flow_override, qr_session_revision,
                   current_seller_id FROM tables WHERE CAST(number AS INTEGER) IN (?, ?)`,
      args: [first, second],
    })).rows;
    const byNumber = new Map(rows.map(row => [Number(row.number), row]));
    if (!byNumber.has(first) || !byNumber.has(second)) fail('Uma das mesas não existe no PDV.', 404);
    const ids = [byNumber.get(first).id, byNumber.get(second).id];
    const payments = (await db.execute({
      sql: `SELECT table_id FROM table_payments WHERE table_id IN (?, ?) AND status = 'active' LIMIT 1`,
      args: ids,
    })).rows;
    const tabs = (await db.execute({
      sql: `SELECT table_id FROM customer_tabs WHERE table_id IN (?, ?) AND status = 'open' LIMIT 1`,
      args: ids,
    })).rows;
    if (payments.length || tabs.length) {
      fail('Há pagamento ou comanda individual ativa; a união exige conferência humana. Nada foi transferido.');
    }
    const orders = (await db.execute({
      sql: `SELECT table_id, COUNT(*) AS count FROM orders
            WHERE table_id IN (?, ?) AND status != 'closed' GROUP BY table_id`,
      args: ids,
    })).rows;
    const requests = (await db.execute({
      sql: `SELECT table_id, COUNT(*) AS count FROM service_requests
            WHERE table_id IN (?, ?) AND status != 'resolved' GROUP BY table_id`,
      args: ids,
    })).rows;
    const orderCount = new Map(orders.map(row => [String(row.table_id), Number(row.count)]));
    const requestCount = new Map(requests.map(row => [String(row.table_id), Number(row.count)]));
    return [first, second].map(number => {
      const row = byNumber.get(number);
      return {
        id: String(row.id), number, status: String(row.status),
        qrFlowOverride: row.qr_flow_override == null ? null : String(row.qr_flow_override),
        qrSessionRevision: Number(row.qr_session_revision || 1),
        currentSellerId: row.current_seller_id == null ? null : String(row.current_seller_id),
        openOrders: orderCount.get(String(row.id)) || 0,
        openRequests: requestCount.get(String(row.id)) || 0,
      };
    });
  };

  const lookup = async ({ firstNumber, secondNumber }, req) => {
    authenticate(req);
    return { tables: await getState(firstNumber, secondNumber) };
  };

  const commit = async ({ firstNumber, secondNumber, keepNumber, requesterPhone, sourceMessageId }, req) => {
    authenticate(req);
    const phone = String(requesterPhone || '').replace(/\D/g, '');
    if (!allowedRequester.has(phone)) fail('Solicitante não habilitado para unir mesas.', 403);
    const sourceId = String(sourceMessageId || '');
    if (!sourceId || sourceId.length > 180) fail('Mensagem de escolha ausente.', 400);
    const keep = numberOf(keepNumber);
    const first = numberOf(firstNumber);
    const second = numberOf(secondNumber);
    if (first === second || ![first, second].includes(keep)) fail('A mesa escolhida não está no par informado.', 400);
    const prior = (await db.execute({
      sql: 'SELECT from_table_id, to_table_id, had_open_work FROM zuri_table_merges WHERE source_message_id = ?',
      args: [sourceId],
    })).rows[0];
    if (prior) {
      const priorTables = (await db.execute({
        sql: 'SELECT id, number FROM tables WHERE id IN (?, ?)',
        args: [prior.from_table_id, prior.to_table_id],
      })).rows;
      const priorById = new Map(priorTables.map(row => [String(row.id), Number(row.number)]));
      if (priorById.get(String(prior.from_table_id)) !== (keep === first ? second : first)
          || priorById.get(String(prior.to_table_id)) !== keep) {
        fail('Esta mensagem já foi usada para outra união de mesas.', 409);
      }
      return { merged: Number(prior.had_open_work) === 1,
        noOpenWork: Number(prior.had_open_work) !== 1, alreadyMerged: true,
        fromNumber: priorById.get(String(prior.from_table_id)), keepNumber: keep };
    }
    const state = await getState(first, second);
    const target = state.find(table => table.number === keep);
    const source = state.find(table => table.number !== keep);
    const hadOpenWork = source.openOrders + source.openRequests > 0;

    const attemptId = randomUUID();
    const inheritsMesaFlow = ['mesa', 'mesa_until_close'].includes(source.qrFlowOverride);
    const ownerId = source.currentSellerId || target.currentSellerId;
    const auditDetails = JSON.stringify({
      sourceMessageId: sourceId, requesterPhone: phone,
      fromNumber: source.number, keepNumber: target.number,
      expectedOpenOrders: source.openOrders, expectedOpenRequests: source.openRequests,
      fromQrRevision: source.qrSessionRevision, toQrRevision: target.qrSessionRevision,
      physicalQrRemovalReportedByRequester: true,
    });
    const result = await db.batch([
      {
        sql: `INSERT OR IGNORE INTO zuri_table_merges
              (source_message_id, attempt_id, from_table_id, to_table_id, requester_phone, had_open_work)
              SELECT ?, ?, ?, ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM tables WHERE id = ? AND qr_session_revision = ?)
                AND EXISTS (SELECT 1 FROM tables WHERE id = ? AND qr_session_revision = ?)
                AND NOT EXISTS (SELECT 1 FROM table_payments WHERE table_id IN (?, ?) AND status = 'active')
                AND NOT EXISTS (SELECT 1 FROM customer_tabs WHERE table_id IN (?, ?) AND status = 'open')
                AND ? = (SELECT CASE WHEN
                  EXISTS (SELECT 1 FROM orders WHERE table_id = ? AND status != 'closed')
                  OR EXISTS (SELECT 1 FROM service_requests WHERE table_id = ? AND status != 'resolved')
                  THEN 1 ELSE 0 END)`,
        args: [sourceId, attemptId, source.id, target.id, phone, hadOpenWork ? 1 : 0,
          source.id, source.qrSessionRevision, target.id, target.qrSessionRevision,
          source.id, target.id, source.id, target.id,
          hadOpenWork ? 1 : 0, source.id, source.id],
      },
      {
        sql: `UPDATE orders SET table_id = ? WHERE table_id = ? AND status != 'closed'
              AND EXISTS (SELECT 1 FROM zuri_table_merges WHERE attempt_id = ?)`,
        args: [target.id, source.id, attemptId],
      },
      {
        sql: `UPDATE service_requests SET table_id = ? WHERE table_id = ? AND status != 'resolved'
              AND EXISTS (SELECT 1 FROM zuri_table_merges WHERE attempt_id = ?)`,
        args: [target.id, source.id, attemptId],
      },
      {
        sql: `UPDATE tables SET status = 'available', current_seller_id = NULL,
                  qr_flow_override = CASE WHEN qr_flow_override = 'mesa' THEN 'mesa' ELSE NULL END,
                  qr_session_revision = COALESCE(qr_session_revision, 1) + 1
              WHERE id = ? AND EXISTS (SELECT 1 FROM zuri_table_merges WHERE attempt_id = ?)`,
        args: [source.id, attemptId],
      },
      {
        sql: `UPDATE tables SET status = 'ordering',
                  current_seller_id = COALESCE(current_seller_id, ?),
                  qr_flow_override = CASE WHEN qr_flow_override = 'mesa' THEN 'mesa'
                    WHEN ? THEN 'mesa_until_close' ELSE qr_flow_override END
              WHERE id = ? AND ? = 1
                AND EXISTS (SELECT 1 FROM zuri_table_merges WHERE attempt_id = ?)`,
        args: [ownerId, inheritsMesaFlow ? 1 : 0, target.id, hadOpenWork ? 1 : 0, attemptId],
      },
      {
        sql: `INSERT INTO audit_logs
              (id, action, details, table_number, origin, author_id, author_name, timestamp)
              SELECT ?, 'table_merge_via_zuri', ?, ?, 'zuri', ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM zuri_table_merges WHERE attempt_id = ?)`,
        args: [randomUUID(), auditDetails, String(target.number), phone,
          'Matheus Alencar via Zuri', new Date().toISOString(), attemptId],
      },
    ], 'write');
    if (Number(result[0]?.rowsAffected || 0) !== 1) {
      fail('As mesas mudaram durante a conferência. Nada foi transferido; consulte novamente.', 409);
    }
    const remaining = (await db.execute({
      sql: `SELECT
              (SELECT COUNT(*) FROM orders WHERE table_id = ? AND status != 'closed') AS orders,
              (SELECT COUNT(*) FROM service_requests WHERE table_id = ? AND status != 'resolved') AS requests`,
      args: [source.id, source.id],
    })).rows[0];
    return {
      merged: hadOpenWork, noOpenWork: !hadOpenWork,
      fromNumber: source.number, keepNumber: target.number,
      ordersMoved: Number(result[1]?.rowsAffected || 0),
      requestsMoved: Number(result[2]?.rowsAffected || 0),
      reviewRequired: Number(remaining.orders || 0) + Number(remaining.requests || 0) > 0,
    };
  };

  return { lookup, commit };
};
