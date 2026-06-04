import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const strict = process.env.DELIVERY_PREFLIGHT_STRICT === '1';
const runChecks = process.env.DELIVERY_PREFLIGHT_RUN_CHECKS === '1';
const configUrl = process.env.DELIVERY_PREFLIGHT_CONFIG_URL || '';
const expectedIp = process.env.DELIVERY_PREFLIGHT_EXPECTED_IP || '72.60.252.50';
const domains = [
  'pdv.becoartes.com',
  'tablet.becoartes.com',
  'coz.becoartes.com',
  'bar.becoartes.com',
  'qr.becoartes.com',
  'delivery.becoartes.com',
];

const commandResult = async (cmd, args, options = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      maxBuffer: 1024 * 1024 * 10,
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

const checkDomain = async (domain) => {
  const result = { domain, addresses: [], expectedIp, resolvesExpectedIp: false, httpStatus: null, error: null };
  try {
    result.addresses = await dns.resolve4(domain);
    result.resolvesExpectedIp = result.addresses.includes(expectedIp);
  } catch (error) {
    result.error = error.code || error.message;
  }

  try {
    const response = await fetch(`http://${domain}`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    result.httpStatus = response.status;
  } catch (error) {
    result.httpStatus = 0;
    result.httpError = error.cause?.code || error.message;
  }

  return result;
};

const safePublicConfig = async () => {
  if (!configUrl) return null;
  try {
    const response = await fetch(configUrl, { signal: AbortSignal.timeout(8000) });
    const payload = await response.json().catch(() => null);
    return {
      ok: response.ok && payload?.ok === true,
      status: response.status,
      data: payload?.data || null,
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.cause?.code || error.message };
  }
};

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const gitStatus = await commandResult('git', ['status', '--short']);
const gitCommit = await commandResult('git', ['rev-parse', '--short', 'HEAD']);
const gitDescribe = await commandResult('git', ['describe', '--tags', '--abbrev=7', '--always']);
const dockerComposeConfig = await commandResult('docker', ['compose', 'config']);

const optionalChecks = [];
if (runChecks) {
  optionalChecks.push(['node-check-bff', await commandResult('node', ['--check', 'server/bff.mjs'])]);
  optionalChecks.push(['node-check-delivery-smoke', await commandResult('node', ['--check', 'scripts/delivery_smoke.mjs'])]);
  optionalChecks.push(['build', await commandResult('npm', ['run', 'build'])]);
  optionalChecks.push(['lint', await commandResult('npm', ['run', 'lint'])]);
}

const domainResults = await Promise.all(domains.map(checkDomain));
const publicConfig = await safePublicConfig();

const failures = [];
if (!gitCommit.ok) failures.push('git commit indisponivel');
if (!dockerComposeConfig.ok) failures.push('docker compose config falhou');
for (const domain of domainResults) {
  if (domain.domain !== 'delivery.becoartes.com' && !domain.resolvesExpectedIp) {
    failures.push(`${domain.domain} nao resolve para ${expectedIp}`);
  }
}
const deliveryDomain = domainResults.find((domain) => domain.domain === 'delivery.becoartes.com');
if (!deliveryDomain?.resolvesExpectedIp) failures.push(`delivery.becoartes.com ainda nao resolve para ${expectedIp}`);
if (publicConfig && !publicConfig.ok) failures.push(`config publica delivery indisponivel (${publicConfig.status})`);
for (const [name, result] of optionalChecks) {
  if (!result.ok) failures.push(`${name} falhou`);
}

const report = {
  ok: failures.length === 0,
  strict,
  runChecks,
  packageVersion: packageJson.version,
  git: {
    commit: gitCommit.stdout || null,
    describe: gitDescribe.stdout || null,
    dirtyFiles: gitStatus.stdout ? gitStatus.stdout.split('\n').length : 0,
  },
  dockerComposeConfig: {
    ok: dockerComposeConfig.ok,
    warnings: dockerComposeConfig.stderr ? dockerComposeConfig.stderr.split('\n').slice(0, 5) : [],
  },
  domains: domainResults,
  publicConfig,
  optionalChecks: Object.fromEntries(optionalChecks.map(([name, result]) => [name, { ok: result.ok }])),
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (strict && failures.length > 0) {
  process.exit(1);
}
