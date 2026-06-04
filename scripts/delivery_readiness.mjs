import dns from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const expectedIp = process.env.DELIVERY_READINESS_EXPECTED_IP || '72.60.252.50';
const configUrl = process.env.DELIVERY_READINESS_CONFIG_URL || '';
const strict = process.env.DELIVERY_READINESS_STRICT === '1';
const checkVps = process.env.DELIVERY_READINESS_CHECK_VPS === '1';
const vpsHost = process.env.DELIVERY_VPS_HOST || '72.60.252.50';
const vpsUser = process.env.DELIVERY_VPS_USER || 'root';
const vpsKey = process.env.DELIVERY_VPS_KEY || `${process.env.HOME}/.ssh/id_rsa_becoartes_ed`;
const vpsReleaseDir = process.env.DELIVERY_VPS_RELEASE_DIR || '/root/becoartes-operational-release';

const execFileAsync = promisify(execFile);

const readText = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const hasScript = (packageJson, name) => Boolean(packageJson.scripts?.[name]);

const run = async (cmd, args, options = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      maxBuffer: 1024 * 1024 * 6,
      ...options,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || '').trim(),
      stderr: String(error.stderr || error.message || '').trim(),
      code: error.code || 1,
    };
  }
};

const checkDns = async (domain) => {
  try {
    const addresses = await dns.resolve4(domain);
    return { domain, addresses, resolvesExpectedIp: addresses.includes(expectedIp) };
  } catch (error) {
    return { domain, addresses: [], resolvesExpectedIp: false, error: error.code || error.message };
  }
};

const checkPublicConfig = async () => {
  if (!configUrl) return { checked: false };
  try {
    const response = await fetch(configUrl, { signal: AbortSignal.timeout(8000) });
    const payload = await response.json().catch(() => null);
    const serialized = JSON.stringify(payload || {});
    const forbiddenHints = ['PAGBANK_TOKEN', 'IFOOD_ACCESS_TOKEN', 'TURSO_AUTH_TOKEN', 'BFF_SESSION_SECRET'];
    return {
      checked: true,
      ok: response.ok && payload?.ok === true,
      status: response.status,
      exposesSecretHints: forbiddenHints.filter((hint) => serialized.includes(hint)),
      mode: payload?.data?.mode || null,
      routes: payload?.data?.routes || null,
    };
  } catch (error) {
    return { checked: true, ok: false, status: 0, error: error.cause?.code || error.message };
  }
};

