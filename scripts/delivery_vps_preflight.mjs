import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const host = process.env.DELIVERY_VPS_HOST || '72.60.252.50';
const user = process.env.DELIVERY_VPS_USER || 'root';
const key = process.env.DELIVERY_VPS_KEY || `${process.env.HOME}/.ssh/id_rsa_becoartes_ed`;
const releaseDir = process.env.DELIVERY_VPS_RELEASE_DIR || '/root/becoartes-operational-release';
const legacyDir = process.env.DELIVERY_VPS_LEGACY_DIR || '/root/becoartes-operational';
const strict = process.env.DELIVERY_VPS_PREFLIGHT_STRICT === '1';

const sshBaseArgs = [
  '-i', key,
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=8',
  '-o', 'StrictHostKeyChecking=accept-new',
  `${user}@${host}`,
];

const runSsh = async (command) => {
  try {
    const { stdout, stderr } = await execFileAsync('ssh', [...sshBaseArgs, command], {
      maxBuffer: 1024 * 1024 * 4,
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

const checks = {};

checks.identity = await runSsh('printf "host=%s user=%s\\n" "$(hostname)" "$(whoami)"');
checks.directories = await runSsh(`
  set -eu
  for d in '${releaseDir}' '${legacyDir}'; do
    if [ -d "$d" ]; then
      printf "%s exists\\n" "$d"
    else
      printf "%s missing\\n" "$d"
    fi
  done
`);
checks.releaseFiles = await runSsh(`
  set -eu
  if [ -d '${releaseDir}' ]; then
    cd '${releaseDir}'
    test -f docker-compose.yml && echo "docker-compose.yml exists" || echo "docker-compose.yml missing"
    test -f nginx.conf && echo "nginx.conf exists" || echo "nginx.conf missing"
    if [ -f nginx.conf ] && grep -q 'delivery.becoartes.com' nginx.conf; then
      echo "nginx delivery host present"
    else
      echo "nginx delivery host missing"
    fi
  else
    echo "release dir missing"
  fi
`);
checks.docker = await runSsh('docker --version 2>/dev/null && docker compose version 2>/dev/null');
checks.runningContainers = await runSsh('docker ps --format "{{.Names}} {{.Status}}" 2>/dev/null | head -20');
checks.safeNginxSearch = await runSsh(`
  set -eu
  if command -v nginx >/dev/null 2>&1; then
    nginx -t 2>&1 | sed -E 's#(/[[:alnum:]_.-]+)+#<path>#g'
  else
    echo "nginx binary not installed on host"
  fi
`);

const failures = [];
if (!checks.identity.ok) failures.push('ssh indisponivel');
if (!checks.directories.stdout.includes(`${releaseDir} exists`)) failures.push('release dir ausente');
if (!checks.releaseFiles.stdout.includes('docker-compose.yml exists')) failures.push('docker-compose.yml ausente no release');
if (!checks.releaseFiles.stdout.includes('nginx delivery host present')) failures.push('delivery host ausente no nginx.conf do release');
if (!checks.docker.ok) failures.push('docker/compose indisponivel');

const report = {
  ok: failures.length === 0,
  strict,
  host,
  user,
  releaseDir,
  checks: Object.fromEntries(Object.entries(checks).map(([name, result]) => [name, {
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
  }])),
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (strict && failures.length > 0) {
  process.exit(1);
}
