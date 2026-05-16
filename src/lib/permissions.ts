import type { Seller } from '../types';

export type PermissionKey =
  | 'viewSalesTotals'
  | 'manageSettings'
  | 'manageTeam'
  | 'manageOptionals'
  | 'addProduct'
  | 'editProductPrice'
  | 'deleteProduct'
  | 'toggleProductVisibility'
  | 'cancelTableItem'
  | 'closeBill';

type PermissionProfile = 'admin' | 'manager' | 'operator';

const legacyPermissionMap: Record<string, PermissionProfile> = {
  admin: 'admin',
  manager: 'manager',
  standard: 'manager',
  operator: 'operator',
  restricted: 'operator',
};

const permissionsByProfile: Record<PermissionProfile, Record<PermissionKey, boolean>> = {
  admin: {
    viewSalesTotals: true,
    manageSettings: true,
    manageTeam: true,
    manageOptionals: true,
    addProduct: true,
    editProductPrice: true,
    deleteProduct: true,
    toggleProductVisibility: true,
    cancelTableItem: true,
    closeBill: true,
  },
  manager: {
    viewSalesTotals: true,
    manageSettings: false,
    manageTeam: false,
    manageOptionals: true,
    addProduct: true,
    editProductPrice: true,
    deleteProduct: true,
    toggleProductVisibility: true,
    cancelTableItem: true,
    closeBill: true,
  },
  operator: {
    viewSalesTotals: false,
    manageSettings: false,
    manageTeam: false,
    manageOptionals: true,
    addProduct: true,
    editProductPrice: false,
    deleteProduct: false,
    toggleProductVisibility: true,
    cancelTableItem: false,
    closeBill: true,
  },
};

export const getPermissionProfile = (seller?: Seller | null): PermissionProfile => {
  return legacyPermissionMap[seller?.permission || 'operator'] || 'operator';
};

export const can = (seller: Seller | null | undefined, permission: PermissionKey) => {
  return permissionsByProfile[getPermissionProfile(seller)][permission];
};

export const getPermissionLabel = (seller?: Seller | null) => {
  const profile = getPermissionProfile(seller);
  if (profile === 'admin') return 'Admin full access';
  if (profile === 'manager') return 'Gerente';
  return 'Operador';
};
