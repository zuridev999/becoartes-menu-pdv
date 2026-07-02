import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const host = process.env.DELIVERY_VPS_HOST || '72.60.252.50';
const user = process.env.DELIVERY_VPS_USER || 'root';
const key = process.env.DELIVERY_VPS_KEY || `${process.env.HOME}/.ssh/id_rsa_becoartes_ed`;
const releaseDir = process.env.DELIVERY_VPS_RELEASE_DIR || '/root/becoartes-operational-release';
const strict = process.env.DELIVERY_DEPLOY_DRY_RUN_STRICT === '1';

const rsyncArgs = [
  '-azn',
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

const run = async (cmd, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      maxBuffer: 1024 * 1024 * 20,
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

const gitCommit = await run('git', ['rev-parse', '--short', 'HEAD']);
const gitDescribe = await run('git', ['describe', '--tags', '--abbrev=7', '--always']);
const gitStatus = await run('git', ['status', '--short']);
const rsync = await run('rsync', rsyncArgs);

const changedLines = rsync.stdout
  ? rsync.stdout.split('\n').filter((line) => line.trim() && !line.startsWith('sending incremental file list'))
  : [];

const forbidden = changedLines.filter((line) => (
  (line.includes('.env') && !line.startsWith('*deleting .env'))
  || line.includes('node_modules/')
  || line.includes('.git/')
  || line.includes('_reports/')
  || line.includes('local-delivery.db')
));

const failures = [];
if (!gitCommit.ok) failures.push('git commit indisponivel');
if (!rsync.ok) failures.push('rsync dry-run falhou');
if (forbidden.length > 0) failures.push('dry-run inclui arquivos proibidos');

const report = {
  ok: failures.length === 0,
  strict,
  host,
  user,
  releaseDir,
  git: {
    commit: gitCommit.stdout || null,
    describe: gitDescribe.stdout || null,
    dirtyFiles: gitStatus.stdout ? gitStatus.stdout.split('\n').length : 0,
  },
  rsync: {
    ok: rsync.ok,
    changedCount: changedLines.length,
    sample: changedLines.slice(0, 80),
    stderr: rsync.stderr,
  },
  forbidden,
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (strict && failures.length > 0) {
  process.exit(1);
}
