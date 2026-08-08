import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';

const basePort = Number(process.env.DELIVERY_ALL_SMOKES_PORT || 18080);
const baseUrl = `http://127.0.0.1:${basePort}`;
const dbUrl = process.env.DELIVERY_ALL_SMOKES_DB_URL || 'file:local-delivery.db';

const scenarios = [
  {
    name: 'mock-checkout-quote-pickup-club',
    env: {
      DELIVERY_PAYMENT_PROVIDER: 'mock',
      DELIVERY_KITCHEN_DISPATCH_MODE: 'mock',
      DELIVERY_LOGISTICS_PROVIDER: 'mock',
    },
    scripts: [
      'smoke:delivery',
      'smoke:delivery:quote',
      'smoke:delivery:pickup',
      'smoke:delivery:club',
      'smoke:delivery:customer-auth-fail-closed',
      'smoke:customer-tab:authorization',
      'smoke:delivery:coupon',
      'smoke:delivery:orders-admin',
      'smoke:delivery:postal-code',
    ],
  },
  {
    name: 'customer-auth-webhook',
    env: {
      DELIVERY_PAYMENT_PROVIDER: 'mock',
      DELIVERY_KITCHEN_DISPATCH_MODE: 'mock',
      DELIVERY_LOGISTICS_PROVIDER: 'disabled',
      DELIVERY_EMAIL_PROVIDER: 'webhook',
      DELIVERY_SMS_PROVIDER: 'disabled',
      DELIVERY_WHATSAPP_PROVIDER: 'disabled',
      DELIVERY_EMAIL_WEBHOOK_URL: 'http://127.0.0.1:19091/email',
      DELIVERY_NOTIFICATION_WEBHOOK_SECRET: 'smoke_auth_notification_secret',
    },
    scripts: ['smoke:delivery:customer-auth'],
  },
  {
    name: 'club-config',
    env: {
      DELIVERY_PAYMENT_PROVIDER: 'mock',
      DELIVERY_KITCHEN_DISPATCH_MODE: 'mock',
      DELIVERY_LOGISTICS_PROVIDER: 'mock',
      DELIVERY_CLUB_CYCLE_SIZE: '3',
      DELIVERY_CLUB_REWARD_LABEL: 'sobremesa gratuita',
    },
    scripts: ['smoke:delivery:club-config'],
  },
  {
    name: 'production-kitchen-mock',
    env: {
      DELIVERY_PAYMENT_PROVIDER: 'mock',
      DELIVERY_KITCHEN_DISPATCH_MODE: 'production',
      DELIVERY_LOGISTICS_PROVIDER: 'mock',
    },
    scripts: ['smoke:delivery:production'],
  },
  {
    name: 'pagbank-webhook-mock',
    env: {
      DELIVERY_PAYMENT_PROVIDER: 'pagbank',
      DELIVERY_KITCHEN_DISPATCH_MODE: 'mock',
      DELIVERY_LOGISTICS_PROVIDER: 'mock',
    },
    scripts: [
      'smoke:delivery:webhook',
      'smoke:delivery:webhook:idempotency',
      'smoke:delivery:payment-methods',
    ],
  },
  {
    name: 'pagbank-webhook-secret',
    env: {
      DELIVERY_PAYMENT_PROVIDER: 'pagbank',
      DELIVERY_KITCHEN_DISPATCH_MODE: 'mock',
      DELIVERY_LOGISTICS_PROVIDER: 'mock',
      DELIVERY_WEBHOOK_SECRET: 'smoke_secret',
    },
    scripts: ['smoke:delivery:webhook:secret'],
  },
  {
    name: 'pagbank-webhook-production',
    env: {
      DELIVERY_PAYMENT_PROVIDER: 'pagbank',
      DELIVERY_KITCHEN_DISPATCH_MODE: 'production',
      DELIVERY_LOGISTICS_PROVIDER: 'mock',
    },
    scripts: ['smoke:delivery:webhook:production'],
  },
  {
    name: 'notification-webhook',
    env: {
      DELIVERY_PAYMENT_PROVIDER: 'mock',
      DELIVERY_KITCHEN_DISPATCH_MODE: 'mock',
      DELIVERY_LOGISTICS_PROVIDER: 'disabled',
      DELIVERY_EMAIL_PROVIDER: 'webhook',
      DELIVERY_SMS_PROVIDER: 'webhook',
      DELIVERY_WHATSAPP_PROVIDER: 'webhook',
      DELIVERY_EMAIL_WEBHOOK_URL: 'http://127.0.0.1:19090/email',
      DELIVERY_SMS_WEBHOOK_URL: 'http://127.0.0.1:19090/sms',
      DELIVERY_WHATSAPP_WEBHOOK_URL: 'http://127.0.0.1:19090/whatsapp',
      DELIVERY_NOTIFICATION_WEBHOOK_SECRET: 'smoke_notification_secret',
    },
    scripts: ['smoke:delivery:notification-webhook'],
  },
  {
    name: 'ifood-dry-run',
    env: {
      DELIVERY_PAYMENT_PROVIDER: 'mock',
      DELIVERY_KITCHEN_DISPATCH_MODE: 'mock',
      DELIVERY_LOGISTICS_PROVIDER: 'ifood',
      IFOOD_ACCESS_TOKEN: 'fake_token',
      IFOOD_MERCHANT_ID: '00000000-0000-0000-0000-000000000000',
      IFOOD_SHIPPING_MODE: 'dry_run',
      DELIVERY_GEOCODER_PROVIDER: 'mock',
      DELIVERY_MOCK_LATITUDE: '-23.5505',
      DELIVERY_MOCK_LONGITUDE: '-46.6333',
    },
    scripts: [
      'smoke:delivery:ifood',
      'smoke:delivery:geocode',
      'smoke:delivery:ifood-quoteid',
    ],
  },
];

