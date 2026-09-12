export const MAX_SERVICE_FEE_PERCENT = 13;

export const roundMoney = (value: number) => Number(value.toFixed(2));

export const parseFlexibleDecimal = (value: string | number | null | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return null;
  const normalized = raw.includes(',') && raw.includes('.')
    ? (raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, ''))
    : raw.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const clampServiceFeePercent = (value: number, max = MAX_SERVICE_FEE_PERCENT) => {
  const safeMax = Number.isFinite(max) ? Math.max(0, max) : Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(value)) return safeMax;
  return Math.min(safeMax, Math.max(0, value));
};

export const formatPercent = (value: number) => (
  Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
);

export const calculateServiceFee = (subtotal: number, serviceFeePercent: number, maxPercent = MAX_SERVICE_FEE_PERCENT) => (
  roundMoney(roundMoney(subtotal) * (clampServiceFeePercent(serviceFeePercent, maxPercent) / 100))
);

export const calculateBillTotal = ({
  subtotal,
  serviceFee,
  discount,
}: {
  subtotal: number;
  serviceFee: number;
  discount: number;
}) => roundMoney(Math.max(0, roundMoney(subtotal) + roundMoney(serviceFee) - roundMoney(discount)));
