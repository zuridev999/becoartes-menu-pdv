import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';

const fingerprint = (source) => createHash('sha256').update(source).digest('hex').slice(0, 20);
const inlineImage = /^data:image\/(png|jpeg|jpg|webp);base64,/i;

// Only the response changes: original images and editable catalog remain intact.
export function compactCatalogImages(catalog) {
  if (!catalog) return catalog;
  return { ...catalog, menuItems: catalog.menuItems.map((item) => ({
    ...item,
    image: inlineImage.test(item.image || '')
      ? `/menu-image?product=${encodeURIComponent(item.id)}&v=${fingerprint(item.image)}`
      : item.image,
  })) };
}

export function createMenuImageHandler({ distDir, getCatalogData }) {
  const cache = new Map();
  const pending = new Map();
  let bytes = 0;
  let running = 0;
  const queue = [];
  const transform = async (source, width) => {
    if (running >= 3) await new Promise(resolve => queue.push(resolve));
    else running += 1;
    try {
      const input = typeof source === 'string' ? await readFile(source) : source;
      return await sharp(input, { limitInputPixels: 24_000_000 }).rotate()
        .resize({ width, withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
    } finally {
      const next = queue.shift();
      if (next) next(); else running -= 1;
    }
  };
  return async (req, res, url) => {
    if (url.pathname !== '/menu-image') return false;
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true;
    }
    try {
      let source;
      let version;
      const productId = url.searchParams.get('product');
      if (productId) {
        const item = (await getCatalogData()).menuItems.find((entry) => String(entry.id) === productId);
        if (!inlineImage.test(item?.image || '') || item.image.length > 16 * 1024 * 1024) throw new Error('Invalid image');
        source = Buffer.from(item.image.split(',')[1], 'base64');
        version = fingerprint(item.image);
      } else {
        // No arbitrary file paths or outbound requests (SSRF).
        const asset = url.searchParams.get('asset') || '';
        if (!/^\/(images|slideshow)\/[\w/ .%-]+\.(png|jpe?g|webp)$/i.test(asset)) throw new Error('Invalid asset');
        const root = await realpath(distDir);
        const path = await realpath(resolve(root, `.${asset}`));
        if (!path.startsWith(root + sep)) throw new Error('Invalid path');
        const info = await stat(path);
        if (info.size > 12 * 1024 * 1024) throw new Error('Image too large');
        version = fingerprint(`${path}:${info.size}:${info.mtimeMs}`);
        source = path;
      }
      const requestedWidth = Number(url.searchParams.get('w') || 640);
      const width = [320, 640, 960].includes(requestedWidth) ? requestedWidth : 640;
      const key = `${version}-${width}`;
      let output = cache.get(key);
      if (!output) {
        if (!pending.has(key)) {
          if (pending.size >= 32) {
            res.writeHead(503, { 'Retry-After': '1', 'Cache-Control': 'no-store' }); res.end(); return true;
          }
          const task = transform(source, width);
          pending.set(key, task);
        }
        try { output = await pending.get(key); } finally { pending.delete(key); }
        if (!cache.has(key)) {
          while (cache.size && (bytes + output.length > 32 * 1024 * 1024 || cache.size >= 160)) {
            const oldest = cache.keys().next().value;
            bytes -= cache.get(oldest).length; cache.delete(oldest);
          }
          cache.set(key, output); bytes += output.length;
        }
      }
      const headers = { 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff', ETag: `"${key}"`,
        'Cache-Control': productId && url.searchParams.get('v') === version
          ? 'public, max-age=31536000, immutable' : 'public, max-age=300' };
      if (req.headers['if-none-match'] === headers.ETag) { res.writeHead(304, headers); res.end(); return true; }
      res.writeHead(200, { ...headers, 'Content-Length': output.length });
      res.end(req.method === 'HEAD' ? undefined : output);
    } catch {
      res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end();
    }
    return true;
  };
}
