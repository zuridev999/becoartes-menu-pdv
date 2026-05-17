import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const port = Number(process.env.PORT || 80);

const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN;
const OS_EMPRESA_ID = process.env.OS_EMPRESA_ID || process.env.VITE_OS_EMPRESA_ID || 'e19cbcce-b2a7-4cc1-bf70-c06d2f8feb8a';
const OS_TENANT_SLUG = process.env.OS_TENANT_SLUG || process.env.VITE_OS_TENANT_SLUG || 'becoartes';
const OS_SYSTEM_USER_ID = process.env.OS_SYSTEM_USER_ID || process.env.VITE_OS_SYSTEM_USER_ID || '';

if (!tursoUrl || !tursoAuthToken) {
  throw new Error('Missing Turso configuration for BFF runtime.');
}

const db = createClient({
  url: tursoUrl,
  authToken: tursoAuthToken,
});

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cache-control': 'no-store',
};

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://*.turso.io wss://*.turso.io https://images.unsplash.com; object-src 'none'; base-uri 'self'; frame-ancestors https://os.becoartes.com",
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const createId = () => randomUUID();
const osTimestamp = () => Math.floor(Date.now() / 1000);
const toStockAmount = (value) => Math.max(0, Math.trunc(Number(value || 0)));

const parseJsonArray = (value) => {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
};

const sendJson = (res, status, body) => {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body));
};

const assertSameOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host;
  if (!host) throw new Error('Host ausente.');
  const expectedHttp = `http://${host}`;
  const expectedHttps = `https://${host}`;
  if (origin !== expectedHttp && origin !== expectedHttps) {
    throw new Error('Origem não autorizada.');
  }
};

const requireString = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Campo obrigatório inválido: ${field}`);
  }
  return value;
};

const requireNumber = (value, field) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Campo numérico inválido: ${field}`);
  return parsed;
};

const resolveOSContext = async () => {
  let empresaId = OS_EMPRESA_ID;
  if (!empresaId) {
    const empresaRes = await db.execute("SELECT id FROM empresas WHERE slug = 'becoartes' LIMIT 1");
    empresaId = empresaRes.rows[0]?.id || '';
  }

  if (!empresaId) throw new Error('Empresa do OS não encontrada.');

  let userId = OS_SYSTEM_USER_ID;
  if (!userId) {
    const userRes = await db.execute({
      sql: "SELECT id FROM users WHERE empresa_id = ? AND role IN ('admin', 'super_admin') ORDER BY created_at ASC LIMIT 1",
      args: [empresaId],
    });
    userId = userRes.rows[0]?.id || '';
  }

  if (!userId) throw new Error('Usuário responsável do OS não encontrado.');
  return { empresaId, userId, slug: OS_TENANT_SLUG };
};

const createOSNotification = async ({ empresaId, title, message, type = 'info', link = null }) => {
  await db.execute({
    sql: "INSERT INTO notificacoes (id, empresa_id, usuario_id, titulo, mensagem, tipo, lida, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [createId(), empresaId, null, title, message, type, 0, link, osTimestamp()],
  });
};

const getActiveOrderItemsForTable = async (tableId) => {
  const res = await db.execute({
    sql: `
      SELECT
        oi.id,
        oi.order_id as orderId,
        oi.product_id as productId,
        COALESCE(m.name, '') as name,
        COALESCE(m.remote_stock_id, '') as remoteStockId,
        oi.quantity,
        oi.selected_modifiers as selectedModifiers
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN menu m ON oi.product_id = m.id
      WHERE o.table_id = ? AND o.status != 'closed'
    `,
    args: [tableId],
  });

  return res.rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    productId: row.productId,
    name: row.name || '',
    remoteStockId: row.remoteStockId || '',
    quantity: Number(row.quantity || 0),
    selectedModifiers: parseJsonArray(row.selectedModifiers),
  }));
};

const claimIntegrationEvent = async (id, type, tableId, payload) => {
  const now = Date.now();
  const existing = await db.execute({ sql: "SELECT status FROM integration_events WHERE id = ? LIMIT 1", args: [id] });
  const status = existing.rows[0]?.status;

  if (status === 'completed' || status === 'processing') return false;

  await db.execute({
    sql: `
      INSERT OR REPLACE INTO integration_events
        (id, type, status, table_id, payload, error, created_at, updated_at)
      VALUES (?, ?, 'processing', ?, ?, NULL, COALESCE((SELECT created_at FROM integration_events WHERE id = ?), ?), ?)
    `,
    args: [id, type, tableId, JSON.stringify(payload), id, now, now],
  });

  return true;
};

const failIntegrationEvent = async (id, error) => {
  await db.execute({
    sql: "UPDATE integration_events SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
    args: [error instanceof Error ? error.message : String(error), Date.now(), id],
  });
};

