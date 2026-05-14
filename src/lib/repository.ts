import { db } from './db';
import type { SellerInput } from './schemas';

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
      sql: "INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, erp_code, remote_stock_id, schedule_config, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        p.id, p.name, p.description || '', p.price, 
        p.categoryId, p.image, p.visible ? 1 : 0, 
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
          args: [m.id || Math.random().toString(36).substr(2, 9), group.id, m.name, m.price, m.status || 'active', i]
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

  async updateSellerStatus(id: string, status: string) {
    await db.execute({
      sql: "UPDATE sellers SET status = ? WHERE id = ?",
      args: [status, id]
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
      db.execute("SELECT o.id, o.status, o.table_id, o.origin, strftime('%Y-%m-%dT%H:%M:%SZ', o.created_at) as created_at, t.number as tableNumber FROM orders o JOIN tables t ON o.table_id = t.id WHERE o.status != 'ready' ORDER BY o.created_at ASC"),
      db.execute("SELECT oi.*, m.name FROM order_items oi JOIN menu m ON oi.product_id = m.id"),
      db.execute("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now') as serverNow")
    ]);
    
    const serverNow = new Date(nowRes.rows[0].serverNow as string);
    const itemsByOrder: Record<string, any[]> = {};
    
    itemsRes.rows.forEach((iRow: any) => {
      if (!itemsByOrder[iRow.order_id]) itemsByOrder[iRow.order_id] = [];
      itemsByOrder[iRow.order_id].push({
        id: iRow.product_id as string,
        name: iRow.name as string,
        price: iRow.price_at_time as number,
        quantity: iRow.quantity as number,
        selectedModifiers: JSON.parse(iRow.selected_modifiers as string || '[]'),
        notes: iRow.notes || ''
      });
    });

    const kOrders = kOrdersRes.rows.map((oRow: any) => ({
      id: oRow.id as string,
      tableId: oRow.table_id as string,
      tableNumber: oRow.tableNumber as string,
      status: oRow.status,
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

  // --- LOGS ---
  async addAuditLog(id: string, action: string, details: string, tableNumber: string, origin: string, authorId: string, authorName: string) {
    await db.execute({
      sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, action, details, tableNumber, origin, authorId, authorName]
    });
  }
};
