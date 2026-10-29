import { CatalogApi } from './api';
import { useStore } from '../store';
import type { ModifierGroup } from '../types';

export async function commitModifierGroup(group: ModifierGroup) {
  await CatalogApi.saveModifierGroup(group);
  useStore.setState(state => ({
    modifierGroups: state.modifierGroups.map(item => item.id === group.id ? group : item),
  }));
  await useStore.getState().syncData({ includeCatalog: true });
}
