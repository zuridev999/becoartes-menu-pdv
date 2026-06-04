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

const customer = {
  name: 'Teste Geocode Quote',
  phone: '11999999992',
  email: 'geocode-quote@example.com',
  street: 'Rua Geocode Quote',
  number: '987',
  neighborhood: 'Centro',
  city: 'Sao Paulo',
  state: 'SP',
  postalCode: '01001000',
  complement: '',
  reference: 'Entrada principal',
  fulfillment: 'delivery',
  paymentMethod: 'pagbank',
  coupon: '',
  joinClub: true,
};

const geocode = await requestJson('/api/delivery/geocode', {
  method: 'POST',
  body: JSON.stringify({ customer }),
});

if (geocode.geocode.status !== 'mock_resolved') fail('Expected mock_resolved geocode', geocode);
if (geocode.geocode.provider !== 'mock') fail('Expected mock geocoder provider', geocode);
if (typeof geocode.geocode.latitude !== 'number' || typeof geocode.geocode.longitude !== 'number') {
  fail('Expected numeric mock coordinates', geocode);
}

const quote = await requestJson('/api/delivery/quote', {
  method: 'POST',
  body: JSON.stringify({
    customer,
    items: [{
      id: 'geocode_quote_item_1',
      productId: 'produto_geocode_quote_smoke',
      name: 'Item Geocode Quote Smoke',
      price: 10,
      quantity: 1,
      selectedModifiers: [],
      notes: '',
    }],
  }),
});

if (quote.quote.status !== 'ready_for_homologation') fail('Expected ready_for_homologation quote', quote);
if (quote.quote.provider !== 'ifood') fail('Expected ifood quote provider', quote);
if (!String(quote.quote.payload?.availabilityEndpoint || '').includes('/shipping/v1.0/merchants/')) {
  fail('Expected iFood Shipping availability endpoint', quote);
}
if (quote.quote.payload?.geocode?.status !== 'mock_resolved') {
  fail('Expected quote payload to include mock geocode evidence', quote);
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  geocodeStatus: geocode.geocode.status,
  latitude: geocode.geocode.latitude,
  longitude: geocode.geocode.longitude,
  quoteStatus: quote.quote.status,
  quoteProvider: quote.quote.provider,
}, null, 2));
