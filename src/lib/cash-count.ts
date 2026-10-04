export const CASH_DENOMINATIONS = [
  { key: 'note_200', label: 'R$ 200', cents: 20000, kind: 'note' },
  { key: 'note_100', label: 'R$ 100', cents: 10000, kind: 'note' },
  { key: 'note_50', label: 'R$ 50', cents: 5000, kind: 'note' },
  { key: 'note_20', label: 'R$ 20', cents: 2000, kind: 'note' },
  { key: 'note_10', label: 'R$ 10', cents: 1000, kind: 'note' },
  { key: 'note_5', label: 'R$ 5', cents: 500, kind: 'note' },
  { key: 'note_2', label: 'R$ 2', cents: 200, kind: 'note' },
  { key: 'coin_1', label: 'R$ 1', cents: 100, kind: 'coin' },
  { key: 'coin_50', label: '50¢', cents: 50, kind: 'coin' },
  { key: 'coin_25', label: '25¢', cents: 25, kind: 'coin' },
  { key: 'coin_10', label: '10¢', cents: 10, kind: 'coin' },
  { key: 'coin_5', label: '5¢', cents: 5, kind: 'coin' },
] as const;

export type CashCount = Record<(typeof CASH_DENOMINATIONS)[number]['key'], number>;

export const emptyCashCount = (): CashCount => Object.fromEntries(
  CASH_DENOMINATIONS.map(({ key }) => [key, 0]),
) as CashCount;

export const cashCountTotalCents = (count: CashCount): number => CASH_DENOMINATIONS.reduce(
  (total, denomination) => total + (count[denomination.key] || 0) * denomination.cents, 0,
);
