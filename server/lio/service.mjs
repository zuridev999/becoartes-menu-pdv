import { createHmac, randomBytes } from 'node:crypto';
import { buildOrderItems, catalogForLio, cents, digest, fail, integer, newId, orderFingerprint, receipt } from './domain.mjs';
import { createCieloClient } from './cielo.mjs';
import { verifyPin } from '../auth/pins.mjs';

export const TERMINALS = ['02322106', '02322105', '02322104'];
const now = () => Date.now();
const token = () => randomBytes(32).toString('hex');
const safe = (v) => { if (typeof v !== 'string' || !v || v.length > 120) fail('Identificador inválido.'); return v; };

export function createLioService({ db, pdv, secret, cielo = createCieloClient(), allowedTerminals = TERMINALS }) {
  if (!secret) throw new Error('LIO requires a server secret');
  const run = (sql, args = []) => db.execute({ sql, args });
  const one = async (sql, args = []) => (await run(sql, args)).rows[0];
  const pinHash = pin => createHmac('sha256', secret).update('lio-pin:' + pin).digest('hex');
  const audit = (actor, device, event, subject) => run('INSERT INTO lio_audit VALUES (?,?,?,?,?,?)', [newId(), actor, device || null, event, subject, now()]);
  const locks = new Map();
  async function serial(key, fn) {
    if (locks.has(key)) fail('Operação em andamento. Aguarde.', 409);
    locks.set(key, true);
    try { return await fn(); } finally { locks.delete(key); }
  }
  const activeSeller = async id => {
    const user = (await pdv.getAuthSellers()).find(s => s.id === id && s.status === 'active');
    if (!user) fail('Funcionário não autorizado ou inativo.', 403);
    return user;
  };
  async function permit(actor, permission) { pdv.requirePermission(actor, permission, await pdv.getSettings()); }
  async function assertOperational(actor) {
    await pdv.assertCashOperationAllowed();
    if(pdv.getCashState && !(await pdv.getCashState()).isOpen) fail('O caixa está fechado. Abra pelo PDV antes de operar a maquininha.',409);
    if(pdv.getPdvLockState && (await pdv.getPdvLockState()).locked && actor.permission!=='admin') fail('PDV bloqueado pelo administrador.',403);
  }
  async function tableFor(id, actor) {
    safe(id);
    await pdv.ensureTableAccess(id, actor);
    const table = (await pdv.getTables()).find(t => t.id === id);
    if (!table) fail('Mesa não encontrada.', 404);
    // Customer tabs have a separate settlement lifecycle. Never settle their parent table here.
    if (table.customerTab) fail('Esta comanda individual deve ser atendida no PDV nesta versão.', 409);
    return table;
  }
  async function quote(id, actor) {
    const table = await tableFor(id, actor);
    const values = await pdv.getActiveTablePaymentBalance(id);
    return { table, ...values, fingerprint: orderFingerprint(table), receipt: receipt(table, values) };
  }
  async function assertUnlocked(tableId, actor = null) {
    const pending = await one("SELECT id FROM lio_intents WHERE table_id=? AND status IN ('pending','verified','recorded')", [tableId]);
    if (pending && actor?.lioIntentId !== pending.id) fail('Mesa em pagamento na maquininha. Conclua ou confira a operação antes de alterar a conta.', 409);
  }
  async function deviceAuth(value) {
    if (!value) fail('Ative esta maquininha pelo administrador.', 401);
    const d = await one('SELECT * FROM lio_devices WHERE token_hash=? AND active=1', [digest(value)]);
    if (!d) fail('Maquininha não autorizada.', 401);
    return d;
  }
  return {
    assertUnlocked,
    async adminState() {
      return {
        sellers: (await pdv.getAuthSellers()).filter(s => s.status === 'active').map(s => ({ id: s.id, name: s.name })),
        devices: (await run('SELECT id,terminal,active FROM lio_devices')).rows,
        operators: (await run('SELECT seller_id,active FROM lio_operators')).rows,
        pending: (await run("SELECT id,table_id,method,amount,status,created_at FROM lio_intents WHERE status IN ('pending','verified','recorded') ORDER BY created_at DESC LIMIT 50")).rows,
        terminals: allowedTerminals, cieloReady: cielo.ready(),
      };
    },
    async enrollDevice(terminal, admin) {
      if (!allowedTerminals.includes(terminal)) fail('Terminal fora da lista autorizada.');
      const code = randomBytes(6).toString('hex').toUpperCase();
      await run(`INSERT INTO lio_devices (id,terminal,enrollment_hash,enrollment_expires,active,created_by,created_at)
        VALUES (?,?,?,?,1,?,?) ON CONFLICT(terminal) DO UPDATE SET enrollment_hash=excluded.enrollment_hash,
        enrollment_expires=excluded.enrollment_expires,active=1`, [newId(), terminal, digest(code), now()+600000, admin.id, now()]);
      await audit(admin.id, null, 'device_enrollment_created', terminal);
      return { code, expiresInSeconds: 600 };
    },
    async activate(code) {
      const value = token();
      const updated = await run(`UPDATE lio_devices SET token_hash=?,enrollment_hash=NULL,enrollment_expires=NULL
        WHERE enrollment_hash=? AND enrollment_expires>? AND active=1 RETURNING id,terminal`, [digest(value), digest(String(code).trim().toUpperCase()), now()]);
      if (!updated.rows.length) fail('Código de ativação inválido ou expirado.', 401);
      await run('DELETE FROM lio_sessions WHERE device_id=?', [updated.rows[0].id]);
      await audit('enrollment', updated.rows[0].id, 'device_activated', updated.rows[0].terminal);
      return { deviceToken: value, terminal: updated.rows[0].terminal };
    },
    async setOperator(sellerId, _pin, admin) {
      await activeSeller(safe(sellerId));
      await db.batch([
        { sql: `INSERT INTO lio_operators VALUES (?,?,1,?,?) ON CONFLICT(seller_id) DO UPDATE SET
          pin_lookup=excluded.pin_lookup,active=1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`, args: [sellerId,pinHash('seller:'+sellerId),admin.id,now()] },
        { sql: 'DELETE FROM lio_sessions WHERE seller_id=?', args: [sellerId] },
      ], 'write');
      await audit(admin.id, null, 'operator_code_updated', sellerId);
      return { ok: true };
    },
    async revoke(kind, id, admin) {
      if (kind === 'device') await run('UPDATE lio_devices SET active=0 WHERE id=?', [safe(id)]);
      else if (kind === 'operator') await run('UPDATE lio_operators SET active=0 WHERE seller_id=?', [safe(id)]);
      else fail('Tipo inválido.');
      await audit(admin.id, null, `${kind}_revoked`, id);
      return { ok: true };
    },
    async cancelPending(id, reason, admin) {
      await permit(admin,'cancelPayment');
      if(typeof reason!=='string'||reason.trim().length<15) fail('Registre a conferência feita na Cielo (mínimo 15 caracteres).');
      return serial(safe(id),async()=>{
        const result=await run("UPDATE lio_intents SET status='cancelled',updated_at=? WHERE id=? AND status='pending'",[now(),id]);
        if(!result.rowsAffected) fail('Somente uma operação não confirmada pode ser liberada. Pagamento confirmado exige conferência financeira.',409);
        await audit(admin.id,null,'pending_released_after_manual_cielo_check',id+': '+reason.trim().slice(0,500));
        return {ok:true};
      });
    },
    async login(deviceToken, pin) {
      const d = await deviceAuth(deviceToken);
      if (!/^\d{4}$/.test(String(pin))) fail('Digite os quatro dígitos do seu PIN.', 401);
      const allowed = new Set((await run('SELECT seller_id FROM lio_operators WHERE active=1')).rows.map(row => String(row.seller_id)));
      const seller = (await pdv.getAuthSellers({ includePins: true })).find(candidate =>
        candidate.status === 'active' && allowed.has(String(candidate.id)) && verifyPin(pin, candidate.pin || '').ok);
      if (!seller) fail('PIN inválido ou funcionário não liberado para a maquininha.', 401);
      await permit(seller,'accessPDV');
      const value = token();
      await db.batch([
        { sql: 'DELETE FROM lio_sessions WHERE device_id=? OR expires<?', args: [d.id, now()] },
        { sql: 'INSERT INTO lio_sessions VALUES (?,?,?,?)', args: [digest(value),d.id,seller.id,now()+8*3600000] },
      ], 'write');
      await audit(seller.id,d.id,'operator_login',d.terminal);
      return { session: value, seller: { id: seller.id, name: seller.name }, terminal: d.terminal };
    },
    async authenticate(deviceToken, sessionToken) {
      const d = await deviceAuth(deviceToken);
      const s = await one(`SELECT s.seller_id FROM lio_sessions s JOIN lio_operators o ON o.seller_id=s.seller_id
        WHERE s.token_hash=? AND s.device_id=? AND s.expires>? AND o.active=1`, [digest(sessionToken || ''),d.id,now()]);
      if (!s) fail('Entre novamente com seu código.', 401);
      const actor=await activeSeller(s.seller_id);
      await permit(actor,'accessPDV');
      return { actor, device: d };
    },
    async logout(sessionToken) { await run('DELETE FROM lio_sessions WHERE token_hash=?', [digest(sessionToken || '')]); return { ok: true }; },
    async pending({actor,device}) {
      return {payments:(await run("SELECT id,table_id,method,amount,received,status FROM lio_intents WHERE device_id=? AND seller_id=? AND status IN ('pending','verified','recorded') ORDER BY created_at",[device.id,actor.id])).rows};
    },
    async tables({ actor }) {
      // One snapshot + one permissions read, not hundreds of remote SQL round trips.
      const [tables,settings,pending]=await Promise.all([pdv.getTables(),pdv.getSettings(),run("SELECT table_id FROM lio_intents WHERE status IN ('pending','verified','recorded')")]);
      const canSeeOthers=pdv.canSessionWithSettings ? pdv.canSessionWithSettings(actor,'viewOtherOperatorTables',settings) : actor.permission==='admin';
      const locked=new Set(pending.rows.map(p=>p.table_id));
      const result = [];
      for (const t of tables) {
        if(t.currentSellerId && t.currentSellerId!==actor.id && !canSeeOthers) continue;
        result.push({ id:t.id,number:t.number,status:t.status,individual:!!t.customerTab,paymentPending:locked.has(t.id),
          subtotalCents:(t.orders || []).reduce((s,i)=>s+i.quantity*(cents(i.price)+(i.selectedModifiers||[]).reduce((n,m)=>n+cents(m.price||0),0)),0) });
      }
      return { tables: result };
    },
    quote: (id, { actor }) => quote(id, actor),
    async catalog() { return { products: catalogForLio(await pdv.getCatalogData()) }; },
    async order(data, { actor, device }) {
      await permit(actor,'addOrderItem'); await permit(actor,'sendOrderToProduction');
      await assertOperational(actor);
      const id = `lio_${device.id}_${safe(data.requestId)}`;
      const existing = pdv.getExistingOrderSubmission ? await pdv.getExistingOrderSubmission(id) : null;
      if(existing) {
        if(String(existing.table_id)!==String(data.tableId)) fail('Solicitação já usada em outra mesa.',409);
        return {ok:true,duplicate:true,orderId:existing.id};
      }
      const table = await tableFor(data.tableId,actor);
      await assertUnlocked(table.id);
      if (table.status === 'available') await permit(actor,'openTable');
      const items = buildOrderItems(data.items,catalogForLio(await pdv.getCatalogData()),id);
      if (items.some(i=>i.quantity!==1)) await permit(actor,'changeItemQuantity');
      if (items.some(i=>i.notes)) await permit(actor,'editItemNotes');
      const total = items.reduce((n,i)=>n+i.quantity*(cents(i.price)+i.selectedModifiers.reduce((s,m)=>s+cents(m.price),0)),0)/100;
      // sendToKitchen opens the table atomically with the items; never call openTable(wasAvailable).
      return pdv.sendToKitchen({ orderId:id,clientRequestId:id,tableId:table.id,items,total,origin:'pdv',sellerId:actor.id },actor);
    },
    async prepare(data, { actor, device }) {
      await permit(actor,'launchPayment'); await assertOperational(actor);
      if (!['credit','debit','pix','cash'].includes(data.method)) fail('Escolha a forma de pagamento.');
      const id = `lio_${device.id}_${safe(data.requestId)}`;
      return serial(id,async()=>{
        const prior = await one('SELECT * FROM lio_intents WHERE id=?',[id]);
        if (prior) {
          if(prior.status==='cancelled') fail('Operação cancelada pelo administrador. Volte à conta.',410);
          if (prior.seller_id!==actor.id || prior.table_id!==data.tableId || prior.amount!==data.amount || prior.received!==data.received || prior.method!==data.method) fail('Solicitação já usada com outros dados.',409);
          // Never return another charge launch after the initial response; reconcile instead.
          return { id, status:prior.status, recovery:true };
        }
        const q = await quote(data.tableId,actor);
        if (q.table.status==='available' || !q.table.orders.length) fail('Mesa sem itens.',409);
        if (q.fingerprint!==data.fingerprint) fail('A conta mudou. Atualize antes de cobrar.',409);
        integer(data.amount); integer(data.received);
        if (data.amount>q.balanceCents) fail('Valor maior que o restante da conta. Atualize.',409);
        if (data.method!=='cash' && data.received!==data.amount) fail('Troco somente em dinheiro.');
        if (data.received<data.amount) fail('Valor recebido insuficiente.');
        if (data.amount<q.balanceCents || q.paidCents>0) await permit(actor,'splitPayment');
        await permit(actor,'changePaymentMethod');
        const intent={id,method:data.method,amount:data.amount};
        const request = data.method==='cash'?null:cielo.request(intent);
        try {
          await run('INSERT INTO lio_intents (id,device_id,seller_id,table_id,method,amount,received,quote,fingerprint,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            [id,device.id,actor.id,q.table.id,data.method,data.amount,data.received,JSON.stringify(q),q.fingerprint,'pending',now(),now()]);
        } catch(e) { if (String(e).includes('UNIQUE')) fail('Há pagamento pendente nesta mesa. Consulte a operação anterior.',409); throw e; }
        await audit(actor.id,device.id,'payment_prepared',id);
        return { id,status:'pending',request };
      });
    },
    async settle(data, context) {
      const { actor, device } = context;
      return serial(safe(data.id),async()=>{
        let i = await one('SELECT * FROM lio_intents WHERE id=? AND device_id=?',[data.id,device.id]);
        if (!i || i.seller_id!==actor.id) fail('Pagamento pertence a outro operador ou terminal.',403);
        if (i.status==='cancelled') fail('Operação cancelada pelo administrador. Volte à conta.',410);
        if (i.status==='done') return JSON.parse(i.result);
        await permit(actor,'launchPayment');
        const session = { ...actor,lioIntentId:i.id };
        if (i.status==='pending') {
          let verified={method:i.method,transactionId:null,orderId:null};
          if (i.method!=='cash') verified=await cielo.verify(i,device.terminal, data.orderId || i.cielo_order_id);
          await run("UPDATE lio_intents SET status='verified',transaction_id=?,cielo_order_id=?,method=?,updated_at=? WHERE id=?",
            [verified.transactionId,verified.orderId,verified.method,now(),i.id]);
          i={...i,status:'verified',method:verified.method};
        }
        if (i.status==='verified') {
          const current = await quote(i.table_id,session);
          if (current.fingerprint!==i.fingerprint) fail('Pagamento confirmado, mas os itens mudaram. Não cobre novamente; confira no caixa.',409);
          await pdv.createTablePayment({id:i.id,tableId:i.table_id,method:i.method,amount:i.amount/100},session);
          await run("UPDATE lio_intents SET status='recorded',updated_at=? WHERE id=?",[now(),i.id]);
        }
        const result={id:i.id,status:'done',method:i.method,paidCents:i.amount,changeCents:i.received-i.amount,
          message:'Pagamento registrado. Atualize a conta para finalizar quando o saldo for zero.'};
        await run("UPDATE lio_intents SET status='done',result=?,updated_at=? WHERE id=?",[JSON.stringify(result),now(),i.id]);
        await audit(actor.id,device.id,'payment_recorded',i.id);
        return result;
      });
    },
    async finish(data, { actor,device }) {
      await permit(actor,'closeBill'); await assertOperational(actor);
      return serial(`close:${safe(data.tableId)}`,async()=>{
        const q=await quote(data.tableId,actor);
        if(q.table.status==='available') return {ok:true,closed:true};
        await assertUnlocked(data.tableId);
        if(q.fingerprint!==data.fingerprint || q.balanceCents!==0 || !q.table.orders.length) fail('Conta mudou ou ainda tem saldo. Atualize.',409);
        await pdv.closeBillWithInventorySync({tableId:q.table.id,tableNumber:q.table.number,sellerId:actor.id,sellerName:actor.name,
          subtotal:q.subtotalCents/100,serviceFee:q.serviceFeeCents/100,total:(q.subtotalCents+q.serviceFeeCents)/100,
          discount:0,couponAmount:0,payments:(q.table.payments||[]).filter(p=>p.status==='active').map(p=>({id:p.id,method:p.method,amount:p.amount}))},actor);
        await audit(actor.id,device.id,'table_closed',q.table.id);
        return {ok:true,closed:true};
      });
    },
  };
}
