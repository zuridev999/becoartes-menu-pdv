import assert from 'node:assert/strict';
import { scrollCatalogToSection } from '../src/lib/catalog-scroll.ts';

let requested;
const container = {
  scrollTop: 450, scrollHeight: 5000, clientHeight: 600,
  getBoundingClientRect: () => ({ top: 114 }),
  scrollTo: value => { requested = value; },
};
// The target is located relative to the list, not to the page or a clipping ancestor.
scrollCatalogToSection(container, { getBoundingClientRect: () => ({ top: 930 }) });
assert.deepEqual(requested, { top: 1250, behavior: 'auto' });
scrollCatalogToSection(container, null);
assert.equal(requested.top, 0, 'Returning to the menu restores its beginning.');
scrollCatalogToSection(container, { getBoundingClientRect: () => ({ top: -2000 }) });
assert.equal(requested.top, 0);
scrollCatalogToSection(container, { getBoundingClientRect: () => ({ top: 20000 }) });
assert.equal(requested.top, 4400, 'Last category stays within the available scroll range.');
container.scrollHeight = 200;
scrollCatalogToSection(container, null);
assert.equal(requested.top, 0, 'A short or filtered catalog does not scroll backwards.');
console.log('Catalog container scrolling passed.');