const findStockProduct = async (empresaId, candidates) => {
  const ids = [candidates.id].filter(Boolean);
  for (const id of ids) {
    const byId = await db.execute({
      sql: "SELECT * FROM estoque_produtos WHERE empresa_id = ? AND ativo = 1 AND id = ? LIMIT 1",
      args: [empresaId, id],
    });
    if (byId.rows[0]) return byId.rows[0];
  }

  if (!candidates.name?.trim()) return null;

  const byName = await db.execute({
    sql: "SELECT * FROM estoque_produtos WHERE empresa_id = ? AND ativo = 1 AND lower(trim(nome)) = lower(trim(?)) LIMIT 1",
    args: [empresaId, candidates.name],
  });

  return byName.rows[0] || null;
};

const notifyOrderItemCancelled = async ({ tableNumber, itemName, quantity, sellerName, sellerPermission }) => {
  const { empresaId, slug } = await resolveOSContext();
  await createOSNotification({
    empresaId,
    title: 'Item cancelado no PDV',
    message: `Mesa ${tableNumber}: ${quantity}x ${itemName} cancelado por ${sellerName} (${sellerPermission}).`,
    type: 'warning',
    link: `/${slug}/dinheiro`,
  });
};

const notifyCloseBillSyncFailure = async ({ tableNumber, integrationId, error }) => {
  try {
    const { empresaId, slug } = await resolveOSContext();
    await createOSNotification({
      empresaId,
      title: 'Erro ao fechar conta no PDV',
      message: `Mesa ${tableNumber}: falha no fechamento ${integrationId}. ${error instanceof Error ? error.message : String(error)}`,
      type: 'error',
      link: `/${slug}/dinheiro`,
    });
  } catch (notificationError) {
    console.error('Erro ao notificar falha de fechamento no OS:', notificationError);
  }
};

const deleteOrderItem = async ({ itemId, cancelContext }) => {
  const itemRes = await db.execute({ sql: "SELECT order_id FROM order_items WHERE id = ? LIMIT 1", args: [itemId] });
  const orderId = itemRes.rows[0]?.order_id;

  await db.execute({ sql: "DELETE FROM order_items WHERE id = ?", args: [itemId] });

  if (orderId) {
    const remainingRes = await db.execute({
      sql: "SELECT quantity, price_at_time, selected_modifiers FROM order_items WHERE order_id = ?",
      args: [orderId],
    });

    const remainingItems = remainingRes.rows.map((row) => ({
      price: Number(row.price_at_time || 0),
      quantity: Number(row.quantity || 0),
      selectedModifiers: parseJsonArray(row.selected_modifiers),
    }));

    if (remainingItems.length === 0) {
      await db.execute({ sql: "UPDATE orders SET total = 0, status = 'closed' WHERE id = ?", args: [orderId] });
    } else {
      const total = remainingItems.reduce((acc, item) => {
        const modifiersTotal = item.selectedModifiers.reduce((sum, modifier) => sum + Number(modifier.price || 0), 0);
        return acc + (Number(item.price || 0) + modifiersTotal) * Number(item.quantity || 0);
      }, 0);

      await db.execute({
        sql: "UPDATE orders SET total = ? WHERE id = ?",
        args: [total, orderId],
      });
    }
  }

  if (cancelContext) {
    await notifyOrderItemCancelled({
      tableNumber: Number(cancelContext.tableNumber || 0),
      itemName: String(cancelContext.itemName || 'Item'),
      quantity: Number(cancelContext.quantity || 0),
      sellerName: String(cancelContext.sellerName || 'Sistema'),
      sellerPermission: String(cancelContext.sellerPermission || 'standard'),
    });
  }

  return { orderId: orderId || null };
};

const sendToKitchen = async ({ orderId, tableId, total, origin, sellerId, items }) => {
  requireString(orderId, 'orderId');
  requireString(tableId, 'tableId');
  const safeOrigin = origin === 'tablet' || origin === 'qr' ? origin : 'pdv';
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) throw new Error('Pedido sem itens.');

  const batch = [
    {
      sql: "INSERT INTO orders (id, table_id, total, status, origin, created_by_id) VALUES (?, ?, ?, ?, ?, ?)",
      args: [orderId, tableId, requireNumber(total, 'total'), 'pending', safeOrigin, sellerId || null],
    },
    ...safeItems.map((item) => ({
      sql: "INSERT INTO order_items (id, order_id, product_id, quantity, price_at_time, selected_modifiers, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        requireString(item.id, 'item.id'),
        orderId,
        requireString(item.productId, 'item.productId'),
        requireNumber(item.quantity, 'item.quantity'),
        requireNumber(item.price, 'item.price'),
        JSON.stringify(item.selectedModifiers || []),
        item.notes || '',
      ],
    })),
    {
      sql: "UPDATE tables SET status = ? WHERE id = ?",
      args: ['ordering', tableId],
    },
  ];

  const requestId = `new_order_${orderId}`;
  const itemsList = safeItems.map((item) => `${item.quantity}x ${item.name}`).join(', ');
  batch.push({
    sql: "INSERT OR IGNORE INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, ?, ?, ?)",
    args: [requestId, tableId, 'new_order', 'pending', itemsList],
  });

  await db.batch(batch, 'write');

  return {
    request: {
      id: requestId,
      tableId,
      type: 'new_order',
      message: itemsList,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  };
};

