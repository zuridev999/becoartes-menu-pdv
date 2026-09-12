import assert from 'node:assert/strict';
import {
  calculateServiceFee,
  clampServiceFeePercent,
  parseFlexibleDecimal,
} from '../src/lib/billing.ts';

assert.equal(parseFlexibleDecimal('7,12'), 7.12);
assert.equal(parseFlexibleDecimal('7.12'), 7.12);
assert.equal(parseFlexibleDecimal('1.234,56'), 1234.56);
assert.equal(parseFlexibleDecimal('1,234.56'), 1234.56);
assert.equal(calculateServiceFee(145.40, 7.12), 10.35);
assert.equal(calculateServiceFee(145.40, 13), 18.90);
assert.equal(clampServiceFeePercent(14), 13);
assert.equal(clampServiceFeePercent(14, Number.POSITIVE_INFINITY), 14);
assert.equal(Math.round((145.40 - 90.05) * 100) / 100, 55.35);
assert.equal(Math.round((90.05 + 65.70 - 145.40) * 100) / 100, 10.35);

console.log('Billing service fee tests passed.');
