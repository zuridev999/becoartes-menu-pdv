import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isPublicMenuRoute } from '../src/lib/public-menu-route.ts';
import { resolvePageMetadata } from '../server/static-files.mjs';

assert.equal(isPublicMenuRoute('qr.becoartes.com', '/cardapio'), true);
assert.equal(isPublicMenuRoute('qr.becoartes.com', '/cardapio/'), true);
assert.equal(isPublicMenuRoute('localhost', '/qr/cardapio'), true);
assert.equal(isPublicMenuRoute('qr.becoartes.com', '/mesa/6'), false);
assert.equal(isPublicMenuRoute('pdv.becoartes.com', '/cardapio'), false);
assert.equal(resolvePageMetadata({ host: 'qr.becoartes.com', pathname: '/cardapio' }).canonical, 'https://qr.becoartes.com/cardapio');

const source = await readFile(new URL('../src/views/qr/PublicMenuView.tsx', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.match(indexHtml, /isPublicMenu\s*\? 'https:\/\/qr\.becoartes\.com\/cardapio'/);
assert.match(source, /<MenuCatalog[\s\S]*onProductSelect=\{setSelectedProduct\}/);
assert.doesNotMatch(source, /ProductModal|CustomerOrderModal|addToCart|sendToKitchen|currentTableId|setCurrentTableId|CustomerTabApi/);
assert.match(source, /publicMenuReadOnlyHint/);
console.log('Cardápio público: rota nominal, catálogo compartilhado e isolamento de pedidos validados.');
