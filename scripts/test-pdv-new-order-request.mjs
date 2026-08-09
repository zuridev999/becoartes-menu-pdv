import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pdvSource = readFileSync(new URL('../src/views/pdv/PDVView.tsx', import.meta.url), 'utf8');
const requestDetails = pdvSource.match(
  /<OrderItemDetails\s+[\s\S]*?items=\{req\.items\}[\s\S]*?\/>/,
)?.[0] || '';

assert.match(
  requestDetails,
  /maxItems=\{req\.type === 'new_order' \? req\.items\?\.length : undefined\}/,
  'Novas solicitações devem mostrar todos os itens do pedido novo.',
);
assert.match(
  requestDetails,
  /maxModifiers=\{req\.type === 'new_order' \? Number\.POSITIVE_INFINITY : undefined\}/,
  'Novas solicitações devem mostrar todas as escolhas do pedido novo.',
);
assert.doesNotMatch(
  requestDetails,
  /table\.orders|table\.cart/,
  'O cartão deve usar somente os itens da solicitação, sem acumular a mesa.',
);

console.log('PDV new order request regression: ok');
