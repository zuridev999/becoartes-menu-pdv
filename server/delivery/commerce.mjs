import { createHash, randomUUID } from 'node:crypto';

export const deliveryCommerceSchema = [
  `CREATE TABLE IF NOT EXISTS delivery_checkout_intents (order_id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, external_id TEXT, instructions TEXT, review_reason TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS delivery_quotes (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, fee_cents INTEGER NOT NULL, expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS delivery_receipts (order_id TEXT PRIMARY KEY, product_cents INTEGER NOT NULL, shipping_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL, paid_cents INTEGER NOT NULL, method TEXT NOT NULL, paid_at TEXT NOT NULL)`
];
const fail = (code, statusCode = 400) => { throw Object.assign(new Error(code), { statusCode, publicCode: code }); };
const json = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const cents = value => Math.round(Number(value) * 100);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => String(value || '').trim().slice(0, 300);
export const defaultDeliverySettings = {
  acceptingOrders: false, pickupEnabled: true, deliveryEnabled: false, logistics: 'manual',
  pickupAddress: '', preparationMinutes: 40, minimumOrder: 0, deliveryFee: 0,
  postalPrefixes: [], hours: Array.from({ length: 7 }, () => ({ enabled: false, start: '11:00', end: '23:00' })),
  coupons: [], clubEnabled: false, ifood: { enabled: false, status: 'pending_homologation' },
};
export function normalizeDeliverySettings(input = {}) {
  const out = { ...defaultDeliverySettings };
  for (const key of ['acceptingOrders', 'pickupEnabled', 'deliveryEnabled', 'clubEnabled']) out[key] = input[key] === true;
  out.logistics = input.logistics === 'ifood' ? 'ifood' : 'manual';
  out.pickupAddress = text(input.pickupAddress);
  for (const [key, max] of [['preparationMinutes', 240], ['minimumOrder', 10000], ['deliveryFee', 200]]) {
    const n = Number(input[key] ?? out[key]);
    if (!Number.isFinite(n) || n < 0 || n > max) fail('deliveryInvalidSettings');
    out[key] = Math.round(n * 100) / 100;
  }
  out.postalPrefixes = [...new Set((Array.isArray(input.postalPrefixes) ? input.postalPrefixes : []).map(String))];
  if (out.postalPrefixes.some(p => !/^\d{3,8}$/.test(p))) fail('deliveryInvalidSettings');
  out.hours = defaultDeliverySettings.hours.map((d, i) => {
    const day = input.hours?.[i] || d;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(day.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.end)) fail('deliveryInvalidSettings');
    return { enabled: day.enabled === true, start: day.start, end: day.end };
  });
  out.coupons = (Array.isArray(input.coupons) ? input.coupons : []).slice(0, 30).map(c => {
    const code = text(c.code).toUpperCase();
    const value = Number(c.value), minSubtotal = Number(c.minSubtotal || 0);
    const maxDiscount = c.maxDiscount == null ? null : Number(c.maxDiscount);
    if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !['fixed','percent'].includes(c.type) || !Number.isFinite(value) || value <= 0 || (c.type === 'percent' && value > 100) || !Number.isFinite(minSubtotal) || minSubtotal < 0 || (maxDiscount !== null && (!Number.isFinite(maxDiscount) || maxDiscount < 0))) fail('deliveryInvalidSettings');
    return { code, type: c.type, value, minSubtotal, maxDiscount, label: text(c.label || code) };
  });
  // iFood cannot be enabled by a UI flag before its separate homologation.
  out.ifood = { enabled: false, status: 'pending_homologation' };
  return out;
}
export function deliveryOpenNow(settings, now = new Date()) {
  if (!settings.acceptingOrders) return false;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = k => parts.find(p => p.type === k)?.value;
  const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
  const time = `${get('hour')}:${get('minute')}`, current = settings.hours[day], previous = settings.hours[(day + 6) % 7];
  return Boolean((current.enabled && (current.start < current.end ? time >= current.start && time < current.end : time >= current.start)) || (previous.enabled && previous.start > previous.end && time < previous.end));
}
export function priceDeliveryItems(items, catalog, now = new Date()) {
  if (!Array.isArray(items) || !items.length || items.length > 50) fail('deliveryInvalidCart');
  const quantityByProduct = new Map();
  return items.map((item, index) => {
    const p = catalog.menuItems.find(p => p.id === item.productId);
    const category = catalog.categories.find(c => c.id === p?.categoryId);
    if (!p || !p.visible || p.deliveryVisible === false || category?.visible === false) fail('deliveryUnavailableItem', 409);
    for (const schedule of [p.schedule,category?.schedule].filter(s => s?.enabled)) if (!deliveryOpenNow({ acceptingOrders: true, hours: Array.from({ length: 7 }, (_, i) => { const d = schedule.days?.[i]; return { enabled: !!d?.active, start: d?.startTime || '00:00', end: d?.endTime || '00:00' }; }) }, now)) fail('deliveryUnavailableItem', 409);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) fail('deliveryInvalidCart');
    const accumulated = (quantityByProduct.get(p.id) || 0) + quantity; quantityByProduct.set(p.id, accumulated);
    if (p.remoteStockId && p.stockQuantity !== null && accumulated > Number(p.stockQuantity)) fail('deliveryUnavailableItem', 409);
    const groupIds = [...new Set([...(catalog.productMapping[p.id] || []), ...(catalog.categoryMapping[p.categoryId] || [])])];
    const groups = groupIds.map(id => catalog.modifierGroups.find(g => g.id === id)).filter(Boolean);
    const requested = Array.isArray(item.selectedModifiers) ? item.selectedModifiers : [];
    if (new Set(requested.map(m => m.id)).size !== requested.length) fail('deliveryInvalidModifiers');
    const selectedModifiers = requested.map(m => {
      const option = groups.flatMap(g => g.modifiers).find(o => o.id === m.id);
      if (!option || option.status !== 'active' || option.inheritedUnavailable) fail('deliveryInvalidModifiers', 409);
      const linked = option.linkedProductId ? catalog.menuItems.find(p => p.id === option.linkedProductId) : null;
      if (linked && (!linked.visible || (linked.remoteStockId && linked.stockQuantity !== null && Number(linked.stockQuantity) < quantity))) fail('deliveryUnavailableItem',409);
      return { id: option.id, name: option.name, price: option.price, linkedProductId: option.linkedProductId || '' };
    });
    for (const g of groups) {
      const count = selectedModifiers.filter(m => g.modifiers.some(o => o.id === m.id)).length;
      if (count < Math.max(g.isRequired ? 1 : 0, Number(g.minChoices || 0)) || count > g.maxChoices) fail('deliveryInvalidModifiers');
    }
    if (!Number.isFinite(p.price) || p.price < 0 || selectedModifiers.some(m => !Number.isFinite(m.price) || m.price < 0)) fail('deliveryInvalidCart');
    return { id: `line_${index}`, productId: p.id, name: p.name, price: p.price, quantity, selectedModifiers, notes: text(item.notes) };
  });
}
export const deliverySubtotal = items => items.reduce((sum, i) => sum + (cents(i.price) + i.selectedModifiers.reduce((s, m) => s + cents(m.price), 0)) * i.quantity, 0);
const addressKey = c => ['fulfillment','postalCode','street','number','neighborhood','city','state','complement'].map(k => text(c[k]).toLowerCase());
export function createDeliveryCommerce({ db, ensureReady, getCatalog, normalizeCustomer, publicStatus, provider, token, apiBase, localDatabase, validCpf = value => /^\d{11}$/.test(value), simulationAllowed = false, kitchenMode, buildPayload, instructions, trackingToken, authorizeOrder, readOrder, dispatch, fetchImpl = fetch, clock = () => new Date() }) {
  if (!['pagbank','mock','disabled'].includes(provider)) throw new Error('Invalid delivery payment provider');
  const isSimulation = provider === 'mock' && localDatabase && simulationAllowed;
  const execute = (sql, args = []) => db.execute({ sql, args });
  const getIntent = async id => (await execute('SELECT * FROM delivery_checkout_intents WHERE order_id=?', [id])).rows[0];
  const settings = async () => { await ensureReady(); const row = (await execute("SELECT value FROM app_settings WHERE key='delivery_settings'")).rows[0]; return row ? normalizeDeliverySettings(json(row.value)) : { ...defaultDeliverySettings }; };
  const readiness = () => ({ paymentReady: isSimulation || (provider === 'pagbank' && !!token), kitchenReady: kitchenMode === 'production' || isSimulation, environment: isSimulation ? 'simulation' : apiBase.includes('sandbox') ? 'sandbox' : 'production', ifoodReady: false });
  const publicConfig = async () => { const s = await settings(); const ready = readiness(); return { settings: s, openNow: publicStatus === 'open' && deliveryOpenNow(s, clock()) && ready.paymentReady && ready.kitchenReady, ...ready }; };
  const saveSettings = async (input, session) => {
    const s = normalizeDeliverySettings(input);
    if (s.acceptingOrders && ((!s.pickupEnabled && !s.deliveryEnabled) || !s.pickupAddress || !s.hours.some(d => d.enabled) || (s.deliveryEnabled && (s.logistics === 'ifood' || !s.postalPrefixes.length)) || !readiness().paymentReady || !readiness().kitchenReady)) fail('deliveryNotReady', 409);
    await db.batch([{ sql: "INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES ('delivery_settings',?,CURRENT_TIMESTAMP)", args: [JSON.stringify(s)] }, { sql: "INSERT INTO audit_logs(id,action,details,origin,author_name,timestamp) VALUES (?,'delivery_settings_updated',?,'admin',?,?)", args: [randomUUID(), JSON.stringify(s), session?.name || session?.id || 'Admin', clock().toISOString()] }], 'write');
    return publicConfig();
  };
  const requireOpen = async () => { const c = await publicConfig(); if (!c.openNow) fail('deliveryClosed', 409); return c.settings; };
  const quote = async ({ customer: raw, items }) => {
    const s = await requireOpen(), c = normalizeCustomer(raw), priced = priceDeliveryItems(items, await getCatalog(), clock());
    if (c.fulfillment === 'pickup' ? !s.pickupEnabled : !s.deliveryEnabled) fail('deliveryUnavailable', 409);
    if (c.fulfillment === 'delivery') {
      if (s.logistics !== 'manual') fail('deliveryIfoodPending', 409);
      if (!/^\d{8}$/.test(c.postalCode) || !s.postalPrefixes.some(p => c.postalCode.startsWith(p)) || !c.street || !c.number || !c.city || !c.state || !c.neighborhood) fail('deliveryOutsideArea', 409);
    }
    const subtotal = deliverySubtotal(priced);
    if (subtotal < cents(s.minimumOrder)) fail('deliveryMinimum', 409);
    let discount = 0;
    if (c.coupon) {
      const coupon = s.coupons.find(x => x.code === c.coupon);
      if (!coupon || subtotal < cents(coupon.minSubtotal)) fail('deliveryCouponInvalid');
      discount = Math.min(subtotal, coupon.type === 'percent' ? Math.round(subtotal * coupon.value / 100) : cents(coupon.value), coupon.maxDiscount == null ? Infinity : cents(coupon.maxDiscount));
    }
    const fee = c.fulfillment === 'delivery' ? cents(s.deliveryFee) : 0;
    const id = randomUUID(), expiresAt = new Date(clock().getTime() + 10 * 60000).toISOString();
    const fingerprint = hash({ priced, address: addressKey(c), coupon: c.coupon, settings: s });
    await execute('DELETE FROM delivery_quotes WHERE expires_at < ?', [clock().toISOString()]);
    await execute('INSERT INTO delivery_quotes(id,fingerprint,fee_cents,expires_at) VALUES (?,?,?,?)', [id, fingerprint, fee, expiresAt]);
    return { quote: { quoteId: id, expiresAt, status: c.fulfillment === 'pickup' ? 'not_required_pickup' : 'available', provider: 'manual', deliveryFee: fee / 100, subtotal: subtotal / 100, discount: discount / 100, total: (subtotal + fee - discount) / 100, preparationTimeSeconds: s.preparationMinutes * 60 }, priced, fingerprint };
  };
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${apiBase}${path}`, { ...options, signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error('deliveryPaymentError'), { statusCode: 502, definitive: response.status >= 400 && response.status < 500 && response.status !== 429 });
    return data;
  };
  const review = async (id, reason) => {
    await db.batch([{ sql: "UPDATE delivery_checkout_intents SET status='review',review_reason=? WHERE order_id=?", args: [reason,id] }, { sql: "UPDATE delivery_orders SET payment_status='review' WHERE id=? AND payment_status!='paid'", args: [id] }, { sql: "INSERT INTO delivery_events(id,delivery_order_id,type,status,error) VALUES (?,?,'payment_review','review',?)", args: [randomUUID(),id,reason] }], 'write');
  };
  const reconcile = async (id, result) => {
    const intent = await getIntent(id), order = (await execute('SELECT * FROM delivery_orders WHERE id=?',[id])).rows[0];
    if (!intent || !order) fail('deliveryOrderMissing',404);
    if (result.reference_id !== id || (intent.external_id && result.id !== intent.external_id) || !result.id) return review(id,'identity_mismatch');
    const paid = (result.charges || []).filter(c => c.status === 'PAID');
    let status = (result.charges || []).some(c => ['DECLINED','CANCELED','CANCELLED'].includes(c.status)) ? 'payment_failed' : 'payment_pending';
    if (paid.length) {
      if (paid.reduce((s,c) => s + Number(c.amount?.value || 0),0) !== cents(order.total) || paid.some(c => c.amount?.currency !== 'BRL' || c.payment_method?.type !== (order.payment_method === 'pix' ? 'PIX' : 'CREDIT_CARD'))) return review(id,'amount_or_method_mismatch');
      if (intent.status === 'abandoned' || intent.status === 'review') return review(id,'late_payment_needs_refund_review');
      status = 'paid';
    }
    if (['review','abandoned'].includes(intent.status) || (intent.status === 'paid' && !paid.length)) return;
    if (!paid.length && order.payment_method === 'pix' && new Date(intent.expires_at) <= clock() && !(result.charges || []).length) status = 'expired';
    const info = instructions(order.payment_method,result), now = clock().toISOString();
    const changed = await execute("UPDATE delivery_checkout_intents SET status=?,external_id=?,instructions=? WHERE order_id=? AND status NOT IN ('paid','review','abandoned')", [status,result.id,JSON.stringify(info),id]);
    if (!changed.rowsAffected && intent.status !== 'paid') {
      const latest = await getIntent(id);
      if (paid.length && latest.status !== 'paid') await review(id,'late_payment_needs_refund_review');
      return;
    }
    await db.batch([
      { sql: "UPDATE delivery_orders SET payment_status=?,payment_external_id=?,paid_at=COALESCE(paid_at,?) WHERE id=? AND payment_status!='paid'", args:[status,result.id,status==='paid'?now:null,id] },
      { sql: "INSERT INTO delivery_events(id,delivery_order_id,type,status,provider,external_id,payload) VALUES (?,?,'payment',?,'pagbank',?,?)", args:[randomUUID(),id,status,result.id,JSON.stringify({instructions:info})] },
      ...(status==='paid' ? [{ sql:'INSERT OR IGNORE INTO delivery_receipts(order_id,product_cents,shipping_cents,discount_cents,paid_cents,method,paid_at) VALUES (?,?,?,?,?,?,?)',args:[id,cents(order.subtotal),cents(order.delivery_fee),cents(order.discount),cents(order.total),order.payment_method,now] }] : [])
    ],'write');
    if (status==='paid') await dispatch({orderId:id,source:'payment_confirmed'});
  };
  const resultFor = async id => { const row=(await execute('SELECT customer_id FROM delivery_orders WHERE id=?',[id])).rows[0]; const key=trackingToken({orderId:id,customerId:row.customer_id}); return { ...(await readOrder({orderId:id,trackingToken:key})),trackingToken:key }; };
  const checkout = async ({ orderId, requestKey, customer:raw, items, payment }) => {
    await ensureReady();
    if (!/^delivery_[a-zA-Z0-9_-]{16,50}$/.test(orderId || '') || !/^[a-zA-Z0-9_-]{24,100}$/.test(requestKey || '')) fail('deliveryInvalidRequest');
    const existing=await getIntent(orderId);
    if (existing) { if (existing.key_hash!==hash(requestKey)) fail('deliveryUnauthorized',403); return resultFor(orderId); }
    const s=await requireOpen(), customer=normalizeCustomer(raw);
    if (!['pix','credit'].includes(raw?.paymentMethod) || customer.name.length<2 || !/^\S+@\S+\.\S+$/.test(customer.email) || customer.phone.replace(/\D/g,'').length<10 || !validCpf(customer.taxId)) fail('deliveryCustomerInvalid');
    customer.joinClub=s.clubEnabled && raw?.joinClub===true;
    if (!isSimulation && customer.paymentMethod==='credit' && (!payment?.card?.encrypted || Number(payment.card.installments || 1)!==1)) fail('deliveryCardInvalid');
    const calculated=await quote({customer,items});
    const approved=(await execute('SELECT * FROM delivery_quotes WHERE id=?',[customer.quoteId])).rows[0];
    if (!approved || approved.fingerprint!==calculated.fingerprint || new Date(approved.expires_at)<=clock()) fail('deliveryQuoteExpired',409);
    const totals=calculated.quote, priced=calculated.priced.map((i,index)=>({...i,id:`${orderId}_${index}`}));
    if (totals.total<=0) fail('deliveryInvalidCart');
    // Build and validate before reserving; card ciphertext is never persisted.
    const payload=isSimulation?null:buildPayload({orderId,customer,items:priced,totals,payment});
    const customerId=createHash('sha256').update(`${customer.phone}|${customer.email}`).digest('hex').slice(0,32), now=clock().toISOString(),expires=new Date(clock().getTime()+30*60000).toISOString();
    try { await db.batch([
      {sql:'INSERT INTO delivery_checkout_intents(order_id,key_hash,fingerprint,status,expires_at,created_at) VALUES (?,?,?,\'creating\',?,?)',args:[orderId,hash(requestKey),calculated.fingerprint,expires,now]},
      {sql:'INSERT OR IGNORE INTO delivery_customers(id,name,phone,email,join_club) VALUES (?,?,?,?,?)',args:[customerId,customer.name,customer.phone,customer.email,customer.joinClub?1:0]},
      {sql:"INSERT INTO delivery_orders(id,customer_id,subtotal,delivery_fee,discount,total,coupon_code,fulfillment,payment_method,payment_status,payment_provider,kitchen_status,delivery_status,customer_snapshot,notes) VALUES (?,?,?,?,?,?,?,?,?,'creating',?,'waiting_payment','waiting_payment',?,?)",args:[orderId,customerId,totals.subtotal,totals.deliveryFee,totals.discount,totals.total,customer.coupon,customer.fulfillment,customer.paymentMethod,provider,JSON.stringify(customer),customer.notes]},
      ...priced.map(i=>({sql:'INSERT INTO delivery_order_items(id,delivery_order_id,product_id,name,quantity,price_at_time,selected_modifiers,notes) VALUES (?,?,?,?,?,?,?,?)',args:[i.id,orderId,i.productId,i.name,i.quantity,i.price,JSON.stringify(i.selectedModifiers),i.notes]}))
    ],'write'); } catch(error) { const duplicate=await getIntent(orderId); if(duplicate?.key_hash===hash(requestKey)) return resultFor(orderId); throw error; }
    try {
      const result=isSimulation ? {id:`mock_${orderId}`,reference_id:orderId,qr_codes: customer.paymentMethod==='pix'?[{text:'SIMULACAO-SEM-VALOR',expiration_date:expires}]:[],charges: customer.paymentMethod==='credit'?[{status:'PAID',amount:{value:cents(totals.total),currency:'BRL'},payment_method:{type:'CREDIT_CARD'}}]:[]} : await request('/orders',{method:'POST',headers:{'x-idempotency-key':orderId},body:JSON.stringify(payload)});
      await reconcile(orderId,result);
    } catch(error) {
      // Unknown network outcome blocks a new attempt; never turn a timeout into a retry charge.
      const current=await getIntent(orderId);
      if(current.status==='creating') await db.batch([{sql:'UPDATE delivery_checkout_intents SET status=? WHERE order_id=?',args:[error.definitive?'payment_failed':'unknown',orderId]},{sql:'UPDATE delivery_orders SET payment_status=? WHERE id=?',args:[error.definitive?'payment_failed':'unknown',orderId]}],'write');
    }
    return resultFor(orderId);
  };
  const refresh = async input => { await authorizeOrder(input); const i=await getIntent(input.orderId); if(i?.external_id && provider==='pagbank' && !['abandoned','review'].includes(i.status)) { try {await reconcile(input.orderId,await request(`/orders/${encodeURIComponent(i.external_id)}`));} catch { /* Keep last confirmed status. */ } } return readOrder(input); };
  const abandon = async input => {
    await refresh(input); const i=await getIntent(input.orderId);
    if(!i || !['payment_pending','payment_failed','expired'].includes(i.status)) fail('deliveryCannotChangePayment',409);
    const row=(await execute('SELECT payment_method FROM delivery_orders WHERE id=?',[input.orderId])).rows[0];
    if(row.payment_method!=='pix' && !['payment_failed','expired'].includes(i.status)) fail('deliveryCannotChangePayment',409);
    const changed=await execute("UPDATE delivery_checkout_intents SET status='abandoned' WHERE order_id=? AND status IN ('payment_pending','payment_failed','expired')",[input.orderId]);
    if(!changed.rowsAffected) fail('deliveryCannotChangePayment',409);
    await execute("UPDATE delivery_orders SET payment_status='abandoned' WHERE id=? AND payment_status!='paid'",[input.orderId]);
    return readOrder(input);
  };
  const recover = async ({orderId, externalId}, session) => {
    if (!await getIntent(orderId) || provider !== 'pagbank' || !/^ORDE_[A-Za-z0-9-]+$/.test(externalId || '')) fail('deliveryInvalidRequest');
    const result = await request(`/orders/${encodeURIComponent(externalId)}`);
    if(result.reference_id !== orderId) fail('deliveryInvalidRequest',409);
    await reconcile(orderId,result);
    await execute("INSERT INTO audit_logs(id,action,details,origin,author_name,timestamp) VALUES (?,'delivery_payment_rechecked',?,'admin',?,?)",[randomUUID(),JSON.stringify({orderId,externalId}),session?.name || session?.id || 'Admin',clock().toISOString()]);
    return resultFor(orderId);
  };
  const webhook = async body => { const id=body.reference_id; if(!await getIntent(id)) return false; await reconcile(id,body); return true; };
  const simulate = async input => {
    if(!isSimulation) fail('deliverySimulationDisabled',403);
    await authorizeOrder(input); const row=(await execute('SELECT * FROM delivery_orders WHERE id=?',[input.orderId])).rows[0];
    await reconcile(input.orderId,{id:`mock_${input.orderId}`,reference_id:input.orderId,charges:[{status:input.decline?'DECLINED':'PAID',amount:{value:cents(row.total),currency:'BRL'},payment_method:{type:row.payment_method==='pix'?'PIX':'CREDIT_CARD'}}]});
    return readOrder(input);
  };
  return { settings, publicConfig, saveSettings, quote: async input=>{ const result=await quote(input); return {quote:result.quote,items:result.priced}; }, checkout, refresh, abandon, webhook, simulate, recover };
}
