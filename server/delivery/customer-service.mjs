export const createDeliveryCustomerServices = ({
  db,
  createId,
  hashToken,
  normalizeText,
  sessionTtlDays,
  clubCycleSize,
  clubRewardLabel,
}) => {
  const normalizeDeliveryCustomer = (customer = {}) => ({
    name: normalizeText(customer.name),
    phone: normalizeText(customer.phone),
    email: normalizeText(customer.email).toLowerCase(),
    taxId: normalizeText(customer.taxId || customer.tax_id).replace(/\D/g, ''),
    street: normalizeText(customer.street),
    number: normalizeText(customer.number),
    neighborhood: normalizeText(customer.neighborhood),
    city: normalizeText(customer.city),
    state: normalizeText(customer.state).toUpperCase().slice(0, 2),
    postalCode: normalizeText(customer.postalCode).replace(/\D/g, ''),
    complement: normalizeText(customer.complement),
    reference: normalizeText(customer.reference),
    latitude: customer.latitude === undefined || customer.latitude === null || customer.latitude === '' ? null : Number(customer.latitude),
    longitude: customer.longitude === undefined || customer.longitude === null || customer.longitude === '' ? null : Number(customer.longitude),
    quoteId: normalizeText(customer.quoteId),
    quoteExpiresAt: normalizeText(customer.quoteExpiresAt),
    notes: normalizeText(customer.notes),
    fulfillment: customer.fulfillment === 'pickup' ? 'pickup' : 'delivery',
    paymentMethod: customer.paymentMethod === 'pagbank'
      ? 'pix'
      : (['pix', 'credit', 'debit'].includes(customer.paymentMethod) ? customer.paymentMethod : 'pix'),
    coupon: normalizeText(customer.coupon).toUpperCase(),
    joinClub: customer.joinClub !== false,
  });

  const deliveryCustomerPublic = (row) => row ? ({
    id: row.id,
    name: row.name || '',
    phone: row.phone || '',
    email: row.email || '',
    street: row.street || '',
    number: row.number || '',
    neighborhood: row.neighborhood || '',
    city: row.city || '',
    state: row.state || '',
    postalCode: row.postal_code || '',
    complement: row.complement || '',
    reference: row.reference || '',
    joinClub: row.join_club !== 0,
    emailVerified: row.email_verified === 1,
    phoneVerified: row.phone_verified === 1,
  }) : null;

  const getDeliveryClubSummary = async (customerId) => {
    if (!customerId) return null;
    const customerRes = await db.execute({
      sql: 'SELECT join_club FROM delivery_customers WHERE id = ? LIMIT 1',
      args: [customerId],
    });
    const joinClub = customerRes.rows[0]?.join_club !== 0;
    if (!joinClub) {
      return {
        enrolled: false,
        paidOrders: 0,
        cycleSize: clubCycleSize,
        remainingToReward: clubCycleSize,
        rewardsEarned: 0,
        rewardLabel: clubRewardLabel,
      };
    }

    const countRes = await db.execute({
      sql: "SELECT COUNT(*) as paid_orders FROM delivery_orders WHERE customer_id = ? AND payment_status LIKE 'paid%'",
      args: [customerId],
    });
    const paidOrders = Number(countRes.rows[0]?.paid_orders || 0);
    const remainder = paidOrders % clubCycleSize;
    return {
      enrolled: true,
      paidOrders,
      cycleSize: clubCycleSize,
      remainingToReward: remainder === 0 && paidOrders > 0 ? 0 : clubCycleSize - remainder,
      rewardsEarned: Math.floor(paidOrders / clubCycleSize),
      rewardLabel: clubRewardLabel,
    };
  };

  const createDeliveryCustomerSession = async (customerId) => {
    const customerRes = await db.execute({
      sql: 'SELECT email_verified, phone_verified FROM delivery_customers WHERE id = ? LIMIT 1',
      args: [customerId],
    });
    const customer = customerRes.rows[0];
    if (!customer || (customer.email_verified !== 1 && customer.phone_verified !== 1)) {
      const error = new Error('Confirme seu cadastro antes de entrar.');
      error.statusCode = 403;
      throw error;
    }
    const token = createId() + createId();
    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000).toISOString();
    await db.execute('DELETE FROM delivery_customer_sessions WHERE expires_at <= CURRENT_TIMESTAMP');
    await db.execute({
      sql: 'INSERT INTO delivery_customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)',
      args: [hashToken(token), customerId, expiresAt],
    });
    await db.execute({
      sql: 'UPDATE delivery_customers SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [customerId],
    });
    return { token, expiresAt };
  };

  const getDeliveryCustomerBySession = async (token = '') => {
    const safeToken = normalizeText(token);
    if (!safeToken) return null;
    const sessionRes = await db.execute({
      sql: 'SELECT customer_id FROM delivery_customer_sessions WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP LIMIT 1',
      args: [hashToken(safeToken)],
    });
    const customerId = sessionRes.rows[0]?.customer_id;
    if (!customerId) return null;
    const customerRes = await db.execute({
      sql: 'SELECT * FROM delivery_customers WHERE id = ? AND (email_verified = 1 OR phone_verified = 1) LIMIT 1',
      args: [customerId],
    });
    return customerRes.rows[0] || null;
  };

  const findDeliveryCustomerIdentity = async ({ email = '', phone = '' } = {}) => {
    const safeEmail = normalizeText(email).toLowerCase();
    const safePhone = normalizeText(phone).replace(/\D/g, '');
    if (!safeEmail && !safePhone) return null;
    const clauses = [];
    const args = [];
    if (safeEmail) {
      clauses.push('email = ?');
      args.push(safeEmail);
    }
    if (safePhone) {
      clauses.push("replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', '') = ?");
      args.push(safePhone);
    }
    const result = await db.execute({
      sql: `SELECT * FROM delivery_customers WHERE ${clauses.join(' OR ')} ORDER BY updated_at DESC LIMIT 1`,
      args,
    });
    return result.rows[0] || null;
  };

  return {
    createDeliveryCustomerSession,
    deliveryCustomerPublic,
    findDeliveryCustomerIdentity,
    getDeliveryClubSummary,
    getDeliveryCustomerBySession,
    normalizeDeliveryCustomer,
  };
};
