import { create } from 'zustand';
import { ProductSchema, SellerSchema } from './lib/schemas';
import { createId } from './lib/id';
import { getOrderItemsTotal } from './lib/totals';
import { postOSMessage } from './lib/osBridge';
import { AdminApi, AppApi, CatalogApi, OperationalApi, OpsApi, hasApiSessionToken, setApiSessionToken, type CashState } from './lib/api';
import type {
  Product, Table, OrderItem, KitchenOrder,
  ServiceRequest, ModifierGroup, ClosedBill, Seller, AppSettings, Modifier, Category
} from './types';

export type { Product, Table, OrderItem, KitchenOrder, ServiceRequest, ModifierGroup, ClosedBill, Seller, AppSettings, Modifier };

const TABLET_TABLE_STORAGE_KEY = 'beco_tablet_table_id';
const LEGACY_TABLET_TABLE_STORAGE_KEY = 'becoartes_tablet_table_id';
const SELLER_SESSION_STORAGE_KEY = 'beco_seller_session';
let syncIntervalId: number | undefined;
let syncInFlight: Promise<void> | null = null;
let lastCatalogSyncAt = 0;
let lastCatalogVersion = '0';
const CATALOG_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const modifierGroupSaveTimers = new Map<string, number>();
const MODIFIER_GROUP_SAVE_DEBOUNCE_MS = 550;

const toSessionSeller = (seller: Seller): Seller => ({ ...seller, pin: '' });

const clearSellerSession = () => {
  localStorage.removeItem(SELLER_SESSION_STORAGE_KEY);
  setApiSessionToken(null);
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
};

const isSessionExpiredError = (error: unknown) => /sess[aã]o obrigat[oó]ria|session/i.test(getErrorMessage(error));
const isNetworkError = (error: unknown) => /fetch failed|network|timeout|etimedout|econnreset/i.test(getErrorMessage(error));

const persistSellerSession = (seller: Seller) => {
  const sessionSeller = toSessionSeller(seller);
  localStorage.setItem(SELLER_SESSION_STORAGE_KEY, JSON.stringify(sessionSeller));
  return sessionSeller;
};

const attachModifierGroupsToMenu = (
  menuItems: Product[],
  modifierGroups: ModifierGroup[],
  productMapping: Record<string, string[]>,
  categoryMapping: Record<string, string[]>
) => {
  const groupById: Record<string, ModifierGroup> = {};
  modifierGroups.forEach(group => {
    groupById[group.id] = group;
  });

  return menuItems.map(item => {
    const productGroupIds = productMapping[item.id] || [];
    const categoryGroupIds = categoryMapping[item.categoryId] || [];
    const allGroupIds = Array.from(new Set([...categoryGroupIds, ...productGroupIds]));

    return {
      ...item,
      modifierGroups: allGroupIds
        .map(groupId => groupById[groupId] ? {
          ...groupById[groupId],
          modifiers: (groupById[groupId].modifiers || []).filter(modifier => modifier.status !== 'inactive')
        } : null)
        .filter(group => group && group.modifiers.length > 0)
    };
  });
};


export interface AppState {
  menu: Product[];
  categories: Category[];
  tables: Table[];
  kitchenOrders: KitchenOrder[];
  serviceRequests: ServiceRequest[];
  modifierGroups: ModifierGroup[];
  productModifierMapping: Record<string, string[]>;
  categoryModifierMapping: Record<string, string[]>;
  banners: string[];
  sellers: Seller[];
  notifications: { id: string; message: string; tableId: string; type: 'order' | 'bill' | 'service' | 'info' | 'error' }[];
  closedBills: ClosedBill[];
  auditLogs: { id: string; action: string; details: string; table_number: string; origin: string; author_name: string; timestamp: string }[];
  fetchAuditLogs: () => Promise<void>;
  syncData: (options?: { includeCatalog?: boolean }) => Promise<void>;
  addAuditLog: (log: { action: string; details?: any; table_number?: string; origin?: string; author_name?: string } | string, details?: string, tableNumber?: string, origin?: string) => Promise<void>;
  activeView: 'tablet' | 'pdv' | 'admin' | 'kitchen' | 'qr' | '';
  adminTab: 'config' | 'products' | 'categories' | 'optionals' | 'sellers' | 'movements' | 'finance';
  adminMode: 'menu' | 'settings';
  isLoading: boolean;
  setAdminTab: (tab: 'config' | 'products' | 'categories' | 'optionals' | 'sellers' | 'movements' | 'finance') => void;
  currentShift: { id: string, status: 'open' | 'closed', openingBalance: number } | null;
  cashState: CashState | null;
  serverTimeOffset: number;

