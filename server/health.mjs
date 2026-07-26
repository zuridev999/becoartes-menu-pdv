const withTimeout = (promise, timeoutMs, timeoutCode = 'timeout') => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(timeoutCode);
      error.code = timeoutCode;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
};

export const createHealthPayload = async ({
  db,
  startedAt,
  version,
  commit,
  buildDate,
  dbTimeoutMs,
  service = 'becoartes-operational-bff',
}) => {
  const checkedAt = new Date().toISOString();
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const dbStartedAt = performance.now();
  const dbStatus = {
    ok: false,
    latencyMs: null,
  };

  try {
    await withTimeout(db.execute('SELECT 1 AS ok'), dbTimeoutMs, 'db_timeout');
    dbStatus.ok = true;
    dbStatus.latencyMs = Math.round(performance.now() - dbStartedAt);
  } catch (error) {
    dbStatus.latencyMs = Math.round(performance.now() - dbStartedAt);
    dbStatus.error = error?.code === 'db_timeout' ? 'timeout' : 'unavailable';
  }

  const status = dbStatus.ok ? 'healthy' : 'degraded';
  return {
    ok: status === 'healthy',
    status,
    service,
    version,
    commit,
    buildDate,
    uptimeSeconds,
    startedAt: new Date(startedAt).toISOString(),
    checkedAt,
    db: dbStatus,
  };
};
