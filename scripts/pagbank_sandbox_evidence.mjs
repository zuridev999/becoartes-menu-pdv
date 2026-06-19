import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sandboxBaseUrl = process.env.PAGBANK_SANDBOX_API_BASE_URL || 'https://sandbox.api.pagseguro.com';
const sandboxToken = process.env.PAGBANK_SANDBOX_TOKEN || '';
const outputPath = process.env.PAGBANK_EVIDENCE_OUTPUT || `_reports/pagbank-sandbox-evidence-${new Date().toISOString().slice(0, 10)}.txt`;
const notificationUrl = process.env.PAGBANK_SANDBOX_NOTIFICATION_URL || 'https://delivery.becoartes.com/api/delivery/webhooks/pagbank';
const amountInCents = Number(process.env.PAGBANK_EVIDENCE_AMOUNT_CENTS || 500);
const createdAt = new Date().toISOString();

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Configure ${name}.`);
  return value;
};

const optionalJson = (name, fallback = null) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} precisa ser JSON valido: ${error.message}`);
  }
};

const loadOverrideRequest = async (methodId) => {
  const envName = `PAGBANK_EVIDENCE_${methodId.toUpperCase()}_REQUEST_FILE`;
  const file = process.env[envName];
  if (!file) return null;
  const raw = await readFile(resolve(file), 'utf8');
  return JSON.parse(raw);
};

const customer = () => ({
  name: process.env.PAGBANK_EVIDENCE_CUSTOMER_NAME || 'Jose da Silva',
  email: process.env.PAGBANK_EVIDENCE_CUSTOMER_EMAIL || 'email@test.com',
  tax_id: process.env.PAGBANK_EVIDENCE_CUSTOMER_TAX_ID || '12345678909',
  phones: [
    {
      country: '55',
      area: process.env.PAGBANK_EVIDENCE_PHONE_AREA || '11',
      number: process.env.PAGBANK_EVIDENCE_PHONE_NUMBER || '999999999',
      type: 'MOBILE',
    },
  ],
});

const items = (suffix) => [
  {
    reference_id: `becoartes_${suffix}_item_001`,
    name: `Becoartes ${suffix}`,
    quantity: 1,
    unit_amount: amountInCents,
  },
];

const shipping = () => ({
  address: {
    street: 'Avenida Brigadeiro Faria Lima',
    number: '1384',
    complement: 'apto 12',
    locality: 'Pinheiros',
    city: 'Sao Paulo',
    region_code: 'SP',
    country: 'BRA',
    postal_code: '01452002',
  },
});

const baseOrder = (methodId) => ({
  reference_id: `becoartes_${methodId}_${Date.now()}`,
  customer: customer(),
  items: items(methodId),
  shipping: shipping(),
  notification_urls: [notificationUrl],
});

const charge = (methodId, paymentMethod) => ({
  reference_id: `becoartes_${methodId}_charge_001`,
  description: `Becoartes sandbox ${methodId}`,
  amount: {
    value: amountInCents,
    currency: 'BRL',
  },
  payment_method: paymentMethod,
});

const creditCardRequest = () => ({
  ...baseOrder('credit_card'),
  charges: [
    charge('credit_card', {
      type: 'CREDIT_CARD',
      installments: 1,
      capture: true,
      card: {
        encrypted: required('PAGBANK_SANDBOX_CREDIT_CARD_ENCRYPTED'),
        store: false,
      },
      holder: {
        name: process.env.PAGBANK_EVIDENCE_CARD_HOLDER_NAME || 'Jose da Silva',
        tax_id: process.env.PAGBANK_EVIDENCE_CARD_HOLDER_TAX_ID || '65544332211',
      },
    }),
  ],
});

const debitCardRequest = () => ({
  ...baseOrder('debit_card'),
  charges: [
    charge('debit_card', {
      type: 'DEBIT_CARD',
      installments: 1,
      capture: true,
      card: {
        encrypted: required('PAGBANK_SANDBOX_DEBIT_CARD_ENCRYPTED'),
        store: false,
      },
      holder: {
        name: process.env.PAGBANK_EVIDENCE_CARD_HOLDER_NAME || 'Jose da Silva',
        tax_id: process.env.PAGBANK_EVIDENCE_CARD_HOLDER_TAX_ID || '65544332211',
      },
      authentication_method: optionalJson('PAGBANK_SANDBOX_DEBIT_3DS_AUTHENTICATION_METHOD', undefined),
    }),
  ],
});

const pixRequest = () => ({
  ...baseOrder('pix'),
  qr_codes: [
    {
      amount: {
        value: amountInCents,
      },
      expiration_date: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    },
  ],
});

const googlePayRequest = () => ({
  ...baseOrder('google_pay'),
  charges: [
    charge('google_pay', {
      type: 'GOOGLE_PAY',
      installments: 1,
      capture: true,
      google_pay: optionalJson('PAGBANK_SANDBOX_GOOGLE_PAY_DATA', {
        encrypted: required('PAGBANK_SANDBOX_GOOGLE_PAY_ENCRYPTED'),
      }),
    }),
  ],
});

const applePayRequest = () => ({
  ...baseOrder('apple_pay'),
  charges: [
    charge('apple_pay', {
      type: 'APPLE_PAY',
      installments: 1,
      capture: true,
      apple_pay: optionalJson('PAGBANK_SANDBOX_APPLE_PAY_DATA', {
        payment_data: required('PAGBANK_SANDBOX_APPLE_PAY_PAYMENT_DATA'),
      }),
    }),
  ],
});

const methods = [
  ['credit_card', 'Cartao de credito', creditCardRequest],
  ['debit_card', 'Cartao de debito', debitCardRequest],
  ['pix', 'Pix', pixRequest],
  ['google_pay', 'Google Pay', googlePayRequest],
  ['apple_pay', 'Apple Pay', applePayRequest],
];

const postPagBank = async (request) => {
  const response = await fetch(`${sandboxBaseUrl}/orders`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${sandboxToken}`,
    },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return {
    http_status: response.status,
    ok: response.ok,
    body,
  };
};

const block = (title, value) => [
  title,
  '',
  JSON.stringify(value, null, 2),
  '',
].join('\n');

if (!sandboxToken) {
  throw new Error('Configure PAGBANK_SANDBOX_TOKEN para gerar evidence real de Sandbox.');
}

const sections = [];

const summary = [];

for (const [methodId, label, buildRequest] of methods) {
  const request = await loadOverrideRequest(methodId) || buildRequest();
  const response = await postPagBank(request);
  summary.push({ method: methodId, label, http_status: response.http_status, ok: response.ok });

  sections.push('='.repeat(80));
  sections.push(`MEIO DE PAGAMENTO: ${label}`);
  sections.push(`GERADO EM: ${createdAt}`);
  sections.push(`ENDPOINT: ${sandboxBaseUrl}/orders`);
  sections.push('OBSERVACAO: o header Authorization foi usado na chamada real, mas nao e impresso neste arquivo.');
  sections.push('');
  sections.push(block('Request', request));
  sections.push(block('RESPONSE', response.body));
}

await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, sections.join('\n'), 'utf8');

console.log(JSON.stringify({ ok: true, outputPath, summary }, null, 2));
