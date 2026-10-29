import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['src/lib/public-i18n.tsx'], bundle: true, platform: 'node', format: 'esm', write: false });
const { getDefaultPublicCopy, getCatalogBaseTranslation, getPublicLanguages } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const pt = getDefaultPublicCopy('pt-BR');
const placeholders = (text) => [...text.matchAll(/{{(\w+)}}/g)].map((match) => match[1]).sort();
for (const locale of ['en-US', 'es-ES', 'fr-FR']) {
  const copy = getDefaultPublicCopy(locale);
  for (const [key, source] of Object.entries(pt)) {
    assert.ok(copy[key]?.trim(), `${locale}: missing ${key}`);
    assert.deepEqual(placeholders(copy[key]), placeholders(source), `${locale}: interpolation ${key}`);
  }
}
assert.equal(getPublicLanguages().find((l) => l.code === 'fr-FR').enabled, true);
assert.equal(getPublicLanguages({ publicLanguages: [{ code: 'fr-FR', enabled: false }] }).find((l) => l.code === 'fr-FR').enabled, false);
assert.equal(getCatalogBaseTranslation('fr-FR', '  MARACUJÁ '), 'Fruit de la passion');
assert.equal(getCatalogBaseTranslation('fr-FR', 'Contra Filé Acebolado para 2 (batata inclusa)'), 'Faux-filet aux oignons pour deux (frites incluses)');
assert.equal(getCatalogBaseTranslation('en-US', 'Escolha o sabor'), 'Choose your flavor');
assert.equal(getCatalogBaseTranslation('fr-FR', 'unknown new product'), undefined, 'Unknown products must keep their source text instead of inventing a translation.');

// Optional read-only snapshot: validate the entire currently visible production catalog.
const snapshotPath = process.env.QR_CATALOG_SNAPSHOT;
let checked = 0;
if (snapshotPath) {
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const catalog = (snapshot.data || snapshot).catalogData;
  const categories = catalog.categories.filter((c) => c.visible !== false);
  const categoryIds = new Set(categories.map((c) => c.id));
  const products = catalog.menuItems.filter((p) => p.visible !== false && categoryIds.has(p.categoryId));
  const groups = catalog.modifierGroups.filter((g) => g.status === 'active');
  const sources = [...categories, ...products, ...groups, ...groups.flatMap((g) => g.modifiers.filter((m) => m.status === 'active'))];
  for (const item of sources) for (const field of ['name', 'description']) {
    if (!item[field]?.trim()) continue;
    for (const locale of ['en-US', 'es-ES', 'fr-FR']) {
      assert.ok(getCatalogBaseTranslation(locale, item[field]), `${locale}: untranslated ${field}: ${item[field]}`);
      checked++;
    }
  }
}
console.log(JSON.stringify({ ok: true, languages: 4, interfaceKeys: Object.keys(pt).length, checkedCatalogFields: checked }));
