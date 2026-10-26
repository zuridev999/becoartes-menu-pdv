import type { Table } from '../types';
import { calculateBillTotal, calculateServiceFee, roundMoney } from './billing';
import { getOrderItemsTotal } from './totals';

export function isOnlinePaidAwaitingConference(table: Table, serviceTax = 13) {
  if (!table.orders?.length || table.status === 'available') return false;
  const active = (table.payments || []).filter(payment => payment.status === 'active');
  if (!active.some(payment => payment.id.startsWith('qr_qrpay_'))) return false;
  const subtotal = getOrderItemsTotal(table.orders);
  const total = calculateBillTotal({ subtotal, serviceFee: calculateServiceFee(subtotal, serviceTax), discount: 0 });
  const received = roundMoney(active.reduce((sum, payment) => sum + payment.amount, 0));
  return total > 0 && received >= total;
}