const runCommand = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: options.stdio || 'pipe',
    shell: false,
    env: { ...process.env, ...(options.env || {}) },
    cwd: options.cwd || process.cwd(),
  });
  let stdout = '';
  let stderr = '';
  if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk; });
  if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('exit', (code, signal) => {
    if (code === 0) resolve({ stdout, stderr });
    else {
      const error = new Error(`${command} ${args.join(' ')} failed with ${code ?? signal}`);
      error.stdout = stdout;
      error.stderr = stderr;
      error.code = code;
      reject(error);
    }
  });
});

const waitForHealth = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`BFF did not become healthy at ${baseUrl}`);
};

const resetDb = async () => {
  await rm('local-delivery.db', { force: true });
  await rm('local-delivery.db-shm', { force: true });
  await rm('local-delivery.db-wal', { force: true });
};

const runScenario = async (scenario) => {
  await resetDb();
  const env = {
    PORT: String(basePort),
    TURSO_DATABASE_URL: dbUrl,
    DEFAULT_MANAGER_PIN: '135790',
    DEFAULT_OPERATOR_PIN: '246801',
    TABLET_SETUP_PIN: '975310',
    ADMIN_BYPASS_PIN: '0719',
    ADMIN_BYPASS_ENABLED: 'true',
    DELIVERY_SMOKE_ADMIN_PIN: '0719',
    BFF_SESSION_SECRET: 'delivery-all-smokes-session-secret',
    DELIVERY_CUSTOMER_CODE_SECRET: 'delivery-all-smokes-code-secret',
    ...scenario.env,
  };
  const bff = spawn('node', ['server/bff.mjs'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  let bffOutput = '';
  bff.stdout.on('data', (chunk) => { bffOutput += chunk; });
  bff.stderr.on('data', (chunk) => { bffOutput += chunk; });

  try {
    await waitForHealth();
    for (const script of scenario.scripts) {
      await runCommand('npm', ['run', script], {
        env: {
          DELIVERY_SMOKE_BASE_URL: baseUrl,
          DELIVERY_SMOKE_DB_URL: dbUrl,
          ...env,
        },
      });
    }
  } catch (error) {
    console.error(`Scenario failed: ${scenario.name}`);
    if (error.stdout) console.error(error.stdout);
    if (error.stderr) console.error(error.stderr);
    if (bffOutput) console.error(bffOutput);
    throw error;
  } finally {
    bff.kill('SIGINT');
    await new Promise((resolve) => bff.once('exit', resolve));
    await resetDb();
  }
};

for (const scenario of scenarios) {
  console.log(`\n▶ ${scenario.name}`);
  await runScenario(scenario);
  console.log(`✓ ${scenario.name}`);
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  scenarios: scenarios.map((scenario) => scenario.name),
}, null, 2));
