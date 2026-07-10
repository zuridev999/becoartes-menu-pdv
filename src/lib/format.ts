const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatCurrency = (value: number | null | undefined) => (
  currencyFormatter.format(Number.isFinite(Number(value)) ? Number(value) : 0)
);
