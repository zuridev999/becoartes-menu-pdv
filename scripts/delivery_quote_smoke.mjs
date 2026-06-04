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

const quote = await requestJson('/api/delivery/quote', {
  method: 'POST',
  body: JSON.stringify({
    customer: {
      name: 'Teste Quote',
      phone: '11999999993',
      email: 'quote@example.com',
      street: 'Rua Quote',
      number: '456',
      neighborhood: 'Centro',
      city: 'Sao Paulo',
      state: 'SP',
      postalCode: '01001000',
      complement: '',
      reference: '',
      fulfillment: 'delivery',
      paymentMethod: 'pagbank',
      coupon: '',
      joinClub: true,
    },
    items: [{
      id: 'quote_item_1',
      productId: 'produto_quote_smoke',
      name: 'Item Quote Smoke',
      price: 10,
      quantity: 2,
      selectedModifiers: [],
      notes: '',
    }],
  }),
});

if (quote.quote.status !== 'available_mock') fail('Expected available_mock quote', quote);
if (quote.quote.provider !== 'ifood_mock') fail('Expected ifood_mock provider', quote);
if (quote.quote.deliveryFee !== 8) fail('Expected mock delivery fee 8', quote);
if (!quote.quote.quoteId?.startsWith('quote_mock_')) fail('Expected mock quoteId', quote);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  status: quote.quote.status,
  provider: quote.quote.provider,
  deliveryFee: quote.quote.deliveryFee,
  quoteId: quote.quote.quoteId,
}, null, 2));
