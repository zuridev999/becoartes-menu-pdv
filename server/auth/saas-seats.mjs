// Shared by PDV user creation; seat claims must use the same database write lock.
export async function insertUserWithinPlan(db, companyId, statement) {
  if (process.env.ZORDON_SAAS_RUNTIME !== 'true') return db.execute(statement);
  const tx = await db.transaction('write');
  try {
    const sub = await tx.execute({ sql: 'SELECT plan,status,trial_ends_at FROM saas_subscriptions WHERE empresa_id=?', args: [companyId] });
    const subscription = sub.rows[0];
    if (!subscription || !['trialing','active'].includes(subscription.status) || Number(subscription.trial_ends_at) <= Date.now()) throw new Error('O acesso da empresa está indisponível.');
    const limit = subscription.status === 'trialing' ? 10 : ({ operacao: 3, equipe: 6, gestao: 10 }[subscription.plan] || 0);
    const count = await tx.execute({ sql: 'SELECT count(*) n FROM users WHERE empresa_id=? AND COALESCE(ativo,1)=1', args: [companyId] });
    if (Number(count.rows[0]?.n || 0) >= limit) throw new Error(`Seu plano permite ${limit} usuários ativos, incluindo o proprietário.`);
    const result = await tx.execute(statement); await tx.commit(); return result;
  } catch (error) { await tx.rollback(); throw error; } finally { tx.close(); }
}

export async function seedCompanySettings(db) {
  if (process.env.ZORDON_SAAS_RUNTIME !== 'true') return;
  await db.execute({ sql: "INSERT OR IGNORE INTO app_settings(key,value) VALUES('settings',?)", args: [JSON.stringify({ unitName: process.env.ZORDON_COMPANY_NAME || 'Sua empresa', mode: 'production', serviceTax: 0, qrMode: 'mesa', pdv: { tickerEnabled: false, tickerText: '' }, tablet: { bannerText: 'Bem-vindo!', bannerUrls: [], autoBanner: false }, tables: { count: 12 }, customerAccountOnlinePaymentEnabled: false })] });
}

export async function isCompanyOwnerSession(db, companyId, session = null) {
  if (String(session?.osRole || '').toLowerCase() === 'super_admin') return true;
  const id = String(session?.id || '').replace(/^os:/, '');
  if (!id) return false;
  const result = await db.execute({ sql: 'SELECT role FROM users WHERE id=? AND empresa_id=? AND COALESCE(ativo,1)=1 LIMIT 1', args: [id, companyId] });
  const role = String(result.rows[0]?.role || '').trim().toLowerCase();
  return role === 'super_admin' || (process.env.ZORDON_SAAS_RUNTIME === 'true' && role === 'admin');
}
