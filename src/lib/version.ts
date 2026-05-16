export const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'v1.0.0';
export const APP_COMMIT = import.meta.env.VITE_APP_COMMIT || '';

export const APP_BUILD_LABEL = APP_COMMIT
  ? `${APP_VERSION} • ${APP_COMMIT}`
  : APP_VERSION;
