import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const inline = html.match(/<script nonce="__CSP_NONCE__">([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline, 'Script inicial da página não encontrado.');
assert.doesNotMatch(app, /<GoogleAdBanner placement="operational-top"/);

function loadedScripts(hostname, pathname) {
  const appended = [];
  const listeners = new Map();
  const document = {
    documentElement: { classList: { add() {} } },
    head: { appendChild(element) { appended.push(element); } },
    createElement(tag) { assert.equal(tag, 'script'); return { dataset: {} }; },
    addEventListener() {},
    querySelector() { return { setAttribute() {} }; },
    title: '',
  };
  const window = {
    location: { hostname, pathname },
    addEventListener(type, callback) { listeners.set(type, callback); },
    setTimeout(callback) { callback(); },
  };
  vm.runInNewContext(inline, {
    document,
    window,
    localStorage: { getItem() { return null; } },
    navigator: {},
  });
  return { appended, listeners };
}

assert.equal(loadedScripts('pdv.becoartes.com', '/').appended.length, 0, 'PDV público não pode carregar AdSense global.');
assert.equal(loadedScripts('localhost', '/pdv').appended.length, 0, 'Rota /pdv não pode carregar AdSense global.');
assert.equal(loadedScripts('zordon.com.br', '/os/pdv/empresa').appended.length, 0, 'PDV Zordon não pode carregar AdSense global.');
const qr = loadedScripts('qr.becoartes.com', '/mesa/1');
assert.equal(qr.appended.length, 0, 'QR aguarda o cardápio ficar pronto.');
qr.listeners.get('beco:menu-ready')?.();
assert.equal(qr.appended.length, 1, 'QR preserva publicidade após abrir o cardápio.');
assert.equal(loadedScripts('delivery.becoartes.com', '/').appended.length, 1, 'Delivery continua com publicidade.');
console.log('PDV sem anúncios fixos/automáticos; QR e Delivery preservados.');
