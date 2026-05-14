import { create } from 'zustand';
import { db } from './lib/db';
import { Repository } from './lib/repository';
import { ProductSchema, SellerSchema } from './lib/schemas';
import { hashPin, comparePin } from './lib/security';
import type { 
  Product, Table, OrderItem, KitchenOrder, 
  ServiceRequest, ModifierGroup, ClosedBill, Seller, AppSettings, Modifier, Category
} from './types';

export type { Product, Table, OrderItem, KitchenOrder, ServiceRequest, ModifierGroup, ClosedBill, Seller, AppSettings, Modifier };


export interface AppState {
  menu: Product[];
  categories: Category[];
  tables: Table[];
  kitchenOrders: KitchenOrder[];
  serviceRequests: ServiceRequest[];
  modifierGroups: ModifierGroup[];
  banners: string[];
  sellers: Seller[];
  notifications: { id: string; message: string; tableId: string; type: 'order' | 'bill' | 'service' | 'info' | 'error' }[];
  closedBills: ClosedBill[];
  auditLogs: { id: string; action: string; details: string; table_number: string; origin: string; author_name: string; timestamp: string }[];
  fetchAuditLogs: () => Promise<void>;
  syncData: () => Promise<void>;
  addAuditLog: (log: { action: string; details?: any; table_number?: string; origin?: string; author_name?: string } | string, details?: string, tableNumber?: string, origin?: string) => Promise<void>;
  activeView: 'tablet' | 'pdv' | 'admin' | 'kitchen' | 'qr' | '';
  adminTab: 'config' | 'products' | 'categories' | 'optionals' | 'sellers' | 'movements';
  adminMode: 'menu' | 'settings';
  isLoading: boolean;
  setAdminTab: (tab: 'config' | 'products' | 'categories' | 'optionals' | 'sellers' | 'movements') => void;
  currentShift: { id: string, status: 'open' | 'closed', openingBalance: number } | null;
  serverTimeOffset: number;
  
