import { fail, verifyCieloOrder } from './domain.mjs';

export function createCieloClient(env = process.env, fetcher = fetch) {
  const ready = () => Boolean(env.LIO_CIELO_CLIENT_ID && env.LIO_CIELO_ACCESS_TOKEN && env.LIO_CIELO_MERCHANT_ID);
  const base = env.LIO_CIELO_ENV === 'production'
    ? 'https://api.cielo.com.br/order-management/v1/orders'
    : 'https://api.cielo.com.br/sandbox-lio/order-management/v1/orders';
  const get = async (suffix) => {
    if (!ready()) fail('Integração Cielo ainda não configurada no servidor.', 503);
    const response = await fetcher(base + suffix, { headers: {
      'client-id': env.LIO_CIELO_CLIENT_ID, 'access-token': env.LIO_CIELO_ACCESS_TOKEN,
      'merchant-id': env.LIO_CIELO_MERCHANT_ID, accept: 'application/json',
    }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) fail('Não foi possível conferir a Cielo. Não repita a cobrança; tente consultar novamente.', 503);
    return response.json();
  };
  return {
    ready,
    request(intent) {
      if (!ready()) fail('Integração Cielo ainda não configurada no servidor.', 503);
      return { clientID: env.LIO_CIELO_CLIENT_ID, accessToken: env.LIO_CIELO_ACCESS_TOKEN,
        reference: intent.id, value: String(intent.amount), installments: 0,
        paymentCode: ({ credit: 'CREDITO_AVISTA', debit: 'DEBITO_AVISTA', pix: 'PIX' })[intent.method],
        items: [{ sku: intent.id, name: 'Conta Becoartes', quantity: 1, unitPrice: intent.amount, unitOfMeasure: 'unidade' }] };
    },
    async verify(intent, terminal, orderId) {
      let order;
      if (orderId) order = await get('/' + encodeURIComponent(orderId));
      else {
        const found = await get('?reference=' + encodeURIComponent(intent.id));
        const orders = Array.isArray(found) ? found : found.content || found.orders || [];
        order = orders.find(o => o.reference === intent.id);
        if (!order) fail('Pagamento ainda não localizado. Não repita a cobrança; consulte novamente.', 409);
        order = await get('/' + encodeURIComponent(order.id));
      }
      return { ...verifyCieloOrder(order, intent, terminal), orderId: String(order.id) };
    },
  };
}
