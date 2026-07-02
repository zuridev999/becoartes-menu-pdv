import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const confirmToken = 'deploy-delivery-release';
const confirmed = process.env.DELIVERY_DEPLOY_CONFIRM === confirmToken;
const host = process.env.DELIVERY_VPS_HOST || '72.60.252.50';
const user = process.env.DELIVERY_VPS_USER || 'root';
const key = process.env.DELIVERY_VPS_KEY || `${process.env.HOME}/.ssh/id_rsa_becoartes_ed`;
const releaseDir = process.env.DELIVERY_VPS_RELEASE_DIR || '/root/becoartes-operational-release';
const appCommit = process.env.APP_COMMIT || '';
const appVersion = process.env.APP_VERSION || '';

const rsyncArgs = [
  '-az',
  '--delete',
  '--itemize-changes',
  '--filter', 'protect .env*',
  '--exclude', '.git',
  '--exclude', '.DS_Store',
  '--exclude', 'node_modules',
  '--exclude', 'dist',
  '--exclude', '.env*',
  '--exclude', '_reports',
  '--exclude', 'local-delivery.db',
  '--exclude', 'local-delivery.db-shm',
  '--exclude', 'local-delivery.db-wal',
  '-e', `ssh -i ${key} -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new`,
  './',
  `${user}@${host}:${releaseDir}/`,
];

const run = async (cmd, args, options = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      maxBuffer: 1024 * 1024 * 20,
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

const sanitizeLines = (text) => String(text || '')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.replace(/(TOKEN|SECRET|PASSWORD|KEY)=([^ \n]+)/gi, '$1=<redacted>'));

const gitCommit = await run('git', ['rev-parse', '--short', 'HEAD']);
const gitDescribe = await run('git', ['describe', '--tags', '--abbrev=7', '--always']);
const gitStatus = await run('git', ['status', '--short']);

const failures = [];
if (!confirmed) failures.push(`confirmacao ausente: export DELIVERY_DEPLOY_CONFIRM=${confirmToken}`);
if (!gitCommit.ok) failures.push('git commit indisponivel');
if (!appCommit && !gitCommit.stdout) failures.push('APP_COMMIT indisponivel');
if (!appVersion && !gitDescribe.stdout) failures.push('APP_VERSION indisponivel');

let rsync = null;
let compose = null;
let remoteHealth = null;

if (failures.length === 0) {
  rsync = await run('rsync', rsyncArgs);
  if (!rsync.ok) failures.push('rsync falhou');
}

if (failures.length === 0) {
  const version = appVersion || gitDescribe.stdout;
  const commit = appCommit || gitCommit.stdout;
  const command = [
    `cd '${releaseDir}'`,
    'docker compose config >/dev/null',
    `VITE_APP_VERSION='${version}' VITE_APP_COMMIT='${commit}' docker compose up -d --build`,
  ].join(' && ');
  compose = await run('ssh', [
    '-i', key,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${user}@${host}`,
    command,
  ]);
  if (!compose.ok) failures.push('docker compose up remoto falhou');
}

if (failures.length === 0) {
  remoteHealth = await run('ssh', [
    '-i', key,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${user}@${host}`,
    'docker ps --format "{{.Names}} {{.Status}}" | head -20',
  ]);
  if (!remoteHealth.ok) failures.push('health remoto indisponivel');
}

const changedLines = rsync?.stdout
  ? rsync.stdout.split('\n').filter((line) => line.trim() && !line.startsWith('sending incremental file list'))
  : [];

const report = {
  ok: failures.length === 0,
  confirmed,
  host,
  user,
  releaseDir,
  git: {
    commit: gitCommit.stdout || null,
    describe: gitDescribe.stdout || null,
    dirtyFiles: gitStatus.stdout ? gitStatus.stdout.split('\n').length : 0,
  },
  rsync: rsync ? {
    ok: rsync.ok,
    changedCount: changedLines.length,
    sample: changedLines.slice(0, 80),
    stderr: sanitizeLines(rsync.stderr),
  } : null,
  compose: compose ? {
    ok: compose.ok,
    stdout: sanitizeLines(compose.stdout).slice(-80),
    stderr: sanitizeLines(compose.stderr).slice(-80),
  } : null,
  remoteHealth: remoteHealth ? {
    ok: remoteHealth.ok,
    stdout: sanitizeLines(remoteHealth.stdout),
    stderr: sanitizeLines(remoteHealth.stderr),
  } : null,
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  process.exit(1);
}
