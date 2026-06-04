import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const files = [];

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    if (stat.isFile() && /\.(tsx|ts)$/.test(entry)) files.push(full);
  }
};

walk(root);

const findings = [];
let buttonCount = 0;
let anchorCount = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const relative = file.replace(root, 'src/');
  const buttonMatches = source.matchAll(/<button\b([\s\S]*?)>/g);
  for (const match of buttonMatches) {
    buttonCount += 1;
    const attrs = match[1] || '';
    const line = source.slice(0, match.index).split('\n').length;
    if (/onClick=\{\s*(?:\(\s*\)|\([^)]*\))\s*=>\s*\{\s*\}\s*\}/.test(attrs)) {
      findings.push({ severity: 'error', type: 'empty-onClick', file: relative, line });
    }
    if (!/onClick=|type=|aria-label=|disabled=/.test(attrs)) {
      findings.push({ severity: 'warn', type: 'button-without-obvious-action', file: relative, line });
    }
    if (!/type=/.test(attrs) && source.includes('<form')) {
      findings.push({ severity: 'warn', type: 'button-without-type-in-form-file', file: relative, line });
    }
  }

  const anchorMatches = source.matchAll(/<a\b([\s\S]*?)>/g);
  for (const match of anchorMatches) {
    anchorCount += 1;
    const attrs = match[1] || '';
    const line = source.slice(0, match.index).split('\n').length;
    if (/href=["']#["']/.test(attrs)) {
      findings.push({ severity: 'error', type: 'empty-anchor-href', file: relative, line });
    }
  }
}

const errors = findings.filter((finding) => finding.severity === 'error');
const report = {
  project: 'pdv',
  buttonCount,
  anchorCount,
  findingCount: findings.length,
  errorCount: errors.length,
  findings,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) process.exit(1);
