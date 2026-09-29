import { createServer } from 'node:http';
import { sendJson } from './http.mjs';

export function startBffServer({ port, handleLio, handleApi, serveStatic }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (await handleLio(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    await serveStatic(req, res, url);
  }).listen(port, () => {
    console.log(`Becoartes PDV BFF listening on :${port}`);
  });
}
