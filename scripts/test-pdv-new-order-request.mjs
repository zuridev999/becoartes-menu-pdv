import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pdvSource = readFileSync(new URL('../src/views/pdv/PDVView.tsx', import.meta.url), 'utf8');
const kitchenSource = readFileSync(new URL('../src/views/kitchen/KitchenView.tsx', import.meta.url), 'utf8');
const historyToggleSource = readFileSync(new URL('../src/components/pdv/RequestHistoryToggle.tsx', import.meta.url), 'utf8');
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
assert.match(pdvSource, /const pendingRequests = visibleRequests\.filter\(req => req\.status !== 'resolved'\)/, 'A fila principal deve conter apenas solicitações pendentes.');
assert.match(historyToggleSource, /Ver atendidos/, 'Solicitações concluídas devem ficar em um histórico recolhido.');
assert.match(kitchenSource, /Pronto para retirar/, 'O Bar deve oferecer a opção que avisa o PDV.');
assert.match(kitchenSource, /Já entregue ao cliente/, 'O Bar deve oferecer a opção que encerra sem alerta pendente.');
assert.match(kitchenSource, /updateKitchenOrderStatus\(selectedOrder\.id, 'ready', completionMode\)/, 'A escolha do Bar deve chegar ao backend.');

console.log('PDV and Bar order handoff regression: ok');
