const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const cpf = '52998224725';
const runId = String(Date.now());

const requestRaw = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
};

const requestData = async (path, options = {}) => {
  const result = await requestRaw(path, options);
  if (!result.response.ok || !result.payload?.ok) {
    throw new Error(`${options.method || 'GET'} ${path}: ${result.response.status} ${JSON.stringify(result.payload)}`);
  }
  return result.payload.data;
};

await requestData('/api/app/init?view=qr');

const opened = await requestData('/api/customer-tabs/open', {
  method: 'POST',
  body: JSON.stringify({
    customerName: 'Cliente Posse',
    phone: `1199${runId.slice(-7)}`,
    cpf,
    origin: 'qr',
  }),
});
if (!opened.tab?.id || !opened.accessToken) {
  throw new Error('Abertura de comanda não devolveu credencial de posse.');
}

const anonymousRecover = await requestRaw('/api/customer-tabs/recover', {
  method: 'POST',
  body: JSON.stringify({ cpf, origin: 'qr' }),
});
if (anonymousRecover.response.status !== 403) {
  throw new Error(`CPF sem credencial recuperou comanda (${anonymousRecover.response.status}).`);
}

const tamperedRecover = await requestRaw('/api/customer-tabs/recover', {
  method: 'POST',
  body: JSON.stringify({ cpf, accessToken: `${opened.accessToken}x`, origin: 'qr' }),
});
if (tamperedRecover.response.status !== 403) {
  throw new Error(`Credencial adulterada recuperou comanda (${tamperedRecover.response.status}).`);
}

const recovered = await requestData('/api/customer-tabs/recover', {
  method: 'POST',
  body: JSON.stringify({ cpf, accessToken: opened.accessToken, origin: 'qr' }),
});
if (recovered.tab?.id !== opened.tab.id || !recovered.accessToken) {
  throw new Error('Credencial legítima não recuperou a própria comanda.');
}

const anonymousPayment = await requestRaw('/api/customer-tabs/payment-link', {
  method: 'POST',
  body: JSON.stringify({ tabId: opened.tab.id, method: 'pix' }),
});
if (anonymousPayment.response.status !== 403) {
  throw new Error(`Comanda aceitou pagamento sem posse (${anonymousPayment.response.status}).`);
}

const authorizedPayment = await requestRaw('/api/customer-tabs/payment-link', {
  method: 'POST',
  body: JSON.stringify({
    tabId: opened.tab.id,
    method: 'pix',
    accessToken: recovered.accessToken,
  }),
});
if (![400, 503].includes(authorizedPayment.response.status)) {
  throw new Error(`Credencial legítima não alcançou o fluxo de pagamento (${authorizedPayment.response.status}).`);
}

console.log(JSON.stringify({
  ok: true,
  covered: [
    'customer_tab_signed_possession',
    'cpf_only_recovery_blocked',
    'tampered_token_blocked',
    'payment_requires_possession',
  ],
}, null, 2));
