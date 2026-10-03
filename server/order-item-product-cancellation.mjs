import { randomUUID } from 'node:crypto';

const fail = (message, statusCode = 409) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
};

const comparableName = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const createOrderItemProductCancellation = ({
  db, assertSuperAdminItemCancellation, ensureTableAccess, parseJsonArray,
  normalizeText, osTimestamp, bumpCatalogVersion, notifyOrderItemCancelled,
}) => async ({ itemId, keepModifierId, cancelContext }, session = null) => {
  await assertSuperAdminItemCancellation(session);
  const reasonCode = normalizeText(cancelContext?.reasonCode);
  const reasonLabel = normalizeText(cancelContext?.reasonLabel);
  const reasonNotes = normalizeText(cancelContext?.reasonNotes);
  if (!itemId || !keepModifierId || !reasonCode || !reasonLabel || reasonNotes.length < 3) {
    fail('Informe o item, o adicional a manter e a justificativa do cancelamento.', 400);
  }

  const access = (await db.execute({
    sql: 'SELECT o.table_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ?',
    args: [itemId],
  })).rows[0];
  if (access?.table_id) await ensureTableAccess(access.table_id, session);

  const splitItemId = `split:${itemId}:${keepModifierId}`;
  const tx = await db.transaction('write');
  let result;
  let reversedCount = 0;
  try {
    const existingSplit = (await tx.execute({
      sql: `SELECT oi.order_id, oi.product_id, oi.quantity, oi.price_at_time,
                   m.name, m.category_id
            FROM order_items oi JOIN menu m ON m.id = oi.product_id WHERE oi.id = ?`,
      args: [splitItemId],
    })).rows[0];
    if (existingSplit) {
      result = { orderId: existingSplit.order_id, item: {
        id: splitItemId, orderId: existingSplit.order_id, productId: existingSplit.product_id,
        name: existingSplit.name, categoryId: existingSplit.category_id || '',
        quantity: Number(existingSplit.quantity), price: Number(existingSplit.price_at_time), selectedModifiers: [],
      }, idempotent: true };
      await tx.rollback();
      return result;
    }

    const item = (await tx.execute({
      sql: `SELECT oi.id, oi.order_id, oi.quantity, oi.price_at_time, oi.selected_modifiers,
                   o.table_id, o.status, t.number AS table_number, m.name AS product_name
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            LEFT JOIN tables t ON t.id = o.table_id
            LEFT JOIN menu m ON m.id = oi.product_id
            WHERE oi.id = ? LIMIT 1`,
      args: [itemId],
    })).rows[0];
    if (!item) fail('Item não encontrado. Atualize a mesa antes de tentar novamente.', 404);
    if (item.status === 'closed') fail('Não é possível alterar um pedido já fechado.');
    if (item.table_id !== access?.table_id) fail('A mesa mudou durante o cancelamento.');

    const modifiers = parseJsonArray(item.selected_modifiers);
    const matches = modifiers.filter(modifier => String(modifier.id) === String(keepModifierId));
    if (matches.length !== 1) fail('O adicional não está identificado de forma única neste item.');
    const modifier = matches[0];
    if (modifiers.filter(entry => comparableName(entry.name) === comparableName(modifier.name)).length !== 1) {
      fail('Há adicionais de mesmo nome nesta linha. Revise a mesa antes de separá-los.');
    }
    if (Number(modifier.price || 0) <= 0 && !modifier.linkedProductId) {
      fail('Este adicional não é um produto independente para permanecer na mesa.');
    }

    const movements = (await tx.execute({
      sql: `SELECT id, empresa_id, produto_id, quantidade, responsavel_id,
                   custo_unitario_centavos, custo_total_centavos, motivo
            FROM estoque_movimentacoes
            WHERE origem = 'pdv' AND order_item_id = ? AND tipo_movimentacao = 'saida'`,
      args: [itemId],
    })).rows;
    const retainedMovements = movements.filter(movement =>
      String(movement.motivo || '').endsWith(` | Opcional ${modifier.name}`));
    if (retainedMovements.length > 0) {
      const priorReversals = (await tx.execute({
        sql: `SELECT id FROM estoque_movimentacoes WHERE source_item_kind = 'cancel_reversal'
              AND source_item_id IN (${retainedMovements.map(() => '?').join(',')}) LIMIT 1`,
        args: retainedMovements.map(movement => String(movement.id)),
      })).rows;
      if (priorReversals.length > 0) fail('A baixa do adicional já foi estornada. Revise o estoque antes de mantê-lo.');
    }
    const stockIds = [...new Set(retainedMovements.map(movement => String(movement.produto_id)))];
    let candidates;
    if (modifier.linkedProductId) {
      candidates = (await tx.execute({
        sql: 'SELECT id, name, price, visible, category_id, remote_stock_id FROM menu WHERE id = ? AND visible = 1',
        args: [modifier.linkedProductId],
      })).rows;
    } else if (stockIds.length > 0) {
      candidates = (await tx.execute({
        sql: `SELECT id, name, price, visible, category_id, remote_stock_id FROM menu
              WHERE remote_stock_id IN (${stockIds.map(() => '?').join(',')})
                AND visible = 1 AND category_id IS NOT NULL AND price > 0`,
        args: stockIds,
      })).rows.filter(candidate => {
        const itemName = comparableName(candidate.name);
        const modifierName = comparableName(modifier.name);
        return itemName === modifierName || itemName.startsWith(`${modifierName} `);
      });
    } else {
      candidates = [];
    }
    if (candidates.length !== 1) {
      fail('Não foi possível identificar um único SKU para manter o adicional. Revise o vínculo no catálogo.');
    }
    const sku = candidates[0];
    if (sku.remote_stock_id && retainedMovements.length === 0) {
      fail('O adicional ainda não tem baixa de estoque identificável. Revise o pedido antes de separá-lo.');
    }

    const keepMovementIds = new Set(retainedMovements.map(movement => String(movement.id)));
    const cancelledMovements = movements.filter(movement => !keepMovementIds.has(String(movement.id)));
    const now = osTimestamp();
    const split = await tx.execute({
      sql: `INSERT INTO order_items
              (id, order_id, product_id, quantity, price_at_time, selected_modifiers, notes)
            VALUES (?, ?, ?, ?, ?, '[]', ?)`,
      args: [splitItemId, item.order_id, sku.id, Number(item.quantity), Number(modifier.price || 0),
        `Adicional mantido após cancelamento de ${item.product_name || 'item'}.`],
    });
    if (Number(split.rowsAffected) !== 1) fail('Não foi possível preservar o adicional.');

    for (const movement of retainedMovements) {
      const moved = await tx.execute({
        sql: 'UPDATE estoque_movimentacoes SET order_item_id = ? WHERE id = ? AND order_item_id = ?',
        args: [splitItemId, movement.id, itemId],
      });
      if (Number(moved.rowsAffected) !== 1) fail('Não foi possível transferir o histórico do adicional.');
    }
    for (const movement of cancelledMovements) {
      const stock = (await tx.execute({
        sql: 'SELECT id FROM estoque_produtos WHERE id = ? AND empresa_id = ? LIMIT 1',
        args: [movement.produto_id, movement.empresa_id],
      })).rows[0];
      if (!stock) fail('O estoque vinculado ao item não existe mais. Revise o vínculo antes de cancelar.');
      const restored = await tx.execute({
        sql: `INSERT OR IGNORE INTO estoque_movimentacoes
                (id, empresa_id, produto_id, tipo_movimentacao, quantidade,
                 quantidade_anterior, quantidade_nova, custo_unitario_centavos, custo_total_centavos,
                 metodo_custeio, custo_fonte, motivo, responsavel_id,
                 created_at, order_id, order_item_id, origem, source_item_id, source_item_kind)
              SELECT ?, empresa_id, id, 'entrada', ?, quantidade_atual, quantidade_atual + ?, ?, ?,
                     'estorno_cmv_historico', 'estoque_movimentacoes', ?, ?, ?, ?, ?, 'pdv', ?, 'cancel_reversal'
              FROM estoque_produtos WHERE id = ? AND empresa_id = ?`,
        args: [`pdv_cancel_${movement.id}`, Number(movement.quantidade), Number(movement.quantidade),
          movement.custo_unitario_centavos == null ? null : Number(movement.custo_unitario_centavos),
          movement.custo_total_centavos == null ? null : Number(movement.custo_total_centavos),
          `Estorno do item ${itemId} com adicional ${modifier.name} mantido: ${reasonLabel}`,
          movement.responsavel_id, now, item.order_id, itemId, String(movement.id),
          movement.produto_id, movement.empresa_id],
      });
      if (Number(restored.rowsAffected) === 1) {
        const stockUpdate = await tx.execute({
          sql: `UPDATE estoque_produtos SET quantidade_atual = quantidade_atual + ?,
                  status = CASE WHEN quantidade_atual + ? <= estoque_minimo THEN 'Crítico' ELSE 'Saudável' END,
                  updated_at = ? WHERE id = ? AND empresa_id = ?`,
          args: [Number(movement.quantidade), Number(movement.quantidade), now,
            movement.produto_id, movement.empresa_id],
        });
        if (Number(stockUpdate.rowsAffected) !== 1) fail('Não foi possível estornar o estoque do item cancelado.');
        reversedCount += 1;
      }
    }
    const removed = await tx.execute({ sql: 'DELETE FROM order_items WHERE id = ?', args: [itemId] });
    if (Number(removed.rowsAffected) !== 1) fail('O item mudou durante o cancelamento.');
    const currentItems = (await tx.execute({
      sql: 'SELECT quantity, price_at_time, selected_modifiers FROM order_items WHERE order_id = ?',
      args: [item.order_id],
    })).rows;
    const total = Number(currentItems.reduce((sum, entry) => {
      const modifierTotal = parseJsonArray(entry.selected_modifiers)
        .reduce((value, selected) => value + Number(selected.price || 0), 0);
      return sum + (Number(entry.price_at_time || 0) + modifierTotal) * Number(entry.quantity || 0);
    }, 0).toFixed(2));
    await tx.execute({ sql: 'UPDATE orders SET total = ? WHERE id = ?', args: [total, item.order_id] });
    await tx.execute({
      sql: `INSERT INTO audit_logs
              (id, action, details, table_number, origin, author_id, author_name, timestamp)
            VALUES (?, 'order_item_product_cancelled_modifier_kept', ?, ?, 'pdv', ?, ?, ?)`,
      args: [randomUUID(), JSON.stringify({ itemId, keepModifierId, keptSkuId: sku.id,
        splitItemId, quantity: item.quantity, historicalModifierPrice: Number(modifier.price || 0),
        reasonCode, reasonLabel, reasonNotes, inventoryReversalCount: reversedCount }),
      String(item.table_number || cancelContext?.tableNumber || ''), session?.id || null,
      session?.name || 'Superadmin', new Date().toISOString()],
    });
    await tx.commit();
    result = { orderId: item.order_id, item: {
      id: splitItemId, orderId: item.order_id, productId: sku.id,
      categoryId: sku.category_id || '', name: sku.name,
      price: Number(modifier.price || 0), quantity: Number(item.quantity), selectedModifiers: [],
    }, total, inventoryReversalCount: reversedCount };
    if (reversedCount > 0) {
      try { await bumpCatalogVersion(); } catch (error) { console.warn('Catálogo não atualizado após cancelamento:', error); }
    }
    void notifyOrderItemCancelled({
      tableNumber: Number(item.table_number || cancelContext?.tableNumber || 0),
      itemName: `${item.product_name || 'item'} (adicional ${modifier.name} mantido)`,
      quantity: Number(item.quantity || 0), sellerName: session?.name || 'Superadmin',
      sellerPermission: 'super_admin', reasonLabel, reasonNotes,
    });
    return result;
  } catch (error) {
    try { await tx.rollback(); } catch { /* transaction already completed */ }
    throw error;
  }
};
