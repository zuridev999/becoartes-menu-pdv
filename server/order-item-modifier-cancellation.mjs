export const createSuperAdminItemCancellationGuard = (isSuperAdminSession) => async (session = null) => {
  const legacyAdmin = session?.permission === 'admin'
    && ['admin-bootstrap', 'admin-bypass', 'master'].includes(String(session?.id || ''));
  if (legacyAdmin || await isSuperAdminSession(session)) return;
  const error = new Error('Apenas o superadmin pode cancelar itens ou adicionais da mesa.');
  error.statusCode = 403;
  throw error;
};

export const createOrderItemCancellationNotifier = ({ safeCreateOSNotification, tenantSlug }) => async ({
  tableNumber, itemName, quantity, sellerName, sellerPermission, reasonLabel, reasonNotes,
}) => {
  const reasonText = reasonLabel ? ` Motivo: ${reasonLabel}${reasonNotes ? ` (${reasonNotes})` : ''}.` : '';
  return safeCreateOSNotification({
    title: 'Item cancelado no PDV',
    message: `Mesa ${tableNumber}: ${quantity}x ${itemName} cancelado por ${sellerName} (${sellerPermission}).${reasonText}`,
    type: 'warning',
    link: `/${tenantSlug}/dinheiro`,
  });
};

