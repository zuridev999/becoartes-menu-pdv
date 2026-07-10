import assert from 'node:assert/strict';
import { businessDateKey, resolveBusinessTimeZone } from '../server/business-time.mjs';

assert.equal(resolveBusinessTimeZone('America/Sao_Paulo'), 'America/Sao_Paulo');
assert.equal(resolveBusinessTimeZone('Fuso/Invalido'), 'America/Sao_Paulo');
assert.equal(businessDateKey('2026-07-10T02:30:00.000Z', 'America/Sao_Paulo'), '2026-07-09');
assert.equal(businessDateKey('2026-07-10T03:30:00.000Z', 'America/Sao_Paulo'), '2026-07-10');

console.log(JSON.stringify({ ok: true, covered: ['timezone_config', 'virada_dia_sao_paulo'] }, null, 2));
