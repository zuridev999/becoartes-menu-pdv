import assert from 'node:assert/strict';
import { attachModifierGroupsToMenu } from '../src/lib/catalog-menu.ts';

const products = [
  { id: 'burger', categoryId: 'food', modifierGroups: [] },
  { id: 'combo', categoryId: 'food', modifierGroups: [] },
];
const groups = [{
  id: 'extras',
  name: 'Adicionais',
  minChoices: 0,
  maxChoices: 2,
  isRequired: false,
  status: 'active',
  modifiers: [
    { id: 'coke-extra', name: 'Coca-Cola', price: 10.9, status: 'active', linkedProductId: 'coke', inheritedUnavailable: true },
    { id: 'no-onion', name: 'Sem cebola', price: 0, status: 'active' },
  ],
}];

const hiddenCatalog = attachModifierGroupsToMenu(products, groups, { burger: ['extras'] }, { food: ['extras'] });
assert.deepEqual(hiddenCatalog.map(product => product.modifierGroups[0].modifiers.map(modifier => modifier.id)), [
  ['no-onion'],
  ['no-onion'],
], 'hidden master product must disappear from every product and category occurrence');
assert.equal(hiddenCatalog[0].modifierGroups.length, 1, 'same group linked by product and category must not be duplicated');

groups[0].modifiers[0].inheritedUnavailable = false;
const visibleCatalog = attachModifierGroupsToMenu(products, groups, { burger: ['extras'] }, { food: ['extras'] });
assert.equal(visibleCatalog.every(product => product.modifierGroups[0].modifiers.some(modifier => modifier.id === 'coke-extra')), true);

console.log('Catalog modifier linkage regression passed.');
