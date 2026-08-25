import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [indexHtml, component, nginx, adsTxt, qrView, deliveryView, app] = await Promise.all([
  read('index.html'),
  read('src/components/common/GoogleAdBanner.tsx'),
  read('nginx.conf'),
  read('public/ads.txt'),
  read('src/views/qr/QRView.tsx'),
  read('src/views/delivery/DeliveryView.tsx'),
  read('src/App.tsx'),
]);

assert.match(indexHtml, /<meta name="google-adsense-account" content="ca-pub-8099608758666537"/);
assert.match(indexHtml, /id="becoartes-adsense-script"[\s\S]*pagead2\.googlesyndication\.com/);
assert.equal((indexHtml.match(/nonce="__CSP_NONCE__"/g) || []).length, 3);
assert.doesNotMatch(component, /document\.createElement\(['"]script['"]\)/);
assert.match(component, /data-ad-render-status/);
assert.match(component, /unfill-optimized/);
assert.match(component, /--beco-mobile-ad-height/);
assert.match(component, /relative h-0 w-full overflow-hidden/);
assert.doesNotMatch(component, /min-h-11/);
assert.match(nginx, /script-src 'nonce-\$request_id' 'strict-dynamic'/);
assert.match(nginx, /sub_filter '__CSP_NONCE__' \$request_id/);
assert.match(nginx, /frame-src 'self' https:/);
assert.match(nginx, /location = \/ads\.txt/);
assert.equal(adsTxt.trim(), 'google.com, pub-8099608758666537, DIRECT, f08c47fec0942fa0');
assert.match(qrView, /var\(--beco-mobile-ad-height, 0px\)/);
assert.match(deliveryView, /var\(--beco-mobile-ad-height, 0px\)/);
assert.match(app, /placement="top"/);
assert.match(app, /placement="mobile-bottom"/);
assert.match(app, /placement="operational-bottom"/);

console.log('AdSense operacional: integração, CSP, ads.txt e proteção de layout validados.');