export const createOrderItemModifierCancellation = ({
  db, assertSuperAdminItemCancellation, normalizeText, parseJsonArray, ensureTableAccess,
  resolveOSContext, osTimestamp, createId, bumpCatalogVersion, notifyOrderItemCancelled,
}) => async ({ itemId, modifierId, cancelContext }, session = null) => {
  await assertSuperAdminItemCancellation(session);
  const reasonCode = normalizeText(cancelContext?.reasonCode);
  const reasonLabel = normalizeText(cancelContext?.reasonLabel);
  const reasonNotes = normalizeText(cancelContext?.reasonNotes);
  if (!itemId || !modifierId || !reasonCode || !reasonLabel || reasonNotes.length < 3) {
    const error = new Error('Informe o adicional, o motivo e uma justificativa para o cancelamento.');
    error.statusCode = 400;
    throw error;
  }

  const itemRes = await db.execute({
    sql: `SELECT oi.order_id, oi.quantity, oi.selected_modifiers, o.table_id, o.status,
                 t.number AS table_number
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN tables t ON t.id = o.table_id
          WHERE oi.id = ? LIMIT 1`,
    args: [itemId],
  });
  const row = itemRes.rows[0];
  if (!row) {
    const error = new Error('Item não encontrado. Atualize a mesa antes de tentar novamente.');
    error.statusCode = 404;
    throw error;
  }
  if (row.table_id) await ensureTableAccess(row.table_id, session);
  if (row.status === 'closed') {
    const error = new Error('Não é possível alterar um pedido já fechado.');
    error.statusCode = 409;
    throw error;
  }

  const modifiers = parseJsonArray(row.selected_modifiers);
  const matching = modifiers.filter(modifier => String(modifier.id) === String(modifierId));
  if (matching.length === 0) return { orderId: row.order_id, inventoryReversalCount: 0, idempotent: true };
  if (matching.length !== 1) {
    const error = new Error('Há adicionais repetidos nesta linha. Revise a mesa antes de cancelar.');
    error.statusCode = 409;
    throw error;
  }
  const modifier = matching[0];
  const remainingModifiers = modifiers.filter(entry => String(entry.id) !== String(modifierId));
  const sourceId = String(modifier.linkedProductId || modifier.id);
  const optionalSuffix = ` | Opcional ${modifier.name}`;
  const movementsRes = await db.execute({
    sql: `SELECT id, empresa_id, produto_id, quantidade, responsavel_id,
                 custo_unitario_centavos, custo_total_centavos, source_item_id,
                 source_item_kind, motivo
          FROM estoque_movimentacoes
          WHERE origem = 'pdv' AND order_item_id = ? AND tipo_movimentacao = 'saida'
            AND source_item_kind IN ('modifier', 'recipe')`,
    args: [itemId],
  });
  const movements = movementsRes.rows.filter(movement => (
    String(movement.motivo || '').endsWith(optionalSuffix)
    && (movement.source_item_kind === 'recipe' || String(movement.source_item_id) === sourceId)
  ));
  const now = osTimestamp();
  const osUserId = movements.length ? (await resolveOSContext()).userId : null;
  const batch = [];
  for (const movement of movements) {
    const stockProduct = await db.execute({
      sql: 'SELECT id FROM estoque_produtos WHERE id = ? AND empresa_id = ? LIMIT 1',
      args: [movement.produto_id, movement.empresa_id],
    });
    if (!stockProduct.rows[0]) {
      const error = new Error('O estoque vinculado ao adicional não existe mais. Revise o vínculo antes de cancelar.');
      error.statusCode = 409;
      throw error;
    }
    batch.push({
      sql: `INSERT OR IGNORE INTO estoque_movimentacoes
              (id, empresa_id, produto_id, tipo_movimentacao, quantidade,
               quantidade_anterior, quantidade_nova, custo_unitario_centavos, custo_total_centavos,
               metodo_custeio, custo_fonte, motivo, responsavel_id,
               created_at, order_id, order_item_id, origem, source_item_id, source_item_kind)
            SELECT ?, empresa_id, id, 'entrada', ?, quantidade_atual, quantidade_atual + ?, ?, ?,
                   'estorno_cmv_historico', 'estoque_movimentacoes', ?, ?, ?, ?, ?, 'pdv', ?, 'cancel_reversal'
            FROM estoque_produtos WHERE id = ? AND empresa_id = ?`,
      args: [
        `pdv_cancel_${movement.id}`, Number(movement.quantidade || 0), Number(movement.quantidade || 0),
        movement.custo_unitario_centavos == null ? null : Number(movement.custo_unitario_centavos),
        movement.custo_total_centavos == null ? null : Number(movement.custo_total_centavos),
        `Estorno automático do adicional ${modifier.name} em ${itemId}: ${reasonLabel}`,
        osUserId || movement.responsavel_id, now, row.order_id, itemId, String(movement.id),
        movement.produto_id, movement.empresa_id,
      ],
    }, {
      sql: `UPDATE estoque_produtos
            SET quantidade_atual = quantidade_atual + ?,
                status = CASE WHEN quantidade_atual + ? <= estoque_minimo THEN 'Crítico' ELSE 'Saudável' END,
                updated_at = ?
            WHERE id = ? AND empresa_id = ? AND changes() > 0`,
      args: [Number(movement.quantidade || 0), Number(movement.quantidade || 0), now, movement.produto_id, movement.empresa_id],
    });
  }

  const allItemsRes = await db.execute({
    sql: 'SELECT id, quantity, price_at_time, selected_modifiers FROM order_items WHERE order_id = ?',
    args: [row.order_id],
  });
  const total = Number(allItemsRes.rows.reduce((sum, item) => {
    const itemModifiers = item.id === itemId ? remainingModifiers : parseJsonArray(item.selected_modifiers);
    const unitPrice = Number(item.price_at_time || 0)
      + itemModifiers.reduce((modifierSum, entry) => modifierSum + Number(entry.price || 0), 0);
    return sum + unitPrice * Number(item.quantity || 0);
  }, 0).toFixed(2));
  batch.push({
    sql: 'UPDATE order_items SET selected_modifiers = ? WHERE id = ?',
    args: [JSON.stringify(remainingModifiers), itemId],
  }, {
    sql: 'UPDATE orders SET total = ? WHERE id = ?',
    args: [total, row.order_id],
  }, {
    sql: `INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name, timestamp)
          VALUES (?, 'order_modifier_cancelled', ?, ?, 'pdv', ?, ?, ?)`,
    args: [createId(), JSON.stringify({ itemId, modifierId, modifierName: modifier.name, quantity: row.quantity,
      reasonCode, reasonLabel, reasonNotes, inventoryReversalCount: movements.length }),
    String(row.table_number || cancelContext?.tableNumber || ''), session?.id || null, session?.name || 'Superadmin', new Date().toISOString()],
  });
  await db.batch(batch, 'write');
  if (movements.length > 0) await bumpCatalogVersion();
  void notifyOrderItemCancelled({
    tableNumber: Number(row.table_number || cancelContext?.tableNumber || 0),
    itemName: `adicional ${modifier.name}`,
    quantity: Number(row.quantity || 0),
    sellerName: session?.name || 'Superadmin',
    sellerPermission: 'super_admin',
    reasonLabel,
    reasonNotes,
  });
  return { orderId: row.order_id, inventoryReversalCount: movements.length, total };
};
