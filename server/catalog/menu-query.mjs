export const createGetMenu = ({ db, parseJsonObject }) => {
return async (availability = { productBlocked: new Set() }) => {
  const res = await db.execute(`
    SELECT
      m.*,
      c.name as category_name,
      c.sort_order as category_sort_order,
      ep.quantidade_atual as stock_quantity,
      ep.estoque_minimo as stock_minimum,
      ep.preco_custo as stock_cost,
      ft.id as cmv_id,
      ft.custo_total as cmv_cost,
      (SELECT COUNT(*) FROM ficha_ingredientes fi WHERE fi.ficha_tecnica_id = ft.id) as cmv_ingredient_count,
      (SELECT COUNT(*) FROM ficha_ingredientes fi WHERE fi.ficha_tecnica_id = ft.id AND fi.estoque_produto_id IS NULL) as cmv_unlinked_count
    FROM menu m
    LEFT JOIN categories c ON m.category_id = c.id
    LEFT JOIN estoque_produtos ep ON ep.id = m.remote_stock_id AND ep.ativo = 1
    LEFT JOIN fichas_tecnicas ft ON ft.id = (
      SELECT candidate.id
      FROM fichas_tecnicas candidate
      WHERE candidate.pdv_product_id = m.id
      ORDER BY
        CASE WHEN EXISTS (SELECT 1 FROM ficha_ingredientes fi2 WHERE fi2.ficha_tecnica_id = candidate.id) THEN 0 ELSE 1 END,
        candidate.updated_at DESC,
        candidate.created_at DESC
      LIMIT 1
    )
    ORDER BY COALESCE(c.sort_order, 0) ASC, COALESCE(m.sort_order, 0) ASC, m.rowid ASC
  `);
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    price: Number(row.price || 0),
    categoryId: row.category_id || '',
    categoryName: row.category_name || '',
    image: row.image || '',
    visible: row.visible === 1 && !availability.productBlocked.has(String(row.id)),
    baseVisible: row.visible === 1,
    availabilityBlocked: availability.productBlocked.has(String(row.id)),
    deliveryVisible: row.delivery_visible !== 0,
    sortOrder: Number(row.sort_order || 0),
    schedule: parseJsonObject(row.schedule_config),
    productCode: Number(row.product_code || 0) || null,
    erpCode: row.erp_code || '',
    remoteStockId: row.remote_stock_id || '',
    stockQuantity: row.remote_stock_id ? Number(row.stock_quantity || 0) : null,
    stockMinimum: row.remote_stock_id ? Number(row.stock_minimum || 0) : null,
    cost: (row.cmv_id
      ? Number(row.cmv_cost || 0)
      : row.remote_stock_id
        ? Number(row.stock_cost || 0)
        : Number(row.cost || 0)) + Number(row.external_service_cost || 0),
    externalFulfillment: row.external_fulfillment === 1,
    externalServiceCost: Number(row.external_service_cost || 0),
    costSource: row.cmv_id ? 'cmv' : row.remote_stock_id ? 'stock' : 'manual',
    cmvId: row.cmv_id || '',
    cmvIngredientCount: Number(row.cmv_ingredient_count || 0),
    cmvUnlinkedCount: Number(row.cmv_unlinked_count || 0),
    cmvStatus: row.cmv_id
      ? Number(row.cmv_ingredient_count || 0) === 0
        ? 'empty'
        : Number(row.cmv_unlinked_count || 0) > 0
          ? 'incomplete'
          : 'complete'
      : row.remote_stock_id
        ? 'direct_stock'
      : row.external_fulfillment === 1 && Number(row.external_service_cost || 0) > 0
        ? 'complete'
        : 'missing',
    modifierGroups: [],
  }));
};
};
