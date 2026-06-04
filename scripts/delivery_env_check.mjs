import { readFile } from 'node:fs/promises';

const strict = process.env.DELIVERY_ENV_CHECK_STRICT === '1';
const envFile = process.env.DELIVERY_ENV_FILE || '';
const target = process.env.DELIVERY_ENV_TARGET || 'first_deploy';

const allowedTargets = new Set(['local', 'first_deploy', 'pagbank', 'kitchen', 'ifood']);
const allowedPaymentProviders = new Set(['mock', 'pagbank', 'disabled']);
const allowedLogisticsProviders = new Set(['mock', 'ifood', 'disabled']);
const allowedKitchenModes = new Set(['mock', 'production']);
const allowedShippingModes = new Set(['dry_run', 'live']);
const allowedGeocoderProviders = new Set(['mock', 'disabled', 'provider']);
const allowedPostalProviders = new Set(['mock', 'viacep', 'disabled']);
const allowedPublicStatuses = new Set(['building', 'open']);

const parseEnvFile = async (path) => {
  if (!path) return {};
  const text = await readFile(path, 'utf8');
  const parsed = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
};

const fileEnv = await parseEnvFile(envFile);
const source = { ...process.env, ...fileEnv };
const value = (key, fallback = '') => String(source[key] ?? fallback).trim();
const present = (key) => value(key) !== '';
const presentLength = (key) => value(key).length;
const isHttpsUrl = (key) => /^https:\/\/[^ ]+\.[^ ]+/.test(value(key));

const paymentProvider = value('DELIVERY_PAYMENT_PROVIDER', 'mock');
const logisticsProvider = value('DELIVERY_LOGISTICS_PROVIDER', 'disabled');
const kitchenMode = value('DELIVERY_KITCHEN_DISPATCH_MODE', 'mock');
const publicStatus = value('DELIVERY_PUBLIC_STATUS', 'building');
const shippingMode = value('IFOOD_SHIPPING_MODE', 'dry_run');
const geocoderProvider = value('DELIVERY_GEOCODER_PROVIDER', 'mock');
const postalProvider = value('DELIVERY_POSTAL_CODE_PROVIDER', 'mock');
const clubCycleSize = Number(value('DELIVERY_CLUB_CYCLE_SIZE', '10'));
const preparationSeconds = Number(value('IFOOD_PREPARATION_TIME_SECONDS', '900'));

const checks = [];
const add = (name, ok, severity, next = '') => checks.push({ name, ok, severity, next });

add('target valido', allowedTargets.has(target), 'error', `Use DELIVERY_ENV_TARGET=${Array.from(allowedTargets).join('|')}.`);
add('payment provider valido', allowedPaymentProviders.has(paymentProvider), 'error', 'Use DELIVERY_PAYMENT_PROVIDER=mock|pagbank|disabled.');
add('logistics provider valido', allowedLogisticsProviders.has(logisticsProvider), 'error', 'Use DELIVERY_LOGISTICS_PROVIDER=mock|ifood|disabled.');
add('kitchen mode valido', allowedKitchenModes.has(kitchenMode), 'error', 'Use DELIVERY_KITCHEN_DISPATCH_MODE=mock|production.');
add('shipping mode valido', allowedShippingModes.has(shippingMode), 'error', 'Use IFOOD_SHIPPING_MODE=dry_run|live.');
add('geocoder provider valido', allowedGeocoderProviders.has(geocoderProvider), 'warn', 'Use DELIVERY_GEOCODER_PROVIDER=mock|disabled|provider.');
add('postal provider valido', allowedPostalProviders.has(postalProvider), 'warn', 'Use DELIVERY_POSTAL_CODE_PROVIDER=mock|viacep|disabled.');
add('public status valido', allowedPublicStatuses.has(publicStatus), 'error', 'Use DELIVERY_PUBLIC_STATUS=building|open.');
add('club cycle valido', Number.isFinite(clubCycleSize) && clubCycleSize >= 1, 'error', 'Configure DELIVERY_CLUB_CYCLE_SIZE >= 1.');
add('preparation time valido', Number.isFinite(preparationSeconds) && preparationSeconds >= 60, 'warn', 'Configure IFOOD_PREPARATION_TIME_SECONDS com pelo menos 60.');

if (target === 'local') {
  add('local database file', value('TURSO_DATABASE_URL').startsWith('file:'), 'warn', 'Para local seguro, use TURSO_DATABASE_URL=file:local-delivery.db.');
}