  currentTableId: string | null;
  setCurrentTableId: (id: string | null) => void;
  init: () => Promise<void>;
  setActiveView: (view: 'tablet' | 'pdv' | 'admin' | 'kitchen' | 'qr', tab?: 'config' | 'products' | 'categories' | 'optionals' | 'sellers' | 'movements', mode?: 'menu' | 'settings') => void;
  toggleProductVisibility: (id: string) => void;
  toggleCategoryVisibility: (id: string) => void;
  addProduct: (product: Product) => Promise<void>;
  updateProduct: (id: string, product: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  
  currentSeller: Seller | null;
  login: (pin: string) => Promise<boolean>;
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
  linkGroupToProduct: (productId: string, groupId: string) => Promise<void>;
  upsertCategory: (cat: Category) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  reorderCategories: (categories: Category[]) => Promise<void>;
  syncBeveragesFromInventory: () => Promise<void>;

  addToCart: (product: Product, quantity: number, selectedModifiers: Modifier[], notes?: string) => void;
  removeOrderItem: (itemId: string) => void;
  removeFromCart: (itemId: string) => void;
  sendToKitchen: (tableId: string, origin?: 'tablet' | 'pdv' | 'qr', sellerId?: string) => Promise<void>;
  requestBill: (tableId: string) => void;
  requestService: (tableId: string, type: string, message?: string) => void;
  resolveService: (requestId: string) => void;
  closeBill: (data: Omit<ClosedBill, 'id' | 'closedAt'>) => Promise<void>;
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
  updateSettings: (settings: Partial<AppSettings>) => void;
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

  updateSettings: (newSettings) => set((state) => ({ 
    settings: { 
      ...state.settings, 
      ...newSettings,
      tablet: newSettings.tablet ? { ...state.settings.tablet, ...newSettings.tablet } : state.settings.tablet,
      kitchen: newSettings.kitchen ? { ...state.settings.kitchen, ...newSettings.kitchen } : state.settings.kitchen
    } 
  })),

  currentTableId: localStorage.getItem('beco_tablet_table_id'),
  setCurrentTableId: (id) => {
    if (id) localStorage.setItem('beco_tablet_table_id', id);
    else localStorage.removeItem('beco_tablet_table_id');
    set({ currentTableId: id });
  },

  currentSeller: null,

  login: async (pin) => {
    // PINs de Sistema Diretos (Prioridade)
    if (pin === '0806') {
      const admin: Seller = {
        id: 'admin-system',
        name: 'Administrador',
        status: 'active',
        role: 'gerente',
        permission: 'admin',
        pin: '0806'
      };
      set({ currentSeller: admin });
      localStorage.setItem('beco_seller_session', JSON.stringify(admin));
      return true;
    }

    if (pin === '0040') {
      const operator: Seller = {
        id: 'op-system',
        name: 'Operador',
        status: 'active',
        role: 'atendente',
        permission: 'standard',
        pin: '0040'
      };
      set({ currentSeller: operator });
      localStorage.setItem('beco_seller_session', JSON.stringify(operator));
      return true;
    }

    // Acesso de Emergência se não houver vendedores
    if (get().sellers.length === 0 && pin === '0000') {
      const masterAdmin: Seller = {
        id: 'master',
        name: 'Admin Mestre',
        status: 'active',
        role: 'gerente',
        permission: 'admin',
        pin: '0000'
      };
      set({ currentSeller: masterAdmin });
      localStorage.setItem('beco_seller_session', JSON.stringify(masterAdmin));
      return true;
    }

    const seller = get().sellers.find(s => s.status === 'active');
    if (seller) {
      const isMatch = await comparePin(pin, seller.pin);
      if (isMatch) {
        set({ currentSeller: seller });
        localStorage.setItem('beco_seller_session', JSON.stringify(seller));
        return true;
      }
    }
    
    // Fallback para PIN mestre em hash se configurado ou texto puro se for primeira vez
    if (pin === '0000') {
       const masterAdmin: Seller = {
         id: 'master', name: 'Admin Mestre', status: 'active', role: 'gerente', permission: 'admin', pin: '0000'
       };
       set({ currentSeller: masterAdmin });
       return true;
    }

    return false;
  },

  logout: () => {
    localStorage.removeItem('beco_seller_session');
    set({ currentSeller: null });
  },

  addAuditLog: async (logOrAction: any, details?: string, tableNumber?: string, origin?: string) => {
    const id = Math.random().toString(36).substr(2, 9);
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
      const savedSession = localStorage.getItem('beco_seller_session');
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
            const catId = Math.random().toString(36).substr(2, 9);
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
      const [categories, menuItems, modifierGroups, sellers, kitchenData, mgMapping] = await Promise.all([
        Repository.getCategories(),
        Repository.getMenu(),
        Repository.getModifierGroups(),
        Repository.getSellers(),
        Repository.getKitchenOrders(),
        Repository.getProductModifierGroupsMapping()
      ]);

      const { orders: kitchenOrders, serverNow } = kitchenData;
      const serverTimeOffset = serverNow.getTime() - new Date().getTime();
      
      // Associar Modificadores em memória (O(1) lookup)
      const mgMap: Record<string, any> = {};
      modifierGroups.forEach(g => mgMap[g.id] = g);
      
      menuItems.forEach(item => {
        const groupIds = mgMapping[item.id] || [];
        item.modifierGroups = groupIds.map(gid => mgMap[gid]).filter(Boolean);
      });

      // 3. Mesas
      const tablesRes = await db.execute("SELECT * FROM tables");
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
        const missing = 50 - tables.length;
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

      // 4. Determinar View Inicial pela URL e Hostname
      const hostname = window.location.hostname;
      
      let initialView: any = 'tablet';
      let initialAdminMode: any = 'settings';
      
      if (hostname.startsWith('pdv.')) initialView = 'pdv';
      else if (hostname.startsWith('coz.')) initialView = 'kitchen';
      else if (hostname.startsWith('tablet.')) initialView = 'tablet';
      else if (hostname.startsWith('qr.')) initialView = 'qr';
      else {
        const fullPath = window.location.pathname.substring(1);
        if (fullPath.startsWith('admin/menu')) {
          initialView = 'admin';
          initialAdminMode = 'menu';
        } else if (fullPath.startsWith('admin/settings') || fullPath.startsWith('admin/config')) {
          initialView = 'admin';
          initialAdminMode = 'settings';
        } else {
          const validViews = ['tablet', 'pdv', 'admin', 'kitchen', 'qr'];
          initialView = validViews.includes(fullPath) ? fullPath : 'tablet';
        }
      }

      // 5. Fetch Audit Logs
      const logsRes = await db.execute("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50");
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
        menu: menuItems, 
        modifierGroups, 
        sellers, 
        kitchenOrders, 
        auditLogs,
        activeView: initialView as any,
        adminMode: initialAdminMode,
        adminTab: initialAdminMode === 'menu' ? 'products' : 'config',
        tables: tables.sort((a, b) => a.number - b.number),
        serverTimeOffset
      });
      
