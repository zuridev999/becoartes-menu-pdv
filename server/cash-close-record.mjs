import { cashDenominationsCents, countCashCents } from './cash-count.mjs';

const conflict = () => Object.assign(new Error('Este caixa já foi fechado. Atualize a tela antes de tentar novamente.'), { statusCode: 409 });

const persistCashClosureOnce = async ({ db, cashTable, cash, empresaId, closingCents, expectedCents, cashCount, notes, actor, createId, now }) => {
  if (cashCount != null && countCashCents(cashCount) !== closingCents) {
    throw Object.assign(new Error('A contagem não confere com o total em espécie.'), { statusCode: 400 });
  }
  const countSnapshot = cashCount == null ? null : Object.fromEntries(
    Object.keys(cashDenominationsCents).map((key) => [key, cashCount[key]]),
  );
  const closedAt = new Date().toISOString();
  const details = {
    empresaId,
    cashId: cash.id,
    cashDate: cash.data,
    closingBalance: closingCents / 100,
    cashCount: countSnapshot,
    expected: expectedCents / 100,
    difference: (closingCents - expectedCents) / 100,
    opening: cash.openingCents / 100,
    cashSales: cash.cashSalesCents / 100,
    manualIn: cash.manualInCents / 100,
    manualOut: cash.manualOutCents / 100,
    tolerance: 1,
    blockingShortage: cash.blockingShortage,
    adminOverride: cash.adminOverride,
    sandbox: cash.sandbox,
  };
  const tx = await db.transaction('write');
  try {
    const updated = await tx.execute({
      sql: `UPDATE ${cashTable} SET valor_caixa_final = ?, status = 'Fechado', observacoes = ?, updated_at = ? WHERE id = ? AND empresa_id = ? AND status = 'Aberto'`,
      args: [closingCents / 100, notes || cash.observacoes || '', now, cash.id, empresaId],
    });
    if (Number(updated.rowsAffected || 0) !== 1) throw conflict();

    if (countSnapshot) {
      await tx.execute({
        sql: `INSERT INTO pdv_cash_closure_counts
          (id, empresa_id, cash_id, business_date, opened_at, closed_at, counts_json, total_cents, expected_cents, difference_cents, actor_id, actor_name, notes, sandbox)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [createId(), empresaId, cash.id, cash.data, String(cash.created_at || ''), closedAt, JSON.stringify(countSnapshot), closingCents, expectedCents, closingCents - expectedCents, actor.id, actor.name, notes || '', cash.sandbox ? 1 : 0],
      });
    }

    await tx.execute({
      sql: 'INSERT INTO audit_logs (id, action, details, origin, author_id, author_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [createId(), 'cash_closed', JSON.stringify(details), 'pdv', actor.id, actor.name, closedAt],
    });
    await tx.commit();
  } catch (error) {
    try { await tx.rollback(); } catch { /* Original error remains authoritative. */ }
    throw error;
  } finally {
    tx.close();
  }
};

const pendingClosures = new Map();
export const persistCashClosure = async (options) => {
  const key = `${options.empresaId}:${options.cash.id}`;
  const previous = pendingClosures.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => persistCashClosureOnce(options));
  pendingClosures.set(key, current);
  try {
    return await current;
  } finally {
    if (pendingClosures.get(key) === current) pendingClosures.delete(key);
  }
};

export const listCashClosureCounts = async ({ db, empresaId, sandboxMode = false, from = '', to = '', limit = 100 }) => {
  const validDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!validDate(from) || !validDate(to) || (from && to && from > to)) {
    throw Object.assign(new Error('Período de conferência inválido.'), { statusCode: 400 });
  }
  const boundedLimit = Math.min(100, Math.max(1, Number.isSafeInteger(limit) ? limit : 30));
  const result = await db.execute({
    sql: `SELECT id, cash_id, business_date, opened_at, closed_at, counts_json, total_cents, expected_cents, difference_cents, actor_id, actor_name, notes
      FROM pdv_cash_closure_counts
      WHERE empresa_id = ? AND sandbox = ? AND (? = '' OR business_date >= ?) AND (? = '' OR business_date <= ?)
      ORDER BY business_date DESC, closed_at DESC, id DESC LIMIT ?`,
    args: [empresaId, sandboxMode ? 1 : 0, from, from, to, to, boundedLimit],
  });
  return result.rows.map((row) => ({
    id: row.id,
    cashId: row.cash_id,
    businessDate: row.business_date,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    counts: JSON.parse(row.counts_json),
    total: Number(row.total_cents) / 100,
    expected: Number(row.expected_cents) / 100,
    difference: Number(row.difference_cents) / 100,
    actorId: row.actor_id,
    actorName: row.actor_name,
    notes: row.notes || '',
  }));
};
