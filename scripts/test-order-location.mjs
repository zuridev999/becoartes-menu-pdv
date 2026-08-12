import assert from 'node:assert/strict';
import { getOrderLocation, preserveCurrentQrTable } from '../src/lib/order-location.ts';

assert.deepEqual(
  getOrderLocation({
    tableNumber: 54,
    sourceTableNumber: 15,
    customerTabId: 'tab-1',
    customerTabNumber: 54,
  }),
  {
    primary: 'Mesa 15',
    secondary: 'Comanda 54',
    compact: 'Mesa 15 • Comanda 54',
  },
);

assert.equal(getOrderLocation({ tableNumber: 15 }).compact, 'Mesa 15');
assert.equal(
  getOrderLocation({ tableNumber: 54, customerTabId: 'tab-1' }).compact,
  'Comanda 54 • Sem mesa',
);

const currentCommand = { id: 'table-51', number: 51, status: 'ordering', orders: [{ id: 'order-1' }] };
assert.deepEqual(
  preserveCurrentQrTable([{ id: 'table-1', number: 1, status: 'available' }], [currentCommand], 'table-51', 'qr'),
  [{ id: 'table-1', number: 1, status: 'available' }, currentCommand],
  'a sincronização pública não deve apagar a comanda autorizada do cliente',
);
assert.deepEqual(
  preserveCurrentQrTable([{ id: 'table-51', number: 51, status: 'available' }], [currentCommand], 'table-51', 'qr'),
  [currentCommand],
  'o snapshot público genérico não deve sobrescrever a conta já autorizada',
);

console.log(JSON.stringify({
  ok: true,
  covered: ['physical_table_primary', 'customer_tab_secondary', 'legacy_table_fallback', 'customer_tab_without_location', 'authorized_qr_table_preserved'],
}, null, 2));
