import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cashDenominationsCents, countCashCents } from '../server/cash-count.mjs';

const zero = Object.fromEntries(Object.keys(cashDenominationsCents).map(key => [key, 0]));
assert.equal(countCashCents(zero), 0);
assert.equal(countCashCents({ ...zero, note_200: 1, note_2: 3, coin_50: 1, coin_25: 2 }), 20700);
assert.equal(countCashCents({ ...zero, coin_1_cent: 0 }), 0, 'Cached clients may send a zero 1¢ count');
assert.throws(() => countCashCents({ ...zero, coin_1_cent: 1 }));
for (const invalid of [
  { ...zero, note_2: -1 },
  { ...zero, note_2: 1.5 },
  { ...zero, note_2: '2' },
  { ...zero, note_2: 10001 },
  { ...zero, extra: 1 },
]) assert.throws(() => countCashCents(invalid));
assert.throws(() => countCashCents({ note_2: 1 }));

const pdvView = readFileSync(new URL('../src/views/pdv/PDVView.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(pdvView, /cashCountTouched/, 'untouched zero count must remain valid at close');
assert.match(pdvView, /cashCountTotalCents\(cashCount\)/, 'close must use the denomination total, including zero');

console.log('cash count: denominations, zero-default close, cents precision and invalid quantities passed');