const updateOrderStatus = async ({ orderId, status }) => {
  requireString(orderId, 'orderId');
  const safeStatus = ['pending', 'preparing', 'ready', 'closed'].includes(status) ? status : null;
  if (!safeStatus) throw new Error('Status inválido.');

  await db.execute({
    sql: "UPDATE orders SET status = ? WHERE id = ?",
    args: [safeStatus, orderId],
  });

  if (safeStatus !== 'ready') return { request: null };

  const orderRes = await db.execute({
    sql: `
      SELECT o.table_id, t.number as tableNumber
      FROM orders o
      LEFT JOIN tables t ON t.id = o.table_id
      WHERE o.id = ?
      LIMIT 1
    `,
    args: [orderId],
  });
  const order = orderRes.rows[0];
  if (!order) return { request: null };

  const itemsRes = await db.execute({
    sql: `
      SELECT oi.quantity, COALESCE(m.name, 'Item') as name
      FROM order_items oi
      LEFT JOIN menu m ON oi.product_id = m.id
      WHERE oi.order_id = ?
    `,
    args: [orderId],
  });
  const itemsList = itemsRes.rows.map((item) => `${item.quantity}x ${item.name}`).join(', ');
  const id = createId();

  await db.execute({
    sql: "INSERT INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, ?, ?, ?)",
    args: [id, order.table_id, 'order_ready', 'pending', itemsList],
  });

  return {
    request: {
      id,
      tableId: order.table_id,
      tableNumber: Number(order.tableNumber || 0),
      type: 'order_ready',
      message: itemsList,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  };
};

const bumpCatalogVersion = async () => {
  const version = String(Date.now());
  await db.execute({
    sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('catalog_version', ?, CURRENT_TIMESTAMP)",
    args: [version],
  });
  return version;
};

const upsertCategory = async ({ category }) => {
  const cat = category || {};
  await db.execute({
    sql: "INSERT OR REPLACE INTO categories (id, name, schedule_config, sort_order, visible) VALUES (?, ?, ?, ?, ?)",
    args: [
      requireString(cat.id, 'category.id'),
      requireString(cat.name, 'category.name'),
      cat.schedule ? JSON.stringify(cat.schedule) : null,
      Number(cat.sortOrder || 0),
      cat.visible ? 1 : 0,
    ],
  });
  return { catalogVersion: await bumpCatalogVersion() };
};

const deleteCategory = async ({ id }) => {
  requireString(id, 'id');
  await db.batch([
    { sql: "DELETE FROM categories WHERE id = ?", args: [id] },
    { sql: "UPDATE menu SET category_id = NULL WHERE category_id = ?", args: [id] },
  ], 'write');
  return { catalogVersion: await bumpCatalogVersion() };
};

const toggleCategoryVisibility = async ({ id, visible }) => {
  requireString(id, 'id');
  await db.execute({
    sql: "UPDATE categories SET visible = ? WHERE id = ?",
    args: [visible ? 1 : 0, id],
  });
  return { catalogVersion: await bumpCatalogVersion() };
};

const upsertProduct = async ({ product }) => {
  const p = product || {};
  const productId = requireString(p.id, 'product.id');
  await db.execute({
    sql: "INSERT OR REPLACE INTO menu (id, name, description, price, category, category_id, image, visible, erp_code, remote_stock_id, schedule_config, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      productId,
      requireString(p.name, 'product.name'),
      p.description || '',
      requireNumber(p.price, 'product.price'),
      p.categoryId || '',
      p.categoryId || '',
      p.image || '',
      p.visible ? 1 : 0,
      p.erpCode || null,
      p.remoteStockId || null,
      p.schedule ? JSON.stringify(p.schedule) : null,
      Number(p.cost || 0),
    ],
  });

  if (Array.isArray(p.modifierGroups)) {
    const batch = [
      { sql: "DELETE FROM product_modifier_groups WHERE product_id = ?", args: [productId] },
      ...p.modifierGroups.map((group, index) => ({
        sql: "INSERT INTO product_modifier_groups (product_id, group_id, sort_order) VALUES (?, ?, ?)",
        args: [productId, requireString(group.id, 'modifierGroup.id'), index],
      })),
    ];
    await db.batch(batch, 'write');
  }

  return { catalogVersion: await bumpCatalogVersion() };
};

const deleteProduct = async ({ id }) => {
  requireString(id, 'id');
  await db.execute({ sql: "DELETE FROM menu WHERE id = ?", args: [id] });
  return { catalogVersion: await bumpCatalogVersion() };
};

const toggleProductVisibility = async ({ id, visible }) => {
  requireString(id, 'id');
  await db.execute({
    sql: "UPDATE menu SET visible = ? WHERE id = ?",
    args: [visible ? 1 : 0, id],
  });
  return { catalogVersion: await bumpCatalogVersion() };
};

