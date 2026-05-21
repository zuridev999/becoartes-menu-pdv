const MESSAGE_SOURCE = 'becoartes-pdv';
const OS_MESSAGE_SOURCE = 'becoartes-os';
const DEFAULT_OS_ORIGIN = 'https://os.becoartes.com';

type BridgeMessage = {
  source?: string;
  type?: string;
  payload?: unknown;
};

export type OSBridgeCommand =
  | { type: 'context'; payload: { tenantSlug?: string; empresaId?: string; userId?: string } }
  | { type: 'sync'; payload?: { includeCatalog?: boolean } }
  | { type: 'refresh_catalog'; payload?: Record<string, never> }
  | { type: 'navigate'; payload?: { view?: 'tablet' | 'pdv' | 'admin' | 'kitchen' | 'qr'; tab?: 'config' | 'products' | 'categories' | 'optionals' | 'sellers' | 'movements' | 'finance'; mode?: 'menu' | 'settings' } };

const configuredOrigins = (import.meta.env.VITE_OS_ALLOWED_ORIGINS || DEFAULT_OS_ORIGIN)
  .split(',')
  .map((origin: string) => origin.trim())
  .filter(Boolean);

export const OS_ALLOWED_ORIGINS = new Set(configuredOrigins);

export const isEmbeddedInOS = () => window.parent !== window;

export const postOSMessage = (type: string, payload: unknown = {}) => {
  if (!isEmbeddedInOS()) return;

  for (const origin of OS_ALLOWED_ORIGINS) {
    window.parent.postMessage({
      source: MESSAGE_SOURCE,
      version: 1,
      type,
      payload
    }, origin);
  }
};

export const subscribeOSMessages = (handler: (message: OSBridgeCommand, origin: string) => void) => {
  const onMessage = (event: MessageEvent<BridgeMessage>) => {
    if (!OS_ALLOWED_ORIGINS.has(event.origin)) return;
    if (event.data?.source !== OS_MESSAGE_SOURCE || !event.data.type) return;

    handler(event.data as OSBridgeCommand, event.origin);
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
};
