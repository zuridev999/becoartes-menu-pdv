export type PublicTableAccessRefreshTarget = {
  tableId?: string;
  tableNumber?: number;
};

const INVALID_PUBLIC_TABLE_ACCESS_PATTERN = /token p[uú]blico da mesa inv[aá]lido ou ausente/i;
const PUBLIC_TABLE_BOOTSTRAP_PATHS = new Set(['/api/table-access-token', '/api/qr/resolve']);

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' ? value as Record<string, unknown> : null
);

export const getPublicTableAccessRefreshTarget = (body: unknown): PublicTableAccessRefreshTarget | null => {
  const payload = asRecord(body);
  if (!payload || payload.origin !== 'qr') return null;

  const tableId = String(payload.sourceTableId || payload.tableId || '').trim();
  const rawTableNumber = Number(payload.sourceTableNumber || payload.tableNumber || 0);
  const tableNumber = Number.isInteger(rawTableNumber) && rawTableNumber > 0 ? rawTableNumber : undefined;
  if (!tableId && !tableNumber) return null;

  return {
    ...(tableId ? { tableId } : {}),
    ...(tableNumber ? { tableNumber } : {}),
  };
};

export const shouldRefreshPublicTableAccess = ({
  path,
  status,
  error,
  body,
}: {
  path: string;
  status: number;
  error?: string;
  body: unknown;
}) => (
  status === 401
  && !PUBLIC_TABLE_BOOTSTRAP_PATHS.has(path)
  && INVALID_PUBLIC_TABLE_ACCESS_PATTERN.test(String(error || ''))
  && Boolean(getPublicTableAccessRefreshTarget(body))
);
