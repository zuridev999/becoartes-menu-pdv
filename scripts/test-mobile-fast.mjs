import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { compactCatalogImages, createMenuImageHandler } from '../server/menu-images.mjs';

const image = await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#583073' } }).png().toBuffer();
const catalog = { menuItems: [{ id: 'test', image: `data:image/png;base64,${image.toString('base64')}` }, { id: 'external', image: 'https://example.com/photo.jpg' }] };
const compact = compactCatalogImages(catalog);
assert.match(catalog.menuItems[0].image, /^data:/, 'Original catalog must remain editable');
assert.match(compact.menuItems[0].image, /^\/menu-image\?product=test&v=/);
assert.equal(compact.menuItems[1].image, catalog.menuItems[1].image);
assert.ok(JSON.stringify(compact).length < JSON.stringify(catalog).length / 4);
const handler = createMenuImageHandler({ distDir: new URL('../public', import.meta.url).pathname, getCatalogData: async () => catalog });
const server = createServer((req, res) => void handler(req, res, new URL(req.url, 'http://localhost')));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const path = compact.menuItems[0].image + '&w=320';
  const response = await fetch(base + path);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  const optimized = Buffer.from(await response.arrayBuffer());
  assert.equal((await sharp(optimized).metadata()).width, 320);
  assert.ok(optimized.length < image.length);
  assert.equal((await fetch(base + path, { headers: { 'If-None-Match': response.headers.get('etag') } })).status, 304);
  assert.equal((await fetch(base + path, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base + path, { method: 'POST' })).status, 405);
  for (const query of ['product=missing', 'product=external', 'asset=https://example.com/x.png', 'asset=/images/../../package.json', 'asset=/images/../../package.json.png']) {
    assert.equal((await fetch(`${base}/menu-image?${query}`)).status, 404, query);
  }
  catalog.menuItems[0].image = catalog.menuItems[0].image.replace('image/png', 'image/jpeg');
  assert.doesNotMatch((await fetch(base + path)).headers.get('cache-control'), /immutable/, 'A stale hash cannot cache a changed image forever');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const account = await read('src/components/modals/CustomerAccountModal.tsx');
assert.doesNotMatch(account, /createPaymentLink|window\.location|canPayOnline|paymentOptions/);
assert.match(account, /QrPaymentPanel/);
assert.match(account, /calculateBillTotal/);
const qr = await read('src/views/qr/QRView.tsx');
assert.equal((qr.match(/className="qr-account-footer"/g) || []).length, 2);
assert.doesNotMatch(qr, /isInlineAdVisible|6\.5rem|sm:pb-28/);
const app = await read('src/App.tsx');
assert.match(app, /!isQrView && \(!animationFinished \|\| isLoading\)/);
assert.match(app, /preloadQrEntry\(\)/);
assert.match(qr, /if \(routeTableNumber && currentTable && !isTableAccessReady\)/, 'Do not remove table authorization');
const styles = await read('src/index.css');
assert.match(styles, /\.qr-mobile-shell\s*\{\s*height: 100vh/);
assert.doesNotMatch(styles, /position: fixed !important/);
console.log('Mobile fast: optimized images, cache, path safety, direct QR entry and inline payment panel passed.');
