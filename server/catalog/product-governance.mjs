export const backfillCanonicalProductData = async (db) => {
  const result = await db.execute('SELECT id, product_code FROM menu ORDER BY rowid ASC');
  const usedCodes = new Set();
  const updates = [];
  let nextCode = 100;

  for (const row of result.rows || []) {
    const currentCode = Number(row.product_code || 0);
    if (Number.isInteger(currentCode) && currentCode >= 100 && currentCode <= 9999 && !usedCodes.has(currentCode)) {
      usedCodes.add(currentCode);
      continue;
    }
    while (usedCodes.has(nextCode)) nextCode += 1;
    if (nextCode > 9999) throw new Error('Limite de códigos de produto atingido.');
    usedCodes.add(nextCode);
    updates.push({ sql: 'UPDATE menu SET product_code = ? WHERE id = ?', args: [nextCode, row.id] });
    nextCode += 1;
  }

  if (updates.length > 0) await db.batch(updates, 'write');
  await db.execute(`
    UPDATE modifiers
    SET linked_product_id = id
    WHERE linked_product_id IS NULL
      AND EXISTS (SELECT 1 FROM menu WHERE menu.id = modifiers.id)
  `);
};

export const persistCanonicalMenuProduct = async ({
  db,
  productId,
  product,
  currentProduct,
  allocateProductCode,
  requireString,
  requireNumber,
}) => {
  let productCode = Number(currentProduct?.product_code || 0) || await allocateProductCode();
  const persist = () => db.execute({
    sql: `
      INSERT INTO menu
        (id, name, description, price, category, category_id, image, visible, delivery_visible, product_code, erp_code, remote_stock_id, schedule_config, cost, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, description = excluded.description, price = excluded.price,
        category = excluded.category, category_id = excluded.category_id, image = excluded.image,
        visible = excluded.visible, delivery_visible = excluded.delivery_visible,
        erp_code = excluded.erp_code, remote_stock_id = excluded.remote_stock_id,
        schedule_config = excluded.schedule_config, cost = excluded.cost, sort_order = excluded.sort_order
    `,
    args: [
      productId,
      requireString(product.name, 'product.name'),
      product.description || '',
      requireNumber(product.price, 'product.price'),
      product.categoryId || '',
      product.categoryId || '',
      product.image || '',
      product.visible ? 1 : 0,
      product.deliveryVisible === false ? 0 : 1,
      productCode,
      product.erpCode || null,
      product.remoteStockId || null,
      product.schedule ? JSON.stringify(product.schedule) : null,
      Number(product.cost || 0),
      Number(product.sortOrder || 0),
    ],
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await persist();
      return productCode;
    } catch (error) {
      const collision = !currentProduct
        && /unique constraint failed.*menu\.product_code|idx_menu_product_code_unique/i.test(String(error?.message || error));
      if (!collision || attempt === 2) throw error;
      productCode = await allocateProductCode();
    }
  }
  throw new Error('Não foi possível reservar um código de produto.');
};

export const prepareCanonicalModifiers = async ({ db, modifiers, createId, requireString }) => {
  const prepared = [];
  const linkedProducts = new Set();
  for (const modifier of Array.isArray(modifiers) ? modifiers : []) {
    const linkedProductId = String(modifier?.linkedProductId || '').trim();
    let name = String(modifier?.name || '').trim();
    let price = Number(modifier?.price || 0);

    if (linkedProductId) {
      if (linkedProducts.has(linkedProductId)) {
        const error = new Error('O mesmo produto não pode aparecer duas vezes no mesmo grupo de adicionais.');
        error.statusCode = 409;
        throw error;
      }
      const result = await db.execute({
        sql: 'SELECT name, price FROM menu WHERE id = ? LIMIT 1',
        args: [linkedProductId],
      });
      const linkedProduct = result.rows?.[0];
      if (!linkedProduct) {
        const error = new Error('Produto vinculado ao adicional não foi encontrado.');
        error.statusCode = 400;
        throw error;
      }
      linkedProducts.add(linkedProductId);
      name = String(linkedProduct.name || '').trim();
      price = Number(linkedProduct.price || 0);
    }

    prepared.push({
      id: String(modifier?.id || '').trim() || createId(),
      linkedProductId: linkedProductId || null,
      name: requireString(name, 'modifier.name'),
      price,
      status: modifier?.status || 'active',
    });
  }
  return prepared;
};

export const saveCanonicalModifierGroup = async ({ db, group, createId, requireString, bumpCatalogVersion }) => {
  const safeGroup = group || {};
  const groupId = requireString(safeGroup.id, 'group.id');
  const prepared = await prepareCanonicalModifiers({
    db,
    modifiers: safeGroup.modifiers,
    createId,
    requireString,
  });

  await db.execute({
    sql: 'INSERT OR REPLACE INTO modifier_groups (id, name, description, min_choices, max_choices, is_required, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [
      groupId,
      requireString(safeGroup.name, 'group.name'),
      safeGroup.description || '',
      Number(safeGroup.minChoices || 0),
      Number(safeGroup.maxChoices || 1),
      safeGroup.isRequired ? 1 : 0,
      safeGroup.status || 'active',
    ],
  });

  if (Array.isArray(safeGroup.modifiers)) {
    await db.batch([
      { sql: 'DELETE FROM modifiers WHERE group_id = ?', args: [groupId] },
      ...prepared.map((modifier, index) => ({
        sql: 'INSERT INTO modifiers (id, group_id, linked_product_id, name, price, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [modifier.id, groupId, modifier.linkedProductId, modifier.name, modifier.price, modifier.status, index],
      })),
    ], 'write');
  }

  return { catalogVersion: await bumpCatalogVersion() };
};
