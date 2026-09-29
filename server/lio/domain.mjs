import { createHash, randomUUID } from 'node:crypto';

export const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
export const cents = (n) => Math.round(Number(n) * 100);
export const money = (n) => (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const digest = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const integer = (n, min = 1, max = 100000000) => {
  if (!Number.isSafeInteger(n) || n < min || n > max) fail('Valor inválido.');
  return n;
};
export function catalogForLio(catalog) {
  const groups = new Map((catalog.modifierGroups || []).map(g => [g.id, g]));
  return (catalog.menuItems || []).filter(p => p.visible === true || p.visible === 1).map(p => ({
    id: p.id, name: p.name, price: Number(p.price), image: p.image || '', categoryId: p.categoryId,
    categoryName: catalog.categories?.find(c => c.id === p.categoryId)?.name || '',
    modifierGroups: [...new Set([...(catalog.categoryMapping?.[p.categoryId] || []), ...(catalog.productMapping?.[p.id] || [])])]
      .map(id => groups.get(id)).filter(Boolean).filter(g => g.status === 'active'),
  }));
}
export function buildOrderItems(selections, products, orderId) {
  if (!Array.isArray(selections) || !selections.length || selections.length > 100) fail('Selecione os produtos.');
  return selections.map((line, index) => {
    const p = products.find(p => p.id === line.productId);
    if (!p) fail('Produto indisponível. Atualize o catálogo.', 409);
    integer(line.quantity, 1, 99);
    const ids = line.modifierIds || [];
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('Opções inválidas.');
    const allowed = p.modifierGroups.flatMap(g => g.modifiers);
    const modifiers = ids.map(id => allowed.find(m => m.id === id && m.status === 'active' && !m.inheritedUnavailable));
    if (modifiers.some(m => !m)) fail('Opção indisponível.', 409);
    for (const group of p.modifierGroups) {
      const count = group.modifiers.filter(m => ids.includes(m.id)).length;
      if (count < Math.max(Number(group.minChoices || 0), group.isRequired ? 1 : 0) || count > Number(group.maxChoices || 1)) {
        fail(`Confira as opções de ${group.name}.`);
      }
    }
    return { id: `${orderId}_${index}`, productId: p.id, name: p.name, categoryId: p.categoryId,
      categoryName: p.categoryName, price: p.price, quantity: line.quantity,
      selectedModifiers: modifiers, notes: String(line.notes || '').slice(0, 300) };
  });
}
export const orderFingerprint = (table) => digest((table.orders || []).map(i => ({
  id: i.id, orderId: i.orderId, productId: i.productId, quantity: i.quantity, price: i.price, modifiers: i.selectedModifiers,
})).sort((a,b) => a.id.localeCompare(b.id)));
export function receipt(table, quote) {
  const lines = ['BECOARTES', 'CONFERENCIA DE CONTA', 'NAO E DOCUMENTO FISCAL', `Mesa ${table.number}`, '--------------------------------'];
  for (const i of table.orders || []) {
    const extra = (i.selectedModifiers || []).reduce((s,m) => s + cents(m.price || 0), 0);
    lines.push(`${i.quantity}x ${i.name}`, money(i.quantity * (cents(i.price) + extra)));
    for (const m of i.selectedModifiers || []) lines.push(`  ${m.name}`);
  }
  lines.push('--------------------------------', `Subtotal: ${money(quote.subtotalCents)}`, `Servico: ${money(quote.serviceFeeCents)}`,
    `Total: ${money(quote.subtotalCents + quote.serviceFeeCents)}`, `Pago: ${money(quote.paidCents)}`, `Restante: ${money(quote.balanceCents)}`, '\n\n');
  return lines.join('\n');
}
// Only authoritative REST data, never the URI callback, can authorize settlement.
export function verifyCieloOrder(order, intent, terminal) {
  if (order.reference !== intent.id || Number(order.price) !== intent.amount || Number(order.remaining) !== 0 || order.status !== 'PAID') {
    fail('Cielo ainda não confirmou este pagamento. Consulte novamente; não cobre outra vez.', 409);
  }
  const transactions = order.transactions || [];
  if (transactions.some(t => t.transaction_type === 'CANCELLATION' && t.status === 'CONFIRMED')) fail('Pagamento cancelado na Cielo.', 409);
  const paid = transactions.filter(t => t.transaction_type === 'PAYMENT' && t.status === 'CONFIRMED');
  if (paid.length !== 1 || Number(paid[0].amount) !== intent.amount || String(paid[0].terminal_number).replace(/^0+/, '') !== terminal.replace(/^0+/, '')) {
    fail('Pagamento exige conferência no caixa: valor ou terminal diferente.', 409);
  }
  const product = paid[0].payment_product?.primary_product_name;
  const actualMethod = ({ CREDITO: 'credit', DEBITO: 'debit', PIX: 'pix' })[String(product || '').toUpperCase()];
  if (!actualMethod) fail('Cielo não informou a modalidade reconhecida. Conferir no caixa.', 409);
  if (!paid[0].id) fail('Transação Cielo sem identificador.', 409);
  return { transactionId: String(paid[0].id), method: actualMethod };
}
export const newId = () => randomUUID();
