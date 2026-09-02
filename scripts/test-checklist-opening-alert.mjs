import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const handler = read('server/routes/handlers.mjs');
const bff = read('server/bff.mjs');
const component = read('src/components/common/ChecklistAlertDisplay.tsx');

assert.match(handler, /getChecklistAlertsFromOs\(context\.session\)/, 'O proxy precisa usar a sessão do operador atual.');
assert.ok(bff.includes("replace(/^os:/, '')"), 'O ID assinado pelo OS precisa ser normalizado.');
assert.match(bff, /searchParams\.set\('userId', sessionUserId\)/, 'O alerta deve consultar somente o usuário conectado.');
assert.match(component, /OPENING_VALIDATION_SNOOZE_MS = 5 \* 60 \* 1000/, 'O aviso deve retornar em cinco minutos.');
assert.match(component, /POLL_MS = 15 \* 1000/, 'A conclusão deve sumir rapidamente do PDV.');
assert.match(component, /role="alertdialog"/, 'O alerta individual precisa ocupar a atenção do operador.');
assert.match(component, /AudioContext/, 'O alerta precisa emitir sinal sonoro.');
assert.match(component, /Termine o checklist de abertura para validar seu ponto\./, 'A mensagem operacional precisa ser inequívoca.');

console.log('PDV opening checklist alert regression: OK');
