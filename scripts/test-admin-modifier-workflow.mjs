import assert from 'node:assert/strict';
import fs from 'node:fs';

const adminView = fs.readFileSync(new URL('../src/views/admin/AdminView.tsx', import.meta.url), 'utf8');
const productEditor = fs.readFileSync(new URL('../src/views/admin/ProductModifierGroupsEditor.tsx', import.meta.url), 'utf8');
const sharedEditor = fs.readFileSync(new URL('../src/views/admin/SharedGroupEditor.tsx', import.meta.url), 'utf8');
const groupCatalog = fs.readFileSync(new URL('../src/views/admin/ModifierGroupCatalog.tsx', import.meta.url), 'utf8');
const optionEditor = fs.readFileSync(new URL('../src/views/admin/ModifierOptionEditor.tsx', import.meta.url), 'utf8');

assert.match(
  adminView,
  /<ProductModifierGroupsEditor[\s\S]*?productMapping=\{productModifierMapping\}[\s\S]*?categoryMapping=\{categoryModifierMapping\}/,
  'O editor do produto precisa receber vínculos diretos e herdados separadamente.',
);
assert.match(
  adminView,
  /if \(exists \|\| !canEditProductFields\) \{[\s\S]*?delete cleanProduct\.modifierGroups;/,
  'Salvar um produto existente não pode substituir vínculos por uma projeção mesclada.',
);
assert.match(
  productEditor,
  /Categoria \+ direto[\s\S]*?Herdado de[\s\S]*?Vínculo direto/,
  'A interface precisa identificar a origem de cada vínculo.',
);
assert.match(
  sharedEditor,
  /Alterações nas opções valem em todos os produtos que usam este grupo/,
  'A edição inline precisa avisar sobre o impacto global do grupo.',
);
assert.match(
  sharedEditor,
  /disabled=\{!canEdit\}[\s\S]*?Adicionar opção/,
  'Usuários sem permissão não podem alterar opções pelo produto.',
);
assert.match(
  optionEditor,
  /disabled\?: boolean[\s\S]*?disabled=\{disabled\}/,
  'O editor de opção precisa respeitar o modo somente leitura.',
);
assert.match(
  groupCatalog,
  /Catálogo de adicionais[\s\S]*?Buscar grupo ou sabor[\s\S]*?vínculo/,
  'A aba de adicionais precisa oferecer catálogo pesquisável e mostrar uso dos grupos.',
);

console.log('Admin modifier workflow regression passed.');
