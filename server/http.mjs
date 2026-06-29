export const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  req.rawBody = raw;
  if (!raw.trim()) return {};
  return JSON.parse(raw);
};

export const sendJson = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
};

export const assertSameOrigin = (req, allowedWebOrigins = []) => {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host;
  if (!host) throw new Error('Host ausente.');
  const expectedHttp = `http://${host}`;
  const expectedHttps = `https://${host}`;
  if (origin !== expectedHttp && origin !== expectedHttps && !allowedWebOrigins.includes(origin)) {
    throw new Error('Origem não autorizada.');
  }
};
