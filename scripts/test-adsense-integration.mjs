import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyPageMetadata,
  createQrRobotsTxt,
  createQrSitemap,
  resolvePageMetadata,
} from '../server/static-files.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [indexHtml, component, nginx, staticFiles, viteConfig, adsTxt, qrView, deliveryView, app, serviceWorker] = await Promise.all([
  read('index.html'),
  read('src/components/common/GoogleAdBanner.tsx'),
  read('nginx.conf'),
  read('server/static-files.mjs'),
  read('vite.config.ts'),
  read('public/ads.txt'),
  read('src/views/qr/QRView.tsx'),
  read('src/views/delivery/DeliveryView.tsx'),
  read('src/App.tsx'),
  read('public/sw.js'),
]);

assert.match(indexHtml, /<meta name="google-adsense-account" content="ca-pub-8099608758666537"/);
assert.match(indexHtml, /id="becoartes-adsense-script"[\s\S]*pagead2\.googlesyndication\.com/);
assert.equal((indexHtml.match(/nonce="__CSP_NONCE__"/g) || []).length, 3);
assert.doesNotMatch(component, /document\.createElement\(['"]script['"]\)/);
assert.match(component, /data-ad-render-status/);
assert.match(component, /unfill-optimized/);
assert.match(component, /--beco-mobile-ad-height/);
assert.match(component, /operational-top/);
assert.doesNotMatch(component, /relative h-0 w-full overflow-hidden/);
assert.doesNotMatch(component, /AD_STATUS_TIMEOUT_MS/);
assert.match(component, /min-h-\[50px\]/);
assert.doesNotMatch(component, /min-h-11/);
assert.match(nginx, /script-src 'nonce-\$request_id' 'strict-dynamic'/);
assert.match(nginx, /sub_filter '__CSP_NONCE__' \$request_id/);
assert.match(nginx, /frame-src 'self' https:/);
assert.match(nginx, /location = \/ads\.txt/);
assert.match(staticFiles, /randomBytes\(16\)\.toString\('base64'\)/);
assert.match(staticFiles, /script-src 'nonce-\$\{nonce\}' 'strict-dynamic'/);
assert.match(staticFiles, /replaceAll\('__CSP_NONCE__', htmlNonce\)/);
assert.match(staticFiles, /replaceAll\('__CSP_NONCE__', htmlSecurity\.nonce\)/);
assert.match(viteConfig, /name: 'becoartes-csp-nonce-placeholder'/);
assert.match(viteConfig, /order: 'post'/);
assert.match(viteConfig, /<script nonce="__CSP_NONCE__"/);
assert.equal(adsTxt.trim(), 'google.com, pub-8099608758666537, DIRECT, f08c47fec0942fa0');
assert.match(qrView, /var\(--beco-mobile-ad-height, 0px\)/);
assert.match(deliveryView, /var\(--beco-mobile-ad-height, 0px\)/);
assert.match(app, /placement="top"/);
assert.match(app, /placement="operational-top"/);
assert.match(app, /const isQrView = activeView === 'qr'/);
assert.match(app, /activeView === 'pdv'/);
assert.match(app, /placement="mobile-bottom"/);
assert.match(app, /placement="operational-bottom"/);
assert.doesNotMatch(app, /activeView === 'qr' && <GoogleAdBanner placement="mobile-bottom"/);
assert.match(serviceWorker, /requestUrl\.origin !== self\.location\.origin/);
assert.match(serviceWorker, /becoartes-kiosk-v1\.9\.9/);
assert.match(staticFiles, /resolvePageMetadata/);
assert.match(staticFiles, /Cardápio Becoartes \| Mesa/);
assert.match(staticFiles, /Mediapartners-Google/);
assert.match(staticFiles, /Google-Display-Ads-Bot/);
assert.match(staticFiles, /createQrSitemap/);
assert.match(indexHtml, /<meta name="description"/);
assert.match(indexHtml, /<meta name="robots"/);
assert.match(indexHtml, /<link rel="canonical"/);

const tableMetadata = resolvePageMetadata({ host: 'qr.becoartes.com', pathname: '/mesa/22' });
assert.equal(tableMetadata.title, 'Cardápio Becoartes | Mesa 22');
assert.equal(tableMetadata.canonical, 'https://qr.becoartes.com/mesa/22');
assert.equal(tableMetadata.robots, 'index,follow,max-image-preview:large');

const tableHtml = applyPageMetadata(indexHtml, { host: 'qr.becoartes.com', pathname: '/mesa/22' });
assert.match(tableHtml, /<title>Cardápio Becoartes \| Mesa 22<\/title>/);
assert.match(tableHtml, /<link rel="canonical" href="https:\/\/qr\.becoartes\.com\/mesa\/22" \/>/);
assert.match(tableHtml, /<meta name="robots" content="index,follow,max-image-preview:large" \/>/);
assert.match(tableHtml, /Cardápio digital Becoartes da Mesa 22/);

const qrRobots = createQrRobotsTxt();
assert.match(qrRobots, /User-agent: Mediapartners-Google\nAllow: \//);
assert.match(qrRobots, /Sitemap: https:\/\/qr\.becoartes\.com\/sitemap\.xml/);

const qrSitemap = createQrSitemap();
assert.equal((qrSitemap.match(/<url>/g) || []).length, 50);
assert.match(qrSitemap, /<loc>https:\/\/qr\.becoartes\.com\/mesa\/22<\/loc>/);
assert.doesNotMatch(qrSitemap, /mesa\/51/);

console.log('AdSense operacional: integração, CSP, ads.txt e proteção de layout validados.');
