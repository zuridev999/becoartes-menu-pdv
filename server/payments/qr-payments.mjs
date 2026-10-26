import { randomUUID } from 'node:crypto';

export const qrPaymentSchema = `CREATE TABLE IF NOT EXISTS qr_payment_intents (
  id TEXT PRIMARY KEY, table_id TEXT NOT NULL, tab_id TEXT, method TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, snapshot TEXT NOT NULL, status TEXT NOT NULL,
  external_id TEXT UNIQUE, instructions TEXT, created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, applied_at TEXT, review_reason TEXT
)`;
export const qrPaymentActiveIndex = `CREATE UNIQUE INDEX IF NOT EXISTS qr_payment_one_pending
  ON qr_payment_intents(table_id) WHERE status IN ('creating','pending','unknown','review')`;
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const cents = value => Math.round(Number(value || 0) * 100);
const json = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const publicIntent = row => row ? ({
  id: row.id, method: row.method, amount: row.amount_cents / 100,
  status: row.status, instructions: json(row.instructions), expiresAt: row.expires_at,
  needsReview: Boolean(row.review_reason),
}) : null;

export function createQrPaymentServices({ db, authorize, getItems, getSettings, getPublicKey,
  token = '', apiBase = 'https://api.pagseguro.com', notificationUrl = '',
  provider = 'disabled', localDatabase = false, maxAmountCents = Infinity, fetchImpl = fetch }) {
  if (!['disabled', 'pagbank', 'simulator'].includes(provider)) throw new Error('QR_PAYMENTS_PROVIDER inválido');
  if (provider === 'simulator' && !localDatabase) throw new Error('Simulação de pagamento exige banco local');
  const enabled = provider === 'simulator' || (provider === 'pagbank' && Boolean(token));
  const environment = provider === 'simulator' ? 'simulator' : apiBase.includes('sandbox.') ? 'sandbox' : 'production';
  const get = async id => (await db.execute({ sql: 'SELECT * FROM qr_payment_intents WHERE id = ?', args: [id] })).rows[0];
  const balance = async target => {
    const items = await getItems(target.tableId);
    const subtotalCents = items.reduce((sum, item) => sum + cents(item.price) * item.quantity, 0);
    const settings = await getSettings();
    const configuredRate = Number(settings?.serviceTax ?? 13);
    const rate = Number.isFinite(configuredRate) ? Math.max(0, Math.min(13, configuredRate)) : 13;
    const serviceFeeCents = Math.round(subtotalCents * rate / 100);
    const payments = await db.execute({ sql: "SELECT COALESCE(SUM(amount),0) total FROM table_payments WHERE table_id=? AND status='active'", args: [target.tableId] });
    const paidCents = cents(payments.rows[0]?.total);
    // IDs prevent a late confirmation from being applied to a newly opened table.
    const fingerprint = items.map(i => `${i.id}:${i.quantity}:${cents(i.price)}`).sort().join('|');
    return { items, fingerprint, subtotalCents, serviceFeeCents, paidCents, amountCents: Math.max(0, subtotalCents + serviceFeeCents - paidCents) };
  };
  const summary = async input => {
    const target = await authorize(input);
    const totals = await balance(target);
    const pending = (await db.execute({ sql: "SELECT * FROM qr_payment_intents WHERE table_id=? AND status IN ('creating','pending','unknown','review') LIMIT 1", args: [target.tableId] })).rows[0];
    return { enabled, environment, methods: enabled ? ['pix', 'credit'] : [], applePay: false,
      testLimit: localDatabase && Number.isFinite(maxAmountCents) ? maxAmountCents / 100 : null,
      subtotal: totals.subtotalCents / 100, serviceFee: totals.serviceFeeCents / 100,
      paid: totals.paidCents / 100, total: (totals.subtotalCents + totals.serviceFeeCents) / 100,
      balance: totals.amountCents / 100, intent: publicIntent(pending) };
  };
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${apiBase}${path}`, { ...options,
      signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${token}`,
        'content-type': 'application/json', ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Keep useful diagnostics without logging customer data, credentials or card values.
      const errors = (Array.isArray(data.error_messages) ? data.error_messages : []).slice(0, 5).map(error => {
        const rawParameter = String(error.parameter_name || '');
        const parameter = /^(customer\.(name|email|tax_id)|(?:qr_codes|charges|items)(?:\[\d+\])?\.(?:amount\.value|unit_amount|payment_method(?:\.pix\.expiration_date)?))$/.test(rawParameter) ? rawParameter : 'other';
        const description = String(error.description || '').toLowerCase();
        const reason = (/must be between|minimum|at least/.test(description) || String(error.code) === '40002') && /amount|unit_amount/.test(parameter) ? 'amount_range'
          : /tax_id/.test(parameter) ? 'customer_tax_id' : /not enabled|not authorized|not allowed|forbidden/.test(description) ? 'not_enabled' : 'validation';
        return { code: /^\d{4,6}$/.test(String(error.code)) ? String(error.code) : 'unknown', parameter, reason };
      });
      const diagnostic = { httpStatus: response.status, errors };
      console.error(JSON.stringify({ event: 'qr_payment_provider_error', ...diagnostic }));
      const publicCode = errors.some(error => error.reason === 'amount_range') ? 'paymentAmountRejected'
        : errors.some(error => error.reason === 'customer_tax_id') ? 'paymentCpfInvalid'
        : [401, 403].includes(response.status) || errors.some(error => error.reason === 'not_enabled') ? 'paymentSetupError' : 'paymentError';
      throw Object.assign(new Error('O PagBank não concluiu o pagamento. Confira os dados ou chame a equipe.'), {
        statusCode: response.status >= 500 ? 503 : 422, publicCode, providerDiagnostic: diagnostic,
      });
    }
    return data;
  };
  const review = async (row, reason) => {
    await db.execute({ sql: "UPDATE qr_payment_intents SET status='review', review_reason=? WHERE id=? AND applied_at IS NULL", args: [reason, row.id] });
    await db.execute({ sql: "INSERT INTO audit_logs (id,action,details,table_number,origin,author_name,timestamp) VALUES (?,'qr_payment_review',?,?,'pagbank','PagBank',?)", args: [randomUUID(), JSON.stringify({ intentId: row.id, reason }), row.table_id, new Date().toISOString()] });
    return publicIntent(await get(row.id));
  };
  const reconcile = async (row, result) => {
    if (row.applied_at) return publicIntent(row);
    if (result.id !== row.external_id || result.reference_id !== row.id) return review(row, 'provider_identity_mismatch');
    const charges = Array.isArray(result.charges) ? result.charges : [];
    const paidCharges = charges.filter(c => c.status === 'PAID');
    if (!paidCharges.length) {
      if (row.status === 'abandoned') return publicIntent(row);
      const failed = charges.some(c => ['DECLINED', 'CANCELED', 'CANCELLED'].includes(c.status));
      // AUTHORIZED is not captured and must never become a settled payment.
      const expired = row.method === 'pix' && Date.parse(row.expires_at) < Date.now() && !charges.length;
      await db.execute({ sql: "UPDATE qr_payment_intents SET status=? WHERE id=? AND applied_at IS NULL AND status!='review'", args: [failed ? 'failed' : expired ? 'expired' : 'pending', row.id] });
      return publicIntent(await get(row.id));
    }
    const value = paidCharges.reduce((sum, charge) => sum + Number(charge.amount?.value || 0), 0);
    const expectedType = row.method === 'pix' ? 'PIX' : 'CREDIT_CARD';
    if (value !== row.amount_cents || paidCharges.some(c => c.amount?.currency !== 'BRL' || c.payment_method?.type !== expectedType)) return review(row, 'provider_amount_or_method_mismatch');
    const saved = json(row.snapshot);
    const current = await balance({ tableId: row.table_id });
    if (!current.fingerprint || !saved.items.every(item => current.items.some(i => i.id === item.id && i.quantity === item.quantity && cents(i.price) === cents(item.price)))) return review(row, 'table_items_changed');
    if (current.amountCents < row.amount_cents) return review(row, 'balance_already_paid_or_reduced');
    const paidAt = new Date().toISOString();
    const paymentId = `qr_${row.id}`;
    await db.batch([
      { sql: `INSERT OR IGNORE INTO table_payments (id,table_id,table_number,seller_id,seller_name,method,amount,status,created_at)
        SELECT ?,?,CAST(t.number AS INTEGER),'pagbank','PagBank',?,?,'active',? FROM tables t
        WHERE t.id=? AND EXISTS (SELECT 1 FROM qr_payment_intents WHERE id=? AND applied_at IS NULL AND status!='review')
        AND CAST(ROUND(100*(SELECT COALESCE(SUM(amount),0) FROM table_payments WHERE table_id=t.id AND status='active')) AS INTEGER)=?`,
        args: [paymentId, row.table_id, row.method, row.amount_cents / 100, paidAt, row.table_id, row.id, current.paidCents] },
      { sql: "UPDATE qr_payment_intents SET status='paid',applied_at=COALESCE(applied_at,?) WHERE id=? AND EXISTS (SELECT 1 FROM table_payments WHERE id=?)", args: [paidAt, row.id, paymentId] },
      { sql: "UPDATE customer_tabs SET status='paid',paid_at=COALESCE(paid_at,?) WHERE id=? AND status='open' AND ?=? AND EXISTS (SELECT 1 FROM table_payments WHERE id=?)", args: [paidAt, row.tab_id, current.amountCents, row.amount_cents, paymentId] },
      { sql: "INSERT OR IGNORE INTO audit_logs (id,action,details,table_number,origin,author_name,timestamp) SELECT ?,'qr_payment_registered',?,?,'pagbank','PagBank',? WHERE EXISTS (SELECT 1 FROM table_payments WHERE id=?)", args: [paymentId, JSON.stringify({ intentId: row.id, externalId: row.external_id, method: row.method, amount: row.amount_cents / 100 }), row.table_id, paidAt, paymentId] },
    ], 'write');
    const applied = await get(row.id);
    return applied.applied_at ? publicIntent(applied) : review(applied, 'concurrent_payment_changed_balance');
  };
  const status = async input => {
    const target = await authorize(input);
    const row = await get(input.intentId);
    if (!row || row.table_id !== target.tableId || (row.tab_id || null) !== (target.tabId || null)) fail('Pagamento não encontrado.', 404);
    if (provider !== 'simulator' && token && row.external_id && !row.applied_at && row.status !== 'review') return reconcile(row, await request(`/orders/${encodeURIComponent(row.external_id)}`));
    return publicIntent(row);
  };
  const abandon = async input => {
    const target = await authorize(input);
    const row = await get(input.intentId);
    if (!row || row.table_id !== target.tableId || (row.tab_id || null) !== (target.tabId || null)) fail('Pagamento não encontrado.', 404);
    if (row.method !== 'pix') fail('Somente um Pix pendente pode ser abandonado.');
    if (row.applied_at || row.status === 'paid') return publicIntent(row);
    if (row.status !== 'pending' || !row.external_id) fail('Este Pix não pode ser trocado agora. Chame a equipe.', 409);
    if (provider !== 'simulator' && token) {
      const checked = await reconcile(row, await request(`/orders/${encodeURIComponent(row.external_id)}`));
      if (checked.status === 'paid' || checked.status === 'review') return checked;
    }
    const abandonedAt = new Date().toISOString();
    await db.batch([
      { sql: "UPDATE qr_payment_intents SET status='abandoned' WHERE id=? AND status='pending' AND applied_at IS NULL", args: [row.id] },
      { sql: "INSERT INTO audit_logs (id,action,details,table_number,origin,author_name,timestamp) SELECT ?,'qr_payment_abandoned',?,?,'pagbank','Cliente',? WHERE EXISTS (SELECT 1 FROM qr_payment_intents WHERE id=? AND status='abandoned')", args: [randomUUID(), JSON.stringify({ intentId: row.id, externalId: row.external_id, warning: 'pix_remains_valid_until_expiration' }), row.table_id, abandonedAt, row.id] },
    ], 'write');
    return publicIntent(await get(row.id));
  };
  const create = async input => {
    const target = await authorize(input);
    if (!enabled) fail('Pagamento online indisponível. Chame a equipe.', 503);
    if (!['pix', 'credit'].includes(input.method)) fail('Forma de pagamento inválida.');
    const active = (await db.execute({ sql: "SELECT * FROM qr_payment_intents WHERE table_id=? AND status IN ('creating','pending','unknown','review') LIMIT 1", args: [target.tableId] })).rows[0];
    if (active) return publicIntent(active);
    const totals = await balance(target);
    if (!totals.amountCents) fail('Esta conta não tem saldo em aberto.');
    if (provider === 'pagbank' && totals.amountCents < 100) throw Object.assign(new Error('O PagBank exige um valor mínimo de R$ 1,00.'), { statusCode: 422, publicCode: 'paymentAmountRejected' });
    if (totals.amountCents > maxAmountCents) fail('Valor acima do limite desta prévia de teste.');
    if (cents(input.expectedAmount) !== totals.amountCents) fail('A conta foi atualizada. Confira o novo total antes de pagar.', 409);
    const customer = input.customer || {};
    const taxId = String(customer.taxId || '').replace(/\D/g, '');
    if (!String(customer.name || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer.email || '')) || !/^\d{11}$/.test(taxId)) fail('Informe nome, e-mail e CPF para o pagamento.');
    if (input.method === 'credit' && !String(input.encryptedCard || '').trim()) fail('Cartão criptografado obrigatório.');
    const id = `qrpay_${randomUUID()}`;
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 15 * 60000).toISOString();
    try {
      await db.execute({ sql: "INSERT INTO qr_payment_intents (id,table_id,tab_id,method,amount_cents,snapshot,status,created_at,expires_at) VALUES (?,?,?,?,?,?,'creating',?,?)", args: [id, target.tableId, target.tabId || null, input.method, totals.amountCents, JSON.stringify(totals), now, expires] });
    } catch (error) {
      if (!/unique/i.test(error.message)) throw error;
      const existing = (await db.execute({ sql: "SELECT * FROM qr_payment_intents WHERE table_id=? AND status IN ('creating','pending','unknown','review') LIMIT 1", args: [target.tableId] })).rows[0];
      return publicIntent(existing);
    }
    const payload = { reference_id: id, customer: { name: String(customer.name).trim(), email: String(customer.email).trim(), tax_id: taxId },
      items: [{ reference_id: id, name: 'Consumo e taxa de serviço', quantity: 1, unit_amount: totals.amountCents }],
      ...(notificationUrl ? { notification_urls: [notificationUrl] } : {}),
      ...(input.method === 'pix'
        ? { qr_codes: [{ amount: { value: totals.amountCents }, expiration_date: expires }] }
        : { charges: [{ reference_id: id, description: 'Becoartes - consumo e taxa de serviço', amount: { value: totals.amountCents, currency: 'BRL' },
          payment_method: { type: 'CREDIT_CARD', installments: 1, capture: true, card: { encrypted: input.encryptedCard, store: false }, holder: { name: String(customer.name).trim(), tax_id: taxId } } }] }) };
    try {
      const result = provider === 'simulator' ? { id: `SIM_${id}`, reference_id: id,
        ...(input.method === 'pix'
          ? { qr_codes: [{ text: 'SIMULACAO-SEM-VALOR-FINANCEIRO', expiration_date: expires }] }
          : { charges: [{ status: 'WAITING', payment_method: payload.charges[0].payment_method }] }) }
        : await request('/orders', { method: 'POST', headers: { 'x-idempotency-key': id }, body: JSON.stringify(payload) });
      if (!result.id) throw new Error('Resposta de pagamento incompleta');
      const pixCharge = result.charges?.find(charge => charge.payment_method?.type === 'PIX');
      const qr = pixCharge?.qr_code || result.qr_codes?.[0];
      const instructions = input.method === 'pix' ? { qrCodeText: qr?.text || '', expiresAt: pixCharge?.payment_method?.pix?.expiration_date || qr?.expiration_date || expires } : {};
      await db.execute({ sql: "UPDATE qr_payment_intents SET external_id=?,status='pending',instructions=? WHERE id=?", args: [result.id, JSON.stringify(instructions), id] });
      const reconciled = await reconcile(await get(id), result);
      return input.method === 'pix' && reconciled.status === 'pending' && !instructions.qrCodeText ? review(await get(id), 'pix_instructions_missing') : reconciled;
    } catch (error) {
      await db.execute({ sql: 'UPDATE qr_payment_intents SET status=? WHERE id=?', args: [error.statusCode === 422 ? 'failed' : 'unknown', id] });
      if (error.providerDiagnostic) await db.execute({ sql: "INSERT INTO audit_logs (id,action,details,table_number,origin,author_name,timestamp) VALUES (?,'qr_payment_provider_error',?,?,'pagbank','PagBank',?)", args: [randomUUID(), JSON.stringify({ intentId: id, ...error.providerDiagnostic }), target.tableId, new Date().toISOString()] });
      throw error;
    }
  };
  const webhook = async body => {
    const id = body.reference_id;
    const row = await get(id);
    if (!row) fail('Cobrança não encontrada.', 404);
    // Fetch authoritative order, never trust webhook amount/status alone.
    if (!row.external_id || !token || provider === 'simulator') fail('Cobrança ainda não vinculada.', 409);
    return reconcile(row, await request(`/orders/${encodeURIComponent(row.external_id)}`));
  };
  const simulate = async input => {
    if (!localDatabase || provider !== 'simulator') fail('Rota indisponível.', 404);
    const target = await authorize(input);
    const row = await get(input.intentId);
    if (!row || row.table_id !== target.tableId) fail('Pagamento não encontrado.', 404);
    const result = { id: row.external_id, reference_id: row.id, charges: [{ status: input.outcome === 'declined' ? 'DECLINED' : input.outcome === 'authorized' ? 'AUTHORIZED' : 'PAID', amount: { value: row.amount_cents, currency: 'BRL' }, payment_method: { type: row.method === 'pix' ? 'PIX' : 'CREDIT_CARD' } }] };
    return reconcile(row, result);
  };
  return { summary, create, status, abandon, webhook, simulate, publicKey: async input => { await authorize(input); if (!enabled) fail('Pagamento online indisponível.', 503); return getPublicKey(); } };
}
