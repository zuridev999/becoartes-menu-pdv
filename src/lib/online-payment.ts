import type { Table } from '../types';
import { calculateBillTotal, calculateServiceFee, roundMoney } from './billing';
import { getOrderItemsTotal } from './totals';

export function getOnlinePaymentLabel(table: Table) {
  const payments = (table.payments || []).filter(payment => payment.status === 'active' && payment.id.startsWith('qr_qrpay_'));
  return [...new Set(payments.map(payment => payment.method === 'credit' ? 'Cartão de crédito' : payment.method === 'pix' ? 'Pix' : 'Pagamento online'))].join(' + ');
}

export function isOnlinePaidAwaitingConference(table: Table, serviceTax = 13) {
  if (!table.orders?.length || table.status === 'available') return false;
  const active = (table.payments || []).filter(payment => payment.status === 'active');
  if (!active.some(payment => payment.id.startsWith('qr_qrpay_'))) return false;
  const subtotal = getOrderItemsTotal(table.orders);
  const total = calculateBillTotal({ subtotal, serviceFee: calculateServiceFee(subtotal, serviceTax), discount: 0 });
  const received = roundMoney(active.reduce((sum, payment) => sum + payment.amount, 0));
  return total > 0 && received >= total;
}
