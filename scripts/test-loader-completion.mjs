import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../src/components/common/Loaders.tsx', import.meta.url), 'utf8');

assert.match(app, /useCallback/, 'App precisa estabilizar o callback do carregador.');
assert.match(
  app,
  /const handleAnimationComplete = useCallback\(\(\) => \{[\s\S]*?setAnimationFinished\(true\);[\s\S]*?\}, \[\]\);/,
  'Callback de conclusão precisa manter identidade estável entre renders.',
);
assert.match(
  loader,
  /setTimeout\(\(\) => \{[\s\S]*?onComplete\(\);[\s\S]*?\}, 250\)/,
  'Loader precisa concluir após o carregamento dos dados.',
);

console.log('Loader completion regression passed.');
