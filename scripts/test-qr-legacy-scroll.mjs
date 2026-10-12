import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const qrView = fs.readFileSync(new URL('../src/views/qr/QRView.tsx', import.meta.url), 'utf8');
const menuCatalog = fs.readFileSync(new URL('../src/components/shared/MenuCatalog.tsx', import.meta.url), 'utf8');
const productModal = fs.readFileSync(new URL('../src/components/modals/ProductModal.tsx', import.meta.url), 'utf8');

assert.match(
  styles,
  /\.ios-touch-scroll\s*\{[\s\S]*?-webkit-overflow-scrolling:\s*touch;[\s\S]*?touch-action:\s*pan-y\s*!important;/,
  'A rolagem vertical precisa manter o impulso nativo em versões antigas do iOS.',
);
assert.match(
  styles,
  /\.ios-touch-scroll button,[\s\S]*?touch-action:\s*pan-y\s*!important;/,
  'O gesto vertical iniciado sobre um card clicável não pode ficar preso no botão.',
);
assert.match(
  styles,
  /\.qr-mobile-shell\s*\{[\s\S]*?100vh[\s\S]*?@supports \(height: 100dvh\)/,
  'O QR precisa de fallback 100vh antes de usar 100dvh.',
);
assert.equal(
  (qrView.match(/className="qr-mobile-shell flex/g) || []).length,
  2,
  'Os fluxos Mesa e Comanda precisam usar a altura compatível.',
);
assert.match(menuCatalog, /ios-touch-scroll flex-1 min-h-0/, 'O catálogo precisa aceitar arraste vertical em iPhones antigos.');
assert.match(productModal, /qrMobileFlow \? 'ios-touch-scroll/, 'Os adicionais do produto também precisam aceitar o arraste vertical.');

console.log('QR legacy iPhone scroll regression passed.');
