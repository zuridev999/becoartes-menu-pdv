const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

export const isZuriWhatsAppConfigured = ({ bridgeUrl = '' } = {}) => Boolean(String(bridgeUrl).trim());

export const sendZuriWhatsAppMessage = async ({
  bridgeUrl = '',
  bridgeSecret = '',
  phone = '',
  message = '',
}) => {
  if (!isZuriWhatsAppConfigured({ bridgeUrl })) {
    throw new Error('Ponte WhatsApp da Zuri não configurada.');
  }

  const normalizedPhone = digitsOnly(phone);
  if (normalizedPhone.length < 10) {
    throw new Error('Telefone inválido para envio pela Zuri.');
  }

  const response = await fetch(`${String(bridgeUrl).replace(/\/$/, '')}/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bridgeSecret ? { 'x-beco-zuri-secret': bridgeSecret } : {}),
    },
    body: JSON.stringify({
      chatId: `${normalizedPhone}@s.whatsapp.net`,
      message,
    }),
    signal: AbortSignal.timeout(8000),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true || !result.messageId) {
    const detail = result.error || `HTTP ${response.status}`;
    throw new Error(`Zuri não confirmou o envio do WhatsApp: ${detail}`);
  }

  return {
    messageId: String(result.messageId),
    recipientChecked: Boolean(result.recipientChecked),
  };
};