const checkRemoteRelease = async () => {
  if (!checkVps) return { checked: false };
  const sshArgs = [
    '-i', vpsKey,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${vpsUser}@${vpsHost}`,
  ];
  const command = `
    set -eu
    printf "release_dir="
    if [ -d '${vpsReleaseDir}' ]; then echo "exists"; else echo "missing"; fi
    if [ -d '${vpsReleaseDir}' ]; then
      cd '${vpsReleaseDir}'
      test -f docker-compose.yml && echo "compose=present" || echo "compose=missing"
      test -f nginx.conf && echo "nginx_conf=present" || echo "nginx_conf=missing"
      if [ -f nginx.conf ] && grep -q 'delivery.becoartes.com' nginx.conf; then
        echo "delivery_nginx=present"
      else
        echo "delivery_nginx=missing"
      fi
      if [ -f docker-compose.yml ] && grep -q 'DELIVERY_PAYMENT_PROVIDER' docker-compose.yml; then
        echo "delivery_envs=present"
      else
        echo "delivery_envs=missing"
      fi
    fi
    docker compose version >/dev/null 2>&1 && echo "docker_compose=present" || echo "docker_compose=missing"
  `;
  const result = await run('ssh', [...sshArgs, command]);
  const output = result.stdout;
  return {
    checked: true,
    ok: result.ok
      && output.includes('release_dir=exists')
      && output.includes('compose=present')
      && output.includes('nginx_conf=present')
      && output.includes('delivery_nginx=present')
      && output.includes('delivery_envs=present')
      && output.includes('docker_compose=present'),
    host: vpsHost,
    user: vpsUser,
    releaseDir: vpsReleaseDir,
    summary: output.split('\n').filter(Boolean),
    error: result.ok ? null : result.stderr,
  };
};

const packageJson = JSON.parse(await readText('package.json'));
const nginxConf = await readText('nginx.conf');
const compose = await readText('docker-compose.yml');
const bff = await readText('server/bff.mjs');
const api = await readText('src/lib/api.ts');
const app = await readText('src/App.tsx');
const deliveryViewExists = existsSync(new URL('../src/views/delivery/DeliveryView.tsx', import.meta.url));
const deliverySmokeExists = existsSync(new URL('../scripts/delivery_all_smokes.mjs', import.meta.url));

const dnsDelivery = await checkDns('delivery.becoartes.com');
const publicConfig = await checkPublicConfig();
const remoteRelease = await checkRemoteRelease();

const localArtifactsReady = [
  deliveryViewExists,
  deliverySmokeExists,
  app.includes('/delivery'),
  api.includes('/api/delivery/checkout'),
  bff.includes('POST /api/delivery/checkout'),
  bff.includes('dispatchPaidDeliveryOrder'),
  bff.includes('POST /api/delivery/postal-code'),
  nginxConf.includes('delivery.becoartes.com'),
  compose.includes('DELIVERY_PAYMENT_PROVIDER'),
  compose.includes('DELIVERY_LOGISTICS_PROVIDER'),
  hasScript(packageJson, 'smoke:delivery:all'),
  hasScript(packageJson, 'deploy:delivery:dry-run'),
].every(Boolean);

const phase = (name, status, evidence, next = '') => ({ name, status, evidence, next });

const phases = [
  phase(
    'local_delivery_app',
    localArtifactsReady ? 'ready' : 'not_ready',
    {
      deliveryViewExists,
      hasRoute: app.includes('/delivery'),
      hasCheckoutApi: api.includes('/api/delivery/checkout'),
      hasBffCheckout: bff.includes('POST /api/delivery/checkout'),
      hasPostalCode: bff.includes('POST /api/delivery/postal-code'),
      hasAllSmoke: hasScript(packageJson, 'smoke:delivery:all'),
    },
    localArtifactsReady ? '' : 'Completar artefatos locais do delivery antes de homologar.'
  ),
  phase(
    'payment',
    'needs_external',
    {
      pagbankProviderPrepared: bff.includes('DELIVERY_PAYMENT_PROVIDER') && bff.includes('pagbank'),
      webhookPrepared: bff.includes('POST /api/delivery/webhooks/pagbank'),
      manualPaymentRemoved: !bff.includes('confirmDeliveryManualPayment') && !bff.includes('/api/delivery/payment/confirm'),
    },
    'Configurar credenciais PagBank sandbox/producao e validar webhook real sem expor segredos.'
  ),
  phase(
    'kitchen_dispatch',
    'needs_external',
    {
      productionModePrepared: bff.includes('DELIVERY_KITCHEN_DISPATCH_MODE') && bff.includes("'pending', 'delivery'"),
      kitchenBadgePrepared: (await readText('src/views/kitchen/KitchenView.tsx')).includes('DELIVERY'),
    },
    'Homologar presencialmente em janela controlada antes de ativar production.'
  ),
  phase(
    'ifood_shipping',
    'needs_external',
    {
      providerPrepared: bff.includes('DELIVERY_LOGISTICS_PROVIDER') && bff.includes('ifood'),
      dryRunPrepared: bff.includes('IFOOD_SHIPPING_MODE') && bff.includes('ready_for_homologation'),
      quoteIdPrepared: bff.includes('quoteId'),
    },
    'Confirmar habilitacao iFood Shipping/On-Demand, credenciais e endpoint final da conta.'
  ),
  phase(
    'domain_dns',
    dnsDelivery.resolvesExpectedIp ? 'ready' : 'needs_external',
    dnsDelivery,
    dnsDelivery.resolvesExpectedIp ? '' : `Criar DNS delivery.becoartes.com apontando para ${expectedIp}.`
  ),
  phase(
    'remote_release',
    remoteRelease.checked ? (remoteRelease.ok ? 'ready' : 'not_ready') : 'needs_external',
    remoteRelease,
    remoteRelease.checked ? 'Atualizar release remoto via rsync seguro e validar nginx/docker.' : 'Rodar DELIVERY_READINESS_CHECK_VPS=1 npm run delivery:readiness antes de deploy/homologacao.'
  ),
  phase(
    'public_config',
    publicConfig.checked ? (publicConfig.ok && publicConfig.exposesSecretHints?.length === 0 ? 'ready' : 'not_ready') : 'needs_external',
    publicConfig,
    publicConfig.checked ? 'Corrigir config publica antes de abrir trafego.' : 'Informar DELIVERY_READINESS_CONFIG_URL apos deploy/homologacao para validar config publica.'
  ),
];

const blocking = phases.filter((item) => item.status !== 'ready');
const report = {
  ok: blocking.length === 0,
  strict,
  expectedIp,
  packageVersion: packageJson.version,
  phases,
  blocking: blocking.map((item) => ({ name: item.name, status: item.status, next: item.next })),
};

console.log(JSON.stringify(report, null, 2));

if (strict && blocking.length > 0) {
  process.exit(1);
}
