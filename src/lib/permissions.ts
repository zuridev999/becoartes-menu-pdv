import type { Seller } from '../types';

export type PermissionKey =
  | 'accessPDV'
  | 'viewSalesTotals'
  | 'viewCashSummary'
  | 'viewFinancialReports'
  | 'manageSettings'
  | 'manageTeam'
  | 'managePDVUsers'
  | 'managePDVPermissions'
  | 'manageCoupons'
  | 'manageRoles'
  | 'manageOptionals'
  | 'addProduct'
  | 'editProduct'
  | 'editProductPrice'
  | 'deleteProduct'
  | 'toggleProductVisibility'
  | 'manageCategories'
  | 'sellUnavailableProduct'
  | 'viewZeroStockProducts'
  | 'openCash'
  | 'closeCash'
  | 'cashWithdrawal'
  | 'cashSupply'
  | 'applyDiscount'
  | 'editServiceFee'
  | 'openTable'
  | 'updateTableStatus'
  | 'transferTable'
  | 'joinTables'
  | 'splitBill'
  | 'reopenPaidBill'
  | 'viewOtherOperatorTables'
  | 'resolveServiceRequest'
  | 'addOrderItem'
  | 'removeCartItem'
  | 'changeItemQuantity'
  | 'editItemNotes'
  | 'sendOrderToProduction'
  | 'cancelTableItem'
  | 'cancelOrder'
  | 'cancelSale'
  | 'launchPayment'
  | 'changePaymentMethod'
  | 'splitPayment'
  | 'cancelPayment'
  | 'refundPayment'
  | 'closeBill'
  | 'viewStock'
  | 'adjustStock'
  | 'confirmPurchaseEntry'
  | 'editPurchaseEntry'
  | 'cancelPurchaseEntry'
  | 'viewNegativeStock'
  | 'receiveStockAlerts'
  | 'manageShifts'
  | 'viewSchedule'
  | 'editSchedule'
  | 'manageFreelancers'
  | 'approveFreelancerHours'
  | 'manageFreelancerPayments'
  | 'reprintReceipt'
  | 'viewSalesHistory'
  | 'accessFullReports'
  | 'accessSensitiveData';

export type PermissionProfile = 'admin' | 'manager' | 'operator';
export type PermissionMatrix = Partial<Record<PermissionProfile, Partial<Record<PermissionKey, boolean>>>>;
export type UserPermissionMatrix = Record<string, Partial<Record<PermissionKey, boolean>>>;

const legacyPermissionMap: Record<string, PermissionProfile> = {
  admin: 'admin',
  manager: 'manager',
  standard: 'manager',
  operator: 'operator',
  restricted: 'operator',
};

