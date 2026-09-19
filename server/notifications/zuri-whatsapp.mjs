import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

export const isZuriWhatsAppConfigured = ({ bridgeUrl = '' } = {}) => Boolean(String(bridgeUrl).trim());

export const sendZuriWhatsAppMessage = async ({
  bridgeUrl = '',
  bridgeSecret = '',
  bridgeHostHeader = '',
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

  const url = new URL(`${String(bridgeUrl).replace(/\/$/, '')}/send`);
  const body = JSON.stringify({
    chatId: `${normalizedPhone}@s.whatsapp.net`,
    message,
  });
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const { statusCode, result } = await new Promise((resolve, reject) => {
    const request = transport(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(bridgeSecret ? { 'x-beco-zuri-secret': bridgeSecret } : {}),
        ...(bridgeHostHeader ? { host: bridgeHostHeader } : {}),
      },
      timeout: 8000,
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(responseBody); } catch { parsed = {}; }
        resolve({ statusCode: Number(response.statusCode || 0), result: parsed });
      });
    });
    request.on('timeout', () => request.destroy(new Error('Tempo esgotado ao acessar a ponte da Zuri.')));
    request.on('error', reject);
    request.end(body);
  });

  if (statusCode < 200 || statusCode >= 300 || result.success !== true || !result.messageId) {
    const detail = result.error || `HTTP ${statusCode}`;
    throw new Error(`Zuri não confirmou o envio do WhatsApp: ${detail}`);
  }

  return {
    messageId: String(result.messageId),
    recipientChecked: Boolean(result.recipientChecked),
  };
};
