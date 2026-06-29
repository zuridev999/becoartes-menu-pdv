import dns from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const strict = process.env.DELIVERY_POST_DEPLOY_STRICT === '1';
const expectedIp = process.env.DELIVERY_POST_DEPLOY_EXPECTED_IP || '72.60.252.50';
const deliveryConfigUrl = process.env.DELIVERY_POST_DEPLOY_CONFIG_URL || 'https://delivery.becoartes.com/api/delivery/config';
const healthUrl = process.env.DELIVERY_POST_DEPLOY_HEALTH_URL || 'https://pdv.becoartes.com/api/health';
const checkVps = process.env.DELIVERY_POST_DEPLOY_CHECK_VPS !== '0';
const vpsHost = process.env.DELIVERY_VPS_HOST || '72.60.252.50';
const vpsUser = process.env.DELIVERY_VPS_USER || 'root';
const vpsKey = process.env.DELIVERY_VPS_KEY || `${process.env.HOME}/.ssh/id_rsa_becoartes_ed`;
const releaseDir = process.env.DELIVERY_VPS_RELEASE_DIR || '/root/becoartes-operational-release';

const domains = [
  'pdv.becoartes.com',
  'tablet.becoartes.com',
  'coz.becoartes.com',
  'bar.becoartes.com',
  'qr.becoartes.com',
  'delivery.becoartes.com',
];

const forbiddenHints = [
  'PAGBANK_TOKEN',
  'IFOOD_ACCESS_TOKEN',
  'TURSO_AUTH_TOKEN',
  'BFF_SESSION_SECRET',
  'JWT_SECRET',
  'SESSION_SECRET',
];

const run = async (cmd, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      maxBuffer: 1024 * 1024 * 6,
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

const fetchStatus = async (url, attempts = 2) => {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      return { status: response.status, error: null, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return { status: 0, error: lastError?.cause?.code || lastError?.message || 'request_failed', attempts };
};

const checkAuthoritativeDns = async (domain) => {
  const zone = domain.split('.').slice(-2).join('.');
  try {
    const nameservers = await dns.resolveNs(zone);
    const checks = await Promise.all(nameservers.map(async (nameserver) => {
      const result = { nameserver, addresses: [], resolvesExpectedIp: false };
      try {
        const nameserverIps = await dns.resolve4(nameserver);
        result.nameserverIps = nameserverIps;
        const resolver = new dns.Resolver();
        resolver.setServers(nameserverIps);
        const addresses = await resolver.resolve4(domain);
        result.addresses = addresses;
        result.resolvesExpectedIp = addresses.includes(expectedIp);
      } catch (error) {
        result.error = error.code || error.message;
      }
      return result;
    }));
    return { zone, nameservers: checks };
  } catch (error) {
    return { zone, nameservers: [], error: error.code || error.message };
  }
};

const checkDomain = async (domain) => {
  const result = {
    domain,
    addresses: [],
    resolvesExpectedIp: false,
    httpStatus: null,
    httpsStatus: null,
    httpError: null,
    httpsError: null,
  };

  if (domain === 'delivery.becoartes.com') {
    result.authoritative = await checkAuthoritativeDns(domain);
  }

  try {
    result.addresses = await dns.resolve4(domain);
    result.resolvesExpectedIp = result.addresses.includes(expectedIp);
  } catch (error) {
    result.dnsError = error.code || error.message;
  }

  for (const protocol of ['http', 'https']) {
    const checked = await fetchStatus(`${protocol}://${domain}`);
    result[`${protocol}Status`] = checked.status;
    result[`${protocol}Error`] = checked.error;
    result[`${protocol}Attempts`] = checked.attempts;
  }

  return result;
};

const checkDeliveryConfig = async () => {
  try {
    const response = await fetch(deliveryConfigUrl, { signal: AbortSignal.timeout(8000) });
    const payload = await response.json().catch(() => null);
    const serialized = JSON.stringify(payload || {});
    return {
      ok: response.ok && payload?.ok === true,
      status: response.status,
      exposesSecretHints: forbiddenHints.filter((hint) => serialized.includes(hint)),
      mode: payload?.data?.mode || null,
      routes: payload?.data?.routes || null,
      webhookSecretEnabled: payload?.data?.webhookSecretEnabled ?? null,
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.cause?.code || error.message };
  }
};

const checkHealth = async () => {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) });
    const payload = await response.json().catch(() => null);
    const serialized = JSON.stringify(payload || {});
    return {
      ok: response.ok && payload?.status === 'healthy' && payload?.db?.ok === true,
      status: response.status,
      appStatus: payload?.status || null,
      version: payload?.version || null,
      commit: payload?.commit || null,
      uptimeSeconds: Number.isFinite(Number(payload?.uptimeSeconds)) ? Number(payload.uptimeSeconds) : null,
      dbOk: payload?.db?.ok ?? null,
      dbLatencyMs: payload?.db?.latencyMs ?? null,
      dbError: payload?.db?.error || null,
      exposesSecretHints: forbiddenHints.filter((hint) => serialized.includes(hint)),
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.cause?.code || error.message };
  }
};

