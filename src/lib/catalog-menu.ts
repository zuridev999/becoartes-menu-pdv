import type { Category, ModifierGroup, Product } from '../types';

export const attachModifierGroupsToMenu = (
  menuItems: Product[],
  modifierGroups: ModifierGroup[],
  productMapping: Record<string, string[]>,
  categoryMapping: Record<string, string[]>,
) => {
  const groupById = Object.fromEntries(modifierGroups.map(group => [group.id, group]));
  return menuItems.map(item => {
    const groupIds = Array.from(new Set([
      ...(productMapping[item.id] || []),
      ...(categoryMapping[item.categoryId] || []),
    ]));
    return {
      ...item,
      modifierGroups: groupIds
        .map(groupId => groupById[groupId] ? {
          ...groupById[groupId],
          modifiers: groupById[groupId].modifiers.filter(modifier => (
            modifier.status !== 'inactive' && !modifier.inheritedUnavailable
          )),
        } : null)
        .filter((group): group is ModifierGroup => Boolean(group && group.modifiers.length > 0)),
    };
  });
};

export const sortProductsByCatalogOrder = (menuItems: Product[], categories: Category[]) => {
  const categoryOrder = new Map(categories.map((category, index) => [category.id, Number(category.sortOrder ?? index)]));
  return menuItems
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const categoryDiff = (categoryOrder.get(a.item.categoryId) ?? 9999) - (categoryOrder.get(b.item.categoryId) ?? 9999);
      if (categoryDiff !== 0) return categoryDiff;
      const orderDiff = Number(a.item.sortOrder ?? 0) - Number(b.item.sortOrder ?? 0);
      return orderDiff !== 0 ? orderDiff : a.index - b.index;
    })
    .map(({ item }) => item);
};
