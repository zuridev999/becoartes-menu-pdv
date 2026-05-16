import { create } from 'zustand';
import { db } from './lib/db';
import { Repository } from './lib/repository';
import { ProductSchema, SellerSchema } from './lib/schemas';
import { hashPin, comparePin } from './lib/security';
import { createId } from './lib/id';
import { getOrderItemsTotal } from './lib/totals';
import { postOSMessage } from './lib/osBridge';
import type { 
  Product, Table, OrderItem, KitchenOrder, 
  ServiceRequest, ModifierGroup, ClosedBill, Seller, AppSettings, Modifier, Category
} from './types';

export type { Product, Table, OrderItem, KitchenOrder, ServiceRequest, ModifierGroup, ClosedBill, Seller, AppSettings, Modifier };

const TABLET_TABLE_STORAGE_KEY = 'beco_tablet_table_id';
const LEGACY_TABLET_TABLE_STORAGE_KEY = 'becoartes_tablet_table_id';
const SELLER_SESSION_STORAGE_KEY = 'beco_seller_session';
const BOOTSTRAP_ADMIN_PIN = import.meta.env.VITE_BOOTSTRAP_ADMIN_PIN || '';
const DEFAULT_MANAGER_PIN = import.meta.env.VITE_DEFAULT_MANAGER_PIN || '2020';
const DEFAULT_OPERATOR_PIN = import.meta.env.VITE_DEFAULT_OPERATOR_PIN || '0040';
let syncIntervalId: number | undefined;
let lastCatalogSyncAt = 0;
let lastCatalogVersion = '0';
const CATALOG_SYNC_INTERVAL_MS = 5 * 60 * 1000;

const toSessionSeller = (seller: Seller): Seller => ({ ...seller, pin: '' });

const persistSellerSession = (seller: Seller) => {
  const sessionSeller = toSessionSeller(seller);
  localStorage.setItem(SELLER_SESSION_STORAGE_KEY, JSON.stringify(sessionSeller));
  return sessionSeller;
};

const isLegacyPlainPin = (storedPin: string) => /^\d{4}$/.test(storedPin);

