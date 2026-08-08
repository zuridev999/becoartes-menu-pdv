import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const contract = JSON.parse(
  readFileSync(resolve(process.cwd(), 'config/mega-module-baseline.json'), 'utf8'),
);
const violations = [];
const observed = {};

for (const [file, maximum] of Object.entries(contract.files)) {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8');
  const lines = source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0);
  observed[file] = lines;
  if (lines > maximum) violations.push(`${file}: ${lines} > ${maximum}`);
}

if (violations.length > 0) {
  console.error('Mega module growth detected:');
  for (const violation of violations) console.error(`- ${violation}`);
  console.error('Extract a focused module instead of increasing the baseline.');
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, observed }, null, 2));
