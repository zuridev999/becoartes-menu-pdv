import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baseline = JSON.parse(
  readFileSync(resolve(process.cwd(), '.quality/eslint-baseline.json'), 'utf8'),
);
const eslintBin = resolve(process.cwd(), 'node_modules/eslint/bin/eslint.js');
const result = spawnSync(process.execPath, [eslintBin, baseline.scope, '--format', 'json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (!result.stdout.trim()) {
  process.stderr.write(result.stderr || 'ESLint did not return a JSON report.\n');
  process.exit(1);
}

const report = JSON.parse(result.stdout);
const counts = new Map();
let errors = 0;
let warnings = 0;

for (const file of report) {
  errors += Number(file.errorCount || 0);
  warnings += Number(file.warningCount || 0);
  for (const message of file.messages || []) {
    const rule = message.ruleId || 'unclassified';
    counts.set(rule, (counts.get(rule) || 0) + 1);
  }
}

const regressions = [];
if (errors > 0) regressions.push(`${errors} ESLint error(s)`);
if (warnings > baseline.maxWarnings) {
  regressions.push(`warnings ${warnings} > baseline ${baseline.maxWarnings}`);
}
for (const [rule, count] of counts) {
  const allowed = Number(baseline.rules[rule] || 0);
  if (count > allowed) regressions.push(`${rule}: ${count} > ${allowed}`);
}

if (regressions.length > 0) {
  console.error('ESLint debt regression detected:');
  for (const regression of regressions) console.error(`- ${regression}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  scope: baseline.scope,
  errors,
  warnings,
  maxWarnings: baseline.maxWarnings,
}, null, 2));
