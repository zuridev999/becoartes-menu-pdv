export const MAX_SERVICE_FEE_PERCENT = 13;

export const roundMoney = (value: number) => Number(value.toFixed(2));

export const clampServiceFeePercent = (value: number) => {
  if (!Number.isFinite(value)) return MAX_SERVICE_FEE_PERCENT;
  return Math.min(MAX_SERVICE_FEE_PERCENT, Math.max(0, value));
};

export const formatPercent = (value: number) => (
  Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
);

export const calculateServiceFee = (subtotal: number, serviceFeePercent: number) => (
  roundMoney(roundMoney(subtotal) * (clampServiceFeePercent(serviceFeePercent) / 100))
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
