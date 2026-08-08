import { createClient } from '@libsql/client';

const url = process.env.VITE_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
const authToken = process.env.VITE_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
if (!url) throw new Error('Banco do PDV não configurado.');

const db = createClient({ url, authToken });
const days = ['2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21'];

for (const day of days) {
  const bills = await db.execute({
    sql: `
      SELECT id, table_id, table_number, seller_name, subtotal, service_fee,
             discount, coupon_amount, total, payments, closed_at
      FROM closed_bills
      WHERE date(datetime(closed_at, '-3 hours')) = ?
      ORDER BY closed_at
    `,
    args: [day],
  });
  const parsed = bills.rows.map((row) => ({
    ...row,
    payments: (() => {
      try { return JSON.parse(String(row.payments || '[]')); }
      catch { return []; }
    })(),
  }));
  const totals = parsed.reduce((acc, bill) => {
    acc.products += Number(bill.subtotal || 0) - Number(bill.discount || 0) - Number(bill.coupon_amount || 0);
    acc.service += Number(bill.service_fee || 0);
    acc.total += Number(bill.total || 0);
    for (const payment of bill.payments) {
      const method = String(payment.method || payment.type || payment.forma || 'desconhecido').toLowerCase();
      const amount = Number(payment.amount || payment.value || payment.valor || 0);
      acc.payments[method] = (acc.payments[method] || 0) + amount;
    }
    return acc;
  }, { products: 0, service: 0, total: 0, payments: {} });

  const standalonePayments = await db.execute({
    sql: `
      SELECT id, table_id, table_number, method, amount, status, applied_closed_bill_id, created_at
      FROM table_payments
      WHERE date(datetime(created_at, '-3 hours')) = ?
      ORDER BY created_at
    `,
    args: [day],
  });

  const standalone = standalonePayments.rows.reduce((acc, row) => {
    const key = `${String(row.status || 'sem_status').toLowerCase()}:${String(row.method || 'sem_metodo').toLowerCase()}`;
    acc[key] = (acc[key] || 0) + Number(row.amount || 0);
    return acc;
  }, {});

  console.log(JSON.stringify({
    day,
    billCount: parsed.length,
    totals,
    standalonePaymentCount: standalonePayments.rows.length,
    standalone,
  }));
}
