import { assertSameOrigin, readJsonBody, sendJson } from '../http.mjs';
import { createHealthPayload } from '../health.mjs';
import { randomUUID } from 'node:crypto';

const isTransientServiceError = (error) => /fetch failed|timeout|timed out|etimedout|econnreset|socket hang up/i.test(String(error?.message || error || ''));
const isExpectedClientError = (error) => (
  error instanceof SyntaxError
  || /inv[aá]lid|obrigat[oó]ri|n[aã]o encontrad|indispon[ií]vel|bloquead|j[aá] est[aá]|selecione|informe|digite|sem permiss[aã]o|acesso negado|saldo em aberto/i.test(String(error?.message || ''))
);

export const createApiHandler = ({
  db,
  startedAt,
  appVersion,
  appCommit,
  appBuildDate,
  healthDbTimeoutMs,
  allowedWebOrigins,
  ensureDatabaseReady,
  handlers,
  isPinRateLimited,
  getSessionFromRequest,
  isOperationIpAllowed,
  isAdminSession,
  enforceRouteAccess,
  assertCashOperationAllowed = async () => {},
  maxJsonBodyBytes = 2 * 1024 * 1024,
}) => async (req, res, url) => {
  if (url.pathname === '/api/health') {
    const health = await createHealthPayload({
      db,
      startedAt,
      version: appVersion,
      commit: appCommit,
      buildDate: appBuildDate,
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

    const body = req.method === 'GET' ? {} : await readJsonBody(req, { maxBytes: maxJsonBodyBytes });
    const session = getSessionFromRequest(req);
    const isLoginRoute = routeKey === 'POST /api/auth/login' || routeKey === 'POST /api/tablet/setup-login';
    const isTrustedTerminalSession = Boolean(session?.trustedTerminalId);
    // Login por PIN nunca deve herdar permissão de uma sessão antiga. Isso evita
    // que um token admin salvo no navegador libere PIN de colaborador fora da rede.
    const operationAccessAllowed = isOperationIpAllowed(req) || (!isLoginRoute && (isAdminSession(session) || isTrustedTerminalSession));
    await enforceRouteAccess(routeKey, body, session, { operationAccessAllowed, req });
    if (new Set([
      'POST /api/orders/send-to-kitchen',
      'POST /api/table-payments',
      'POST /api/table-payments/cancel',
      'POST /api/bills/close',
      'POST /api/counter-sales/close',
      'POST /api/tables/open',
      'POST /api/tables/transfer',
      'POST /api/tables/join',
    ]).has(routeKey)) {
      await assertCashOperationAllowed();
    }
    const data = await handler(body, { req, url, session, operationAccessAllowed, rawBody: req.rawBody || '' });
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    const requestId = randomUUID();
    const transient = isTransientServiceError(error);
    const status = Number(error?.statusCode || (transient ? 503 : isExpectedClientError(error) ? 400 : 500));
    console.error(JSON.stringify({
      event: 'bff_request_error',
      requestId,
      route: `${req.method} ${url.pathname}`,
      status,
      error: error instanceof Error ? error.message : String(error),
    }));
    sendJson(res, status, {
      ok: false,
      error: status >= 500 ? 'Serviço temporariamente indisponível.' : error instanceof Error ? error.message : 'Erro interno',
      requestId,
    });
  }
};
