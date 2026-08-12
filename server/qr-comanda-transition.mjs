export const createQrModeTransitionStatements = ({ currentMode, nextMode, nextSettings }) => {
  const statements = [];
  if (currentMode !== 'comanda' && nextMode === 'comanda') {
    statements.push({
      sql: `
        UPDATE tables
        SET qr_flow_override = CASE
          WHEN CAST(number AS INTEGER) BETWEEN 1 AND 50
            AND NOT EXISTS (SELECT 1 FROM customer_tabs ct WHERE ct.table_id = tables.id AND ct.status IN ('open', 'paid'))
            AND (
              status IN ('ordering', 'waiting', 'paid', 'bill_requested')
              OR EXISTS (SELECT 1 FROM orders o WHERE o.table_id = tables.id AND o.status != 'closed')
              OR EXISTS (SELECT 1 FROM table_payments tp WHERE tp.table_id = tables.id AND tp.status = 'active')
            )
          THEN 'mesa_until_close'
          ELSE NULL
        END
        WHERE CAST(number AS INTEGER) BETWEEN 1 AND 50
      `,
      args: [],
    });
  } else if (nextMode === 'mesa') {
    statements.push({ sql: "UPDATE tables SET qr_flow_override = NULL WHERE qr_flow_override IS NOT NULL", args: [] });
  }
  statements.push({
    sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('settings', ?, CURRENT_TIMESTAMP)",
    args: [JSON.stringify(nextSettings)],
  });
  return statements;
};