const saveModifierGroup = async ({ group }) => {
  const safeGroup = group || {};
  const groupId = requireString(safeGroup.id, 'group.id');
  await db.execute({
    sql: "INSERT OR REPLACE INTO modifier_groups (id, name, min_choices, max_choices, is_required, status) VALUES (?, ?, ?, ?, ?, ?)",
    args: [
      groupId,
      requireString(safeGroup.name, 'group.name'),
      Number(safeGroup.minChoices || 0),
      Number(safeGroup.maxChoices || 1),
      safeGroup.isRequired ? 1 : 0,
      safeGroup.status || 'active',
    ],
  });

  if (Array.isArray(safeGroup.modifiers)) {
    const batch = [
      { sql: "DELETE FROM modifiers WHERE group_id = ?", args: [groupId] },
      ...safeGroup.modifiers.map((modifier, index) => ({
        sql: "INSERT INTO modifiers (id, group_id, name, price, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        args: [
          modifier.id || createId(),
          groupId,
          requireString(modifier.name, 'modifier.name'),
          Number(modifier.price || 0),
          modifier.status || 'active',
          index,
        ],
      })),
    ];
    await db.batch(batch, 'write');
  }

  return { catalogVersion: await bumpCatalogVersion() };
};

const deleteModifierGroup = async ({ id }) => {
  requireString(id, 'id');
  await db.execute({ sql: "UPDATE modifier_groups SET status = 'inactive' WHERE id = ?", args: [id] });
  return { catalogVersion: await bumpCatalogVersion() };
};