export const defaultPermissionsByProfile: Record<PermissionProfile, Record<PermissionKey, boolean>> = {
  admin: {
    accessPDV: true,
    viewSalesTotals: true,
    viewCashSummary: true,
    viewFinancialReports: true,
    manageSettings: true,
    manageTeam: true,
    managePDVUsers: true,
    managePDVPermissions: true,
    manageCoupons: true,
    manageRoles: true,
    manageOptionals: true,
    addProduct: true,
    editProduct: true,
    editProductPrice: true,
    deleteProduct: true,
    toggleProductVisibility: true,
    manageCategories: true,
    sellUnavailableProduct: true,
    viewZeroStockProducts: true,
    openCash: true,
    closeCash: true,
    cashWithdrawal: true,
    cashSupply: true,
    applyDiscount: true,
    editServiceFee: true,
    openTable: true,
    updateTableStatus: true,
    transferTable: true,
    joinTables: true,
    splitBill: true,
    reopenPaidBill: true,
    viewOtherOperatorTables: true,
    resolveServiceRequest: true,
    addOrderItem: true,
    removeCartItem: true,
    changeItemQuantity: true,
    editItemNotes: true,
    sendOrderToProduction: true,
    cancelTableItem: true,
    cancelOrder: true,
    cancelSale: true,
    launchPayment: true,
    changePaymentMethod: true,
    splitPayment: true,
    cancelPayment: true,
    refundPayment: true,
    closeBill: true,
    viewStock: true,
    adjustStock: true,
    confirmPurchaseEntry: true,
    editPurchaseEntry: true,
    cancelPurchaseEntry: true,
    viewNegativeStock: true,
    receiveStockAlerts: true,
    manageShifts: true,
    viewSchedule: true,
    editSchedule: true,
    manageFreelancers: true,
    approveFreelancerHours: true,
    manageFreelancerPayments: true,
    reprintReceipt: true,
    viewSalesHistory: true,
    accessFullReports: true,
    accessSensitiveData: true,
  },
  manager: {
    accessPDV: true,
    viewSalesTotals: true,
    viewCashSummary: true,
    viewFinancialReports: true,
    manageSettings: false,
    manageTeam: false,
    managePDVUsers: false,
    managePDVPermissions: false,
    manageCoupons: false,
    manageRoles: false,
    manageOptionals: true,
    addProduct: true,
    editProduct: true,
    editProductPrice: true,
    deleteProduct: true,
    toggleProductVisibility: true,
    manageCategories: true,
    sellUnavailableProduct: true,
    viewZeroStockProducts: true,
    openCash: true,
    closeCash: true,
    cashWithdrawal: true,
    cashSupply: true,
    applyDiscount: true,
    editServiceFee: true,
    openTable: true,
    updateTableStatus: true,
    transferTable: true,
    joinTables: true,
    splitBill: true,
    reopenPaidBill: true,
    viewOtherOperatorTables: true,
    resolveServiceRequest: true,
    addOrderItem: true,
    removeCartItem: true,
    changeItemQuantity: true,
    editItemNotes: true,
    sendOrderToProduction: true,
    cancelTableItem: true,
    cancelOrder: true,
    cancelSale: true,
    launchPayment: true,
    changePaymentMethod: true,
    splitPayment: true,
    cancelPayment: true,
    refundPayment: true,
    closeBill: true,
    viewStock: true,
    adjustStock: true,
    confirmPurchaseEntry: true,
    editPurchaseEntry: true,
    cancelPurchaseEntry: true,
    viewNegativeStock: true,
    receiveStockAlerts: true,
    manageShifts: true,
    viewSchedule: true,
    editSchedule: true,
    manageFreelancers: true,
    approveFreelancerHours: true,
    manageFreelancerPayments: true,
    reprintReceipt: true,
    viewSalesHistory: true,
    accessFullReports: true,
    accessSensitiveData: false,
  },
  operator: {
    accessPDV: true,
    viewSalesTotals: false,
    viewCashSummary: false,
    viewFinancialReports: false,
    manageSettings: false,
    manageTeam: false,
    managePDVUsers: false,
    managePDVPermissions: false,
    manageCoupons: false,
    manageRoles: false,
    manageOptionals: true,
    addProduct: true,
    editProduct: true,
    editProductPrice: false,
    deleteProduct: false,
    toggleProductVisibility: true,
    manageCategories: true,
    sellUnavailableProduct: true,
    viewZeroStockProducts: false,
    openCash: true,
    closeCash: true,
    cashWithdrawal: false,
    cashSupply: false,
    applyDiscount: false,
    editServiceFee: true,
    openTable: true,
    updateTableStatus: true,
    transferTable: true,
    joinTables: true,
    splitBill: true,
    reopenPaidBill: false,
    viewOtherOperatorTables: true,
    resolveServiceRequest: true,
    addOrderItem: true,
    removeCartItem: true,
    changeItemQuantity: true,
    editItemNotes: true,
    sendOrderToProduction: true,
    cancelTableItem: false,
    cancelOrder: false,
    cancelSale: false,
    launchPayment: true,
    changePaymentMethod: true,
    splitPayment: true,
    cancelPayment: true,
    refundPayment: false,
    closeBill: true,
    viewStock: false,
    adjustStock: false,
    confirmPurchaseEntry: false,
    editPurchaseEntry: false,
    cancelPurchaseEntry: false,
    viewNegativeStock: false,
    receiveStockAlerts: true,
    manageShifts: true,
    viewSchedule: true,
    editSchedule: false,
    manageFreelancers: false,
    approveFreelancerHours: false,
    manageFreelancerPayments: false,
    reprintReceipt: true,
    viewSalesHistory: false,
    accessFullReports: false,
    accessSensitiveData: false,
  },
};

