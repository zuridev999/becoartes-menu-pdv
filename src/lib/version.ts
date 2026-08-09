export const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'v1.7.9';

export const APP_COMMIT = import.meta.env.VITE_APP_COMMIT || '';

export const APP_BUILD_LABEL = APP_COMMIT
  ? `${APP_VERSION} • ${APP_COMMIT}`
  : APP_VERSION;

export const getAppLabel = () => {
  if (typeof window === 'undefined') return 'PDV';
  const location = `${window.location.hostname}${window.location.pathname}`.toLowerCase();
  if (location.includes('tablet')) return 'Tablet';
  if (location.includes('/bar') || location.includes('bar.')) return 'Bar';
  if (location.includes('/kitchen') || location.includes('coz')) return 'Cozinha';
  if (location.includes('/qr') || location.includes('qr.')) return 'QR';
  return 'PDV';
};
