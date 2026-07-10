export const DEFAULT_BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

export const resolveBusinessTimeZone = (value) => {
  const candidate = String(value || '').trim() || DEFAULT_BUSINESS_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_BUSINESS_TIME_ZONE;
  }
};

export const businessDateKey = (date = new Date(), timeZone = DEFAULT_BUSINESS_TIME_ZONE) => {
  const parsed = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveBusinessTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
