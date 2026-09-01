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

export const businessDateGapDays = (earlierDateKey, laterDateKey) => {
  const parseDateKey = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const parsed = new Date(timestamp);
    if (businessDateKey(parsed, 'UTC') !== match[0]) return null;
    return timestamp;
  };

  const earlier = parseDateKey(earlierDateKey);
  const later = parseDateKey(laterDateKey);
  if (earlier === null || later === null) return null;
  return Math.round((later - earlier) / 86_400_000);
};
