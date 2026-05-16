import { db } from './db';
import type { SellerInput } from './schemas';
import { createId } from './id';
import { getOrderItemsTotal } from './totals';

const OS_EMPRESA_ID = import.meta.env.VITE_OS_EMPRESA_ID || 'e19cbcce-b2a7-4cc1-bf70-c06d2f8feb8a';
const OS_TENANT_SLUG = import.meta.env.VITE_OS_TENANT_SLUG || 'becoartes';
const OS_SYSTEM_USER_ID = import.meta.env.VITE_OS_SYSTEM_USER_ID || '';

type ActiveOrderItemRow = {
  id: string;
  orderId: string;
  productId: string;
  name: string;
  remoteStockId: string;
  quantity: number;
  selectedModifiers: Array<{ id: string; name: string; price?: number }>;
};

type InventorySyncResult = {
  movementCount: number;
  unmatched: string[];
  insufficient: string[];
};

const parseJsonArray = (value: unknown) => {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const toStockAmount = (value: unknown) => Math.max(0, Math.trunc(Number(value || 0)));

export const Repository = {
  // --- MENU ---
  // --- CATEGORIES ---
  async getCategories() {
    const res = await db.execute("SELECT * FROM categories ORDER BY sort_order ASC");
    return res.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      schedule: row.schedule_config ? JSON.parse(row.schedule_config as string) : undefined,
      sortOrder: row.sort_order as number,
      visible: row.visible === 1,
    }));
  },

  async upsertCategory(cat: any) {
    await db.execute({
      sql: "INSERT OR REPLACE INTO categories (id, name, schedule_config, sort_order, visible) VALUES (?, ?, ?, ?, ?)",
      args: [cat.id, cat.name, cat.schedule ? JSON.stringify(cat.schedule) : null, cat.sortOrder || 0, cat.visible ? 1 : 0]
    });
  },

  async deleteCategory(id: string) {
    await db.execute({ sql: "DELETE FROM categories WHERE id = ?", args: [id] });
    // Opcional: Atualizar produtos da categoria deletada?
    await db.execute({ sql: "UPDATE menu SET category_id = NULL WHERE category_id = ?", args: [id] });
  },

  // --- MENU ---
  async getMenu() {
    const res = await db.execute(`
      SELECT m.*, c.name as category_name 
      FROM menu m 
      LEFT JOIN categories c ON m.category_id = c.id
    `);
    return res.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      price: row.price as number,
      categoryId: row.category_id as string,
      categoryName: row.category_name as string,
      image: row.image as string,
      visible: row.visible === 1,
      schedule: row.schedule_config ? JSON.parse(row.schedule_config as string) : undefined,
      erpCode: row.erp_code as string,
      remoteStockId: row.remote_stock_id as string,
      cost: row.cost as number,
      modifierGroups: [] // Carregado separadamente se necessário
    }));
  },

  async upsertProduct(p: any) {
    await db.execute({
      sql: "INSERT OR REPLACE INTO menu (id, name, description, price, category, category_id, image, visible, erp_code, remote_stock_id, schedule_config, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        p.id, p.name, p.description || '', p.price, 
        p.categoryId, p.categoryId, p.image, p.visible ? 1 : 0, 
        p.erpCode || null, p.remoteStockId || null,
        p.schedule ? JSON.stringify(p.schedule) : null,
        p.cost || 0
      ]
    });

    // Sincronizar grupos de modificadores vinculados
    if (p.modifierGroups) {
      await db.execute({ sql: "DELETE FROM product_modifier_groups WHERE product_id = ?", args: [p.id] });
      for (let i = 0; i < p.modifierGroups.length; i++) {
        const mg = p.modifierGroups[i];
        await db.execute({
          sql: "INSERT INTO product_modifier_groups (product_id, group_id, sort_order) VALUES (?, ?, ?)",
          args: [p.id, mg.id, i]
        });
      }
    }
  },

  // --- MODIFIERS ---
  async getModifierGroups() {
    const [groupsRes, modifiersRes] = await Promise.all([
      db.execute("SELECT * FROM modifier_groups WHERE status = 'active'"),
      db.execute("SELECT * FROM modifiers WHERE status = 'active' ORDER BY sort_order ASC")
    ]);

    const modifiersByGroup: Record<string, any[]> = {};
    modifiersRes.rows.forEach((m: any) => {
      if (!modifiersByGroup[m.group_id]) modifiersByGroup[m.group_id] = [];
      modifiersByGroup[m.group_id].push({
        id: m.id as string,
        name: m.name as string,
        price: m.price as number,
        status: m.status as any,
        sortOrder: m.sort_order as number
      });
    });

    return groupsRes.rows.map((row: any) => ({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      minChoices: row.min_choices as number,
      maxChoices: row.max_choices as number,
      isRequired: row.is_required === 1,
      status: row.status as any,
      modifiers: modifiersByGroup[row.id] || []
    }));
  },

  async saveModifierGroup(group: any) {
    await db.execute({
      sql: "INSERT OR REPLACE INTO modifier_groups (id, name, min_choices, max_choices, is_required, status) VALUES (?, ?, ?, ?, ?, ?)",
      args: [group.id, group.name, group.minChoices || 0, group.maxChoices || 1, group.isRequired ? 1 : 0, group.status || 'active']
    });

    if (group.modifiers) {
      await db.execute({ sql: "DELETE FROM modifiers WHERE group_id = ?", args: [group.id] });
      for (let i = 0; i < group.modifiers.length; i++) {
        const m = group.modifiers[i];
        await db.execute({
          sql: "INSERT INTO modifiers (id, group_id, name, price, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
          args: [m.id || createId(), group.id, m.name, m.price, m.status || 'active', i]
        });
      }
    }
  },

  async deleteModifierGroup(id: string) {
    await db.execute({ sql: "UPDATE modifier_groups SET status = 'inactive' WHERE id = ?", args: [id] });
  },

  async getProductModifierGroupsMapping() {
    const res = await db.execute(`
      SELECT pmg.*
      FROM product_modifier_groups pmg
      JOIN modifier_groups mg ON pmg.group_id = mg.id
      WHERE mg.status = 'active'
      ORDER BY pmg.product_id, pmg.sort_order
    `);
    
    const mapping: Record<string, string[]> = {};
    res.rows.forEach((row: any) => {
      if (!mapping[row.product_id]) mapping[row.product_id] = [];
      mapping[row.product_id].push(row.group_id as string);
    });
    return mapping;
  },

  async getCategoryModifierGroupsMapping() {
    const res = await db.execute(`
      SELECT cmg.*
      FROM category_modifier_groups cmg
      JOIN modifier_groups mg ON cmg.group_id = mg.id
      WHERE mg.status = 'active'
      ORDER BY cmg.category_id, cmg.sort_order
    `);
    
    const mapping: Record<string, string[]> = {};
    res.rows.forEach((row: any) => {
      if (!mapping[row.category_id]) mapping[row.category_id] = [];
      mapping[row.category_id].push(row.group_id as string);
    });
    return mapping;
  },

  async linkGroupToCategory(categoryId: string, groupId: string, linked: boolean) {
    if (linked) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO category_modifier_groups (category_id, group_id) VALUES (?, ?)",
        args: [categoryId, groupId]
      });
    } else {
      await db.execute({
        sql: "DELETE FROM category_modifier_groups WHERE category_id = ? AND group_id = ?",
        args: [categoryId, groupId]
      });
    }
  },

  async linkGroupToProduct(productId: string, groupId: string, linked: boolean) {
    if (linked) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO product_modifier_groups (product_id, group_id) VALUES (?, ?)",
        args: [productId, groupId]
      });
    } else {
      await db.execute({
        sql: "DELETE FROM product_modifier_groups WHERE product_id = ? AND group_id = ?",
        args: [productId, groupId]
      });
    }
  },

  async deleteProduct(id: string) {
    await db.execute({ sql: "DELETE FROM menu WHERE id = ?", args: [id] });
  },

  // --- SELLERS ---
  async getSellers() {
    const res = await db.execute("SELECT * FROM sellers");
    return res.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      nickname: row.nickname as string,
      status: row.status as any,
      role: row.role as any,
      permission: row.permission as any,
      pin: row.pin as string,
      createdAt: new Date(row.created_at as string)
    }));
  },

  async addSeller(s: SellerInput) {
    await db.execute({
      sql: "INSERT INTO sellers (id, name, nickname, status, role, permission, pin) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [s.id, s.name, s.nickname || '', s.status, s.role, s.permission, s.pin]
    });
  },

  async upsertSeller(s: SellerInput) {
    await db.execute({
      sql: "INSERT OR REPLACE INTO sellers (id, name, nickname, status, role, permission, pin) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [s.id, s.name, s.nickname || '', s.status, s.role, s.permission, s.pin]
    });
  },

  async updateSellerStatus(id: string, status: string) {
    await db.execute({
      sql: "UPDATE sellers SET status = ? WHERE id = ?",
      args: [status, id]
    });
  },

  async updateSellerPin(id: string, pin: string) {
    await db.execute({
      sql: "UPDATE sellers SET pin = ? WHERE id = ?",
      args: [pin, id]
    });
  },

  async deleteSeller(id: string) {
    await db.execute({ sql: "DELETE FROM sellers WHERE id = ?", args: [id] });
  },

  // --- ORDERS ---
  async createOrder(id: string, tableId: string, total: number, origin: string, sellerId: string | null) {
    await db.execute({
      sql: "INSERT INTO orders (id, table_id, total, status, origin, created_by_id) VALUES (?, ?, ?, ?, ?, ?)",
      args: [id, tableId, total, 'pending', origin, sellerId]
    });
  },

  async addOrderItem(id: string, orderId: string, productId: string, qty: number, price: number, modifiers: string, notes: string = '') {
    await db.execute({
      sql: "INSERT INTO order_items (id, order_id, product_id, quantity, price_at_time, selected_modifiers, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, orderId, productId, qty, price, modifiers, notes]
    });
  },

  async getKitchenOrders() {
    const [kOrdersRes, itemsRes, nowRes] = await Promise.all([
      db.execute("SELECT o.id, o.status, o.table_id, o.origin, strftime('%Y-%m-%dT%H:%M:%SZ', o.created_at) as created_at, t.number as tableNumber FROM orders o JOIN tables t ON o.table_id = t.id WHERE o.status IN ('pending', 'preparing') ORDER BY o.created_at ASC"),
      db.execute("SELECT oi.*, m.name FROM order_items oi JOIN menu m ON oi.product_id = m.id"),
      db.execute("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now') as serverNow")
    ]);
    
    const serverNow = new Date(nowRes.rows[0].serverNow as string);
    const itemsByOrder: Record<string, any[]> = {};
    
    itemsRes.rows.forEach((iRow: any) => {
      if (!itemsByOrder[iRow.order_id]) itemsByOrder[iRow.order_id] = [];
      itemsByOrder[iRow.order_id].push({
        id: iRow.id as string,
        orderId: iRow.order_id as string,
        productId: iRow.product_id as string,
        name: iRow.name as string,
        price: iRow.price_at_time as number,
        quantity: iRow.quantity as number,
        selectedModifiers: parseJsonArray(iRow.selected_modifiers),
        notes: iRow.notes || ''
      });
    });

    const kOrders = kOrdersRes.rows.map((oRow: any) => ({
      id: oRow.id as string,
      tableId: oRow.table_id as string,
      tableNumber: Number(oRow.tableNumber),
      status: oRow.status as any,
      origin: (oRow.origin || 'pdv') as any,
      createdAt: new Date(oRow.created_at as string),
      items: itemsByOrder[oRow.id] || []
    }));

    return { orders: kOrders, serverNow };
  },

  async updateOrderStatus(id: string, status: string) {
    await db.execute({
      sql: "UPDATE orders SET status = ? WHERE id = ?",
      args: [status, id]
    });
  },

  async deleteOrderItem(id: string) {
    const itemRes = await db.execute({ sql: "SELECT order_id FROM order_items WHERE id = ? LIMIT 1", args: [id] });
    const orderId = itemRes.rows[0]?.order_id as string | undefined;

    await db.execute({ sql: "DELETE FROM order_items WHERE id = ?", args: [id] });

    if (!orderId) return;

    const remainingRes = await db.execute({
      sql: "SELECT quantity, price_at_time, selected_modifiers FROM order_items WHERE order_id = ?",
      args: [orderId]
    });

    const remainingItems = remainingRes.rows.map((row: any) => ({
      price: Number(row.price_at_time || 0),
      quantity: Number(row.quantity || 0),
      selectedModifiers: parseJsonArray(row.selected_modifiers)
    }));

    if (remainingItems.length === 0) {
      await db.execute({ sql: "UPDATE orders SET total = 0, status = 'closed' WHERE id = ?", args: [orderId] });
      return;
    }

    await db.execute({
      sql: "UPDATE orders SET total = ? WHERE id = ?",
      args: [getOrderItemsTotal(remainingItems), orderId]
    });
  },

  async getActiveOrderItemsForTable(tableId: string): Promise<ActiveOrderItemRow[]> {
    const res = await db.execute({
      sql: `
        SELECT
          oi.id,
          oi.order_id,
          oi.product_id,
          oi.quantity,
          oi.selected_modifiers,
          m.name,
          m.remote_stock_id
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        LEFT JOIN menu m ON oi.product_id = m.id
        WHERE o.table_id = ? AND o.status != 'closed'
        ORDER BY o.created_at ASC
      `,
      args: [tableId]
    });

    return res.rows.map((row: any) => ({
      id: row.id as string,
      orderId: row.order_id as string,
      productId: row.product_id as string,
      name: row.name as string || '',
      remoteStockId: row.remote_stock_id as string || '',
      quantity: Number(row.quantity || 0),
      selectedModifiers: parseJsonArray(row.selected_modifiers)
    }));
  },

  async claimIntegrationEvent(id: string, type: string, tableId: string, payload: unknown) {
    const now = Date.now();
    const existing = await db.execute({ sql: "SELECT status FROM integration_events WHERE id = ? LIMIT 1", args: [id] });
    const status = existing.rows[0]?.status as string | undefined;

    if (status === 'completed' || status === 'processing') {
      return false;
    }

    await db.execute({
      sql: `
        INSERT OR REPLACE INTO integration_events
          (id, type, status, table_id, payload, error, created_at, updated_at)
        VALUES (?, ?, 'processing', ?, ?, NULL, COALESCE((SELECT created_at FROM integration_events WHERE id = ?), ?), ?)
      `,
      args: [id, type, tableId, JSON.stringify(payload), id, now, now]
    });

    return true;
  },

  async completeIntegrationEvent(id: string, payload: unknown) {
    await db.execute({
      sql: "UPDATE integration_events SET status = 'completed', payload = ?, error = NULL, updated_at = ? WHERE id = ?",
      args: [JSON.stringify(payload), Date.now(), id]
    });
  },

  async failIntegrationEvent(id: string, error: unknown) {
    await db.execute({
      sql: "UPDATE integration_events SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
      args: [error instanceof Error ? error.message : String(error), Date.now(), id]
    });
  },

  async resolveOSContext() {
    let empresaId = OS_EMPRESA_ID;
    if (!empresaId) {
      const empresaRes = await db.execute("SELECT id FROM empresas WHERE slug = 'becoartes' LIMIT 1");
      empresaId = empresaRes.rows[0]?.id as string || '';
    }

    if (!empresaId) {
      throw new Error('Empresa do OS não encontrada para sincronização de estoque.');
    }

    let userId = OS_SYSTEM_USER_ID;
    if (!userId) {
      const userRes = await db.execute({
        sql: "SELECT id FROM users WHERE empresa_id = ? AND role IN ('admin', 'super_admin') ORDER BY created_at ASC LIMIT 1",
        args: [empresaId]
      });
      userId = userRes.rows[0]?.id as string || '';
    }

    if (!userId) {
      throw new Error('Usuário responsável do OS não encontrado para movimentação de estoque.');
    }

    return { empresaId, userId, slug: OS_TENANT_SLUG };
  },

  async createOSNotification(data: { empresaId: string; title: string; message: string; type?: 'info' | 'warning' | 'error' | 'alert'; link?: string }) {
    await db.execute({
      sql: "INSERT INTO notificacoes (id, empresa_id, usuario_id, titulo, mensagem, tipo, lida, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [createId(), data.empresaId, null, data.title, data.message, data.type || 'info', 0, data.link || null, Date.now()]
    });
  },

  async findStockProduct(empresaId: string, candidates: { id?: string; name: string }) {
    const ids = [candidates.id].filter(Boolean) as string[];

    for (const id of ids) {
      const byId = await db.execute({
        sql: "SELECT * FROM estoque_produtos WHERE empresa_id = ? AND ativo = 1 AND id = ? LIMIT 1",
        args: [empresaId, id]
      });
      if (byId.rows[0]) return byId.rows[0] as any;
    }

    if (!candidates.name.trim()) return null;

    const byName = await db.execute({
      sql: "SELECT * FROM estoque_produtos WHERE empresa_id = ? AND ativo = 1 AND lower(trim(nome)) = lower(trim(?)) LIMIT 1",
      args: [empresaId, candidates.name]
    });

    return byName.rows[0] as any || null;
  },

  async decrementStock(params: {
    empresaId: string;
    userId: string;
    stock: any;
    requestedQuantity: number;
    reason: string;
  }) {
    const currentQuantity = toStockAmount(params.stock.quantidade_atual);
    const requestedQuantity = toStockAmount(params.requestedQuantity);
    const appliedQuantity = Math.min(currentQuantity, requestedQuantity);
    const newQuantity = Math.max(0, currentQuantity - requestedQuantity);

    await db.execute({
      sql: `
        UPDATE estoque_produtos
        SET quantidade_atual = MAX(0, quantidade_atual - ?),
            status = CASE WHEN MAX(0, quantidade_atual - ?) <= estoque_minimo THEN 'Crítico' ELSE 'Saudável' END,
            updated_at = ?
        WHERE id = ?
      `,
      args: [requestedQuantity, requestedQuantity, Date.now(), params.stock.id]
    });

    if (appliedQuantity > 0) {
      await db.execute({
        sql: `
          INSERT INTO estoque_movimentacoes
            (id, empresa_id, produto_id, tipo_movimentacao, quantidade, quantidade_anterior, quantidade_nova, motivo, responsavel_id, created_at)
          VALUES (?, ?, ?, 'saida', ?, ?, ?, ?, ?, ?)
        `,
        args: [
          createId(),
          params.empresaId,
          params.stock.id,
          appliedQuantity,
          currentQuantity,
          newQuantity,
          params.reason,
          params.userId,
          Date.now()
        ]
      });
    }

    return {
      appliedQuantity,
      newQuantity,
      insufficient: requestedQuantity > currentQuantity
    };
  },

  async syncInventoryForClosedBill(data: {
    tableNumber: number;
    closedBillId: string;
    orderItems: ActiveOrderItemRow[];
  }): Promise<InventorySyncResult> {
    const { empresaId, userId, slug } = await this.resolveOSContext();
    const result: InventorySyncResult = { movementCount: 0, unmatched: [], insufficient: [] };
    const reason = `Venda PDV Mesa ${data.tableNumber} | Fechamento ${data.closedBillId}`;

    for (const item of data.orderItems) {
      const productStock = await this.findStockProduct(empresaId, {
        id: item.remoteStockId || item.productId,
        name: item.name
      });

      if (!productStock) {
        result.unmatched.push(`${item.quantity}x ${item.name}`);
      } else {
        const movement = await this.decrementStock({
          empresaId,
          userId,
          stock: productStock,
          requestedQuantity: item.quantity,
          reason
        });
        if (movement.appliedQuantity > 0) result.movementCount++;
        if (movement.insufficient) result.insufficient.push(`${item.name} (estoque insuficiente)`);
      }

      for (const modifier of item.selectedModifiers || []) {
        const modifierStock = await this.findStockProduct(empresaId, {
          id: modifier.id,
          name: modifier.name
        });

        if (!modifierStock) continue;

        const movement = await this.decrementStock({
          empresaId,
          userId,
          stock: modifierStock,
          requestedQuantity: item.quantity,
          reason: `${reason} | Opcional ${modifier.name}`
        });
        if (movement.appliedQuantity > 0) result.movementCount++;
        if (movement.insufficient) result.insufficient.push(`${modifier.name} (estoque insuficiente)`);
      }
    }

    if (result.unmatched.length > 0) {
      await this.createOSNotification({
        empresaId,
        title: 'Itens do PDV sem vínculo de estoque',
        message: `Mesa ${data.tableNumber}: ${result.unmatched.slice(0, 8).join(', ')}`,
        type: 'alert',
        link: `/${slug}/estoque`
      });
    }

    if (result.insufficient.length > 0) {
      await this.createOSNotification({
        empresaId,
        title: 'Estoque insuficiente em venda PDV',
        message: `Mesa ${data.tableNumber}: ${result.insufficient.slice(0, 8).join(', ')}`,
        type: 'warning',
        link: `/${slug}/estoque`
      });
    }

    await this.createOSNotification({
      empresaId,
      title: 'Conta fechada no PDV',
      message: `Mesa ${data.tableNumber}: ${result.movementCount} movimentações de estoque registradas.`,
      type: result.unmatched.length > 0 ? 'warning' : 'info',
      link: `/${slug}/dinheiro`
    });

    return result;
  },

  async getSettings() {
    const res = await db.execute("SELECT value FROM app_settings WHERE key = 'settings' LIMIT 1");
    const raw = res.rows[0]?.value;
    if (!raw || typeof raw !== 'string') return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  async saveSettings(settings: unknown) {
    await db.execute({
      sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('settings', ?, CURRENT_TIMESTAMP)",
      args: [JSON.stringify(settings)]
    });
  },

  async getServiceRequests() {
    const res = await db.execute(`
      SELECT sr.*, t.number as tableNumber
      FROM service_requests sr
      LEFT JOIN tables t ON sr.table_id = t.id
      WHERE sr.status IN ('pending', 'viewed')
      ORDER BY sr.created_at ASC
    `);

    return res.rows.map((row: any) => ({
      id: row.id as string,
      tableId: row.table_id as string,
      tableNumber: Number(row.tableNumber || 0),
      type: row.type as string,
      message: row.message as string || '',
      status: row.status as any,
      createdAt: row.created_at ? new Date(row.created_at as string) : new Date()
    }));
  },

  async getClosedBills(limit = 200) {
    const res = await db.execute({
      sql: "SELECT * FROM closed_bills ORDER BY closed_at DESC LIMIT ?",
      args: [limit]
    });

    return res.rows.map((row: any) => ({
      id: row.id as string,
      tableId: row.table_id as string || '',
      tableNumber: Number(row.table_number || 0),
      sellerId: row.seller_id as string || '',
      sellerName: row.seller_name as string || 'Sistema',
      subtotal: Number(row.subtotal || 0),
      serviceFee: Number(row.service_fee || 0),
      discount: Number(row.discount || 0),
      discountReason: row.discount_reason as string || '',
      total: Number(row.total || 0),
      payments: parseJsonArray(row.payments),
      closedAt: row.closed_at ? new Date(row.closed_at as string) : new Date()
    }));
  },

  // --- LOGS ---
  async addAuditLog(id: string, action: string, details: string, tableNumber: string, origin: string, authorId: string, authorName: string) {
    await db.execute({
      sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, action, details, tableNumber, origin, authorId, authorName]
    });
  }
};
