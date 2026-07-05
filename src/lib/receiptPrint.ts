import type { OrderItem } from '../types';

export type ReceiptPaymentMethod = 'credit' | 'debit' | 'cash' | 'pix';

export type ReceiptPayment = {
  method: ReceiptPaymentMethod;
  amount: number;
};

export type ReceiptData = {
  title: string;
  subtitle?: string;
  tableNumber?: number;
  sellerName?: string;
  customerDocument?: string;
  items: OrderItem[];
  subtotal: number;
  serviceFee?: number;
  serviceFeePercent?: number;
  discount?: number;
  couponCode?: string;
  couponAmount?: number;
  total: number;
  payments?: ReceiptPayment[];
  paidTotal?: number;
  remaining?: number;
  change?: number;
  printedAt?: Date;
};

export type ReceiptPaperWidth = 58 | 80;

export type ReceiptHtmlOptions = {
  paperWidth?: ReceiptPaperWidth;
  autoPrint?: boolean;
};

const paymentMethodLabels: Record<ReceiptPaymentMethod, string> = {
  credit: 'Credito',
  debit: 'Debito',
  pix: 'PIX',
  cash: 'Dinheiro',
};

const formatMoney = (value: number) => `R$ ${Number(value || 0).toLocaleString('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const formatDateTime = (date: Date) => date.toLocaleString('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const itemUnitTotal = (item: OrderItem) => (
  Number(item.price || 0) + (item.selectedModifiers || []).reduce((sum, modifier) => sum + Number(modifier.price || 0), 0)
);

export const buildReceiptHtml = (data: ReceiptData, options: ReceiptHtmlOptions = {}) => {
  const paperWidth = options.paperWidth || 58;
  const pageMargin = paperWidth === 58 ? 2 : 3;
  const bodyWidth = paperWidth === 58 ? 52 : 74;
  const textSize = paperWidth === 58 ? 9 : 11;
  const lineHeight = paperWidth === 58 ? 1.2 : 1.25;
  const brandSize = paperWidth === 58 ? 13 : 16;
  const companySize = paperWidth === 58 ? 7 : 9;
  const subtitleSize = paperWidth === 58 ? 8 : 10;
  const mutedSize = paperWidth === 58 ? 8 : 10;
  const itemNameWidth = paperWidth === 58 ? 34 : 48;
  const itemValueWidth = paperWidth === 58 ? 15 : 22;
  const itemSize = paperWidth === 58 ? 9 : 11;
  const metaSize = paperWidth === 58 ? 7 : 9;
  const sectionSize = paperWidth === 58 ? 8 : 10;
  const strongSize = paperWidth === 58 ? 10 : 12;
  const totalSize = paperWidth === 58 ? 12 : 15;
  const autoPrintScript = options.autoPrint ? `
  <script>
    window.addEventListener('load', () => {
      window.focus();
      setTimeout(() => window.print(), 150);
    });
  </script>` : '';
  const printedAt = data.printedAt || new Date();
  const payments = data.payments || [];
  const hasPayments = payments.length > 0;
  const title = escapeHtml(data.title);
  const subtitle = data.subtitle ? escapeHtml(data.subtitle) : (hasPayments ? 'CONTA COM PAGAMENTOS' : 'CONTA ABERTA');

  const itemsHtml = data.items.map((item) => {
    const unitTotal = itemUnitTotal(item);
    const total = unitTotal * Number(item.quantity || 0);
    const modifiers = (item.selectedModifiers || []).map((modifier) => (
      `<div class="modifier">+ ${escapeHtml(modifier.name)} ${Number(modifier.price || 0) > 0 ? escapeHtml(formatMoney(modifier.price)) : ''}</div>`
    )).join('');
    const notes = item.notes ? `<div class="note">Obs: ${escapeHtml(item.notes)}</div>` : '';

    return `
      <div class="item">
        <div class="item-main">
          <span>${escapeHtml(item.quantity)}x ${escapeHtml(item.name)}</span>
          <strong>${escapeHtml(formatMoney(total))}</strong>
        </div>
        <div class="item-meta">Unit. ${escapeHtml(formatMoney(unitTotal))}</div>
        ${modifiers}
        ${notes}
      </div>
    `;
  }).join('');

  const paymentsHtml = hasPayments ? `
    <div class="section-title">Meios de pagamento</div>
    ${payments.map((payment) => `
      <div class="line">
        <span>${escapeHtml(paymentMethodLabels[payment.method] || payment.method)}</span>
        <strong>${escapeHtml(formatMoney(payment.amount))}</strong>
      </div>
    `).join('')}
    <div class="line strong">
      <span>Total pago</span>
      <strong>${escapeHtml(formatMoney(data.paidTotal || 0))}</strong>
    </div>
    <div class="line">
      <span>Restante</span>
      <strong>${escapeHtml(formatMoney(data.remaining || 0))}</strong>
    </div>
    <div class="line">
      <span>Troco</span>
      <strong>${escapeHtml(formatMoney(data.change || 0))}</strong>
    </div>
  ` : `
    <div class="open-warning">Conta aberta. Pagamento ainda nao lancado.</div>
  `;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { size: ${paperWidth}mm auto; margin: ${pageMargin}mm; }
    * { box-sizing: border-box; }
    body {
      width: ${bodyWidth}mm;
      margin: 0 auto;
      background: #fff;
      color: #000;
      font-family: "Arial", "Helvetica", sans-serif;
      font-size: ${textSize}px;
      line-height: ${lineHeight};
    }
    .receipt { width: 100%; padding: 1.5mm 0; overflow: hidden; }
    .center { text-align: center; }
    .brand { font-size: ${brandSize}px; font-weight: 900; letter-spacing: 0.03em; }
    .company { margin-top: 2px; font-size: ${companySize}px; font-weight: 700; line-height: 1.15; }
    .subtitle { margin-top: 2px; font-size: ${subtitleSize}px; font-weight: 900; letter-spacing: 0.10em; }
    .muted { color: #333; font-size: ${mutedSize}px; }
    .rule { border-top: 1px dashed #000; margin: 5px 0; }
    .line, .item-main {
      display: flex;
      justify-content: space-between;
      gap: 4px;
      align-items: flex-start;
    }
    .line span, .item-main span {
      max-width: ${itemNameWidth}mm;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .line strong, .item-main strong {
      flex: 0 0 auto;
      max-width: ${itemValueWidth}mm;
      white-space: normal;
      text-align: right;
      overflow-wrap: anywhere;
    }
    .document-line {
      display: block;
    }
    .document-line span,
    .document-line strong {
      display: block;
      max-width: 100%;
      text-align: left;
    }
    .document-line strong {
      max-width: none;
      margin-top: 1px;
      font-size: ${paperWidth === 58 ? 8 : 10}px;
      white-space: nowrap;
      overflow-wrap: normal;
    }
    .item { padding: 4px 0; border-bottom: 1px dotted #999; }
    .item-main { font-size: ${itemSize}px; font-weight: 800; }
    .item-meta, .modifier, .note { margin-top: 1px; color: #333; font-size: ${metaSize}px; }
    .note { font-style: italic; }
    .section-title { margin: 6px 0 3px; font-size: ${sectionSize}px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.10em; }
    .strong { font-size: ${strongSize}px; font-weight: 900; }
    .total { font-size: ${totalSize}px; font-weight: 900; }
    .open-warning {
      margin-top: 6px;
      padding: 4px;
      border: 1px solid #000;
      text-align: center;
      font-size: ${sectionSize}px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .footer { margin-top: 8px; text-align: center; font-size: ${metaSize}px; color: #333; }
    @media print {
      html, body { width: ${paperWidth}mm; }
      body { margin: 0; }
    }
  </style>
</head>
<body>
  <main class="receipt">
    <div class="center">
      <div class="brand">BECOARTES</div>
      <div class="company">
        Becoartes<br />
        35118706000137<br />
        Gonçalo Afonso 99 Jd das Bandeiras 05436100
      </div>
      <div class="subtitle">${subtitle}</div>
      <div class="muted">${escapeHtml(formatDateTime(printedAt))}</div>
    </div>
    <div class="rule"></div>
    ${data.tableNumber ? `<div class="line strong"><span>Mesa</span><strong>${escapeHtml(data.tableNumber)}</strong></div>` : ''}
    ${data.sellerName ? `<div class="line"><span>Vendedor</span><strong>${escapeHtml(data.sellerName)}</strong></div>` : ''}
    ${data.customerDocument ? `<div class="line document-line"><span>CPF/CNPJ</span><strong>${escapeHtml(data.customerDocument)}</strong></div>` : ''}
    <div class="rule"></div>
    <div class="section-title">Itens</div>
    ${itemsHtml || '<div class="muted">Sem itens.</div>'}
    <div class="rule"></div>
    <div class="line"><span>Subtotal</span><strong>${escapeHtml(formatMoney(data.subtotal))}</strong></div>
    <div class="line"><span>Taxa servico${data.serviceFeePercent !== undefined ? ` ${escapeHtml(data.serviceFeePercent)}%` : ''}</span><strong>${escapeHtml(formatMoney(data.serviceFee || 0))}</strong></div>
    ${(data.discount || 0) > 0 ? `<div class="line"><span>Desconto</span><strong>- ${escapeHtml(formatMoney(data.discount || 0))}</strong></div>` : ''}
    ${(data.couponAmount || 0) > 0 || data.couponCode ? `<div class="line"><span>Cupom ${escapeHtml(data.couponCode || '')}</span><strong>- ${escapeHtml(formatMoney(data.couponAmount || 0))}</strong></div>` : ''}
    <div class="line total"><span>Total</span><strong>${escapeHtml(formatMoney(data.total))}</strong></div>
    <div class="rule"></div>
    ${paymentsHtml}
    <div class="footer">
      Obrigado pela visita.<br />
      Documento sem valor fiscal.
    </div>
  </main>
  ${autoPrintScript}
</body>
</html>`;
};

export function printThermalReceipt(data: ReceiptData, paperWidth: ReceiptPaperWidth = 58) {
  const popup = window.open('', '_blank', 'width=320,height=720');
  if (!popup) {
    throw new Error('Pop-up bloqueado. Libere pop-ups para imprimir a conta.');
  }
  popup.document.open();
  popup.document.write(buildReceiptHtml(data, { paperWidth, autoPrint: true }));
  popup.document.close();
}
