import assert from 'node:assert/strict';

import {
  createRequestTimeoutSignal,
  operationalRequestError,
} from '../src/lib/request-timeout.ts';

assert.throws(() => createRequestTimeoutSignal(0), /inteiro positivo/);

const signal = createRequestTimeoutSignal(10);
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(signal.aborted, true);
assert.match(
  operationalRequestError(new DOMException('timeout', 'TimeoutError')),
  /demorou para responder/,
);
assert.equal(operationalRequestError(new Error('offline')), 'offline');

console.log(JSON.stringify({
  ok: true,
  covered: [
    'positive_timeout_contract',
    'read_timeout_abort',
    'operator_friendly_timeout_message',
    'original_network_error',
  ],
}, null, 2));