export const permissionLabels: Record<PermissionKey, string> = {
  accessPDV: 'Acessar PDV',
  viewSalesTotals: 'Ver totais e relatórios',
  viewCashSummary: 'Visualizar resumo do caixa',
  viewFinancialReports: 'Relatórios financeiros',
  manageSettings: 'Configurações gerais',
  manageTeam: 'Equipe geral',
  managePDVUsers: 'Usuários do PDV',
  managePDVPermissions: 'Editar permissões do PDV',
  manageCoupons: 'Gerar cupons',
  manageRoles: 'Criar cargos/funções',
  manageOptionals: 'Opcionais/adicionais',
  addProduct: 'Cadastrar produtos/categorias',
  editProduct: 'Editar produto',
  editProductPrice: 'Alterar preço',
  deleteProduct: 'Excluir produtos/categorias',
  toggleProductVisibility: 'Ativar/desativar produto',
  manageCategories: 'Alterar categorias/cardápio',
  sellUnavailableProduct: 'Vender produto invisível/indisponível',
  viewZeroStockProducts: 'Ver produto zerado/negativo no PDV',
  openCash: 'Abrir caixa',
  closeCash: 'Fechar caixa',
  cashWithdrawal: 'Fazer sangria',
  cashSupply: 'Fazer suprimento',
  applyDiscount: 'Aplicar desconto',
  editServiceFee: 'Editar taxa de serviço',
  openTable: 'Abrir mesa',
  updateTableStatus: 'Alterar status da mesa',
  transferTable: 'Transferir mesa',
  joinTables: 'Juntar mesas',
  splitBill: 'Separar conta',
  reopenPaidBill: 'Reabrir conta paga',
  viewOtherOperatorTables: 'Ver mesas de outros operadores',
  resolveServiceRequest: 'Dar ciente em solicitação',
  addOrderItem: 'Adicionar item',
  removeCartItem: 'Remover item antes de enviar',
  changeItemQuantity: 'Alterar quantidade',
  editItemNotes: 'Alterar observação do item',
  sendOrderToProduction: 'Enviar pedido para produção/bar',
  cancelTableItem: 'Cancelar item lançado',
  cancelOrder: 'Cancelar pedido inteiro',
  cancelSale: 'Cancelar venda',
  launchPayment: 'Lançar pagamento',
  changePaymentMethod: 'Alterar forma de pagamento',
  splitPayment: 'Dividir pagamento',
  cancelPayment: 'Cancelar pagamento',
  refundPayment: 'Estornar pagamento',
  closeBill: 'Fechar conta',
  viewStock: 'Visualizar estoque',
  adjustStock: 'Ajustar estoque manualmente',
  confirmPurchaseEntry: 'Confirmar entrada de compra',
  editPurchaseEntry: 'Editar entrada de compra',
  cancelPurchaseEntry: 'Cancelar entrada de compra',
  viewNegativeStock: 'Visualizar estoque negativo',
  receiveStockAlerts: 'Receber alertas de estoque',
  manageShifts: 'Abrir/fechar turno legado',
  viewSchedule: 'Visualizar escala',
  editSchedule: 'Editar escala',
  manageFreelancers: 'Cadastrar freelancer',
  approveFreelancerHours: 'Aprovar horas de freelancer',
  manageFreelancerPayments: 'Lançar valores de freelancer',
  reprintReceipt: 'Reimprimir comprovante',
  viewSalesHistory: 'Ver histórico de vendas',
  accessFullReports: 'Relatórios completos',
  accessSensitiveData: 'Dados sensíveis',
};

