import { assertSameOrigin, readJsonBody, sendJson } from '../http.mjs';
import { createHealthPayload } from '../health.mjs';

export const createApiHandler = ({
  db,
  startedAt,
  appVersion,
  appCommit,
  healthDbTimeoutMs,
  allowedWebOrigins,
  ensureDatabaseReady,
  handlers,
  isPinRateLimited,
  getSessionFromRequest,
  isOperationIpAllowed,
  isAdminSession,
  enforceRouteAccess,
}) => async (req, res, url) => {
  if (url.pathname === '/api/health') {
    const health = await createHealthPayload({
      db,
      startedAt,
      version: appVersion,
      commit: appCommit,
      dbTimeoutMs: healthDbTimeoutMs,
    });
    sendJson(res, health.ok ? 200 : 503, health);
    return;
  }

  try {
    await ensureDatabaseReady();
    assertSameOrigin(req, allowedWebOrigins);
    const routeKey = `${req.method} ${url.pathname}`;
    const handler = handlers[routeKey];
    if (!handler) {
      sendJson(res, 404, { ok: false, error: 'API route not found' });
      return;
    }

    if (isPinRateLimited(req, url.pathname)) {
      sendJson(res, 429, { ok: false, error: 'Muitas tentativas de PIN. Aguarde 1 minuto.' });
      return;
    }

    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json')) {
      sendJson(res, 415, { ok: false, error: 'Content-Type precisa ser application/json' });
      return;
    }

    const body = req.method === 'GET' ? {} : await readJsonBody(req);
    const session = getSessionFromRequest(req);
    const isLoginRoute = routeKey === 'POST /api/auth/login' || routeKey === 'POST /api/tablet/setup-login';
    // Login por PIN nunca deve herdar permissão de uma sessão antiga. Isso evita
    // que um token admin salvo no navegador libere PIN de colaborador fora da rede.
    const operationAccessAllowed = isOperationIpAllowed(req) || (!isLoginRoute && isAdminSession(session));
    await enforceRouteAccess(routeKey, body, session, { operationAccessAllowed, req });
    const data = await handler(body, { req, url, session, operationAccessAllowed, rawBody: req.rawBody || '' });
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    console.error('BFF error:', error);
    sendJson(res, error.statusCode || 400, { ok: false, error: error instanceof Error ? error.message : 'Erro interno' });
  }
};