  currentTableId: string | null;
  setCurrentTableId: (id: string | null) => void;
  init: () => Promise<void>;
  setActiveView: (view: 'tablet' | 'pdv' | 'admin' | 'kitchen' | 'qr', tab?: 'config' | 'products' | 'categories' | 'optionals' | 'sellers' | 'movements' | 'finance', mode?: 'menu' | 'settings') => void;
  toggleProductVisibility: (id: string) => void;
  toggleCategoryVisibility: (id: string) => void;
  addProduct: (product: Product) => Promise<void>;
  updateProduct: (id: string, product: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;

  currentSeller: Seller | null;
  login: (pin: string, sellerId?: string) => Promise<boolean>;
  logout: () => void;

  // Vendedores
  addSeller: (seller: Seller) => Promise<void>;
  updateSeller: (id: string, data: Partial<Seller>) => Promise<void>;
  deleteSeller: (id: string) => Promise<void>;
  toggleSellerStatus: (id: string) => Promise<void>;

  // Grupos de Modificadores
  addModifierGroup: (group: ModifierGroup) => Promise<void>;
  updateModifierGroup: (id: string, group: Partial<ModifierGroup>) => Promise<void>;
  deleteModifierGroup: (id: string) => Promise<void>;
  linkGroupToProduct: (productId: string, groupId: string, linked: boolean) => Promise<void>;
  linkGroupToCategory: (categoryId: string, groupId: string, linked: boolean) => Promise<void>;
  upsertCategory: (cat: Category) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  reorderCategories: (categories: Category[]) => Promise<void>;
  syncBeveragesFromInventory: () => Promise<void>;

  addToCart: (product: Product, quantity: number, selectedModifiers: Modifier[], notes?: string) => void;
  removeOrderItem: (itemId: string, context?: { tableNumber: number; itemName: string; quantity: number; sellerName?: string; sellerPermission?: Seller['permission'] }) => Promise<void>;
  removeFromCart: (itemId: string) => void;
  sendToKitchen: (tableId: string, origin?: 'tablet' | 'pdv' | 'qr', sellerId?: string) => Promise<void>;
  requestBill: (tableId: string) => void;
  requestService: (tableId: string, type: string, message?: string) => void;
  resolveService: (requestId: string) => void;
  closeBill: (data: Omit<ClosedBill, 'id' | 'closedAt'>) => Promise<boolean>;
  updateTableStatus: (tableId: string, status: Table['status']) => void;
  updateKitchenOrderStatus: (orderId: string, status: KitchenOrder['status']) => void;
  addNotification: (message: string, type?: 'info' | 'error' | 'order' | 'service', tableId?: string) => void;
  clearNotification: (id: string) => void;

  // Logística de Mesas
  openTable: (tableId: string, initialItems?: OrderItem[], origin?: 'tablet' | 'pdv', sellerId?: string) => Promise<void>;
  transferTable: (fromTableId: string, toTableId: string) => Promise<void>;
  joinTables: (tableIds: string[], targetTableId: string) => Promise<void>;

  // Gestão de Caixa
  openShift: (openingBalance: number) => Promise<void>;
  closeShift: (closingBalance: number) => Promise<void>;
  refreshCashState: () => Promise<void>;
  openCash: (openingBalance: number, notes?: string) => Promise<void>;
  closeCash: (closingBalance: number, notes?: string, confirmationPin?: string) => Promise<void>;

  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  activeView: '',
  adminTab: 'config',
  adminMode: 'settings',
  isLoading: true,
  banners: [
    'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=1200&h=400&fit=crop',
    'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=1200&h=400&fit=crop',
    'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=1200&h=400&fit=crop'
  ],
  sellers: [],
  auditLogs: [],
  notifications: [],
  closedBills: [],
  kitchenOrders: [],
  serverTimeOffset: 0,
  serviceRequests: [],
  modifierGroups: [],
  productModifierMapping: {},
  categoryModifierMapping: {},
  menu: [],
  categories: [],
  tables: [],
  currentShift: null,
  cashState: null,
  settings: {
    unitName: 'Becoartes',
    mode: 'demo',
    currency: 'BRL',
    serviceTax: 13,
    theme: 'dark-becoartes',
    tablet: {
      inactivityTimeout: 60,
      autoBanner: true,
      bannerText: 'Bem-vindo ao Becoartes!',
      bannerUrls: ['https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200', 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1200'],
      fullscreen: false,
      viewMode: 'grid',
      sendToKitchenOnFinish: true
    },
    tables: {
      count: 12,
      statuses: ['livre', 'aberta', 'pedido enviado', 'aguardando pagamento', 'fechada']
    },
    orders: {
      allowNotes: true,
      allowChangeQty: true,
      allowRemove: true,
      groupItems: true,
      saveHistory: true,
      sendToKitchenOnFinish: true
    },
    kitchen: {
      showTable: true,
      visualAlert: true,
      soundAlert: true
    }
  },

  updateSettings: async (newSettings) => {
    const currentSettings = get().settings;
    const nextSettings = {
      ...currentSettings,
      ...newSettings,
      tablet: newSettings.tablet ? { ...currentSettings.tablet, ...newSettings.tablet } : currentSettings.tablet,
      kitchen: newSettings.kitchen ? { ...currentSettings.kitchen, ...newSettings.kitchen } : currentSettings.kitchen
    };

    set({ settings: nextSettings });

    try {
      await AdminApi.saveSettings(nextSettings);
    } catch (error) {
      console.error("❌ Erro ao salvar configurações:", error);
      set({ settings: currentSettings });
      get().addNotification("Erro ao salvar configurações.", "error");
    }
  },

  currentTableId: localStorage.getItem(TABLET_TABLE_STORAGE_KEY) || localStorage.getItem(LEGACY_TABLET_TABLE_STORAGE_KEY),
  setCurrentTableId: (id) => {
    if (id) {
      localStorage.setItem(TABLET_TABLE_STORAGE_KEY, id);
      localStorage.removeItem(LEGACY_TABLET_TABLE_STORAGE_KEY);
    } else {
      localStorage.removeItem(TABLET_TABLE_STORAGE_KEY);
      localStorage.removeItem(LEGACY_TABLET_TABLE_STORAGE_KEY);
    }
    set({ currentTableId: id });
  },

  currentSeller: null,

  login: async (pin, sellerId) => {
    let result;
    try {
      result = await AppApi.login(pin, sellerId);
    } catch (error) {
      console.warn('Login bloqueado ou recusado:', error);
      get().addNotification(error instanceof Error ? error.message : 'Login não autorizado.', 'error');
      return false;
    }

    if (!result.seller) {
      if (result.accessRestricted) {
        get().addNotification('Este PIN só funciona na rede autorizada do Becoartes.', 'error');
      }
      return false;
    }

    setApiSessionToken(result.sessionToken || null);
    const sessionSeller = persistSellerSession(result.seller as Seller);
    set({ currentSeller: sessionSeller });
    const firstName = sessionSeller.nickname || String(sessionSeller.name || '').trim().split(' ')[0] || 'equipe';
    get().addNotification(`Bem-vindo, ${firstName}!`, 'info');
    try {
      await get().syncData();
    } catch (error) {
      console.warn('Login realizado, mas o refresh pós-login falhou:', error);
    }
    return true;
  },

  logout: () => {
    clearSellerSession();
    set({ currentSeller: null });
  },

  addAuditLog: async (logOrAction: any, details?: string, tableNumber?: string, origin?: string) => {
    const id = createId();
    const timestamp = new Date().toISOString();

    let logData;
    if (typeof logOrAction === 'object') {
      logData = {
        action: logOrAction.action,
        details: JSON.stringify(logOrAction.details || {}),
        table_number: logOrAction.table_number || null,
        origin: logOrAction.origin || 'pdv',
        author_name: logOrAction.author_name || get().currentSeller?.name || 'Sistema'
      };
    } else {
      logData = {
        action: logOrAction,
        details: details || '',
        table_number: tableNumber || null,
        origin: origin || 'pdv',
        author_name: get().currentSeller?.name || 'Sistema'
      };
    }

    await OpsApi.addAuditLog({
      id,
      action: logData.action,
      details: logData.details,
      tableNumber: logData.table_number,
      origin: logData.origin,
      authorName: logData.author_name,
      timestamp
    });

    const newLog = { id, ...logData, timestamp, details: logData.details || '' };
    set((state) => ({ auditLogs: [newLog as any, ...state.auditLogs].slice(0, 50) }));
  },

  init: async () => {
    // Só mostra o loader se for a PRIMEIRA vez absoluta que carrega algo
    if (get().categories.length === 0) {
      set({ isLoading: true });
    }

    try {
      // Restaurar Sessão se existir
      const savedSession = localStorage.getItem(SELLER_SESSION_STORAGE_KEY);
      if (savedSession && hasApiSessionToken()) {
        set({ currentSeller: JSON.parse(savedSession) });
      } else if (savedSession) {
        // Sessões antigas da UI não têm o token assinado do BFF. Força novo PIN
        // para evitar estado "logado" no cliente e bloqueado no backend.
        clearSellerSession();
        set({ currentSeller: null });
      }
      const snapshot = await AppApi.init();
      if (snapshot.accessRestricted) {
        clearSellerSession();
        set({ currentSeller: null });
      }
      const catalogData = snapshot.catalogData;
      const { categories, menuItems, modifierGroups, productMapping, categoryMapping, catalogVersion } = catalogData;
      const { orders: kitchenOrders, serverNow } = snapshot.kitchenData;
      const serverTimeOffset = serverNow.getTime() - new Date().getTime();

      const menuWithModifierGroups = attachModifierGroupsToMenu(menuItems, modifierGroups, productMapping, categoryMapping);
      lastCatalogSyncAt = Date.now();
      lastCatalogVersion = catalogVersion;

      // 4. Determinar View Inicial pela URL e Hostname
      const hostname = window.location.hostname;
      const fullPath = window.location.pathname.substring(1);

      let initialView: any = 'tablet';
      let initialAdminMode: any = 'settings';

      if (fullPath.startsWith('qr/') || fullPath.startsWith('mesa/')) {
        initialView = 'qr';
      } else if (fullPath.startsWith('admin/menu')) {
        initialView = 'admin';
        initialAdminMode = 'menu';
      } else if (fullPath.startsWith('admin/settings') || fullPath.startsWith('admin/config')) {
        initialView = 'admin';
        initialAdminMode = 'settings';
      } else if (['tablet', 'pdv', 'admin', 'kitchen', 'qr'].includes(fullPath)) {
        initialView = fullPath;
      } else if (hostname.startsWith('pdv.')) initialView = 'pdv';
      else if (hostname.startsWith('coz.')) initialView = 'kitchen';
      else if (hostname.startsWith('tablet.')) initialView = 'tablet';
      else if (hostname.startsWith('qr.')) initialView = 'qr';
      else {
        initialView = 'tablet';
      }

      set({
        categories,
        menu: menuWithModifierGroups,
        modifierGroups,
        productModifierMapping: productMapping,
        categoryModifierMapping: categoryMapping,
        sellers: snapshot.sellers,
        kitchenOrders,
        serviceRequests: snapshot.serviceRequests,
        closedBills: snapshot.closedBills,
        auditLogs: snapshot.auditLogs,
        settings: snapshot.savedSettings ? { ...get().settings, ...snapshot.savedSettings } : get().settings,
        cashState: snapshot.cashState || null,
        activeView: initialView as any,
        adminMode: initialAdminMode,
        adminTab: initialAdminMode === 'menu' ? 'products' : 'config',
        tables: snapshot.tables.sort((a: Table, b: Table) => a.number - b.number),
        serverTimeOffset
      });

      console.log(`🚀 Sistema Becoartes Inicializado! View: ${initialView} | Host: ${hostname}`);

      // NOTA TÉCNICA MODO KIOSK:
      // Para bloqueio total do hardware (botão Home, recentes, etc) no Android,
      // utilize o "Fully Kiosk Browser" apontando para este URL com "Kiosk Mode" ATIVO.

      // Admin/QR nao possuem polling proprio. PDV, tablet e cozinha controlam seus ciclos nas views.
      if (initialView === 'admin' || initialView === 'qr') {
        if (syncIntervalId) window.clearInterval(syncIntervalId);
        syncIntervalId = window.setInterval(() => {
          get().syncData();
        }, 60000);
      }

    } catch (e) {
      console.error("❌ Erro ao inicializar App:", e);
    } finally {
      set({ isLoading: false });
    }
  },

  setActiveView: (view, tab, mode) => {
    const url = view === 'admin' ? `/admin/${mode || 'settings'}` : `/${view}`;
    window.history.pushState({}, '', url);
    set({
      activeView: view,
      adminTab: tab || (mode === 'menu' ? 'products' : 'config'),
      adminMode: mode || get().adminMode
    });
  },
  setAdminTab: (tab) => set({ adminTab: tab }),
  toggleProductVisibility: async (id) => {
    const product = get().menu.find(p => p.id === id);
    if (!product) return;
    const newVisible = !product.visible;

    // 1. Atualização Otimista (Interface responde na hora)
    set((state) => ({
      menu: state.menu.map(p => p.id === id ? { ...p, visible: newVisible } : p)
    }));

    try {
      // 2. Persistir no Banco
      const result = await CatalogApi.toggleProductVisibility(id, newVisible);
      lastCatalogVersion = result.catalogVersion;
    } catch (e) {
      // 3. Reverter se falhar
      console.error("❌ Falha ao sincronizar visibilidade:", e);
      set((state) => ({
        menu: state.menu.map(p => p.id === id ? { ...p, visible: !newVisible } : p)
      }));
      get().addNotification("Falha na rede ao ocultar produto. Tente novamente.", "error");
    }
  },
  toggleCategoryVisibility: async (id) => {
    const category = get().categories.find(c => c.id === id);
    if (!category) return;
    const newVisible = !category.visible;

    // 1. Atualização Otimista
    set((state) => ({
      categories: state.categories.map(c => c.id === id ? { ...c, visible: newVisible } : c)
    }));

    try {
      const result = await CatalogApi.toggleCategoryVisibility(id, newVisible);
      lastCatalogVersion = result.catalogVersion;
    } catch (e) {
      console.error("❌ Falha ao sincronizar visibilidade da categoria:", e);
      set((state) => ({
        categories: state.categories.map(c => c.id === id ? { ...c, visible: !newVisible } : c)
      }));
      get().addNotification("Falha na rede ao ocultar categoria.", "error");
    }
  },
  updateProduct: async (id, data) => {
    try {
      const category = get().categories.find(c => c.id === data.categoryId);
      // Limpeza profunda para evitar nulos em campos obrigatórios do schema
      const cleanData = {
        ...data,
        description: data.description || "",
        erpCode: data.erpCode || "",
        remoteStockId: data.remoteStockId || "",
        image: data.image || "",
        cost: Number(data.cost) || 0,
        price: Number(data.price) || 0
      };

      const validated = ProductSchema.parse({ ...cleanData, id, categoryName: category?.name });
      const result = await CatalogApi.upsertProduct(validated as Product);
      lastCatalogVersion = result.catalogVersion;
      set((state) => ({
        menu: state.menu.map(p => p.id === id ? validated as Product : p)
      }));
      get().addNotification(`Produto "${validated.name}" atualizado com sucesso!`, 'info');
    } catch (e: any) {
      console.error("❌ Erro ao atualizar produto:", e);
      // Se for erro do Zod, extrair a mensagem amigável
      const msg = e.errors ? e.errors.map((err: any) => `${err.path}: ${err.message}`).join(', ') : e.message;
      get().addNotification(msg || "Dados inválidos", 'error');
      throw e;
    }
  },

  addProduct: async (product) => {
    try {
      const category = get().categories.find(c => c.id === product.categoryId);
      const cleanData = {
        ...product,
        description: product.description || "",
        erpCode: product.erpCode || "",
        remoteStockId: product.remoteStockId || "",
        image: product.image || "",
        cost: Number(product.cost) || 0,
        price: Number(product.price) || 0
      };

      const validated = ProductSchema.parse({ ...cleanData, categoryName: category?.name });
      const result = await CatalogApi.upsertProduct(validated as Product);
      lastCatalogVersion = result.catalogVersion;
      set((state) => ({ menu: [...state.menu, validated as Product] }));
      get().addNotification(`Produto "${validated.name}" adicionado!`, 'info');
    } catch (e: any) {
      console.error("❌ Erro ao adicionar produto:", e);
      const msg = e.errors ? e.errors.map((err: any) => `${err.path}: ${err.message}`).join(', ') : e.message;
      get().addNotification(msg || "Dados inválidos", 'error');
      throw e;
    }
  },

  deleteProduct: async (id) => {
    try {
      const result = await CatalogApi.deleteProduct(id);
      lastCatalogVersion = result.catalogVersion;
      set((state) => ({ menu: state.menu.filter(x => x.id !== id) }));
      get().addNotification("Produto removido definitivamente", 'info');
    } catch (e: any) {
      console.error("❌ Erro ao deletar produto:", e);
      // Se houver erro de constraint (pedido vinculado), apenas ocultamos
      await get().toggleProductVisibility(id);
      get().addNotification("Produto possui histórico e não pode ser deletado. Ele foi ocultado do cardápio.", 'info');
    }
  },

  syncData: async (options = {}) => {
    if (syncInFlight) {
      if (options.includeCatalog) {
        return syncInFlight.then(() => get().syncData(options));
      }
      return syncInFlight;
    }

    const runSync = (async () => {
      try {
        const shouldRefreshCatalog =
          Boolean(options.includeCatalog)
          || Date.now() - lastCatalogSyncAt > CATALOG_SYNC_INTERVAL_MS;
        let snapshot = await AppApi.sync(shouldRefreshCatalog);
        if (snapshot.accessRestricted) {
          clearSellerSession();
          set({ currentSeller: null });
        }

        if (!shouldRefreshCatalog && snapshot.catalogVersion && snapshot.catalogVersion !== lastCatalogVersion) {
          snapshot = await AppApi.sync(true);
          if (snapshot.accessRestricted) {
            clearSellerSession();
            set({ currentSeller: null });
          }
        }

        const { orders: kitchenOrders, serverNow } = snapshot.kitchenData;
        const serverTimeOffset = serverNow.getTime() - new Date().getTime();

        const catalogUpdate = snapshot.catalogData
          ? (() => {
              lastCatalogSyncAt = Date.now();
              lastCatalogVersion = snapshot.catalogData.catalogVersion;
              return {
                categories: snapshot.catalogData.categories,
                menu: attachModifierGroupsToMenu(snapshot.catalogData.menuItems, snapshot.catalogData.modifierGroups, snapshot.catalogData.productMapping, snapshot.catalogData.categoryMapping),
                modifierGroups: snapshot.catalogData.modifierGroups,
                productModifierMapping: snapshot.catalogData.productMapping,
                categoryModifierMapping: snapshot.catalogData.categoryMapping
              };
            })()
          : null;

        if (snapshot.catalogVersion) {
          lastCatalogVersion = snapshot.catalogVersion;
        }

        const currentTables = get().tables;
        const finalTables = snapshot.tables.map((newTable: Table) => {
          const localTable = currentTables.find(t => t.id === newTable.id);
          return {
            ...newTable,
            cart: localTable?.cart || [],
          };
        });

        set({
          ...(catalogUpdate || {}),
          kitchenOrders,
          serviceRequests: snapshot.serviceRequests,
          closedBills: snapshot.closedBills,
          cashState: snapshot.cashState || get().cashState,
          tables: finalTables.sort((a, b) => a.number - b.number),
          serverTimeOffset
        });
      } catch (error) {
        console.error("❌ Erro no sync de dados:", error);
      }
    })();

    syncInFlight = runSync;
    try {
      await runSync;
    } finally {
      if (syncInFlight === runSync) syncInFlight = null;
    }
  },

  syncBeveragesFromInventory: async () => {
    set({ isLoading: true });
    try {
      const result = await AdminApi.syncBeveragesFromInventory();
      lastCatalogVersion = result.catalogVersion;

      // Recarregar o menu
      await get().init();
      set({ notifications: [...get().notifications, { id: Date.now().toString(), message: 'Bebidas sincronizadas com o estoque!', type: 'info', tableId: '' }] });
    } catch (error) {
      console.error("Erro na sincronização:", error);
    } finally {
      set({ isLoading: false });
    }
  },

  addToCart: (product, quantity, selectedModifiers = [], notes = '') => {
    const { currentTableId, addNotification } = get();
    if (!currentTableId) return;

    const newItem: OrderItem = {
      id: createId(),
      productId: product.id,
      categoryId: product.categoryId,
      categoryName: product.categoryName,
      name: product.name,
      price: product.price,
      quantity,
      selectedModifiers,
      notes,
      status: 'pending',
      orderedAt: new Date()
    };

    set((state) => ({
      tables: state.tables.map(t => t.id === currentTableId ? {
        ...t,
        cart: [...t.cart, newItem]
      } : t)
    }));

    addNotification(`${quantity}x ${product.name} adicionado ao carrinho!`);
  },

  removeFromCart: (itemId) => {
    const { currentTableId } = get();
    if (!currentTableId) return;
    set((state) => ({
      tables: state.tables.map(t => t.id === currentTableId ? { ...t, cart: t.cart.filter(i => i.id !== itemId) } : t)
    }));
  },

  removeOrderItem: async (itemId, context) => {
    const { currentTableId } = get();
    if (!currentTableId) return;

    await OperationalApi.deleteOrderItem({
      itemId,
      cancelContext: context ? {
        tableNumber: context.tableNumber,
        itemName: context.itemName,
        quantity: context.quantity,
        sellerName: context.sellerName || get().currentSeller?.name || 'Sistema',
        sellerPermission: context.sellerPermission || get().currentSeller?.permission || 'standard'
      } : undefined
    });

    set((state) => ({
      tables: state.tables.map(t => t.id === currentTableId ? { ...t, orders: t.orders.filter(o => o.id !== itemId) } : t),
      kitchenOrders: state.kitchenOrders
        .map(order => ({ ...order, items: order.items.filter(item => item.id !== itemId) }))
        .filter(order => order.items.length > 0)
    }));
  },

  requestService: async (tableId, type, message = '') => {
    const table = get().tables.find(t => t.id === tableId);
    const id = createId();

    const created = await OpsApi.createServiceRequest({ id, tableId, type, message });

    const newRequest: ServiceRequest = {
      ...created.request,
      tableNumber: typeof table?.number === 'number' ? table.number : created.request.tableNumber || 0
    };

    const messages: Record<string, string> = {
      waiter: 'Chamar Garçom',
      bill: 'Fechar a Conta',
      napkin: 'Precisa de Guardanapos',
      cutlery: 'Precisa de Talheres',
      glass: 'Copo Extra',
      ice: 'Pedir Gelo',
      lemon: 'Pedir Limão',
      physical_menu: 'Cardápio Físico',
      help: 'Ajuda com Pedido',
      problem: 'Problema com Pedido',
      other: 'Solicitação Diversa'
    };

    set((state) => ({
      serviceRequests: [...state.serviceRequests, newRequest]
    }));
    get().addNotification(`Mesa ${newRequest.tableNumber}: ${messages[type] || type}`, 'service', tableId);
    postOSMessage('table_alert', {
      tableId,
      tableNumber: newRequest.tableNumber,
      alertType: type,
      message: message || messages[type] || type,
      createdAt: newRequest.createdAt.toISOString()
    });
  },

  resolveService: async (requestId) => {
    const request = get().serviceRequests.find(r => r.id === requestId);
    if (!request) return;

    if (!hasApiSessionToken()) {
      clearSellerSession();
      set({ currentSeller: null });
      get().addNotification("Sessão expirada. Entre com o PIN novamente.", "error");
      return;
    }

    const newStatus = 'resolved';

    try {
      await OpsApi.resolveServiceRequest({
        requestId,
        tableId: request.tableId,
        type: request.type,
        message: request.message,
        currentStatus: request.status
      });

      set((state) => ({
        serviceRequests: state.serviceRequests.map(r =>
          request.type === 'new_order'
            ? (r.id === requestId || (r.tableId === request.tableId && r.type === 'new_order' && r.message === request.message && r.status === 'pending'))
            ? { ...r, status: newStatus }
            : r
            : r.id === requestId ? { ...r, status: newStatus } : r
        )
      }));
    } catch (error) {
      console.error("Erro ao atualizar solicitação:", error);
      if (isSessionExpiredError(error)) {
        clearSellerSession();
        set({ currentSeller: null });
        get().addNotification("Sessão expirada. Entre com o PIN novamente.", "error");
        return;
      }
      const message = getErrorMessage(error);
      get().addNotification(message || "Não foi possível dar ciente. Tente novamente.", "error");
    }
  },

  sendToKitchen: async (tableId, origin = 'pdv', sellerId) => {
    const table = get().tables.find(t => t.id === tableId);
    if (!table || table.cart.length === 0) return;

    const orderId = createId();
    const total = getOrderItemsTotal(table.cart);
    const persistedItems: OrderItem[] = table.cart.map(item => ({
      ...item,
      id: createId(),
      orderId
    }));

    await OperationalApi.sendToKitchen({
      orderId,
      tableId,
      total,
      origin,
      sellerId: sellerId || null,
      items: persistedItems
    });

    const newKitchenOrder: KitchenOrder = {
      id: orderId,
      tableId: tableId,
      tableNumber: table.number,
      items: persistedItems,
      status: 'pending',
      origin: origin as 'tablet' | 'pdv',
      createdAt: new Date()
    };

    // Criar uma solicitação de serviço imediata para o PDV (para drinks/bebidas)
    const requestId = 'new_order_' + orderId;
    const itemsList = table.cart.map(i => `${i.quantity}x ${i.name}`).join(', ');

    const newRequest: ServiceRequest = {
      id: requestId,
      tableId,
      tableNumber: table.number,
      type: 'new_order',
      message: itemsList,
      status: 'pending',
      createdAt: new Date()
    };

    set((state) => ({
      kitchenOrders: [...state.kitchenOrders, newKitchenOrder],
      serviceRequests: [newRequest, ...state.serviceRequests],
      tables: state.tables.map(t => t.id === tableId ? {
        ...t,
        orders: [...t.orders, ...persistedItems],
        cart: [],
        status: 'ordering',
        lastActivity: new Date()
      } : t)
    }));

    get().addNotification(`Novo pedido da Mesa ${table.number}!`, 'order', tableId);

    postOSMessage('table_alert', {
      tableId,
      tableNumber: table.number,
      alertType: 'new_order',
      message: `Novo pedido realizado!`,
      createdAt: new Date().toISOString()
    });

    try {
      await get().addAuditLog('order_sent', `Itens: ${table.cart.length} | Total: R$ ${total.toFixed(2)}`, table.number.toString(), origin);
    } catch (error) {
      console.warn('Pedido enviado, mas a auditoria falhou:', error);
    }
  },

  updateKitchenOrderStatus: async (orderId, status) => {
    const result = await OperationalApi.updateOrderStatus(orderId, status);

    // Se o pedido ficou pronto, cria uma solicitação de serviço automática para o PDV
    if (status === 'ready') {
      const order = get().kitchenOrders.find(o => o.id === orderId);
      if (order && result.request) {
        const itemsList = order.items.map(i => `${i.quantity}x ${i.name}`).join(', ');

        const newRequest: ServiceRequest = {
          ...result.request,
          tableId: order.tableId,
          tableNumber: order.tableNumber,
          type: 'order_ready',
          message: itemsList,
          status: 'pending',
          createdAt: result.request.createdAt
        };

        set((state) => ({
          serviceRequests: [
            newRequest,
            ...state.serviceRequests.filter(request => request.id !== newRequest.id)
          ]
        }));

        postOSMessage('table_alert', {
          tableId: order.tableId,
          tableNumber: order.tableNumber,
          alertType: 'order_ready',
          message: `Pedido da Mesa ${order.tableNumber} está PRONTO!`,
          createdAt: new Date().toISOString()
        });
      }
    }

    set((state) => ({
      kitchenOrders: state.kitchenOrders.map(o => o.id === orderId ? { ...o, status } : o)
    }));
  },

  requestBill: async (tableId) => {
    const table = get().tables.find(t => t.id === tableId);
    await OpsApi.requestBill(tableId);
    set((state) => ({ tables: state.tables.map(t => t.id === tableId ? { ...t, status: 'bill_requested' } : t) }));
    get().addNotification(`A Mesa ${table?.number || tableId} solicitou o fechamento da conta!`, 'info', tableId);
    postOSMessage('table_alert', {
      tableId,
      tableNumber: table?.number || tableId,
      alertType: 'bill_requested',
      message: 'Cliente solicitou o fechamento da conta.',
      createdAt: new Date().toISOString()
    });
    await get().addAuditLog('bill_requested', 'Cliente solicitou a conta via Tablet', table?.number.toString(), 'tablet');
  },

  closeBill: async (data) => {
    if (!hasApiSessionToken()) {
      clearSellerSession();
      set({ currentSeller: null });
      get().addNotification("Sessão expirada. Entre com o PIN novamente.", "error");
      return false;
    }

    try {
      const closeResult = await OperationalApi.closeBill(data);

      if (closeResult.skipped || !closeResult.closedBill || !closeResult.inventorySync) {
        get().addNotification("Este fechamento já foi processado ou está em andamento.", "info");
        await get().syncData();
        return false;
      }

      set((state) => ({
        closedBills: [...state.closedBills, closeResult.closedBill],
        tables: state.tables.map(t => t.id === data.tableId ? { ...t, status: 'available', orders: [] } : t),
        serviceRequests: state.serviceRequests.map(r => r.tableId === data.tableId ? { ...r, status: 'resolved' } : r)
      }));
      postOSMessage('bill_closed', {
        tableId: data.tableId,
        tableNumber: data.tableNumber,
        total: data.total,
        sellerId: data.sellerId,
        sellerName: data.sellerName,
        closedBillId: closeResult.closedBill.id,
        inventorySync: closeResult.inventorySync,
        closedAt: closeResult.closedBill.closedAt.toISOString()
      });

      const inventorySuffix = closeResult.inventorySync.unmatched.length > 0
        ? ` ${closeResult.inventorySync.unmatched.length} item(ns) sem vínculo de estoque.`
        : '';
      get().addNotification(`Conta Lançada! Mesa ${data.tableNumber} finalizada com sucesso!${inventorySuffix}`, 'info');
      return true;
    } catch (error) {
      console.error("Erro ao fechar conta:", error);
      if (isSessionExpiredError(error)) {
        clearSellerSession();
        set({ currentSeller: null });
        get().addNotification("Sessão expirada. Entre com o PIN novamente.", "error");
        return false;
      }

      if (isNetworkError(error)) {
        get().addNotification("Banco demorou para responder. Atualize a mesa e tente novamente.", "error");
        return false;
      }

      const message = getErrorMessage(error);
      get().addNotification(message ? `Erro ao lançar conta: ${message}` : "Erro ao lançar conta. Tente novamente.", "error");
      return false;
    }
  },

  updateTableStatus: async (tableId, status) => {
    await OpsApi.updateTableStatus(tableId, status);
    set((state) => ({
      tables: state.tables.map(t => t.id === tableId ? { ...t, status } : t)
    }));
  },

  // CRUD VENDEDORES
  addSeller: async (s) => {
    try {
      const id = createId();
      const validated = SellerSchema.parse({ ...s, id, status: 'active' });
      await AdminApi.addSeller(validated);
      set((state) => ({ sellers: [...state.sellers, toSessionSeller(validated as Seller)] }));
      get().addNotification("Vendedor cadastrado com sucesso!", "info");
    } catch (e: any) {
      get().addNotification(e.message || "Dados inválidos", 'error');
    }
  },

  updateSeller: async (id, data) => {
    console.log("Update seller not fully implemented", id, data);
  },

  deleteSeller: async (id) => {
    // Verificar se tem vendas
    const result = await AdminApi.deleteSeller(id);
    if (!result.deleted && result.reason === 'seller_has_bills') {
      get().addNotification("Não é possível excluir: vendedor possui vendas vinculadas.", "error");
      return;
    }
    set((state) => ({ sellers: state.sellers.filter(s => s.id !== id) }));
  },

  toggleSellerStatus: async (id) => {
    const seller = get().sellers.find(s => s.id === id);
    if (!seller) return;
    const newStatus = seller.status === 'active' ? 'inactive' : 'active';
    await AdminApi.updateSellerStatus(id, newStatus);
    set((state) => ({ sellers: state.sellers.map(s => s.id === id ? { ...s, status: newStatus } : s) }));
  },


  addNotification: (message, type = 'info', tableId = '') => {
    const id = createId();
    set((state) => ({
      notifications: [...state.notifications, { id, message, type, tableId }]
    }));
    // Auto-remover após 30 segundos
    setTimeout(() => {
      get().clearNotification(id);
    }, 30000);
  },

  clearNotification: (id) => set((state) => ({
    notifications: state.notifications.filter(n => n.id !== id)
  })),

  // --- CATEGORIES ---
  upsertCategory: async (cat) => {
    const result = await CatalogApi.upsertCategory(cat);
    lastCatalogVersion = result.catalogVersion;
    set((state) => {
      const exists = state.categories.find(c => c.id === cat.id);
      let newCats;
      if (exists) {
        newCats = state.categories.map(c => c.id === cat.id ? cat : c);
      } else {
        newCats = [...state.categories, cat];
      }
      return { categories: newCats.sort((a, b) => a.sortOrder - b.sortOrder) };
    });
  },

  deleteCategory: async (id) => {
    const result = await CatalogApi.deleteCategory(id);
    lastCatalogVersion = result.catalogVersion;
    set((state) => ({
      categories: state.categories.filter(c => c.id !== id),
      menu: state.menu.map(p => p.categoryId === id ? { ...p, categoryId: '', categoryName: 'Sem Categoria' } : p)
    }));
  },

  reorderCategories: async (newCategories) => {
    const ordered = newCategories.map((c, idx) => ({ ...c, sortOrder: idx }));
    set({ categories: ordered });
    for (const cat of ordered) {
      const result = await CatalogApi.upsertCategory(cat);
      lastCatalogVersion = result.catalogVersion;
    }
  },

  // --- MODIFIERS ---
  addModifierGroup: async (group) => {
    const result = await CatalogApi.saveModifierGroup(group);
    lastCatalogVersion = result.catalogVersion;
    set((state) => ({ modifierGroups: [...state.modifierGroups, group] }));
    await get().syncData({ includeCatalog: true });
  },

  updateModifierGroup: async (id, data) => {
    const { modifierGroups } = get();
    const group = modifierGroups.find(g => g.id === id);
    if (group) {
      const updated = { ...group, ...data };
      set((state) => ({
        modifierGroups: state.modifierGroups.map(g => g.id === id ? updated : g)
      }));

      const existingTimer = modifierGroupSaveTimers.get(id);
      if (existingTimer) window.clearTimeout(existingTimer);

      if (!String(updated.name || '').trim()) return;

      const timer = window.setTimeout(async () => {
        try {
          const result = await CatalogApi.saveModifierGroup({
            ...updated,
            name: String(updated.name).trim(),
            minChoices: Number(updated.minChoices) || 0,
            maxChoices: Math.max(1, Number(updated.maxChoices) || 1),
            modifiers: (updated.modifiers || [])
              .filter(modifier => String(modifier.name || '').trim())
              .map(modifier => ({
                ...modifier,
                name: String(modifier.name).trim(),
                price: Number(modifier.price) || 0,
              })),
          });
          lastCatalogVersion = result.catalogVersion;
        } catch (error) {
          console.error("❌ Erro ao salvar grupo de opcionais:", error);
          get().addNotification("Falha ao salvar opcionais. Tente novamente.", "error");
        } finally {
          modifierGroupSaveTimers.delete(id);
        }
      }, MODIFIER_GROUP_SAVE_DEBOUNCE_MS);

      modifierGroupSaveTimers.set(id, timer);
    }
  },

  deleteModifierGroup: async (id) => {
    const result = await CatalogApi.deleteModifierGroup(id);
    lastCatalogVersion = result.catalogVersion;
    set((state) => ({
      modifierGroups: state.modifierGroups.map(g => g.id === id ? { ...g, status: 'inactive' } : g)
    }));
    await get().syncData({ includeCatalog: true });
  },


  linkGroupToProduct: async (productId, groupId, linked) => {
    const result = await CatalogApi.linkModifierGroup('product', productId, groupId, linked);
    lastCatalogVersion = result.catalogVersion;
    await get().syncData({ includeCatalog: true });
  },

  linkGroupToCategory: async (categoryId, groupId, linked) => {
    const result = await CatalogApi.linkModifierGroup('category', categoryId, groupId, linked);
    lastCatalogVersion = result.catalogVersion;
    await get().syncData({ includeCatalog: true });
  },

  openTable: async (tableId, initialItems = [], origin = 'pdv', sellerId) => {
    const currentTable = get().tables.find(t => t.id === tableId);
    if (currentTable?.status === 'available') {
      // Limpeza de pedidos/solicitações antigas fica no BFF.
    }

    await OpsApi.openTable(tableId, currentTable?.status === 'available');

    set((state) => ({
      tables: state.tables.map(t => t.id === tableId ? { ...t, status: 'ordering', orders: initialItems, lastActivity: new Date() } : t),
      serviceRequests: state.serviceRequests.map(r => r.tableId === tableId ? { ...r, status: 'resolved' } : r)
    }));

    if (initialItems.length > 0) {
      await get().sendToKitchen(tableId, origin, sellerId);
    } else {
      const table = get().tables.find(t => t.id === tableId);
      await get().addAuditLog('table_opened', 'Mesa aberta sem itens iniciais', table?.number.toString(), origin);
    }
  },

  transferTable: async (fromTableId, toTableId) => {
    const state = get();
    const fromTable = state.tables.find(t => t.id === fromTableId);
    const toTable = state.tables.find(t => t.id === toTableId);

    if (!fromTable || !toTable) return;

    await OpsApi.transferTable(fromTableId, toTableId);

    set((state) => ({
      tables: state.tables.map(t => {
        if (t.id === fromTableId) return { ...t, status: 'available', orders: [] };
        if (t.id === toTableId) return { ...t, status: 'ordering', orders: [...t.orders, ...fromTable.orders] };
        return t;
      })
    }));
  },

  joinTables: async (tableIds, targetTableId) => {
    const state = get();
    const allOrders: OrderItem[] = [];

    for (const id of tableIds) {
      const table = state.tables.find(t => t.id === id);
      if (table) {
        allOrders.push(...table.orders);
        if (id !== targetTableId) {
          // Persistência feita em lote no BFF abaixo.
        }
      }
    }

    await OpsApi.joinTables(tableIds, targetTableId);

    set((state) => ({
      tables: state.tables.map(t => {
        if (tableIds.includes(t.id) && t.id !== targetTableId) return { ...t, status: 'available', orders: [] };
        if (t.id === targetTableId) return { ...t, status: 'ordering', orders: [...t.orders, ...allOrders] };
        return t;
      })
    }));
  },

  openShift: async (openingBalance) => {
    const id = createId();
    await OpsApi.openShift(id, openingBalance);
    set({ currentShift: { id, status: 'open', openingBalance } });
  },

  closeShift: async (closingBalance) => {
    const shift = get().currentShift;
    if (!shift) return;

    await OpsApi.closeShift(shift.id, closingBalance);

    set({ currentShift: null });
  },

  refreshCashState: async () => {
    const result = await OperationalApi.getCashStatus();
    set({ cashState: result.cashState });
  },

  openCash: async (openingBalance, notes = '') => {
    const result = await OperationalApi.openCash(openingBalance, notes);
    set({ cashState: result.cashState });
    get().addNotification('Caixa aberto. PDV liberado para operação.', 'info');
  },

  closeCash: async (closingBalance, notes = '', confirmationPin = '') => {
    const result = await OperationalApi.closeCash(closingBalance, notes, confirmationPin);
    set({ cashState: result.cashState });
    get().addNotification('Caixa fechado. Operação do PDV bloqueada.', 'info');
  },

  fetchAuditLogs: async () => {
    const result = await AppApi.fetchAuditLogs(50);
    set({ auditLogs: result.auditLogs as any });
  },
}));
