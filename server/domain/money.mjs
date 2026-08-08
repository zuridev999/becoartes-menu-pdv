export const moneyToCents = (value, field = 'money') => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Campo numérico inválido: ${field}`);
    return Math.round(value * 100);
  }

  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`Campo numérico inválido: ${field}`);
  return Math.round(parsed * 100);
};

export const centsToMoney = (cents) => Math.round(Number(cents || 0)) / 100;

export const formatMoneyBRL = (value) => (
  centsToMoney(moneyToCents(value)).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
);

export const normalizePaymentsFingerprint = (payments = []) => JSON.stringify(
  (Array.isArray(payments) ? payments : [])
    .map((payment) => ({
      method: String(payment?.method || ''),
      amount: moneyToCents(payment?.amount || 0, 'payment.amount'),
    }))
    .sort((a, b) => a.method.localeCompare(b.method) || a.amount - b.amount),
);