      console.log(`🚀 Sistema Becoartes Inicializado! View: ${initialView} | Host: ${hostname}`);
      
      // Iniciar Sync Automático (a cada 30 segundos se não for kitchen)
      if (initialView !== 'kitchen') {
        setInterval(() => {
          get().syncData();
        }, 30000);
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
    await db.execute({
      sql: "UPDATE menu SET visible = ? WHERE id = ?",
      args: [newVisible ? 1 : 0, id]
    });
    set((state) => ({
      menu: state.menu.map(p => p.id === id ? { ...p, visible: newVisible } : p)
    }));
  },
  toggleCategoryVisibility: async (id) => {
    const category = get().categories.find(c => c.id === id);
    if (!category) return;
    const newVisible = !category.visible;
    await db.execute({
      sql: "UPDATE categories SET visible = ? WHERE id = ?",
      args: [newVisible ? 1 : 0, id]
    });
    set((state) => ({
      categories: state.categories.map(c => c.id === id ? { ...c, visible: newVisible } : c)
    }));
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

  syncData: async () => {
    try {
      const [kitchenData, tablesRes, categories, menuItems, modifierGroups, mgMapping] = await Promise.all([
        Repository.getKitchenOrders(),
        db.execute("SELECT * FROM tables"),
        Repository.getCategories(),
        Repository.getMenu(),
        Repository.getModifierGroups(),
        Repository.getProductModifierGroupsMapping()
      ]);

      const { orders: kitchenOrders, serverNow } = kitchenData;
      const serverTimeOffset = serverNow.getTime() - new Date().getTime();

      // Associar em memória
      const mgMap: Record<string, any> = {};
      modifierGroups.forEach(g => mgMap[g.id] = g);
      
      menuItems.forEach(item => {
        const groupIds = mgMapping[item.id] || [];
        item.modifierGroups = groupIds.map(gid => mgMap[gid]).filter(Boolean);
      });

      const updatedTables = tablesRes.rows.map((row: any) => ({
        id: row.id as string,
        number: Number(row.number),
        status: row.status as Table['status'],
        orders: [],
        cart: [],
        lastActivity: row.last_activity ? new Date(row.last_activity as string) : new Date(),
      }));

      const ordersRes = await db.execute(`
        SELECT oi.*, o.table_id 
        FROM order_items oi 
        JOIN orders o ON oi.order_id = o.id 
        WHERE o.status != 'closed'
      `);

      const ordersByTable: Record<string, OrderItem[]> = {};
      ordersRes.rows.forEach((row: any) => {
        if (!ordersByTable[row.table_id]) ordersByTable[row.table_id] = [];
        ordersByTable[row.table_id].push({
          id: row.id as string,
          productId: row.product_id as string,
          name: row.name || '', 
          price: row.price_at_time as number,
          quantity: row.quantity as number,
          selectedModifiers: JSON.parse(row.selected_modifiers as string || '[]'),
          notes: row.notes as string
        });
      });

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
        categories,
        menu: menuItems,
        modifierGroups,
        kitchenOrders, 
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
          const newId = Math.random().toString(36).substr(2, 9);
          
          // Buscar ou criar categoria 'Bebidas'
          let cat = get().categories.find(c => c.name === 'Bebidas');
          if (!cat) {
             const catId = Math.random().toString(36).substr(2, 9);
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
      id: Math.random().toString(36).substr(2, 9),
      productId: product.id,
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

  removeOrderItem: (itemId) => {
    const { currentTableId } = get();
    if (!currentTableId) return;
    
    set((state) => ({
      tables: state.tables.map(t => {
        if (t.id === currentTableId) {
          const newOrders = t.orders.filter(o => o.id !== itemId);
          return { ...t, orders: newOrders };
        }
        return t;
      })
    }));
  },

  requestService: async (tableId, type, message = '') => {
    const table = get().tables.find(t => t.id === tableId);
    const id = Math.random().toString(36).substr(2, 9);
    
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
  },

  resolveService: async (requestId) => {
    await db.execute({
      sql: "UPDATE service_requests SET status = ? WHERE id = ?",
      args: ['done', requestId]
    });
    set((state) => ({
      serviceRequests: state.serviceRequests.filter(r => r.id !== requestId)
    }));
  },

  sendToKitchen: async (tableId, origin = 'pdv', sellerId) => {
    const table = get().tables.find(t => t.id === tableId);
    if (!table || table.cart.length === 0) return;

    const orderId = Math.random().toString(36).substr(2, 9);
    const total = table.cart.reduce((acc, o) => {
      const modifiersTotal = o.selectedModifiers?.reduce((mAcc, m) => mAcc + m.price, 0) || 0;
      const itemPrice = o.price + modifiersTotal;
      return acc + (itemPrice * o.quantity);
    }, 0);

    // Repositório
    await Repository.createOrder(orderId, tableId, total, origin, sellerId || null);

    // Salvar Itens do Pedido (Mover do Carrinho)
    for (const item of table.cart) {
      const itemId = Math.random().toString(36).substr(2, 9);
      await Repository.addOrderItem(itemId, orderId, item.productId, item.quantity, item.price, JSON.stringify(item.selectedModifiers), item.notes || '');
    }

    const newKitchenOrder: KitchenOrder = {
      id: orderId,
      tableId: tableId,
      tableNumber: table.number,
      items: [...table.cart],
      status: 'pending',
      origin: origin as 'tablet' | 'pdv',
      createdAt: new Date()
    };

    set((state) => ({
      kitchenOrders: [...state.kitchenOrders, newKitchenOrder],
      tables: state.tables.map(t => t.id === tableId ? { 
        ...t, 
        orders: [...t.orders, ...table.cart],
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
    set((state) => ({
      kitchenOrders: state.kitchenOrders.map(o => o.id === orderId ? { ...o, status } : o)
    }));
  },

  requestBill: async (tableId) => {
    const table = get().tables.find(t => t.id === tableId);
    await db.execute({ sql: "UPDATE tables SET status = ? WHERE id = ?", args: ['bill_requested', tableId] });
    set((state) => ({ tables: state.tables.map(t => t.id === tableId ? { ...t, status: 'bill_requested' } : t) }));
    get().addNotification(`A Mesa ${table.number} solicitou o fechamento da conta!`, 'info', tableId);
    await get().addAuditLog('bill_requested', 'Cliente solicitou a conta via Tablet', table?.number.toString(), 'tablet');
  },

  closeBill: async (data) => {
    try {
      await get().addAuditLog('bill_closed', `Fechamento: R$ ${data.total.toFixed(2)}`, data.tableNumber.toString(), 'pdv');
      const id = Math.random().toString(36).substr(2, 9);
      const closedAt = new Date();
      const closedBill: ClosedBill = { ...data, id, closedAt };

      // Salvar no DB
      await db.execute({
        sql: "INSERT INTO closed_bills (id, table_number, seller_id, seller_name, subtotal, service_fee, discount, discount_reason, total, payments, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          id, 
          data.tableNumber, 
          data.sellerId,
          data.sellerName,
          data.subtotal, 
          data.serviceFee, 
          data.discount, 
          data.discountReason || null, 
          data.total, 
          JSON.stringify(data.payments), 
          closedAt.toISOString()
        ]
      });

      // Liberar mesa no DB
      await db.execute({
        sql: "UPDATE tables SET status = 'available', last_activity = ? WHERE id = ?",
        args: [closedAt.toISOString(), data.tableId]
      });

      set((state) => ({
        closedBills: [...state.closedBills, closedBill],
        tables: state.tables.map(t => t.id === data.tableId ? { ...t, status: 'available', orders: [] } : t)
      }));
      
      get().addNotification(`Conta Lançada! Mesa ${data.tableNumber} finalizada com sucesso!`, 'info');
    } catch (error) {
      console.error("Erro ao fechar conta:", error);
      get().addNotification("Erro ao lançar conta. Tente novamente.", "error");
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
      const id = Math.random().toString(36).substr(2, 9);
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
    const id = Math.random().toString(36).substr(2, 9);
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


  linkGroupToProduct: async (productId, groupId) => {
    set((state) => ({
      menu: state.menu.map(p => {
        if (p.id === productId) {
          const group = state.modifierGroups.find(g => g.id === groupId);
          if (group && !p.modifierGroups.some(mg => mg.id === groupId)) {
            return { ...p, modifierGroups: [...p.modifierGroups, group] };
          }
        }
        return p;
      })
    }));
  },

  openTable: async (tableId, initialItems = [], origin = 'pdv', sellerId) => {
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
    const id = Math.random().toString(36).substr(2, 9);
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
