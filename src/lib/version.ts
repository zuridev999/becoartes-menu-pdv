export const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'v1.4.23';

export const APP_COMMIT = import.meta.env.VITE_APP_COMMIT || '';

export const APP_BUILD_LABEL = APP_COMMIT
  ? `${APP_VERSION} • ${APP_COMMIT}`
  : APP_VERSION;

export const getAppLabel = () => {
  if (typeof window === 'undefined') return 'PDV';
  const host = window.location.hostname;
  if (host.includes('tablet')) return 'Tablet';
  if (host.includes('coz')) return 'Cozinha';
  if (host.includes('bar')) return 'Bar';
  if (host.includes('qr')) return 'QR';
  return 'PDV';
};
