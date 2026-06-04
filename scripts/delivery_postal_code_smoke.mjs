const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';

const fail = (message, details = null) => {
  console.error(message);
  if (details) console.error(JSON.stringify(details, null, 2));
  process.exit(1);
};

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    fail(`Request failed: ${options.method || 'GET'} ${path}`, payload || { status: response.status });
  }
  return payload.data;
};

await requestJson('/api/app/init?view=delivery');

const resolved = await requestJson('/api/delivery/postal-code', {
  method: 'POST',
  body: JSON.stringify({ postalCode: '01001-000' }),
});

if (resolved.postalCode.status !== 'mock_resolved') fail('Expected mock postal code resolution', resolved);
if (resolved.postalCode.provider !== 'mock') fail('Expected mock postal code provider', resolved);
if (resolved.postalCode.postalCode !== '01001000') fail('Expected normalized postal code', resolved);
if (resolved.postalCode.address?.state !== 'SP') fail('Expected mock address state SP', resolved);

const invalid = await requestJson('/api/delivery/postal-code', {
  method: 'POST',
  body: JSON.stringify({ postalCode: '123' }),
});

if (invalid.postalCode.status !== 'invalid_postal_code') fail('Expected invalid postal code status', invalid);
if (invalid.postalCode.address !== null) fail('Expected invalid postal code without address', invalid);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  resolvedStatus: resolved.postalCode.status,
  normalizedPostalCode: resolved.postalCode.postalCode,
  invalidStatus: invalid.postalCode.status,
}, null, 2));