if (target === 'first_deploy') {
  add('first deploy pagamento mock', paymentProvider === 'mock', 'error', 'Primeiro deploy publico deve usar DELIVERY_PAYMENT_PROVIDER=mock.');
  add('first deploy logistica disabled', logisticsProvider === 'disabled', 'error', 'Primeiro deploy publico deve usar DELIVERY_LOGISTICS_PROVIDER=disabled.');
  add('first deploy cozinha mock', kitchenMode === 'mock', 'error', 'Primeiro deploy publico deve usar DELIVERY_KITCHEN_DISPATCH_MODE=mock.');
  add('first deploy trava building', publicStatus === 'building', 'error', 'Primeiro deploy deve usar DELIVERY_PUBLIC_STATUS=building.');
  add('pagbank token ausente no primeiro deploy', !present('PAGBANK_TOKEN'), 'warn', 'Evite habilitar token PagBank antes da homologacao.');
  add('ifood token ausente no primeiro deploy', !present('IFOOD_ACCESS_TOKEN'), 'warn', 'Evite habilitar token iFood antes da homologacao.');
}

if (target === 'pagbank') {
  add('pagbank provider ativo', paymentProvider === 'pagbank', 'error', 'Use DELIVERY_PAYMENT_PROVIDER=pagbank.');
  add('pagbank token presente', present('PAGBANK_TOKEN'), 'error', 'Configure PAGBANK_TOKEN.');
  add('webhook secret presente', presentLength('DELIVERY_WEBHOOK_SECRET') >= 16, 'warn', 'Configure DELIVERY_WEBHOOK_SECRET com pelo menos 16 caracteres.');
  add('pagbank notification https', isHttpsUrl('PAGBANK_NOTIFICATION_URL'), 'error', 'Configure PAGBANK_NOTIFICATION_URL=https://delivery.becoartes.com/api/delivery/webhooks/pagbank.');
  add('pagbank redirect https', isHttpsUrl('PAGBANK_REDIRECT_URL'), 'warn', 'Configure PAGBANK_REDIRECT_URL=https://delivery.becoartes.com/delivery.');
}

if (target === 'kitchen') {
  add('cozinha production', kitchenMode === 'production', 'error', 'Use DELIVERY_KITCHEN_DISPATCH_MODE=production somente em teste presencial.');
  add('pagamento nao disabled', paymentProvider !== 'disabled', 'error', 'Pagamento deve estar mock ou pagbank para acionar cozinha.');
  add('logistica controlada', logisticsProvider === 'mock' || logisticsProvider === 'disabled', 'warn', 'Para teste presencial de cozinha, mantenha logistica mock/disabled.');
}

if (target === 'ifood') {
  add('ifood provider ativo', logisticsProvider === 'ifood', 'error', 'Use DELIVERY_LOGISTICS_PROVIDER=ifood.');
  add('ifood access token presente', present('IFOOD_ACCESS_TOKEN'), 'error', 'Configure IFOOD_ACCESS_TOKEN.');
  add('ifood merchant presente', present('IFOOD_MERCHANT_ID'), 'error', 'Configure IFOOD_MERCHANT_ID.');
  add('ifood dry-run primeiro', shippingMode === 'dry_run', 'warn', 'Comece homologacao com IFOOD_SHIPPING_MODE=dry_run antes de live.');
  add('geocoder real escolhido', geocoderProvider !== 'disabled', 'warn', 'Escolha geocoder confiavel antes de entrega real.');
  add('postal viacep recomendado', postalProvider === 'viacep', 'warn', 'Para homologacao real, use DELIVERY_POSTAL_CODE_PROVIDER=viacep ou equivalente.');
}

const errors = checks.filter((check) => !check.ok && check.severity === 'error');
const warnings = checks.filter((check) => !check.ok && check.severity === 'warn');

const report = {
  ok: errors.length === 0,
  strict,
  target,
  source: envFile ? 'file+process' : 'process',
  envFileChecked: Boolean(envFile),
  summary: {
    paymentProvider,
    logisticsProvider,
    kitchenMode,
    publicStatus,
    shippingMode,
    geocoderProvider,
    postalProvider,
    pagbankTokenPresent: present('PAGBANK_TOKEN'),
    ifoodTokenPresent: present('IFOOD_ACCESS_TOKEN'),
    ifoodMerchantPresent: present('IFOOD_MERCHANT_ID'),
    webhookSecretPresent: present('DELIVERY_WEBHOOK_SECRET'),
  },
  checks,
  errors,
  warnings,
};

console.log(JSON.stringify(report, null, 2));

if ((strict && (errors.length > 0 || warnings.length > 0)) || errors.length > 0) {
  process.exit(1);
}
