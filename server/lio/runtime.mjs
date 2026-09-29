import { createLioService } from './service.mjs';
import { createLioHandler } from './http.mjs';

export async function createLioRuntime({ db, secret, pdv, getSessionFromRequest, isAdminSession }) {
  const enabled = process.env.LIO_ENABLED === '1';
  if (enabled) {
    // Fail at startup when activation precedes the explicit additive migration.
    await db.execute('SELECT id FROM lio_devices LIMIT 0');
  }
  const service = enabled ? createLioService({ db, secret, pdv }) : null;
  const handle = createLioHandler({ service, getSessionFromRequest, isAdminSession, enabled });
  return { service, handle };
}
