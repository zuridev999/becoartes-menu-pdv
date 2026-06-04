import { APP_COMMIT, APP_VERSION, getAppLabel } from './version';

const MESSAGE_SOURCE = 'becoartes-pdv';
const OS_MESSAGE_SOURCE = 'becoartes-os';
const DEFAULT_OS_ORIGIN = 'https://os.becoartes.com';
const BRIDGE_VERSION = 1;

type BridgeMessage = {
  source?: string;
  version?: number;
  type?: string;
  payload?: unknown;
};

type AppView = 'tablet' | 'pdv' | 'admin' | 'kitchen' | 'qr' | 'delivery';
type AdminTab = 'config' | 'products' | 'categories' | 'optionals' | 'sellers' | 'movements' | 'finance' | 'qrcodes';
type AdminMode = 'menu' | 'settings';

export type OSBridgeCommand =
  | { type: 'context'; payload: { tenantSlug?: string; empresaId?: string; userId?: string } }
  | { type: 'sync'; payload?: { includeCatalog?: boolean } }
  | { type: 'refresh_catalog'; payload?: Record<string, never> }
  | { type: 'navigate'; payload: { view: AppView; tab?: AdminTab; mode?: AdminMode } };

export type OSBridgeEvent =
  | { type: 'ready'; payload: { view: AppView | ''; path: string } }
  | { type: 'bill_closed'; payload: { tableId: string; tableNumber: number; total: number; sellerId?: string; sellerName?: string; closedBillId: string; inventorySync?: unknown; closedAt: string } }
  | { type: 'table_alert'; payload: { tableId: string; tableNumber: number | string; alertType: string; message: string; createdAt: string } };

const configuredOrigins = (import.meta.env.VITE_OS_ALLOWED_ORIGINS || DEFAULT_OS_ORIGIN)
  .split(',')
  .map((origin: string) => origin.trim())
  .filter(Boolean);

export const OS_ALLOWED_ORIGINS = new Set(configuredOrigins);

const allowedViews = new Set<AppView>(['tablet', 'pdv', 'admin', 'kitchen', 'qr', 'delivery']);
const allowedTabs = new Set<AdminTab>(['config', 'products', 'categories', 'optionals', 'sellers', 'movements', 'finance', 'qrcodes']);
const allowedModes = new Set<AdminMode>(['menu', 'settings']);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const asString = (value: unknown, fallback = '') => (
  typeof value === 'string' ? value.slice(0, 500) : fallback
);

const asBoolean = (value: unknown) => value === true;

const asFiniteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeCommand = (message: BridgeMessage): OSBridgeCommand | null => {
  const payload = isRecord(message.payload) ? message.payload : {};

  if (message.type === 'context') {
    return {
      type: 'context',
      payload: {
        tenantSlug: asString(payload.tenantSlug),
        empresaId: asString(payload.empresaId),
        userId: asString(payload.userId),
      },
    };
  }

  if (message.type === 'sync') {
    return {
      type: 'sync',
      payload: { includeCatalog: asBoolean(payload.includeCatalog) },
    };
  }

  if (message.type === 'refresh_catalog') {
    return { type: 'refresh_catalog', payload: {} };
  }

  if (message.type === 'navigate') {
    const view = payload.view;
    if (typeof view !== 'string' || !allowedViews.has(view as AppView)) return null;
    const tab = typeof payload.tab === 'string' && allowedTabs.has(payload.tab as AdminTab)
      ? payload.tab as AdminTab
      : undefined;
    const mode = typeof payload.mode === 'string' && allowedModes.has(payload.mode as AdminMode)
      ? payload.mode as AdminMode
      : undefined;
    return { type: 'navigate', payload: { view: view as AppView, tab, mode } };
  }

  return null;
};

const sanitizeEventPayload = (event: OSBridgeEvent): OSBridgeEvent['payload'] => {
  const payload: Record<string, unknown> = isRecord(event.payload) ? event.payload : {};

  if (event.type === 'ready') {
    return {
      view: allowedViews.has(payload.view as AppView) ? payload.view as AppView : '',
      path: asString(payload.path || window.location.pathname, window.location.pathname),
    };
  }

  if (event.type === 'bill_closed') {
    return {
      tableId: asString(payload.tableId),
      tableNumber: asFiniteNumber(payload.tableNumber),
      total: asFiniteNumber(payload.total),
      sellerId: asString(payload.sellerId),
      sellerName: asString(payload.sellerName),
      closedBillId: asString(payload.closedBillId),
      inventorySync: payload.inventorySync,
      closedAt: asString(payload.closedAt, new Date().toISOString()),
    };
  }

  return {
    tableId: asString(payload.tableId),
    tableNumber: typeof payload.tableNumber === 'number' ? payload.tableNumber : asString(payload.tableNumber),
    alertType: asString(payload.alertType),
    message: asString(payload.message),
    createdAt: asString(payload.createdAt, new Date().toISOString()),
  };
};

export const isEmbeddedInOS = () => typeof window !== 'undefined' && window.parent !== window;

export const postOSMessage = <T extends OSBridgeEvent['type']>(
  type: T,
  payload: Extract<OSBridgeEvent, { type: T }>['payload']
) => {
  if (!isEmbeddedInOS()) return;

  const event = { type, payload } as OSBridgeEvent;
  const safePayload = sanitizeEventPayload(event);

  for (const origin of OS_ALLOWED_ORIGINS) {
    window.parent.postMessage({
      source: MESSAGE_SOURCE,
      version: BRIDGE_VERSION,
      type,
      payload: safePayload,
      app: {
        label: getAppLabel(),
        version: APP_VERSION,
        commit: APP_COMMIT,
        host: window.location.hostname,
        path: window.location.pathname,
      },
      sentAt: new Date().toISOString(),
    }, origin);
  }
};

export const subscribeOSMessages = (handler: (message: OSBridgeCommand, origin: string) => void) => {
  const onMessage = (event: MessageEvent<BridgeMessage>) => {
    if (!OS_ALLOWED_ORIGINS.has(event.origin)) return;
    if (isEmbeddedInOS() && event.source !== window.parent) return;
    if (event.data?.source !== OS_MESSAGE_SOURCE || !event.data.type) return;

    const command = sanitizeCommand(event.data);
    if (!command) return;

    handler(command, event.origin);
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
};
