import { isZuriWhatsAppConfigured, sendZuriWhatsAppMessage } from './zuri-whatsapp.mjs';

export const createNotificationServices = ({
  db,
  createId,
  normalizeText,
  generateNumericCode,
  hashDeliveryCustomerCode,
  providers,
  webhooks,
  webhookSecret = '',
  zuriWhatsApp = {},
}) => {
  const recordDeliveryNotification = async ({ orderId = null, customerId = null, channel, type, provider, status, destination = '', payload = {}, error = null }) => {
    await db.execute({
      sql: 'INSERT INTO delivery_notifications (id, delivery_order_id, customer_id, channel, type, provider, status, destination, payload, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [createId(), orderId, customerId, channel, type, provider, status, destination, JSON.stringify(payload), error],
    });
  };

  const sendDeliveryNotification = async ({ orderId = null, customer = {}, channel, type, message, payload = {}, sensitive = false }) => {
    const destination = channel === 'email' ? customer.email : customer.phone;
    const provider = providers[channel] || 'disabled';
    const notificationPayload = {
      orderId,
      customerId: customer.id || null,
      channel,
      type,
      destination,
      customer: {
        name: customer.name || '',
        email: customer.email || '',
        phone: customer.phone || '',
      },
      message,
      payload,
      createdAt: new Date().toISOString(),
    };
    const persistedPayload = sensitive
      ? { ...notificationPayload, message: '[REDACTED]', payload: {} }
      : notificationPayload;

    if (provider === 'zuri' && channel === 'whatsapp') {
      try {
        const result = await sendZuriWhatsAppMessage({
          ...zuriWhatsApp,
          phone: customer.phone,
          message,
        });
        await recordDeliveryNotification({
          orderId,
          customerId: customer.id || null,
          channel,
          type,
          provider,
          status: 'sent',
          destination,
          payload: { ...persistedPayload, messageId: result.messageId },
        });
        return { channel, provider, status: 'sent', messageId: result.messageId };
      } catch (error) {
        await recordDeliveryNotification({
          orderId,
          customerId: customer.id || null,
          channel,
          type,
          provider,
          status: 'failed',
          destination,
          payload: persistedPayload,
          error: error instanceof Error ? error.message : String(error),
        });
        return { channel, provider, status: 'failed' };
      }
    }

    if (provider === 'webhook') {
      const webhookUrl = webhooks[channel] || '';
      if (!webhookUrl) {
        await recordDeliveryNotification({
          orderId,
          customerId: customer.id || null,
          channel,
          type,
          provider,
          status: 'missing_webhook_url',
          destination,
          payload: persistedPayload,
          error: `Configure DELIVERY_${channel.toUpperCase()}_WEBHOOK_URL.`,
        });
        return { channel, provider, status: 'missing_webhook_url' };
      }
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(webhookSecret ? { 'x-beco-delivery-notification-secret': webhookSecret } : {}),
          },
          body: JSON.stringify(notificationPayload),
          signal: AbortSignal.timeout(5000),
        });
        const status = response.ok ? 'sent' : 'failed';
        await recordDeliveryNotification({
          orderId,
          customerId: customer.id || null,
          channel,
          type,
          provider,
          status,
          destination,
          payload: { ...persistedPayload, responseStatus: response.status },
          error: response.ok ? null : `Webhook retornou ${response.status}`,
        });
        return { channel, provider, status };
      } catch (error) {
        await recordDeliveryNotification({
          orderId,
          customerId: customer.id || null,
          channel,
          type,
          provider,
          status: 'failed',
          destination,
          payload: persistedPayload,
          error: error instanceof Error ? error.message : String(error),
        });
        return { channel, provider, status: 'failed' };
      }
    }

    const status = provider === 'disabled' ? 'disabled' : provider === 'mock' ? 'mock_logged' : 'ready_for_provider';
    await recordDeliveryNotification({
      orderId,
      customerId: customer.id || null,
      channel,
      type,
      provider,
      status,
      destination,
      payload: persistedPayload,
    });
    return { channel, provider, status };
  };

  const zuriReady = () => isZuriWhatsAppConfigured(zuriWhatsApp);
  const getDeliveryCustomerCodeChannel = (customer = {}) => [
    { channel: 'email', provider: providers.email, webhookUrl: webhooks.email, destination: normalizeText(customer.email) },
    { channel: 'sms', provider: providers.sms, webhookUrl: webhooks.sms, destination: normalizeText(customer.phone) },
    { channel: 'whatsapp', provider: providers.whatsapp, webhookUrl: webhooks.whatsapp, destination: normalizeText(customer.phone) },
  ].find((entry) => (
    entry.destination
    && ((entry.provider === 'webhook' && entry.webhookUrl) || (entry.channel === 'whatsapp' && entry.provider === 'zuri' && zuriReady()))
  )) || null;

  const assertDeliveryCustomerCodeChannel = (customer = {}) => {
    const channel = getDeliveryCustomerCodeChannel(customer);
    if (channel) return channel;
    const error = new Error('Canal de confirmacao temporariamente indisponivel.');
    error.statusCode = 503;
    throw error;
  };

  const sendDeliveryCustomerCode = async ({ customer, type }) => {
    const target = assertDeliveryCustomerCodeChannel(customer);
    const code = generateNumericCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const columnPrefix = type === 'reset_password' ? 'reset' : 'verification';
    await db.execute({
      sql: `UPDATE delivery_customers SET ${columnPrefix}_code_hash = ?, ${columnPrefix}_code_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [hashDeliveryCustomerCode(code), expiresAt, customer.id],
    });
    const notification = await sendDeliveryNotification({
      customer,
      channel: target.channel,
      type,
      message: `Seu codigo Becoartes e ${code}. Ele vale por 15 minutos.`,
      payload: { code },
      sensitive: true,
    });
    if (notification.status !== 'sent') {
      await db.execute({
        sql: `UPDATE delivery_customers SET ${columnPrefix}_code_hash = NULL, ${columnPrefix}_code_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [customer.id],
      });
      const error = new Error('Canal de confirmacao temporariamente indisponivel.');
      error.statusCode = 503;
      throw error;
    }
    return { expiresAt };
  };

  const sendCustomerTabRecoveryCode = async ({ tab, code }) => {
    const whatsappReady = (
      (providers.whatsapp === 'webhook' && Boolean(webhooks.whatsapp))
      || (providers.whatsapp === 'zuri' && zuriReady())
    );
    if (!whatsappReady) {
      const error = new Error('Recuperação por WhatsApp ainda não está disponível. Peça ajuda à equipe.');
      error.statusCode = 503;
      throw error;
    }
    const notification = await sendDeliveryNotification({
      customer: { id: tab.id, name: tab.customer_name || '', phone: tab.phone || '' },
      channel: 'whatsapp',
      type: 'customer_tab_recovery',
      message: `Seu código Becoartes é ${code}. Digite-o na tela para acessar sua comanda. Válido por 5 minutos. Não compartilhe.`,
      payload: { code },
      sensitive: true,
    });
    if (notification.status !== 'sent') {
      const error = new Error('Não conseguimos enviar o código agora. Tente novamente ou peça ajuda à equipe.');
      error.statusCode = 503;
      throw error;
    }
  };

  return {
    assertDeliveryCustomerCodeChannel,
    recordDeliveryNotification,
    sendCustomerTabRecoveryCode,
    sendDeliveryCustomerCode,
    sendDeliveryNotification,
  };
};