export const permissionGroups: Array<{ title: string; keys: PermissionKey[] }> = [
  { title: 'Acesso e administração', keys: ['accessPDV', 'manageSettings', 'managePDVUsers', 'managePDVPermissions', 'manageCoupons', 'manageRoles', 'manageTeam', 'accessSensitiveData'] },
  { title: 'Mesas e comandas', keys: ['openTable', 'updateTableStatus', 'transferTable', 'joinTables', 'splitBill', 'reopenPaidBill', 'viewOtherOperatorTables'] },
  { title: 'Pedidos', keys: ['addOrderItem', 'removeCartItem', 'changeItemQuantity', 'editItemNotes', 'sendOrderToProduction', 'cancelTableItem', 'cancelOrder', 'cancelSale', 'resolveServiceRequest'] },
  { title: 'Pagamentos e taxa', keys: ['launchPayment', 'changePaymentMethod', 'splitPayment', 'cancelPayment', 'refundPayment', 'closeBill', 'applyDiscount', 'editServiceFee', 'reprintReceipt'] },
  { title: 'Caixa e relatórios', keys: ['openCash', 'closeCash', 'cashWithdrawal', 'cashSupply', 'viewCashSummary', 'viewSalesTotals', 'viewSalesHistory', 'viewFinancialReports', 'accessFullReports'] },
  { title: 'Produtos e cardápio', keys: ['addProduct', 'editProduct', 'editProductPrice', 'deleteProduct', 'toggleProductVisibility', 'manageCategories', 'sellUnavailableProduct', 'viewZeroStockProducts', 'manageOptionals'] },
  { title: 'Estoque', keys: ['viewStock', 'adjustStock', 'confirmPurchaseEntry', 'editPurchaseEntry', 'cancelPurchaseEntry', 'viewNegativeStock', 'receiveStockAlerts'] },
  { title: 'Equipe, escala e freelancer', keys: ['viewSchedule', 'editSchedule', 'manageFreelancers', 'approveFreelancerHours', 'manageFreelancerPayments', 'manageShifts'] },
];

export const getEffectivePermissions = (profile: PermissionProfile, overrides?: PermissionMatrix) => ({
  ...defaultPermissionsByProfile[profile],
  ...(overrides?.[profile] || {}),
  ...(profile === 'admin' ? { accessPDV: true, manageSettings: true, managePDVPermissions: true, manageCoupons: true } : {}),
});

export const getPermissionProfile = (seller?: Seller | null): PermissionProfile => {
  return legacyPermissionMap[seller?.permission || 'operator'] || 'operator';
};

const getUserOverrideAliases = (sellerId?: string) => {
  const id = String(sellerId || '').trim();
  if (!id) return [];
  const withoutOsPrefix = id.replace(/^os:/, '');
  return Array.from(new Set([id, withoutOsPrefix, `os:${withoutOsPrefix}`]));
};

export const getEffectiveUserPermissions = (
  seller: Seller | null | undefined,
  overrides?: PermissionMatrix,
  userOverrides?: UserPermissionMatrix
) => {
  const profile = getPermissionProfile(seller);
  const sellerOverrides = getUserOverrideAliases(seller?.id)
    .reduce<Partial<Record<PermissionKey, boolean>>>((acc, id) => ({
      ...acc,
      ...(userOverrides?.[id] || {}),
    }), {});
  return {
    ...getEffectivePermissions(profile, overrides),
    ...sellerOverrides,
    ...(profile === 'admin' ? { accessPDV: true, manageSettings: true, managePDVPermissions: true, manageCoupons: true } : {}),
  };
};

export const can = (
  seller: Seller | null | undefined,
  permission: PermissionKey,
  overrides?: PermissionMatrix,
  userOverrides?: UserPermissionMatrix
) => {
  return getEffectiveUserPermissions(seller, overrides, userOverrides)[permission];
};

export const getPermissionLabel = (seller?: Seller | null) => {
  const profile = getPermissionProfile(seller);
  if (profile === 'admin') return 'Admin full access';
  if (profile === 'manager') return 'Gerente';
  return 'Operador';
};
