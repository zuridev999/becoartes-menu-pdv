import { randomUUID } from 'node:crypto';

export const availabilitySchema = [
  `CREATE TABLE IF NOT EXISTS catalog_availability_sources (
    source_id TEXT PRIMARY KEY, hidden INTEGER NOT NULL DEFAULT 0,
    event_id TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS catalog_availability_links (
    source_id TEXT NOT NULL, subject_key TEXT NOT NULL,
    provenance TEXT NOT NULL DEFAULT 'reviewed',
    PRIMARY KEY (source_id, subject_key)
  )`,
  `CREATE TABLE IF NOT EXISTS catalog_availability_exceptions (
    source_id TEXT NOT NULL, subject_key TEXT NOT NULL, event_id TEXT NOT NULL,
    PRIMARY KEY (source_id, subject_key, event_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_availability_links_subject ON catalog_availability_links(subject_key)',
];

const key = (kind, id) => `${kind}:${id}`;
const asRows = (result) => result.rows || [];
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

// A small reviewed seed. Recipe/name matches outside this set remain candidates,
// never automatic hide targets. The hidden Frango a Passarinho recipe is excluded.
export const reviewedRecipeLinks = [
  ['255152b7-9eb8-430b-86ba-d98962e173cb', ['br4', 'pr2_file_frango', 'br1', 'pr2_parmegiana_frango', 'p3'].map(id => key('product', id))],
  ['5f689c4d-c77e-452a-8335-fcf02f8d1af3', ['p1', 'p2', 'pr2_calabresa', 'pr2_contra_file', 'pr2_file_frango', 'pr2_omelete', 'pr2_parmegiana_carne', 'pr2_parmegiana_frango'].map(id => key('product', id)).concat([key('modifier', 'mod_batata_frita_pratos')])],
  ['0fc0ac0a-061a-47d2-bda3-ece49ee77487', ['p4', 'br2', 'pr2_contra_file', 'db433b06-f94a-4b87-aae4-53ceeb41652d', 'pr2_parmegiana_carne'].map(id => key('product', id))],
  ['00134099-0ecd-48d0-a654-f3e23c5e80ac', ['br3', 'pr2_calabresa'].map(id => key('product', id))],
  ['4b849e83-db24-4088-abaf-c28d2abf8021', [key('modifier', 'd0db2d63-da73-4f0b-9fc6-d25de649e867')]],
  ['652ef36a-71d8-4641-a498-f0b399213e0d', [key('modifier', '3701a090-7042-4a08-9175-7d3085b3f50b')]],
];

export const seedReviewedRecipeLinks = async (db) => {
  const statements = reviewedRecipeLinks.flatMap(([sourceId, targets]) => targets.map(subjectKey => ({
    sql: `INSERT OR IGNORE INTO catalog_availability_links (source_id, subject_key, provenance)
      SELECT ?, ?, 'reviewed_recipe'
      WHERE EXISTS (SELECT 1 FROM estoque_produtos WHERE id = ?)
        AND EXISTS (SELECT 1 FROM ${subjectKey.startsWith('product:') ? 'menu' : 'modifiers'} WHERE id = ?)
        AND EXISTS (
          SELECT 1 FROM fichas_tecnicas ft JOIN ficha_ingredientes fi ON fi.ficha_tecnica_id = ft.id
          WHERE ft.pdv_product_id = ? AND fi.estoque_produto_id = ?
        )`,
    args: [sourceId, subjectKey, sourceId, subjectKey.split(':')[1], subjectKey.split(':')[1], sourceId],
  })));
  if (statements.length) await db.batch(statements, 'write');
};

export const readAvailabilityProjection = async (db) => {
  const hidden = asRows(await db.execute('SELECT source_id, event_id FROM catalog_availability_sources WHERE hidden = 1'));
  const productBlocked = new Set();
  const modifierBlocked = new Set();
  if (!hidden.length) return { productBlocked, modifierBlocked };

  const [products, modifiers, links, exceptions, recipeLinks] = await Promise.all([
    db.execute('SELECT id, remote_stock_id FROM menu'),
    db.execute('SELECT id, linked_product_id FROM modifiers'),
    db.execute('SELECT source_id, subject_key FROM catalog_availability_links'),
    db.execute('SELECT source_id, subject_key, event_id FROM catalog_availability_exceptions'),
    db.execute(`SELECT DISTINCT fi.estoque_produto_id AS source_id, ft.pdv_product_id AS subject_id
      FROM fichas_tecnicas ft JOIN ficha_ingredientes fi ON fi.ficha_tecnica_id = ft.id`),
  ]);
  const productById = new Map(asRows(products).map(row => [String(row.id), row]));
  const modifierById = new Map(asRows(modifiers).map(row => [String(row.id), row]));
  const currentRecipes = new Set(asRows(recipeLinks).map(row => `${row.source_id}|${row.subject_id}`));
  const reviewed = new Map();
  for (const row of asRows(links)) {
    const sourceId = String(row.source_id);
    const subjectKey = String(row.subject_key);
    const separator = subjectKey.indexOf(':');
    const kind = subjectKey.slice(0, separator);
    const subjectId = subjectKey.slice(separator + 1);
    // A reviewed edge must still exist in the current recipe or direct SKU.
    // In particular, old reviewed recipes cannot keep hiding an item after
    // its ingredient was removed from the technical sheet.
    const direct = kind === 'product'
      ? String(productById.get(subjectId)?.remote_stock_id || '') === sourceId
      : String(productById.get(String(modifierById.get(subjectId)?.linked_product_id || ''))?.remote_stock_id || '') === sourceId;
    if (!direct && (kind === 'modifier' && productById.has(subjectId)
      || !currentRecipes.has(`${sourceId}|${subjectId}`))) continue;
    if (!reviewed.has(sourceId)) reviewed.set(sourceId, new Set());
    reviewed.get(sourceId).add(subjectKey);
  }
  const excepted = new Set(asRows(exceptions).map(row => `${row.source_id}|${row.subject_key}|${row.event_id}`));

  for (const source of hidden) {
    const sourceId = String(source.source_id);
    const eventId = String(source.event_id);
    const selected = (subjectKey) => !excepted.has(`${sourceId}|${subjectKey}|${eventId}`);
    for (const product of asRows(products)) {
      const subjectKey = key('product', product.id);
      if ((String(product.remote_stock_id || '') === sourceId || reviewed.get(sourceId)?.has(subjectKey)) && selected(subjectKey)) {
        productBlocked.add(String(product.id));
      }
    }
    for (const modifier of asRows(modifiers)) {
      const subjectKey = key('modifier', modifier.id);
      const linkedStock = productById.get(String(modifier.linked_product_id || ''))?.remote_stock_id;
      if ((String(linkedStock || '') === sourceId || reviewed.get(sourceId)?.has(subjectKey)) && selected(subjectKey)) {
        modifierBlocked.add(String(modifier.id));
      }
    }
  }
  return { productBlocked, modifierBlocked };
};

export const getSourceImpact = async (db, { productId, sourceId }) => {
  const product = asRows(await db.execute({
    sql: 'SELECT id, name, remote_stock_id FROM menu WHERE id = ? LIMIT 1', args: [productId],
  }))[0];
  if (!product) throw error('Produto não encontrado.', 404);
  const recipeSources = asRows(await db.execute({
    sql: `SELECT DISTINCT ep.id, ep.nome
      FROM fichas_tecnicas ft JOIN ficha_ingredientes fi ON fi.ficha_tecnica_id = ft.id
      JOIN estoque_produtos ep ON ep.id = fi.estoque_produto_id
      WHERE ft.pdv_product_id = ?`, args: [productId],
  }));
  const sources = new Map(recipeSources.map(row => [String(row.id), { id: String(row.id), name: String(row.nome), direct: false }]));
  if (product.remote_stock_id) {
    const stock = asRows(await db.execute({ sql: 'SELECT id, nome FROM estoque_produtos WHERE id = ?', args: [product.remote_stock_id] }))[0];
    if (stock) sources.set(String(stock.id), { id: String(stock.id), name: String(stock.nome), direct: true });
  }
  if (!sources.size) return { productId, sources: [], sourceId: null, candidates: [] };
  const hiddenRows = asRows(await db.execute('SELECT source_id FROM catalog_availability_sources WHERE hidden = 1'));
  const hiddenIds = new Set(hiddenRows.map(row => String(row.source_id)));
  for (const source of sources.values()) source.hidden = hiddenIds.has(source.id);
  if (sourceId && !sources.has(String(sourceId))) throw error('Insumo não pertence ao produto selecionado.');
  const chosenId = String(sourceId || [...sources.values()].find(row => row.hidden)?.id || [...sources.values()].find(row => row.direct)?.id || (sources.size === 1 ? [...sources.keys()][0] : ''));
  if (!chosenId) return { productId, sources: [...sources.values()], sourceId: null, candidates: [] };

  const [directProducts, recipeProducts, linkedModifiers, recipeModifiers, reviewedRows, sourceState, exceptions] = await Promise.all([
    db.execute({ sql: 'SELECT id, name, visible FROM menu WHERE remote_stock_id = ?', args: [chosenId] }),
    db.execute({ sql: `SELECT DISTINCT m.id, m.name, m.visible FROM menu m
      JOIN fichas_tecnicas ft ON ft.pdv_product_id = m.id
      JOIN ficha_ingredientes fi ON fi.ficha_tecnica_id = ft.id WHERE fi.estoque_produto_id = ?`, args: [chosenId] }),
    db.execute({ sql: `SELECT DISTINCT md.id, md.name, md.status FROM modifiers md
      JOIN menu m ON m.id = md.linked_product_id WHERE m.remote_stock_id = ?`, args: [chosenId] }),
    db.execute({ sql: `SELECT DISTINCT md.id, md.name, md.status FROM modifiers md
      JOIN fichas_tecnicas ft ON ft.pdv_product_id = md.id
      JOIN ficha_ingredientes fi ON fi.ficha_tecnica_id = ft.id WHERE fi.estoque_produto_id = ?
      AND (NOT EXISTS (SELECT 1 FROM menu m WHERE m.id = md.id)
        OR EXISTS (SELECT 1 FROM menu linked WHERE linked.id = md.linked_product_id AND linked.remote_stock_id = ?))`, args: [chosenId, chosenId] }),
    db.execute({ sql: 'SELECT subject_key FROM catalog_availability_links WHERE source_id = ?', args: [chosenId] }),
    db.execute({ sql: 'SELECT hidden, event_id FROM catalog_availability_sources WHERE source_id = ?', args: [chosenId] }),
    db.execute({ sql: 'SELECT subject_key, event_id FROM catalog_availability_exceptions WHERE source_id = ?', args: [chosenId] }),
  ]);
  const reviewed = new Set(asRows(reviewedRows).map(row => String(row.subject_key)));
  const candidates = new Map();
  const add = (kind, row, provenance) => {
    const subjectKey = key(kind, row.id);
    const existing = candidates.get(subjectKey);
    candidates.set(subjectKey, {
      key: subjectKey, kind, id: String(row.id), name: String(row.name),
      baseVisible: kind === 'product' ? Number(row.visible) === 1 : row.status === 'active',
      reviewed: provenance !== 'recipe_candidate' || reviewed.has(subjectKey) || Boolean(existing?.reviewed),
      provenance: provenance !== 'recipe_candidate' ? provenance : (existing?.provenance || provenance),
    });
  };
  for (const row of asRows(recipeProducts)) add('product', row, 'recipe_candidate');
  for (const row of asRows(recipeModifiers)) add('modifier', row, 'recipe_candidate');
  for (const row of asRows(directProducts)) add('product', row, 'direct_stock');
  for (const row of asRows(linkedModifiers)) add('modifier', row, 'linked_product');
  const hiddenState = asRows(sourceState)[0];
  const exceptionKeys = new Set(asRows(exceptions).filter(row => row.event_id === hiddenState?.event_id).map(row => String(row.subject_key)));
  return {
    productId,
    sources: [...sources.values()], sourceId: chosenId,
    sourceName: sources.get(chosenId)?.name,
    hidden: Number(hiddenState?.hidden) === 1,
    candidates: [...candidates.values()].map(row => ({ ...row, selected: row.reviewed && !exceptionKeys.has(row.key) })),
  };
};

export const setSourceVisibility = async (db, { sourceId, productId, selectedKeys, hidden, authorId, authorName }) => {
  const impact = await getSourceImpact(db, { productId, sourceId });
  if (!impact.sourceId) throw error('Selecione um insumo vinculado ao produto.');
  const keys = new Set((Array.isArray(selectedKeys) ? selectedKeys : []).map(String));
  const allowed = new Set(impact.candidates.map(row => row.key));
  if (hidden && (!keys.size || [...keys].some(subjectKey => !allowed.has(subjectKey)))) {
    throw error('Seleção de produtos/adicionais inválida.');
  }
  const eventId = randomUUID();
  const version = String(Date.now());
  const statements = [
    {
      sql: `INSERT INTO catalog_availability_sources (source_id, hidden, event_id, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(source_id) DO UPDATE SET hidden=excluded.hidden, event_id=excluded.event_id, updated_at=CURRENT_TIMESTAMP`,
      args: [sourceId, hidden ? 1 : 0, hidden ? eventId : null],
    },
    { sql: 'DELETE FROM catalog_availability_exceptions WHERE source_id = ?', args: [sourceId] },
    ...impact.candidates.filter(row => hidden && keys.has(row.key) && !row.reviewed).map(row => ({
      sql: `INSERT OR IGNORE INTO catalog_availability_links (source_id, subject_key, provenance) VALUES (?, ?, 'selected_in_impact')`,
      args: [sourceId, row.key],
    })),
    ...impact.candidates.filter(row => hidden && row.reviewed && !keys.has(row.key)).map(row => ({
      sql: 'INSERT INTO catalog_availability_exceptions (source_id, subject_key, event_id) VALUES (?, ?, ?)',
      args: [sourceId, row.key, eventId],
    })),
    { sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('catalog_version', ?, CURRENT_TIMESTAMP)", args: [version] },
    {
      sql: `INSERT INTO audit_logs (id, action, details, table_number, origin, author_id, author_name, timestamp)
        VALUES (?, ?, ?, NULL, 'pdv', ?, ?, ?)`,
      args: [randomUUID(), hidden ? 'catalog_source_hidden' : 'catalog_source_restored', JSON.stringify({ sourceId, productId, selectedKeys: [...keys], eventId: hidden ? eventId : null }), authorId || null, authorName || 'Admin', new Date().toISOString()],
    },
  ];
  await db.batch(statements, 'write');
  return { catalogVersion: version, sourceId, hidden: Boolean(hidden), selectedKeys: [...keys] };
};
