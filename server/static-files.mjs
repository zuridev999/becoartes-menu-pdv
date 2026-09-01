import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const createHtmlSecurityHeaders = (securityHeaders) => {
  const nonce = randomBytes(16).toString('base64');
  return {
    nonce,
    headers: {
      ...securityHeaders,
      'content-security-policy': `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' 'unsafe-eval' https: http:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https: wss:; frame-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors https://os.becoartes.com`,
    },
  };
};

const normalizeHost = (host = '') => host.split(':')[0].trim().toLowerCase();

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export const resolvePageMetadata = ({ host, pathname }) => {
  const hostname = normalizeHost(host);
  const tableMatch = hostname === 'qr.becoartes.com'
    ? pathname.match(/^\/mesa\/(\d+)\/?$/)
    : null;

  if (tableMatch) {
    const tableNumber = Number(tableMatch[1]);
    return {
      title: `Cardápio Becoartes | Mesa ${tableNumber}`,
      description: `Cardápio digital Becoartes da Mesa ${tableNumber}. Consulte pratos, bebidas e acompanhe sua comanda.`,
      canonical: `https://qr.becoartes.com/mesa/${tableNumber}`,
      robots: 'index,follow,max-image-preview:large',
      fallback: `Cardápio digital Becoartes da Mesa ${tableNumber}. Ative o JavaScript para consultar o cardápio e sua comanda.`,
    };
  }

  if (hostname === 'qr.becoartes.com') {
    return {
      title: 'Cardápio Becoartes',
      description: 'Cardápio digital Becoartes. Escaneie o QR code identificado na mesa para consultar e pedir.',
      canonical: 'https://qr.becoartes.com/',
      robots: 'index,follow,max-image-preview:large',
      fallback: 'Cardápio digital Becoartes. Escaneie o QR code identificado na mesa para acessar.',
    };
  }

  return {
    title: 'Becoartes PDV',
    description: 'Sistema operacional Becoartes.',
    canonical: `https://${hostname || 'pdv.becoartes.com'}/`,
    robots: 'noindex,nofollow',
    fallback: 'Ative o JavaScript para acessar o sistema Becoartes.',
  };
};

export const applyPageMetadata = (html, requestContext) => {
  const metadata = resolvePageMetadata(requestContext);
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(metadata.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escapeHtml(metadata.description)}" />`)
    .replace(/<meta name="robots"[^>]*>/, `<meta name="robots" content="${escapeHtml(metadata.robots)}" />`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${escapeHtml(metadata.canonical)}" />`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>${escapeHtml(metadata.fallback)}</noscript>`);
};

export const createQrRobotsTxt = () => [
  'User-agent: *',
  'Allow: /',
  '',
  'User-agent: Mediapartners-Google',
  'Allow: /',
  '',
  'User-agent: Google-Display-Ads-Bot',
  'Allow: /',
  '',
  'Sitemap: https://qr.becoartes.com/sitemap.xml',
  '',
].join('\n');

export const createQrSitemap = (tableNumbers = Array.from({ length: 50 }, (_, index) => index + 1)) => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...tableNumbers.map((tableNumber) => `  <url><loc>https://qr.becoartes.com/mesa/${tableNumber}</loc></url>`),
  '</urlset>',
  '',
].join('\n');

export const createStaticHandler = ({ distDir, securityHeaders, mimeTypes }) => async (req, res, url) => {
  let pathname = decodeURIComponent(url.pathname);
  const hostname = normalizeHost(req.headers.host);

  if (pathname === '/robots.txt') {
    const body = hostname === 'qr.becoartes.com'
      ? createQrRobotsTxt()
      : 'User-agent: *\nDisallow: /\n';
    res.writeHead(200, {
      ...securityHeaders,
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    });
    res.end(body);
    return;
  }

  if (pathname === '/sitemap.xml') {
    if (hostname !== 'qr.becoartes.com') {
      res.writeHead(404, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      ...securityHeaders,
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    });
    res.end(createQrSitemap());
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(distDir, normalized);

  if (!existsSync(filePath) || normalized.endsWith('/') || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }

  const ext = extname(filePath);
  let headers = {
    ...securityHeaders,
    'content-type': mimeTypes[ext] || 'application/octet-stream',
  };
  let htmlNonce = '';

  if (filePath.endsWith('index.html')) {
    const htmlSecurity = createHtmlSecurityHeaders(securityHeaders);
    htmlNonce = htmlSecurity.nonce;
    headers = {
      ...htmlSecurity.headers,
      'content-type': mimeTypes['.html'],
    };
    headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
  } else {
    headers['cache-control'] = 'public, max-age=31536000, immutable';
  }

  try {
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    if (htmlNonce) {
      const html = await readFile(filePath, 'utf8');
      res.writeHead(200, headers);
      res.end(applyPageMetadata(html.replaceAll('__CSP_NONCE__', htmlNonce), {
        host: req.headers.host,
        pathname: url.pathname,
      }));
      return;
    }

    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  } catch {
    const htmlSecurity = createHtmlSecurityHeaders(securityHeaders);
    const fallback = await readFile(join(distDir, 'index.html'), 'utf8');
    res.writeHead(200, {
      ...htmlSecurity.headers,
      'content-type': mimeTypes['.html'],
      'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    });
    res.end(applyPageMetadata(fallback.replaceAll('__CSP_NONCE__', htmlSecurity.nonce), {
      host: req.headers.host,
      pathname: url.pathname,
    }));
  }
};
