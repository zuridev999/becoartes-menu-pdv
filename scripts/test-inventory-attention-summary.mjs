import assert from 'node:assert/strict';
import { summarizeInventoryAttention } from '../server/inventory/attention-summary.mjs';

const summary = summarizeInventoryAttention([
  'CACHAÇA 51 965ML (baixa não realizada: 0.051813 UN; unidade incompatível: UN -> ML; conversão do Produto Mestre necessária)',
  'CACHAÇA 51 965ML (baixa não realizada: 0.051813 UN; unidade incompatível: UN -> ML; conversão do Produto Mestre necessária)',
  'BATATA 2KG (baixa não realizada: 0.15 UN; unidade incompatível: UN -> G; conversão do Produto Mestre necessária)',
], 10);

assert.equal(summary.title, 'Conversão de estoque pendente no PDV');
assert.equal(summary.groups.length, 2, 'itens repetidos devem ser agrupados');
assert.match(summary.message, /CACHAÇA 51 965ML: 2 ocorrência/);
assert.match(summary.message, /0\.1036 UN não baixados/);
assert.match(summary.message, /a baixa não ocorreu/);

console.log('Inventory attention summary regression passed.');