const checkRemote = async () => {
  if (!checkVps) return { checked: false };
  const command = `
    set -eu
    if [ -d '${releaseDir}' ]; then
      echo "release_dir=exists"
      cd '${releaseDir}'
      test -f nginx.conf && echo "nginx_conf=present" || echo "nginx_conf=missing"
      grep -q 'delivery.becoartes.com' nginx.conf && echo "delivery_nginx=present" || echo "delivery_nginx=missing"
      test -f docker-compose.yml && echo "compose=present" || echo "compose=missing"
      grep -q 'DELIVERY_PAYMENT_PROVIDER' docker-compose.yml && echo "delivery_envs=present" || echo "delivery_envs=missing"
      docker compose ps --format json 2>/dev/null | head -20 || true
    else
      echo "release_dir=missing"
    fi
  `;
  const result = await run('ssh', [
    '-i', vpsKey,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${vpsUser}@${vpsHost}`,
    command,
  ]);
  const lines = result.stdout.split('\n').filter(Boolean);
  return {
    checked: true,
    ok: result.ok
      && lines.includes('release_dir=exists')
      && lines.includes('nginx_conf=present')
      && lines.includes('delivery_nginx=present')
      && lines.includes('compose=present')
      && lines.includes('delivery_envs=present'),
    host: vpsHost,
    releaseDir,
    summary: lines.filter((line) => !line.includes('{')).slice(0, 30),
    error: result.ok ? null : result.stderr,
  };
};

const [domainResults, config, health, remote] = await Promise.all([
  Promise.all(domains.map(checkDomain)),
  checkDeliveryConfig(),
  checkHealth(),
  checkRemote(),
]);

const failures = [];
for (const domain of domainResults) {
  if (!domain.resolvesExpectedIp) failures.push(`${domain.domain} nao resolve para ${expectedIp}`);
  if (domain.domain !== 'bar.becoartes.com' && ![200, 301, 302, 307, 308].includes(domain.httpStatus)) {
    failures.push(`${domain.domain} HTTP inesperado (${domain.httpStatus})`);
  }
  if (domain.domain !== 'bar.becoartes.com' && ![200, 301, 302, 307, 308].includes(domain.httpsStatus)) {
    failures.push(`${domain.domain} HTTPS inesperado (${domain.httpsStatus})`);
  }
}

const deliveryDomain = domainResults.find((domain) => domain.domain === 'delivery.becoartes.com');
const brokenDeliveryNameservers = deliveryDomain?.authoritative?.nameservers?.filter((item) => !item.resolvesExpectedIp) || [];
if (brokenDeliveryNameservers.length > 0) {
  failures.push(`delivery.becoartes.com inconsistente nos nameservers autoritativos: ${brokenDeliveryNameservers.map((item) => item.nameserver).join(', ')}`);
}

if (!config.ok) failures.push(`config delivery indisponivel (${config.status})`);
if (config.exposesSecretHints?.length) failures.push(`config delivery expõe hints sensiveis: ${config.exposesSecretHints.join(', ')}`);
if (!health.ok) failures.push(`healthcheck degradado (${health.status || 0}, app=${health.appStatus || 'unknown'}, db=${health.dbOk})`);
if (health.exposesSecretHints?.length) failures.push(`healthcheck expõe hints sensiveis: ${health.exposesSecretHints.join(', ')}`);
if (remote.checked && !remote.ok) failures.push('release remoto ainda nao contem delivery completo');

const report = {
  ok: failures.length === 0,
  strict,
  expectedIp,
  deliveryConfigUrl,
  healthUrl,
  domains: domainResults,
  config,
  health,
  remote,
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (strict && failures.length > 0) {
  process.exit(1);
}
