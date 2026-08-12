type OrderLocationInput = {
  tableNumber?: number | null;
  sourceTableNumber?: number | null;
  customerTabId?: string | null;
  customerTabNumber?: number | null;
};

type CustomerTabContext = {
  customerTabId: string;
  sourceTableId: string;
  sourceTableNumber: number;
};

type QrModeTable = {
  id?: string;
  number: number;
  status: string;
  qrFlowOverride?: 'mesa_until_close' | null;
  customerTab?: unknown;
  orders?: unknown[];
  payments?: Array<{ status?: string }>;
};

export const preserveCurrentQrTable = <T extends QrModeTable>(
  snapshotTables: T[],
  currentTables: T[],
  currentTableId: string | null,
  currentView: string,
) => {
  if (currentView !== 'qr' || !currentTableId) return snapshotTables;
  const current = currentTables.find((table) => table.id === currentTableId);
  if (!current) return snapshotTables;
  const index = snapshotTables.findIndex((table) => table.id === currentTableId);
  if (index < 0) return [...snapshotTables, current];
  return snapshotTables.map((table, tableIndex) => tableIndex === index ? current : table);
};

export const isTableVisibleForQrMode = (table: QrModeTable, isComandaMode: boolean) => (
  isComandaMode ? table.number > 50 || table.qrFlowOverride === 'mesa_until_close' : table.number <= 50
);

export const getPhysicalTablesPendingTransition = (tables: QrModeTable[]) => tables
  .filter((table) => table.number >= 1 && table.number <= 50 && !table.customerTab)
  .filter((table) => (
    ['ordering', 'waiting', 'paid', 'bill_requested'].includes(table.status)
    || (table.orders || []).length > 0
    || (table.payments || []).some((payment) => payment.status === 'active')
  ))
  .map((table) => table.number)
  .sort((a, b) => a - b);

const SERVICE_REQUEST_LABELS: Record<string, string> = {
  waiter: 'Chamar Garçom',
  bill: 'Fechar a Conta',
  napkin: 'Precisa de Guardanapos',
  cutlery: 'Precisa de Talheres',
  glass: 'Copo Extra',
  ice: 'Pedir Gelo',
  lemon: 'Pedir Limão',
  physical_menu: 'Cardápio Físico',
  help: 'Ajuda com Pedido',
  problem: 'Problema com Pedido',
  other: 'Solicitação Diversa',
};

export const getServiceRequestLabel = (type: string) => SERVICE_REQUEST_LABELS[type] || type;

export const getCustomerTabLocationContext = (tableNumber: number, context?: CustomerTabContext) => {
  const sourceTableNumber = context?.sourceTableNumber || null;
  const customerTabNumber = context ? tableNumber : null;
  return {
    fields: {
      sourceTableId: context?.sourceTableId || null,
      sourceTableNumber,
      customerTabId: context?.customerTabId || null,
      customerTabNumber,
    },
    sourceTableNumber,
    customerTabNumber,
    publicTableNumber: sourceTableNumber || tableNumber,
    label: sourceTableNumber ? `Mesa ${sourceTableNumber} • Comanda ${tableNumber}` : `Mesa ${tableNumber}`,
  };
};

export const getOrderLocation = (order: OrderLocationInput) => {
  const sourceTableNumber = Number(order.sourceTableNumber || 0);
  const accountNumber = Number(order.customerTabNumber || order.tableNumber || 0);
  const isCustomerTab = Boolean(order.customerTabId || order.customerTabNumber);

  if (isCustomerTab && sourceTableNumber > 0) {
    return {
      primary: `Mesa ${sourceTableNumber}`,
      secondary: accountNumber > 0 ? `Comanda ${accountNumber}` : 'Comanda',
      compact: accountNumber > 0
        ? `Mesa ${sourceTableNumber} • Comanda ${accountNumber}`
        : `Mesa ${sourceTableNumber} • Comanda`,
    };
  }

  if (isCustomerTab) {
    const label = accountNumber > 0 ? `Comanda ${accountNumber}` : 'Comanda sem mesa';
    return { primary: label, secondary: 'Sem mesa física', compact: `${label} • Sem mesa` };
  }

  const tableNumber = Number(order.tableNumber || 0);
  const label = tableNumber > 0 ? `Mesa ${tableNumber}` : 'Mesa';
  return { primary: label, secondary: '', compact: label };
};
