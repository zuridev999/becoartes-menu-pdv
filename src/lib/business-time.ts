export const DEFAULT_BUSINESS_TIME_ZONE = 'America/Sao_Paulo';
export const BUSINESS_TIME_ZONE = import.meta.env.VITE_BUSINESS_TIME_ZONE || DEFAULT_BUSINESS_TIME_ZONE;

export function businessDateKey(date: Date | string | number = new Date()) {
  const parsed = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function businessWeekday(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}
