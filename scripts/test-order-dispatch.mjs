import assert from 'node:assert/strict';
import test from 'node:test';
import { planOrderDispatch } from '../server/order-dispatch.mjs';

test('o envio padrão mantém cozinha, bar e aviso do pedido', () => {
  assert.deepEqual(planOrderDispatch({ origin: 'pdv' }), {
    targets: { kitchen: true, bar: true },
    skippedStations: [],
    orderStatus: 'pending',
    requestStatus: 'pending',
    sentToProduction: true,
  });
});

test('desmarcar cozinha mantém somente o preparo do bar', () => {
  const result = planOrderDispatch({
    origin: 'pdv',
    dispatchTargets: { kitchen: false, bar: true },
    presentStations: ['kitchen', 'bar'],
  });
  assert.deepEqual(result.skippedStations, ['kitchen']);
  assert.equal(result.orderStatus, 'pending');
  assert.equal(result.requestStatus, 'pending');
});

test('desmarcar bar mantém somente o preparo da cozinha e esconde o aviso do bar', () => {
  const result = planOrderDispatch({
    origin: 'pdv',
    dispatchTargets: { kitchen: true, bar: false },
    presentStations: ['kitchen', 'bar'],
  });
  assert.deepEqual(result.skippedStations, ['bar']);
  assert.equal(result.orderStatus, 'pending');
  assert.equal(result.requestStatus, 'suppressed');
});

test('desmarcar ambos registra a conta sem criar preparo pendente', () => {
  const result = planOrderDispatch({
    origin: 'pdv',
    dispatchTargets: { kitchen: false, bar: false },
    presentStations: ['kitchen', 'bar'],
  });
  assert.deepEqual(result.skippedStations, ['kitchen', 'bar']);
  assert.equal(result.orderStatus, 'ready');
  assert.equal(result.requestStatus, 'suppressed');
  assert.equal(result.sentToProduction, false);
});

test('quando só há comida e cozinha está desmarcada, não deixa pedido preso como pendente', () => {
  const result = planOrderDispatch({
    origin: 'pdv',
    dispatchTargets: { kitchen: false, bar: true },
    presentStations: ['kitchen'],
  });
  assert.equal(result.orderStatus, 'ready');
  assert.equal(result.sentToProduction, false);
  assert.equal(result.requestStatus, 'suppressed');
});

test('QR e tablet ignoram qualquer seleção enviada por engano', () => {
  for (const origin of ['qr', 'tablet']) {
    const result = planOrderDispatch({
      origin,
      dispatchTargets: { kitchen: false, bar: false },
      presentStations: ['kitchen', 'bar'],
    });
    assert.equal(result.orderStatus, 'pending');
    assert.deepEqual(result.skippedStations, []);
    assert.equal(result.requestStatus, 'pending');
  }
});
