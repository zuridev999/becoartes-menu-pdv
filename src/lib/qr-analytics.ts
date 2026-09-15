import { createId } from './id';

const QR_VISIT_STORAGE_KEY = 'beco_qr_visit';
const QR_SESSION_IDLE_MS = 30 * 60 * 1000;

type StoredQrVisit = {
  id: string;
  lastSeenAt: number;
};

const readStoredVisit = (): StoredQrVisit | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = JSON.parse(localStorage.getItem(QR_VISIT_STORAGE_KEY) || 'null') as StoredQrVisit | null;
    if (!value || typeof value.id !== 'string' || !Number.isFinite(value.lastSeenAt)) return null;
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(value.id)) return null;
    return value;
  } catch {
    return null;
  }
};

export const getQrVisitId = () => {
  const now = Date.now();
  const stored = readStoredVisit();
  const id = stored && now - stored.lastSeenAt <= QR_SESSION_IDLE_MS ? stored.id : createId();
  try {
    localStorage.setItem(QR_VISIT_STORAGE_KEY, JSON.stringify({ id, lastSeenAt: now }));
  } catch {
    // Sem persistência, a visita ainda pode ser medida enquanto a página estiver aberta.
  }
  return id;
};

