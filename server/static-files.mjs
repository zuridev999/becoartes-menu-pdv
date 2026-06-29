import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

export const createStaticHandler = ({ distDir, securityHeaders, mimeTypes }) => async (req, res, url) => {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(distDir, normalized);

  if (!existsSync(filePath) || normalized.endsWith('/') || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }

  const ext = extname(filePath);
  const headers = {
    ...securityHeaders,
    'content-type': mimeTypes[ext] || 'application/octet-stream',
  };

  if (filePath.endsWith('index.html')) {
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

    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  } catch {
    const fallback = await readFile(join(distDir, 'index.html'));
    res.writeHead(200, { ...securityHeaders, 'content-type': mimeTypes['.html'] });
    res.end(fallback);
  }
};