const linkModifierGroup = async ({ scope, targetId, groupId, linked }) => {
  requireString(targetId, 'targetId');
  requireString(groupId, 'groupId');
  const tableName = scope === 'category' ? 'category_modifier_groups' : 'product_modifier_groups';
  const idColumn = scope === 'category' ? 'category_id' : 'product_id';

  if (linked) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO ${tableName} (${idColumn}, group_id) VALUES (?, ?)`,
      args: [targetId, groupId],
    });
  } else {
    await db.execute({
      sql: `DELETE FROM ${tableName} WHERE ${idColumn} = ? AND group_id = ?`,
      args: [targetId, groupId],
    });
  }

  return { catalogVersion: await bumpCatalogVersion() };
};

const saveSettings = async ({ settings }) => {
  await db.execute({
    sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('settings', ?, CURRENT_TIMESTAMP)",
    args: [JSON.stringify(settings || {})],
  });
  return { saved: true };
};

const addAuditLog = async ({ id, action, details = '', tableNumber = null, origin = 'pdv', authorName = 'Sistema', timestamp }) => {
  const logId = id || createId();
  const createdAt = timestamp || new Date().toISOString();
  await db.execute({
    sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [logId, requireString(action, 'action'), details, tableNumber, origin, authorName, createdAt],
  });
  return {
    log: {
      id: logId,
      action,
      details,
      table_number: tableNumber,
      origin,
      author_name: authorName,
      timestamp: createdAt,
    },
  };
};

const createServiceRequest = async ({ id, tableId, type, message = '' }) => {
  const requestId = id || createId();
  const tableRes = await db.execute({ sql: "SELECT number FROM tables WHERE id = ? LIMIT 1", args: [tableId] });
  const tableNumber = Number(tableRes.rows[0]?.number || 0);
  await db.execute({
    sql: "INSERT INTO service_requests (id, table_id, type, status, message) VALUES (?, ?, ?, ?, ?)",
    args: [requestId, requireString(tableId, 'tableId'), requireString(type, 'type'), 'pending', message],
  });
  return {
    request: {
      id: requestId,
      tableId,
      tableNumber,
      type,
      message,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  };
};

const resolveServiceRequest = async ({ requestId, tableId, type, message, currentStatus }) => {
  const newStatus = currentStatus === 'resolved' ? 'pending' : 'resolved';
  if (type === 'new_order') {
    await db.execute({
      sql: "UPDATE service_requests SET status = ? WHERE (id = ? OR (table_id = ? AND type = 'new_order' AND message = ? AND status = 'pending'))",
      args: [newStatus, requestId, tableId, message],
    });
  } else {
    await db.execute({
      sql: "UPDATE service_requests SET status = ? WHERE id = ?",
      args: [newStatus, requestId],
    });
  }
  return { status: newStatus };
};

const requestBill = async ({ tableId }) => {
  await db.execute({ sql: "UPDATE tables SET status = ? WHERE id = ?", args: ['bill_requested', tableId] });
  return { status: 'bill_requested' };
};

const updateTableStatus = async ({ tableId, status }) => {
  requireString(tableId, 'tableId');
  const allowed = new Set(['available', 'ordering', 'waiting', 'paid', 'bill_requested']);
  if (!allowed.has(status)) throw new Error('Status de mesa inválido.');
  await db.execute({ sql: "UPDATE tables SET status = ? WHERE id = ?", args: [status, tableId] });
  return { status };
};

const openTable = async ({ tableId, wasAvailable }) => {
  requireString(tableId, 'tableId');
  const batch = [];
  if (wasAvailable) {
    batch.push(
      { sql: "UPDATE orders SET status = 'closed' WHERE table_id = ? AND status != 'closed'", args: [tableId] },
      { sql: "UPDATE service_requests SET status = 'resolved' WHERE table_id = ? AND status != 'resolved'", args: [tableId] },
    );
  }
  batch.push({ sql: "UPDATE tables SET status = 'ordering', last_activity = CURRENT_TIMESTAMP WHERE id = ?", args: [tableId] });
  await db.batch(batch, 'write');
  return { status: 'ordering' };
};

const transferTable = async ({ fromTableId, toTableId }) => {
  requireString(fromTableId, 'fromTableId');
  requireString(toTableId, 'toTableId');
  await db.batch([
    { sql: "UPDATE orders SET table_id = ? WHERE table_id = ? AND status != 'closed'", args: [toTableId, fromTableId] },
    { sql: "UPDATE service_requests SET table_id = ? WHERE table_id = ? AND status != 'resolved'", args: [toTableId, fromTableId] },
    { sql: "UPDATE tables SET status = 'available' WHERE id = ?", args: [fromTableId] },
    { sql: "UPDATE tables SET status = 'ordering' WHERE id = ?", args: [toTableId] },
  ], 'write');
  return { moved: true };
};

const joinTables = async ({ tableIds, targetTableId }) => {
  if (!Array.isArray(tableIds) || tableIds.length === 0) throw new Error('tableIds inválido.');
  requireString(targetTableId, 'targetTableId');
  const sourceIds = tableIds.filter((id) => id !== targetTableId);
  const batch = [
    ...sourceIds.map((id) => ({ sql: "UPDATE orders SET table_id = ? WHERE table_id = ? AND status != 'closed'", args: [targetTableId, id] })),
    ...sourceIds.map((id) => ({ sql: "UPDATE service_requests SET table_id = ? WHERE table_id = ? AND status != 'resolved'", args: [targetTableId, id] })),
    ...sourceIds.map((id) => ({ sql: "UPDATE tables SET status = 'available' WHERE id = ?", args: [id] })),
    { sql: "UPDATE tables SET status = 'ordering' WHERE id = ?", args: [targetTableId] },
  ];
  await db.batch(batch, 'write');
  return { joined: true };
};

const openShift = async ({ id, openingBalance }) => {
  const shiftId = id || createId();
  await db.execute({
    sql: "INSERT INTO shifts (id, status, opening_balance) VALUES (?, ?, ?)",
    args: [shiftId, 'open', requireNumber(openingBalance, 'openingBalance')],
  });
  return { shift: { id: shiftId, status: 'open', openingBalance: Number(openingBalance) } };
};

const closeShift = async ({ id, closingBalance }) => {
  requireString(id, 'id');
  await db.execute({
    sql: "UPDATE shifts SET status = 'closed', closing_balance = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [requireNumber(closingBalance, 'closingBalance'), id],
  });
  return { closed: true };
};

const addSeller = async ({ seller }) => {
  const safeSeller = seller || {};
  await db.execute({
    sql: "INSERT INTO sellers (id, name, nickname, status, role, permission, pin) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      requireString(safeSeller.id, 'seller.id'),
      requireString(safeSeller.name, 'seller.name'),
      safeSeller.nickname || '',
      safeSeller.status || 'active',
      safeSeller.role || 'atendente',
      safeSeller.permission || 'operator',
      requireString(safeSeller.pin, 'seller.pin'),
    ],
  });
  return { saved: true };
};

const updateSellerPin = async ({ id, pin }) => {
  requireString(id, 'id');
  requireString(pin, 'pin');
  await db.execute({
    sql: "UPDATE sellers SET pin = ? WHERE id = ?",
    args: [pin, id],
  });
  return { updated: true };
};

const deleteSeller = async ({ id }) => {
  requireString(id, 'id');
  const hasBills = await db.execute({ sql: "SELECT id FROM closed_bills WHERE seller_id = ? LIMIT 1", args: [id] });
  if (hasBills.rows.length > 0) {
    return { deleted: false, reason: 'seller_has_bills' };
  }
  await db.execute({ sql: "DELETE FROM sellers WHERE id = ?", args: [id] });
  return { deleted: true };
};

const updateSellerStatus = async ({ id, status }) => {
  requireString(id, 'id');
  const safeStatus = status === 'inactive' ? 'inactive' : 'active';
  await db.execute({
    sql: "UPDATE sellers SET status = ? WHERE id = ?",
    args: [safeStatus, id],
  });
  return { status: safeStatus };
};

const syncBeveragesFromInventory = async () => {
  const stockRes = await db.execute("SELECT * FROM estoque_produtos WHERE categoria = 'Bebidas' AND ativo = 1");
  let categoryRes = await db.execute("SELECT id FROM categories WHERE name = 'Bebidas' LIMIT 1");
  let categoryId = categoryRes.rows[0]?.id;

  if (!categoryId) {
    categoryId = createId();
    await db.execute({
      sql: "INSERT INTO categories (id, name, sort_order, visible) VALUES (?, 'Bebidas', 0, 1)",
      args: [categoryId],
    });
  }

  const batch = [];
  for (const row of stockRes.rows) {
    const remoteId = row.id;
    const existing = await db.execute({
      sql: "SELECT id FROM menu WHERE remote_stock_id = ? LIMIT 1",
      args: [remoteId],
    });
    if (existing.rows[0]) {
      batch.push({
        sql: "UPDATE menu SET name = ?, price = ? WHERE remote_stock_id = ?",
        args: [row.nome, Number(row.preco_venda || 0), remoteId],
      });
    } else {
      batch.push({
        sql: "INSERT INTO menu (id, name, description, price, category_id, image, visible, erp_code, remote_stock_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          createId(),
          row.nome,
          'Sincronizado do Estoque OS',
          Number(row.preco_venda || 0),
          categoryId,
          'https://images.unsplash.com/photo-1544145945-f904253db0ad?w=400',
          1,
          null,
          remoteId,
        ],
      });
    }
  }

  if (batch.length > 0) await db.batch(batch, 'write');
  return { catalogVersion: await bumpCatalogVersion(), count: stockRes.rows.length };
};

const closeBillWithInventorySync = async (data) => {
  const tableId = requireString(data.tableId, 'tableId');
  const activeOrderItems = await getActiveOrderItemsForTable(tableId);
  const orderIds = Array.from(new Set(activeOrderItems.map((item) => item.orderId))).sort();
  const integrationId = `pdv_close_${tableId}_${orderIds.join('_') || 'no_orders'}`;

  const claimed = await claimIntegrationEvent(integrationId, 'pdv_close_bill', tableId, {
    tableNumber: data.tableNumber,
    orderIds,
    total: data.total,
  });

  if (!claimed) {
    return {
      skipped: true,
      integrationId,
      closedBill: null,
      inventorySync: null,
    };
  }

  try {
    const closedAt = new Date();
    const closedBill = {
      ...data,
      id: integrationId,
      closedAt: closedAt.toISOString(),
    };
    const { empresaId, userId, slug } = await resolveOSContext();
    const movementPlans = [];
    const result = { movementCount: 0, unmatched: [], insufficient: [], critical: [] };
    const baseReason = `Venda PDV Mesa ${data.tableNumber} | Fechamento ${integrationId}`;

    for (const item of activeOrderItems) {
      const requestedQuantity = toStockAmount(item.quantity);
      const productStock = await findStockProduct(empresaId, {
        id: item.remoteStockId || item.productId,
        name: item.name,
      });

      if (!productStock) {
        result.unmatched.push(`${item.quantity}x ${item.name}`);
      } else {
        const currentQuantity = toStockAmount(productStock.quantidade_atual);
        const nextQuantity = Math.max(0, currentQuantity - requestedQuantity);
        if (requestedQuantity > currentQuantity) result.insufficient.push(`${item.name} (estoque insuficiente)`);
        if (nextQuantity <= toStockAmount(productStock.estoque_minimo)) result.critical.push(item.name);
        if (currentQuantity > 0 && requestedQuantity > 0) {
          movementPlans.push({
            movementId: createId(),
            stockId: productStock.id,
            stockName: productStock.nome || item.name,
            orderId: item.orderId,
            orderItemId: item.id,
            sourceItemId: item.productId,
            sourceItemKind: 'product',
            requestedQuantity,
            previousQuantity: currentQuantity,
            nextQuantity,
            reason: baseReason,
          });
        }
      }

      for (const modifier of item.selectedModifiers || []) {
        const modifierStock = await findStockProduct(empresaId, {
          id: modifier.id,
          name: modifier.name,
        });

        if (!modifierStock) continue;

        const currentQuantity = toStockAmount(modifierStock.quantidade_atual);
        const nextQuantity = Math.max(0, currentQuantity - requestedQuantity);
        if (requestedQuantity > currentQuantity) result.insufficient.push(`${modifier.name} (estoque insuficiente)`);
        if (nextQuantity <= toStockAmount(modifierStock.estoque_minimo)) result.critical.push(modifier.name);
        if (currentQuantity > 0 && requestedQuantity > 0) {
          movementPlans.push({
            movementId: createId(),
            stockId: modifierStock.id,
            stockName: modifierStock.nome || modifier.name,
            orderId: item.orderId,
            orderItemId: item.id,
            sourceItemId: modifier.id,
            sourceItemKind: 'modifier',
            requestedQuantity,
            previousQuantity: currentQuantity,
            nextQuantity,
            reason: `${baseReason} | Opcional ${modifier.name}`,
          });
        }
      }
    }

    result.movementCount = movementPlans.length;

    const now = osTimestamp();
    const batch = [
      {
        sql: "INSERT OR REPLACE INTO closed_bills (id, table_id, table_number, seller_id, seller_name, subtotal, service_fee, discount, discount_reason, total, payments, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          integrationId,
          tableId,
          data.tableNumber,
          data.sellerId,
          data.sellerName,
          data.subtotal,
          data.serviceFee,
          data.discount,
          data.discountReason || null,
          data.total,
          JSON.stringify(data.payments),
          closedAt.toISOString(),
        ],
      },
    ];

    for (const movement of movementPlans) {
      batch.push(
        {
          sql: `
            INSERT OR IGNORE INTO estoque_movimentacoes
              (id, empresa_id, produto_id, tipo_movimentacao, quantidade, quantidade_anterior, quantidade_nova, motivo, responsavel_id, created_at, closed_bill_id, order_id, order_item_id, origem, integration_event_id, source_item_id, source_item_kind)
            SELECT ?, empresa_id, id, 'saida', MIN(quantidade_atual, ?), quantidade_atual, MAX(0, quantidade_atual - ?), ?, ?, ?, ?, ?, ?, 'pdv', ?, ?, ?
            FROM estoque_produtos
            WHERE id = ? AND empresa_id = ? AND ativo = 1 AND quantidade_atual > 0
          `,
          args: [
            movement.movementId,
            movement.requestedQuantity,
            movement.requestedQuantity,
            movement.reason,
            userId,
            now,
            integrationId,
            movement.orderId,
            movement.orderItemId,
            integrationId,
            movement.sourceItemId,
            movement.sourceItemKind,
            movement.stockId,
            empresaId,
          ],
        },
        {
          sql: `
            UPDATE estoque_produtos
            SET quantidade_atual = MAX(0, quantidade_atual - ?),
                status = CASE WHEN MAX(0, quantidade_atual - ?) <= estoque_minimo THEN 'Crítico' ELSE 'Saudável' END,
                updated_at = ?
            WHERE id = ? AND changes() > 0
          `,
          args: [movement.requestedQuantity, movement.requestedQuantity, now, movement.stockId],
        },
      );
    }

    batch.push(
      {
        sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name, timestamp) VALUES (?, 'bill_closed', ?, ?, 'pdv', ?, ?, ?)",
        args: [
          createId(),
          `Fechamento: R$ ${Number(data.total || 0).toFixed(2)} | Estoque: ${result.movementCount} movimentação(ões) | Evento: ${integrationId}`,
          String(data.tableNumber),
          data.sellerId,
          data.sellerName,
          closedAt.toISOString(),
        ],
      },
      {
        sql: "UPDATE tables SET status = 'available', last_activity = ? WHERE id = ?",
        args: [closedAt.toISOString(), tableId],
      },
      {
        sql: "UPDATE orders SET status = 'closed' WHERE table_id = ? AND status != 'closed'",
        args: [tableId],
      },
      {
        sql: "UPDATE service_requests SET status = 'resolved' WHERE table_id = ? AND status != 'resolved'",
        args: [tableId],
      },
    );

    if (result.unmatched.length > 0) {
      batch.push({
        sql: "INSERT INTO notificacoes (id, empresa_id, usuario_id, titulo, mensagem, tipo, lida, link, created_at) VALUES (?, ?, NULL, ?, ?, 'alert', 0, ?, ?)",
        args: [
          createId(),
          empresaId,
          'Itens do PDV sem vínculo de estoque',
          `Mesa ${data.tableNumber}: ${result.unmatched.slice(0, 8).join(', ')}`,
          `/${slug}/estoque`,
          now,
        ],
      });
    }

    if (result.insufficient.length > 0) {
      batch.push({
        sql: "INSERT INTO notificacoes (id, empresa_id, usuario_id, titulo, mensagem, tipo, lida, link, created_at) VALUES (?, ?, NULL, ?, ?, 'warning', 0, ?, ?)",
        args: [
          createId(),
          empresaId,
          'Estoque insuficiente em venda PDV',
          `Mesa ${data.tableNumber}: ${result.insufficient.slice(0, 8).join(', ')}`,
          `/${slug}/estoque`,
          now,
        ],
      });
    }

    if (result.critical.length > 0) {
      batch.push({
        sql: "INSERT INTO notificacoes (id, empresa_id, usuario_id, titulo, mensagem, tipo, lida, link, created_at) VALUES (?, ?, NULL, ?, ?, 'warning', 0, ?, ?)",
        args: [
          createId(),
          empresaId,
          'Estoque crítico após venda PDV',
          `Mesa ${data.tableNumber}: ${Array.from(new Set(result.critical)).slice(0, 8).join(', ')}`,
          `/${slug}/estoque`,
          now,
        ],
      });
    }

    batch.push(
      {
        sql: "INSERT INTO notificacoes (id, empresa_id, usuario_id, titulo, mensagem, tipo, lida, link, created_at) VALUES (?, ?, NULL, 'Conta fechada no PDV', ?, ?, 0, ?, ?)",
        args: [
          createId(),
          empresaId,
          `Mesa ${data.tableNumber}: ${result.movementCount} movimentações de estoque registradas.`,
          result.unmatched.length > 0 ? 'warning' : 'info',
          `/${slug}/dinheiro`,
          now,
        ],
      },
      {
        sql: "UPDATE integration_events SET status = 'completed', payload = ?, error = NULL, updated_at = ? WHERE id = ?",
        args: [
          JSON.stringify({
            tableNumber: data.tableNumber,
            orderIds,
            inventorySync: result,
            movementIds: movementPlans.map((movement) => movement.movementId),
          }),
          Date.now(),
          integrationId,
        ],
      },
    );

    await db.batch(batch, 'write');

    return {
      skipped: false,
      integrationId,
      closedBill,
      inventorySync: result,
    };
  } catch (error) {
    await failIntegrationEvent(integrationId, error);
    await notifyCloseBillSyncFailure({ tableNumber: data.tableNumber, integrationId, error });
    throw error;
  }
};

const handlers = {
  'POST /api/orders/send-to-kitchen': async (body) => sendToKitchen(body),
  'POST /api/orders/status': async (body) => updateOrderStatus(body),
  'POST /api/order-items/delete': async (body) => deleteOrderItem(body),
  'POST /api/bills/close': async (body) => closeBillWithInventorySync(body),
  'POST /api/catalog/category': async (body) => upsertCategory(body),
  'POST /api/catalog/category/delete': async (body) => deleteCategory(body),
  'POST /api/catalog/category/visibility': async (body) => toggleCategoryVisibility(body),
  'POST /api/catalog/product': async (body) => upsertProduct(body),
  'POST /api/catalog/product/delete': async (body) => deleteProduct(body),
  'POST /api/catalog/product/visibility': async (body) => toggleProductVisibility(body),
  'POST /api/catalog/modifier-group': async (body) => saveModifierGroup(body),
  'POST /api/catalog/modifier-group/delete': async (body) => deleteModifierGroup(body),
  'POST /api/catalog/modifier-group/link': async (body) => linkModifierGroup(body),
  'POST /api/settings': async (body) => saveSettings(body),
  'POST /api/audit-logs': async (body) => addAuditLog(body),
  'POST /api/service-requests': async (body) => createServiceRequest(body),
  'POST /api/service-requests/resolve': async (body) => resolveServiceRequest(body),
  'POST /api/tables/request-bill': async (body) => requestBill(body),
  'POST /api/tables/status': async (body) => updateTableStatus(body),
  'POST /api/tables/open': async (body) => openTable(body),
  'POST /api/tables/transfer': async (body) => transferTable(body),
  'POST /api/tables/join': async (body) => joinTables(body),
  'POST /api/shifts/open': async (body) => openShift(body),
  'POST /api/shifts/close': async (body) => closeShift(body),
  'POST /api/sellers': async (body) => addSeller(body),
  'POST /api/sellers/pin': async (body) => updateSellerPin(body),
  'POST /api/sellers/delete': async (body) => deleteSeller(body),
  'POST /api/sellers/status': async (body) => updateSellerStatus(body),
  'POST /api/inventory/sync-beverages': async () => syncBeveragesFromInventory(),
};

const handleApi = async (req, res, url) => {
  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, version: process.env.VITE_APP_VERSION || process.env.APP_VERSION || 'unknown' });
    return;
  }

  try {
    assertSameOrigin(req);
    const routeKey = `${req.method} ${url.pathname}`;
    const handler = handlers[routeKey];
    if (!handler) {
      sendJson(res, 404, { ok: false, error: 'API route not found' });
      return;
    }

    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      sendJson(res, 415, { ok: false, error: 'Content-Type precisa ser application/json' });
      return;
    }

    const body = await readJsonBody(req);
    const data = await handler(body);
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    console.error('BFF error:', error);
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Erro interno' });
  }
};

const serveStatic = async (req, res, url) => {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(distDir, normalized);

  if (!existsSync(filePath) || normalized.endsWith('/')) {
    filePath = join(distDir, 'index.html');
  }

  const ext = extname(filePath);
  const headers = {
    ...securityHeaders,
    'content-type': mimeTypes[ext] || 'application/octet-stream',
  };

  if (filePath.endsWith('index.html')) {
    headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
  } else {
    headers['cache-control'] = 'public, max-age=31536000, immutable';
  }

  try {
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  } catch {
    const fallback = await readFile(join(distDir, 'index.html'));
    res.writeHead(200, { ...securityHeaders, 'content-type': mimeTypes['.html'] });
    res.end(fallback);
  }
};

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  await serveStatic(req, res, url);
}).listen(port, () => {
  console.log(`Becoartes PDV BFF listening on :${port}`);
});
