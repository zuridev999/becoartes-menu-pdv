import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/shared/QrPaymentPanel.tsx', 'utf8');
const copy = readFileSync('src/lib/public-payment-copy.ts', 'utf8');

assert.match(panel, /method: 'pix'/, 'QR payment creation must remain Pix-only');
assert.doesNotMatch(panel, /CreditCard|encryptCard|setMethod\('credit'\)|paymentCardNumber|paymentPayAmount/,
  'Customer QR must not expose or prepare a credit-card payment');
assert.doesNotMatch(panel, /\['pix', 'credit'\]/,
  'Customer QR must not render a Pix/credit selector');

for (const expected of ['"paymentStart": "Pague via Pix"', '"paymentTitle": "Pague via Pix"',
  '"paymentStart": "Pay with Pix"', '"paymentTitle": "Pay with Pix"',
  '"paymentStart": "Paga con Pix"', '"paymentTitle": "Paga con Pix"',
  '"paymentStart": "Payer par Pix"', '"paymentTitle": "Payer par Pix"']) {
  assert.ok(copy.includes(expected), `Missing Pix-only customer copy: ${expected}`);
}

for (const forbidden of ['Pix ou cartão', 'Pix or card', 'Pix o tarjeta', 'Pix ou carte',
  'escolher cartão', 'choose card', 'elegir tarjeta', 'choisir la carte']) {
  assert.ok(!copy.includes(forbidden), `Customer copy still offers card: ${forbidden}`);
}

console.log('QR Pix-only UI: no credit-card controls or offers; Pix copy validated in four languages.');
