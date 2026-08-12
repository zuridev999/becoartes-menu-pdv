import assert from 'node:assert/strict';
import { getOrderLocation } from '../src/lib/order-location.ts';

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

console.log(JSON.stringify({
  ok: true,
  covered: ['physical_table_primary', 'customer_tab_secondary', 'legacy_table_fallback', 'customer_tab_without_location'],
}, null, 2));