export const createQrComandaTransitionServices = ({
  db,
  createSignedToken,
  decodeSignedToken,
  getSettings,
  ensureDatabaseReady,
  ensureTablesUpTo,
  isAdminSession,
  tabletTokenTtlMs,
  normalizeCpf,
  isValidCpf,
  requireString,
  getCpfHash,
  verifyCustomerTabAccessToken,
  createCustomerTabAccessToken,
  createId,
  getCustomerTabTotalsByTable,
  sanitizeCustomerTab,
}) => {
  const getTableById = async (tableId) => {
    const result = await db.execute({
      sql: "SELECT id, number, status, qr_flow_override, COALESCE(qr_session_revision, 1) AS qr_session_revision FROM tables WHERE id = ? LIMIT 1",
      args: [String(tableId || '')],
    });
    return result.rows[0] || null;
  };

  const getTableByNumber = async (tableNumber) => {
    const safeNumber = Math.trunc(Number(tableNumber || 0));
    if (!Number.isFinite(safeNumber) || safeNumber <= 0) return null;
    const result = await db.execute({
      sql: "SELECT id, number, status, qr_flow_override, COALESCE(qr_session_revision, 1) AS qr_session_revision FROM tables WHERE number = ? LIMIT 1",
      args: [String(safeNumber)],
    });
    return result.rows[0] || null;
  };

  const createPublicTableToken = ({ source, tableId, tableNumber, revision = '', sessionRevision = 1, expiresAt = 0 }) => createSignedToken({
    typ: 'public_table_access',
    source,
    tableId: String(tableId || ''),
    tableNumber: Number(tableNumber || 0),
    revision: String(revision || ''),
    sessionRevision: Number(sessionRevision || 1),
    exp: expiresAt ? Number(expiresAt) : 0,
    iat: Date.now(),
  });

  const verifyPublicTableToken = async ({ token, source, tableId = '', tableNumber = '' }) => {
    const decoded = decodeSignedToken(token);
    if (!decoded || decoded.typ !== 'public_table_access' || decoded.source !== source) return null;
    if (decoded.exp && Number(decoded.exp) < Date.now()) return null;

    const table = tableId ? await getTableById(tableId) : await getTableByNumber(tableNumber || decoded.tableNumber);
    if (!table) return null;
    if (String(decoded.tableId) !== String(table.id)) return null;
    if (Number(decoded.tableNumber || 0) !== Number(table.number || 0)) return null;
    if (tableNumber && Number(tableNumber) !== Number(table.number || 0)) return null;
    if (Number(decoded.sessionRevision || 1) !== Number(table.qr_session_revision || 1)) return null;

    if (source === 'qr') {
      const settings = await getSettings();
      const revision = settings?.qrCodes?.tableRevisions?.[String(table.number)] || '';
      if (String(decoded.revision || '') !== String(revision || '')) return null;
    }

    return {
      source,
      tableId: String(table.id),
      tableNumber: Number(table.number || 0),
      sessionRevision: Number(table.qr_session_revision || 1),
    };
  };

  const createTableAccessToken = async ({ origin, tableId = '', tableNumber = '' }, session = null) => {
    const source = origin === 'tablet' ? 'tablet' : origin === 'qr' ? 'qr' : '';
    if (!source) throw new Error('Origem inválida para token de mesa.');
    if (source === 'tablet' && !session?.stationAccess && !isAdminSession(session)) {
      const error = new Error('Sessão do tablet inválida para vincular mesa.');
      error.statusCode = 403;
      throw error;
    }

    const table = tableId ? await getTableById(tableId) : await getTableByNumber(tableNumber);
    if (!table) throw new Error('Mesa não encontrada para token público.');
    const settings = await getSettings();
    const revision = source === 'qr' ? (settings?.qrCodes?.tableRevisions?.[String(table.number)] || '') : '';
    const expiresAt = source === 'tablet' ? Date.now() + tabletTokenTtlMs : 0;
    return {
      tableId: String(table.id),
      tableNumber: Number(table.number || 0),
      origin: source,
      token: createPublicTableToken({
        source,
        tableId: table.id,
        tableNumber: table.number,
        revision,
        sessionRevision: table.qr_session_revision,
        expiresAt,
      }),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    };
  };

  const isPhysicalTableOperationallyActive = async (tableId) => {
    const result = await db.execute({
      sql: `
        SELECT
          CASE WHEN t.status IN ('ordering', 'waiting', 'paid', 'bill_requested') THEN 1 ELSE 0 END AS active_status,
          EXISTS(SELECT 1 FROM orders o WHERE o.table_id = t.id AND o.status != 'closed') AS has_orders,
          EXISTS(SELECT 1 FROM table_payments tp WHERE tp.table_id = t.id AND tp.status = 'active') AS has_payments
        FROM tables t
        WHERE t.id = ?
        LIMIT 1
      `,
      args: [String(tableId || '')],
    });
    const row = result.rows[0];
    return Boolean(row && (Number(row.active_status) || Number(row.has_orders) || Number(row.has_payments)));
  };

  const resolvePhysicalQrFlow = async ({ tableNumber }) => {
    await ensureDatabaseReady();
    const safeNumber = Math.trunc(Number(tableNumber || 0));
    if (!Number.isFinite(safeNumber) || safeNumber < 1 || safeNumber > 50) {
      const error = new Error('QR de mesa física inválido.');
      error.statusCode = 400;
      throw error;
    }

    let table = await getTableByNumber(safeNumber);
    if (!table) {
      const error = new Error('Mesa física não encontrada.');
      error.statusCode = 404;
      throw error;
    }

    const settings = await getSettings();
    const globalMode = settings?.qrMode === 'comanda' ? 'comanda' : 'mesa';
    let inheritedMesa = globalMode === 'comanda' && table.qr_flow_override === 'mesa_until_close';
    if (inheritedMesa && !(await isPhysicalTableOperationallyActive(table.id))) {
      await db.execute({
        sql: "UPDATE tables SET qr_flow_override = NULL, qr_session_revision = COALESCE(qr_session_revision, 1) + 1 WHERE id = ? AND qr_flow_override = 'mesa_until_close'",
        args: [table.id],
      });
      table = await getTableById(table.id);
      inheritedMesa = false;
    }

    const flow = globalMode === 'mesa' || inheritedMesa ? 'mesa' : 'comanda';
    return {
      flow,
      globalMode,
      inheritedMesa,
      physicalTable: { id: String(table.id), number: safeNumber, status: String(table.status || 'available') },
      access: await createTableAccessToken({ origin: 'qr', tableId: table.id, tableNumber: safeNumber }),
    };
  };

  const verifyCustomerTabOrderContext = async ({
    tableId,
    origin,
    customerTabId = '',
    customerTabAccessToken = '',
    sourceTableId = '',
    sourceTableNumber = '',
    publicAccessToken = '',
  }) => {
    if (!customerTabId) {
      if (customerTabAccessToken || sourceTableId || sourceTableNumber) {
        const error = new Error('Contexto de comanda incompleto. Escaneie o QR novamente.');
        error.statusCode = 401;
        throw error;
      }
      return null;
    }
    if (origin !== 'qr' || !customerTabAccessToken || !sourceTableId || !sourceTableNumber || !publicAccessToken) {
      const error = new Error('Credenciais da comanda incompletas. Escaneie o QR novamente.');
      error.statusCode = 401;
      throw error;
    }

    const result = await db.execute({
      sql: "SELECT * FROM customer_tabs WHERE id = ? AND status IN ('open', 'paid') LIMIT 1",
      args: [customerTabId],
    });
    const tab = result.rows[0];
    if (!tab || String(tab.table_id) !== String(tableId) || !verifyCustomerTabAccessToken({ token: customerTabAccessToken, tab })) {
      const error = new Error('Acesso à comanda não autorizado.');
      error.statusCode = 403;
      throw error;
    }
    const sourceAccess = await verifyPublicTableToken({ token: publicAccessToken, source: 'qr', tableId: sourceTableId, tableNumber: sourceTableNumber });
    if (!sourceAccess || sourceAccess.tableNumber < 1 || sourceAccess.tableNumber > 50) {
      const error = new Error('Mesa física de origem inválida. Escaneie o QR novamente.');
      error.statusCode = 401;
      throw error;
    }
    return {
      customerTabId: String(tab.id),
      customerTabNumber: Number(tab.table_number || 0),
      sourceTableId: sourceAccess.tableId,
      sourceTableNumber: sourceAccess.tableNumber,
    };
  };

  const verifyPhysicalSource = async ({ origin = '', sourceTableId = '', sourceTableNumber = '', publicAccessToken = '' }) => {
    const hasSource = Boolean(sourceTableId || sourceTableNumber || publicAccessToken);
    if (!hasSource) return null;
    if (origin !== 'qr' || !sourceTableId || !sourceTableNumber || !publicAccessToken) {
      const error = new Error('Origem física da comanda incompleta. Escaneie o QR novamente.');
      error.statusCode = 401;
      throw error;
    }
    const access = await verifyPublicTableToken({ token: publicAccessToken, source: 'qr', tableId: sourceTableId, tableNumber: sourceTableNumber });
    if (!access || access.tableNumber < 1 || access.tableNumber > 50) {
      const error = new Error('QR físico inválido para esta comanda.');
      error.statusCode = 401;
      throw error;
    }
    const resolution = await resolvePhysicalQrFlow({ tableNumber: access.tableNumber });
    if (resolution.flow !== 'comanda') {
      const error = new Error(`A Mesa ${access.tableNumber} continua no modo mesa até o fechamento.`);
      error.statusCode = 409;
      throw error;
    }
    return access;
  };

  const findCustomerTabByCpf = async (cpf, statuses = ['open', 'paid']) => {
    const normalizedCpf = normalizeCpf(cpf);
    const result = await db.execute({
      sql: `SELECT * FROM customer_tabs WHERE cpf = ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY opened_at DESC LIMIT 1`,
      args: [normalizedCpf, ...statuses],
    });
    const row = result.rows[0] || null;
    if (!row) return null;
    const totals = await getCustomerTabTotalsByTable([row.table_id]);
    return sanitizeCustomerTab(row, totals[row.table_id]);
  };

  const findAvailableCustomerTabTable = async () => {
    await ensureTablesUpTo(200);
    const result = await db.execute(`
      SELECT t.id, t.number
      FROM tables t
      LEFT JOIN customer_tabs ct ON ct.table_id = t.id AND ct.status IN ('open', 'paid')
      WHERE CAST(t.number AS INTEGER) BETWEEN 51 AND 200
        AND ct.id IS NULL
        AND t.status = 'available'
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.table_id = t.id AND o.status != 'closed')
        AND NOT EXISTS (SELECT 1 FROM table_payments tp WHERE tp.table_id = t.id AND tp.status = 'active')
      ORDER BY CAST(t.number AS INTEGER) ASC
      LIMIT 1
    `);
    const table = result.rows[0];
    if (!table) throw new Error('Todas as comandas técnicas estão ocupadas.');
    return { id: String(table.id), number: Number(table.number) };
  };

  const openCustomerTab = async ({
    customerName,
    phone,
    cpf,
    accessToken = '',
    origin = '',
    sourceTableId = '',
    sourceTableNumber = '',
    publicAccessToken = '',
  }) => {
    await verifyPhysicalSource({ origin, sourceTableId, sourceTableNumber, publicAccessToken });
    const normalizedCpf = normalizeCpf(cpf);
    if (!isValidCpf(normalizedCpf)) throw new Error('CPF inválido. Confira os números e tente novamente.');
    const safeName = requireString(customerName, 'customerName').trim().slice(0, 120);
    const safePhone = requireString(phone, 'phone').trim().slice(0, 40);
    const existing = await findCustomerTabByCpf(normalizedCpf, ['open', 'paid']);
    if (existing) {
      const existingRow = (await db.execute({ sql: "SELECT * FROM customer_tabs WHERE id = ? LIMIT 1", args: [existing.id] })).rows[0];
      if (existingRow && verifyCustomerTabAccessToken({ token: accessToken, tab: existingRow })) {
        return { tab: existing, accessToken: createCustomerTabAccessToken(existingRow), recovered: true };
      }
      const error = new Error('Já existe uma comanda ativa para estes dados. Continue no dispositivo em que ela foi aberta ou peça ajuda à equipe.');
      error.statusCode = 409;
      throw error;
    }

    let lastError = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const table = await findAvailableCustomerTabTable();
      const id = createId();
      const openedAt = new Date().toISOString();
      try {
        await db.batch([
          {
            sql: "INSERT INTO customer_tabs (id, cpf, cpf_hash, cpf_last4, customer_name, phone, table_id, table_number, status, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
            args: [id, normalizedCpf, getCpfHash(normalizedCpf), normalizedCpf.slice(-4), safeName, safePhone, table.id, table.number, openedAt],
          },
          { sql: "UPDATE tables SET status = 'ordering', last_activity = ?, current_seller_id = NULL WHERE id = ?", args: [openedAt, table.id] },
          {
            sql: "INSERT INTO audit_logs (id, action, details, table_number, origin, author_name, timestamp) VALUES (?, 'customer_tab_opened', ?, ?, 'qr', 'Cliente QR', ?)",
            args: [createId(), JSON.stringify({ customerName: safeName, phone: safePhone, cpfLast4: normalizedCpf.slice(-4), tableId: table.id }), String(table.number), openedAt],
          },
        ], 'write');
        const tab = await findCustomerTabByCpf(normalizedCpf, ['open', 'paid']);
        const tabRow = (await db.execute({ sql: "SELECT * FROM customer_tabs WHERE id = ? LIMIT 1", args: [tab.id] })).rows[0];
        return { tab, accessToken: createCustomerTabAccessToken(tabRow), recovered: false };
      } catch (error) {
        lastError = error;
        if (!/constraint|unique/i.test(error instanceof Error ? error.message : String(error))) throw error;
        const racedExisting = await findCustomerTabByCpf(normalizedCpf, ['open', 'paid']);
        if (racedExisting) {
          const conflict = new Error('Uma comanda acabou de ser aberta para estes dados. Continue no dispositivo original ou peça ajuda à equipe.');
          conflict.statusCode = 409;
          throw conflict;
        }
      }
    }
    throw lastError || new Error('Não foi possível abrir a comanda agora. Tente novamente.');
  };

  const recoverCustomerTab = async ({
    cpf,
    accessToken = '',
    origin = '',
    sourceTableId = '',
    sourceTableNumber = '',
    publicAccessToken = '',
  }) => {
    await verifyPhysicalSource({ origin, sourceTableId, sourceTableNumber, publicAccessToken });
    const normalizedCpf = normalizeCpf(cpf);
    if (!isValidCpf(normalizedCpf)) throw new Error('CPF inválido. Confira os números e tente novamente.');
    const tab = await findCustomerTabByCpf(normalizedCpf, ['open', 'paid']);
    if (!tab) {
      const error = new Error('Não foi possível recuperar esta comanda neste dispositivo.');
      error.statusCode = 403;
      throw error;
    }
    const row = (await db.execute({ sql: "SELECT * FROM customer_tabs WHERE id = ? LIMIT 1", args: [tab.id] })).rows[0];
    if (!row || !verifyCustomerTabAccessToken({ token: accessToken, tab: row })) {
      const error = new Error('Não foi possível recuperar esta comanda neste dispositivo.');
      error.statusCode = 403;
      throw error;
    }
    return { tab, accessToken: createCustomerTabAccessToken(row) };
  };

  return {
    createTableAccessToken,
    openCustomerTab,
    recoverCustomerTab,
    resolvePhysicalQrFlow,
    verifyCustomerTabOrderContext,
    verifyPublicTableToken,
  };
};