const parseJsonArray = (value: unknown): any[] => {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const loadActiveOrdersByTable = async () => {
  const ordersRes = await db.execute(`
    SELECT oi.*, o.table_id, m.name, m.category_id, c.name as category_name
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    LEFT JOIN menu m ON oi.product_id = m.id
    LEFT JOIN categories c ON m.category_id = c.id
    WHERE o.status != 'closed'
  `);

  const ordersByTable: Record<string, OrderItem[]> = {};
  ordersRes.rows.forEach((row: any) => {
    if (!ordersByTable[row.table_id]) ordersByTable[row.table_id] = [];
    ordersByTable[row.table_id].push({
      id: row.id as string,
      orderId: row.order_id as string,
      productId: row.product_id as string,
      categoryId: row.category_id as string,
      categoryName: row.category_name as string,
      name: row.name || '',
      price: row.price_at_time as number,
      quantity: row.quantity as number,
      selectedModifiers: parseJsonArray(row.selected_modifiers),
      notes: row.notes as string
    });
  });

  return ordersByTable;
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
      modifierGroups: allGroupIds.map(groupId => groupById[groupId]).filter(Boolean)
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
      await Repository.saveSettings(nextSettings);
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
    const activeSellers = get().sellers.filter(s => s.status === 'active' && (!sellerId || s.id === sellerId));

    if (activeSellers.length === 0 && BOOTSTRAP_ADMIN_PIN && pin === BOOTSTRAP_ADMIN_PIN) {
      const masterAdmin: Seller = {
        id: 'master',
        name: 'Admin Mestre',
        status: 'active',
        role: 'gerente',
        permission: 'admin',
        pin: ''
      };
      set({ currentSeller: persistSellerSession(masterAdmin) });
      return true;
    }

    for (const seller of activeSellers) {
      const isMatch = isLegacyPlainPin(seller.pin)
        ? seller.pin === pin
        : await comparePin(pin, seller.pin);

      if (isMatch) {
        if (isLegacyPlainPin(seller.pin)) {
          const hashedPin = await hashPin(pin);
          await Repository.updateSellerPin(seller.id, hashedPin);
          seller.pin = hashedPin;
          set((state) => ({
            sellers: state.sellers.map(s => s.id === seller.id ? { ...s, pin: hashedPin } : s)
          }));
        }
        set({ currentSeller: persistSellerSession(seller) });
        return true;
      }
    }

    return false;
  },

  logout: () => {
    localStorage.removeItem(SELLER_SESSION_STORAGE_KEY);
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

    await db.execute({
      sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, logData.action, logData.details, logData.table_number, logData.origin, logData.author_name, timestamp]
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
      if (savedSession) {
        set({ currentSeller: JSON.parse(savedSession) });
      }
      // 1. Migração de Categorias (Legado -> Novo)
      // Usamos um bloco try-catch interno para não travar o carregamento se a migração falhar
      try {
        const menuCheck = await db.execute("SELECT * FROM menu LIMIT 1");
        const hasCategoryId = menuCheck.columns?.includes('category_id');
        
        if (!hasCategoryId) {
          console.log("⚠️ Migrando categorias legadas...");
          const legacyMenu = await db.execute("SELECT DISTINCT category FROM menu");
          for (const row of legacyMenu.rows) {
            const catName = row.category as string;
            if (!catName) continue;
            const catId = createId();
            await Repository.upsertCategory({ id: catId, name: catName, sortOrder: 0 });
            await db.execute({
              sql: "UPDATE menu SET category_id = ? WHERE category = ?",
              args: [catId, catName]
            });
          }
        }
      } catch (migrationError) {
        console.error("❌ Erro na migração de categorias:", migrationError);
      }

      // 2. Carregar Dados
      const [catalogData, loadedSellers, kitchenData, serviceRequests, closedBills, savedSettings, tablesRes, logsRes] = await Promise.all([
        Repository.getCatalogData(),
        Repository.getSellers(),
        Repository.getKitchenOrders(),
        Repository.getServiceRequests(),
        Repository.getClosedBills(),
        Repository.getSettings(),
        db.execute("SELECT * FROM tables"),
        db.execute("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50")
      ]);
      const { categories, menuItems, modifierGroups, productMapping, categoryMapping, catalogVersion } = catalogData;

      let sellers: Seller[] = loadedSellers;
      const defaultUsers = [
        {
          id: 'admin-bootstrap',
          name: 'Admin Full',
          nickname: 'Admin',
          role: 'gerente' as const,
          permission: 'admin' as const,
          pin: BOOTSTRAP_ADMIN_PIN,
        },
        {
          id: 'manager-default',
          name: 'Gerente',
          nickname: 'Gerente',
          role: 'gerente' as const,
          permission: 'manager' as const,
          pin: DEFAULT_MANAGER_PIN,
        },
        {
          id: 'operator-default',
          name: 'Operador',
          nickname: 'Operador',
          role: 'atendente' as const,
          permission: 'operator' as const,
          pin: DEFAULT_OPERATOR_PIN,
        },
      ].filter(user => user.pin);

      for (const user of defaultUsers) {
        if (!sellers.some(s => s.id === user.id)) {
          const seller: Seller = {
            id: user.id,
            name: user.name,
            nickname: user.nickname,
            status: 'active',
            role: user.role,
            permission: user.permission,
            pin: await hashPin(user.pin)
          };
          await Repository.upsertSeller(seller);
          sellers = [...sellers, seller];
        }
      }

      const { orders: kitchenOrders, serverNow } = kitchenData;
      const serverTimeOffset = serverNow.getTime() - new Date().getTime();
      
      const menuWithModifierGroups = attachModifierGroupsToMenu(menuItems, modifierGroups, productMapping, categoryMapping);
      lastCatalogSyncAt = Date.now();
      lastCatalogVersion = catalogVersion;

      // 3. Mesas
      let tables: Table[] = tablesRes.rows.map(row => ({
        id: row.id as string,
        number: Number(row.number),
        status: row.status as Table['status'],
        orders: [],
        cart: [],
        lastActivity: row.last_activity ? new Date(row.last_activity as string) : new Date(),
      }));

      // Garantir 50 mesas para o Becoartes
      if (tables.length < 50) {
        console.log("🛠️ Gerando mesas iniciais...");
        const values: any[] = [];
        const placeholders: string[] = [];
        
        for (let i = tables.length + 1; i <= 50; i++) {
          placeholders.push("(?, ?, ?)");
          values.push(`${i}`, `${i}`, 'available');
        }

        await db.execute({ 
          sql: `INSERT OR IGNORE INTO tables (id, number, status) VALUES ${placeholders.join(', ')}`, 
          args: values 
        });

        const freshTables = await db.execute("SELECT * FROM tables");
        tables = freshTables.rows.map(row => ({
          id: row.id as string,
          number: Number(row.number),
          status: row.status as Table['status'],
          orders: [],
          cart: [],
          lastActivity: row.last_activity ? new Date(row.last_activity as string) : new Date(),
        }));
      }

      const ordersByTable = await loadActiveOrdersByTable();
      tables = tables.map(table => ({
        ...table,
        orders: ordersByTable[table.id] || []
      }));

      // 4. Determinar View Inicial pela URL e Hostname
      const hostname = window.location.hostname;
      const fullPath = window.location.pathname.substring(1);
      
      let initialView: any = 'tablet';
      let initialAdminMode: any = 'settings';
      
      if (fullPath.startsWith('admin/menu')) {
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

      // 5. Audit Logs
      const auditLogs = logsRes.rows.map((r: any) => ({
        id: r.id,
        action: r.action,
        details: r.details,
        table_number: r.table_number,
        origin: r.origin,
        author_name: r.author_name,
        timestamp: r.timestamp
      }));

      set({ 
        categories, 
        menu: menuWithModifierGroups,
        modifierGroups, 
        productModifierMapping: productMapping,
        categoryModifierMapping: categoryMapping,
        sellers, 
        kitchenOrders, 
        serviceRequests,
        closedBills,
        auditLogs,
        settings: savedSettings ? { ...get().settings, ...savedSettings } : get().settings,
        activeView: initialView as any,
        adminMode: initialAdminMode,
        adminTab: initialAdminMode === 'menu' ? 'products' : 'config',
        tables: tables.sort((a, b) => a.number - b.number),
        serverTimeOffset
      });
      
      console.log(`🚀 Sistema Becoartes Inicializado! View: ${initialView} | Host: ${hostname}`);
      
      // NOTA TÉCNICA MODO KIOSK: 
      // Para bloqueio total do hardware (botão Home, recentes, etc) no Android,
      // utilize o "Fully Kiosk Browser" apontando para este URL com "Kiosk Mode" ATIVO.
      
      // Iniciar Sync Automático (a cada 60 segundos se não for kitchen)
      if (initialView !== 'kitchen') {
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
      await db.execute({
        sql: "UPDATE menu SET visible = ? WHERE id = ?",
        args: [newVisible ? 1 : 0, id]
      });
      lastCatalogVersion = await Repository.bumpCatalogVersion();
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
      await db.execute({
        sql: "UPDATE categories SET visible = ? WHERE id = ?",
        args: [newVisible ? 1 : 0, id]
      });
      lastCatalogVersion = await Repository.bumpCatalogVersion();
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
      await Repository.upsertProduct(validated as Product);
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
      await Repository.upsertProduct(validated as Product);
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
      await Repository.deleteProduct(id);
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
    try {
      const catalogVersion = await Repository.getCatalogVersion();
      const shouldRefreshCatalog =
        Boolean(options.includeCatalog)
        || catalogVersion !== lastCatalogVersion
        || Date.now() - lastCatalogSyncAt > CATALOG_SYNC_INTERVAL_MS;
      const [kitchenData, serviceRequests, closedBills, tablesRes, catalogData] = await Promise.all([
        Repository.getKitchenOrders(),
        Repository.getServiceRequests(),
        Repository.getClosedBills(),
        db.execute("SELECT * FROM tables"),
        shouldRefreshCatalog ? Repository.getCatalogData() : Promise.resolve(null)
      ]);

      const { orders: kitchenOrders, serverNow } = kitchenData;
      const serverTimeOffset = serverNow.getTime() - new Date().getTime();
      
      const catalogUpdate = catalogData
        ? (() => {
            lastCatalogSyncAt = Date.now();
            lastCatalogVersion = catalogData.catalogVersion;
            return {
              categories: catalogData.categories,
              menu: attachModifierGroupsToMenu(catalogData.menuItems, catalogData.modifierGroups, catalogData.productMapping, catalogData.categoryMapping),
              modifierGroups: catalogData.modifierGroups,
              productModifierMapping: catalogData.productMapping,
              categoryModifierMapping: catalogData.categoryMapping
            };
          })()
        : null;

      const updatedTables = tablesRes.rows.map((row: any) => ({
        id: row.id as string,
        number: Number(row.number),
        status: row.status as Table['status'],
        orders: [],
        cart: [],
        lastActivity: row.last_activity ? new Date(row.last_activity as string) : new Date(),
      }));

      const ordersByTable = await loadActiveOrdersByTable();

      const currentTables = get().tables;
      const finalTables = updatedTables.map(newTable => {
        const localTable = currentTables.find(t => t.id === newTable.id);
        return {
          ...newTable,
          cart: localTable?.cart || [],
          orders: ordersByTable[newTable.id] || []
        };
      });

      set({ 
        ...(catalogUpdate || {}),
        kitchenOrders, 
        serviceRequests,
        closedBills,
        tables: finalTables.sort((a, b) => a.number - b.number),
        serverTimeOffset
      });
    } catch (error) {
      console.error("❌ Erro no sync de dados:", error);
    }
  },

  syncBeveragesFromInventory: async () => {
    set({ isLoading: true });
    try {
      // 1. Puxar apenas BEBIDAS do estoque do OS
      const res = await db.execute("SELECT * FROM estoque_produtos WHERE categoria = 'Bebidas' AND ativo = 1");
      
      const currentMenu = get().menu;
      
      for (const row of res.rows) {
        const remoteId = row.id as string;
        const name = row.nome as string;
        const price = row.preco_venda as number;
        
        const existing = currentMenu.find(p => p.remoteStockId === remoteId);
        
        if (existing) {
          // Atualizar item existente
          await db.execute({
            sql: "UPDATE menu SET name = ?, price = ? WHERE remote_stock_id = ?",
            args: [name, price, remoteId]
          });
        } else {
          // Criar novo item de bebida - Garantindo todos os campos
          const newId = createId();
          
          // Buscar ou criar categoria 'Bebidas'
          let cat = get().categories.find(c => c.name === 'Bebidas');
          if (!cat) {
             const catId = createId();
             await Repository.upsertCategory({ id: catId, name: 'Bebidas', sortOrder: 0 });
             await get().init(); // Recarregar categorias
             cat = get().categories.find(c => c.name === 'Bebidas');
          }

          await db.execute({
            sql: "INSERT INTO menu (id, name, description, price, category_id, image, visible, erp_code, remote_stock_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            args: [newId, name, 'Sincronizado do Estoque OS', price, cat?.id || 'bebidas', 'https://images.unsplash.com/photo-1544145945-f904253db0ad?w=400', 1, null, remoteId]
          });
        }
      }
      lastCatalogVersion = await Repository.bumpCatalogVersion();
      
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

    await Repository.deleteOrderItem(itemId);
    if (context) {
      await Repository.notifyOrderItemCancelled({
        tableNumber: context.tableNumber,
        itemName: context.itemName,
        quantity: context.quantity,
        sellerName: context.sellerName || get().currentSeller?.name || 'Sistema',
        sellerPermission: context.sellerPermission || get().currentSeller?.permission || 'standard'
      });
    }
    
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
    
    await db.execute({
      sql: "INSERT INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, ?, ?, ?)",
      args: [id, tableId, type, 'pending', message]
    });

    const newRequest: ServiceRequest = {
      id,
      tableId,
      tableNumber: typeof table?.number === 'number' ? table.number : 0,
      type,
      message,
      status: 'pending',
      createdAt: new Date()
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

    const newStatus = request.status === 'resolved' ? 'pending' : 'resolved';

    await db.execute({
      sql: "UPDATE service_requests SET status = ? WHERE id = ?",
      args: [newStatus, requestId]
    });

    set((state) => ({
      serviceRequests: state.serviceRequests.map(r => 
        r.id === requestId ? { ...r, status: newStatus } : r
      )
    }));
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

    await Repository.createKitchenOrderWithItems({
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

    set((state) => ({
      kitchenOrders: [...state.kitchenOrders, newKitchenOrder],
      tables: state.tables.map(t => t.id === tableId ? { 
        ...t, 
        orders: [...t.orders, ...persistedItems],
        cart: [],
        status: 'ordering', 
        lastActivity: new Date() 
      } : t)
    }));

    get().addNotification(`Novo pedido enviado para a Cozinha!`, 'order', tableId);
    await get().addAuditLog('order_sent', `Itens: ${table.cart.length} | Total: R$ ${total.toFixed(2)}`, table.number.toString(), origin);
  },

  updateKitchenOrderStatus: async (orderId, status) => {
    await Repository.updateOrderStatus(orderId, status);
    
    // Se o pedido ficou pronto, cria uma solicitação de serviço automática para o PDV
    if (status === 'ready') {
      const order = get().kitchenOrders.find(o => o.id === orderId);
      if (order) {
        const id = createId();
        const itemsList = order.items.map(i => `${i.quantity}x ${i.name}`).join(', ');
        
        await db.execute({
          sql: "INSERT INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, ?, ?, ?)",
          args: [id, order.tableId, 'order_ready', 'pending', itemsList]
        });

        const newRequest: ServiceRequest = {
          id,
          tableId: order.tableId,
          tableNumber: order.tableNumber,
          type: 'order_ready',
          message: itemsList,
          status: 'pending',
          createdAt: new Date()
        };

        set((state) => ({
          serviceRequests: [newRequest, ...state.serviceRequests]
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
    await db.execute({ sql: "UPDATE tables SET status = ? WHERE id = ?", args: ['bill_requested', tableId] });
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
    try {
      const closeResult = await Repository.closeBillWithInventorySync(data);

      if (closeResult.skipped || !closeResult.closedBill || !closeResult.inventorySync) {
        get().addNotification("Este fechamento já foi processado ou está em andamento.", "info");
        await get().syncData();
        return false;
      }

      set((state) => ({
        closedBills: [...state.closedBills, closeResult.closedBill],
        tables: state.tables.map(t => t.id === data.tableId ? { ...t, status: 'available', orders: [] } : t)
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
      get().addNotification("Erro ao lançar conta. Tente novamente.", "error");
      return false;
    }
  },

  updateTableStatus: async (tableId, status) => {
    await db.execute({
      sql: "UPDATE tables SET status = ? WHERE id = ?",
      args: [status, tableId]
    });
    set((state) => ({
      tables: state.tables.map(t => t.id === tableId ? { ...t, status } : t)
    }));
  },

  // CRUD VENDEDORES
  addSeller: async (s) => {
    try {
      const id = createId();
      const hashedPin = await hashPin(s.pin);
      const validated = SellerSchema.parse({ ...s, id, status: 'active', pin: hashedPin });
      await Repository.addSeller(validated);
      set((state) => ({ sellers: [...state.sellers, validated as Seller] }));
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
    const hasBills = await db.execute({ sql: "SELECT id FROM closed_bills WHERE seller_id = ? LIMIT 1", args: [id] });
    if (hasBills.rows.length > 0) {
      get().addNotification("Não é possível excluir: vendedor possui vendas vinculadas.", "error");
      return;
    }
    await Repository.deleteSeller(id);
    set((state) => ({ sellers: state.sellers.filter(s => s.id !== id) }));
  },

  toggleSellerStatus: async (id) => {
    const seller = get().sellers.find(s => s.id === id);
    if (!seller) return;
    const newStatus = seller.status === 'active' ? 'inactive' : 'active';
    await Repository.updateSellerStatus(id, newStatus);
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
    await Repository.upsertCategory(cat);
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
    await Repository.deleteCategory(id);
    set((state) => ({
      categories: state.categories.filter(c => c.id !== id),
      menu: state.menu.map(p => p.categoryId === id ? { ...p, categoryId: '', categoryName: 'Sem Categoria' } : p)
    }));
  },

  reorderCategories: async (newCategories) => {
    const ordered = newCategories.map((c, idx) => ({ ...c, sortOrder: idx }));
    set({ categories: ordered });
    for (const cat of ordered) {
      await Repository.upsertCategory(cat);
    }
  },

  // --- MODIFIERS ---
  addModifierGroup: async (group) => {
    await Repository.saveModifierGroup(group);
    set((state) => ({ modifierGroups: [...state.modifierGroups, group] }));
  },

  updateModifierGroup: async (id, data) => {
    const { modifierGroups } = get();
    const group = modifierGroups.find(g => g.id === id);
    if (group) {
      const updated = { ...group, ...data };
      await Repository.saveModifierGroup(updated);
      set((state) => ({
        modifierGroups: state.modifierGroups.map(g => g.id === id ? updated : g)
      }));
    }
  },

  deleteModifierGroup: async (id) => {
    await Repository.deleteModifierGroup(id);
    set((state) => ({
      modifierGroups: state.modifierGroups.map(g => g.id === id ? { ...g, status: 'inactive' } : g)
    }));
  },


  linkGroupToProduct: async (productId, groupId, linked) => {
    await Repository.linkGroupToProduct(productId, groupId, linked);
    await get().syncData({ includeCatalog: true });
  },

  linkGroupToCategory: async (categoryId, groupId, linked) => {
    await Repository.linkGroupToCategory(categoryId, groupId, linked);
    await get().syncData({ includeCatalog: true });
  },

  openTable: async (tableId, initialItems = [], origin = 'pdv', sellerId) => {
    const currentTable = get().tables.find(t => t.id === tableId);
    if (currentTable?.status === 'available') {
      await db.execute({
        sql: "UPDATE orders SET status = 'closed' WHERE table_id = ? AND status != 'closed'",
        args: [tableId]
      });
    }

    await db.execute({
      sql: "UPDATE tables SET status = 'ordering', last_activity = CURRENT_TIMESTAMP WHERE id = ?",
      args: [tableId]
    });
    
    set((state) => ({
      tables: state.tables.map(t => t.id === tableId ? { ...t, status: 'ordering', orders: initialItems, lastActivity: new Date() } : t)
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

    // No DB: Mover itens de pedidos de uma mesa para outra
    // (Simplificando: atualizando o table_id nas tabelas relacionadas se necessário)
    await db.execute({
      sql: "UPDATE tables SET status = 'available' WHERE id = ?",
      args: [fromTableId]
    });
    await db.execute({
      sql: "UPDATE tables SET status = 'ordering' WHERE id = ?",
      args: [toTableId]
    });

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
          await db.execute({ sql: "UPDATE tables SET status = 'available' WHERE id = ?", args: [id] });
        }
      }
    }

    await db.execute({ sql: "UPDATE tables SET status = 'ordering' WHERE id = ?", args: [targetTableId] });

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
    await db.execute({
      sql: "INSERT INTO shifts (id, status, opening_balance) VALUES (?, ?, ?)",
      args: [id, 'open', openingBalance]
    });
    set({ currentShift: { id, status: 'open', openingBalance } });
  },

  closeShift: async (closingBalance) => {
    const shift = get().currentShift;
    if (!shift) return;

    await db.execute({
      sql: "UPDATE shifts SET status = 'closed', closing_balance = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [closingBalance, shift.id]
    });

    set({ currentShift: null });
  },

  fetchAuditLogs: async () => {
    const res = await db.execute("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50");
    set({ auditLogs: res.rows as any });
  },
}));
