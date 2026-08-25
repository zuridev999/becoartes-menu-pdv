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

export const createStaticHandler = ({ distDir, securityHeaders, mimeTypes }) => async (req, res, url) => {
  let pathname = decodeURIComponent(url.pathname);
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
      res.end(html.replaceAll('__CSP_NONCE__', htmlNonce));
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
    res.end(fallback.replaceAll('__CSP_NONCE__', htmlSecurity.nonce));
  }
};
