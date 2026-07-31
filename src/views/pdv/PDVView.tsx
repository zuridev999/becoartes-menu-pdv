import { useEffect, useState, useRef, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  Plus, 
  Minus,
  X,
  PlusCircle,
  LayoutDashboard,
  LogOut,
  Settings, Soup, Bell, Check, Trash2, Wallet, Sparkles, Clock, AlertTriangle, ChevronRight, ExternalLink, LockKeyhole, ShoppingBag, Search, Printer, Sun, Moon
} from 'lucide-react';
import { useStore, type OrderItem, type Product, type Table as TableType } from '../../store';
import type { CustomerTab } from '../../types';
import { CheckoutModal } from '../../components/modals/CheckoutModal';
import { CounterSaleModal } from '../../components/modals/CounterSaleModal';
import { ActionDialog } from '../../components/common/ActionDialog';
import { OrderItemDetails } from '../../components/common/OrderItemDetails';
import { ReceiptPrintModal } from '../../components/common/ReceiptPrintModal';
import { ProductModal } from '../../components/modals/ProductModal';
import { PdvTicker } from '../../components/pdv/PdvTicker';
import { can, getPermissionLabel } from '../../lib/permissions';
import { getOrderItemTotal, getOrderItemsTotal } from '../../lib/totals';
import { AdminApi, AppApi, CustomerTabApi, type PdvLockState } from '../../lib/api';
import type { ReceiptData } from '../../lib/receiptPrint';
import { businessDateKey, businessWeekday } from '../../lib/business-time';

const CANCEL_REASONS = [
  { code: 'cliente_desistiu', label: 'Cliente desistiu' },
  { code: 'pedido_por_engano', label: 'Pedido por engano' },
  { code: 'produto_indisponivel', label: 'Produto indisponível' },
  { code: 'erro_preparo', label: 'Erro de preparo' },
  { code: 'correcao_administrativa', label: 'Correção administrativa' },
  { code: 'outro', label: 'Outro motivo' },
];

const DAILY_GOALS_BY_WEEKDAY: Record<number, number> = {
  0: 6000,
  1: 3000,
  2: 2000,
  3: 2000,
  4: 2800,
  5: 4000,
  6: 7500,
};

const DAILY_GOAL_EXCEPTIONS: Record<string, number> = {
  '2026-06-24': 3000,
  '2026-07-09': 7000,
};

const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatMoneyInput = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const amount = Number(digits) / 100;
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

function getLocalDateKey(date = new Date()) {
  return businessDateKey(date);
}

function getSaoPauloWeekday(date = new Date()) {
  return businessWeekday(getLocalDateKey(date));
}

function isSameSaoPauloDate(date: Date | string | null | undefined, dateKey = getLocalDateKey()) {
  if (!date) return false;
  const parsedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return false;
  return getLocalDateKey(parsedDate) === dateKey;
}

function getDailyGoal(date = new Date()) {
  const dateKey = getLocalDateKey(date);
  return DAILY_GOAL_EXCEPTIONS[dateKey] ?? DAILY_GOALS_BY_WEEKDAY[getSaoPauloWeekday(date)] ?? 0;
}

function getGoalMessage(percent: number) {
  if (percent >= 100) return 'Parabéns, alcançamos a meta diária!';
  if (percent >= 80) return 'Já foram 80%, falta pouco, acreditem!';
  if (percent >= 50) return 'Já passamos da metade, vamos focar.';
  return 'Foco nas vendas, pessoal.';
}

const GOAL_TICKER_MESSAGE = 'Foco nas vendas. Aumentar o som para que se escute da rua e não sejamos engolidos por sons de outros lugares. Manter playlist Becoartes que é estudada há 6 anos para atrair nosso público alvo. Aqui não é lugar de fofoca. Nós ganhamos por hora, então faça sua hora valer.';

function PdvGoalTicker({ totalToday }: { totalToday: number }) {
  const goal = getDailyGoal();
  if (goal <= 0) return null;

  const percent = Math.min(999, (totalToday / goal) * 100);
  const message = getGoalMessage(percent);
  const durationSeconds = Math.round(Math.min(96, Math.max(44, GOAL_TICKER_MESSAGE.length / 2.2)) * 0.8);
  const tickerStyle = {
    '--pdv-ticker-duration': `${durationSeconds}s`,
  } as CSSProperties;

  return (
    <section className="solid-panel mb-3 -mt-1 overflow-hidden rounded-xl border border-emerald-200/25 bg-gradient-to-r from-emerald-950 via-emerald-800 to-emerald-950 px-4 py-2">
      <div className="pdv-ticker-track flex w-max items-center gap-10 whitespace-nowrap" style={tickerStyle}>
        {[0, 1, 2].map((item) => (
          <span key={item} className="inline-flex items-center gap-10 text-xs sm:text-sm font-black uppercase tracking-[0.14em] text-yellow-200 drop-shadow">
            {message} {GOAL_TICKER_MESSAGE}
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-300 shadow-lg shadow-yellow-300/40" />
          </span>
        ))}
      </div>
    </section>
  );
}

// Toggle claro/escuro do PDV — persiste em localStorage, aplica classe no <html>.
function useThemeToggle() {
  const [isLight, setIsLight] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('light')
  );
  const toggleTheme = () => {
    const next = !isLight;
    document.documentElement.classList.toggle('light', next);
    try { localStorage.setItem('pdv-theme', next ? 'light' : 'dark'); } catch { /* noop */ }
    setIsLight(next);
  };
  return { isLight, toggleTheme };
}

function ThemeToggleButton() {
  const { isLight, toggleTheme } = useThemeToggle();
  return (
    <button
      type="button"
      aria-label={isLight ? 'Mudar para tema escuro' : 'Mudar para tema claro'}
      onClick={toggleTheme}
      className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400 transition-colors hover:border-accent/50 hover:text-accent"
      title={isLight ? 'Mudar para tema escuro' : 'Mudar para tema claro'}
    >
      {isLight ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}

function setSettingsFromQrModeResult(settingsResult: unknown, fallbackMode: 'mesa' | 'comanda') {
  const currentSettings = useStore.getState().settings;
  const nextSettings = settingsResult && typeof settingsResult === 'object'
    ? { ...currentSettings, ...(settingsResult as Record<string, unknown>) }
    : { ...currentSettings, qrMode: fallbackMode };
  useStore.setState({ settings: nextSettings });
}

export function PDVView() {
  const { 
    tables, 
    menu, 
    categories, 
    closedBills, 
    currentSeller, 
    logout,
    addAuditLog,
    addToCart,
    removeOrderItem,
    removeFromCart,
    updateCartItemQuantity,
    setCurrentTableId,
    sendToKitchen,
    serviceRequests,
    resolveService,
    clearServiceRequest,
    login,
    syncData,
    updateTableStatus,
    cashState,
    settings,
    openCash,
    closeCash,
    addNotification
  } = useStore();
  const kitchenOrders = useStore((state) => state.kitchenOrders);

  const [pin, setPin] = useState('');
  const [isSendingOrder, setIsSendingOrder] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showProductMenu, setShowProductMenu] = useState(false);
  const [showCounterSale, setShowCounterSale] = useState(false);
  const [showSalesBreakdown, setShowSalesBreakdown] = useState(false);
  const [showManualLog, setShowManualLog] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(categories[0]?.id || null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [logAction, setLogAction] = useState('');
  const [logDetails, setLogDetails] = useState('');
  const [logTable, setLogTable] = useState('');
  const [cancelItemDialog, setCancelItemDialog] = useState<{ item: OrderItem; tableId: string; tableNumber: number } | null>(null);
  const [cancelReasonCode, setCancelReasonCode] = useState('');
  const [cancelReasonNotes, setCancelReasonNotes] = useState('');
  
  const [selectedRequestForDetails, setSelectedRequestForDetails] = useState<any>(null);
  const [isPanicDismissed, setIsPanicDismissed] = useState(false);
  const [hasPanicAlert, setHasPanicAlert] = useState(false);
  const [cashDialog, setCashDialog] = useState<'open' | 'close' | null>(null);
  const [cashValue, setCashValue] = useState('');
  const [cashNotes, setCashNotes] = useState('');
  const [cashConfirmationPin, setCashConfirmationPin] = useState('');
  const [cashError, setCashError] = useState('');
  const [isCashSubmitting, setIsCashSubmitting] = useState(false);
  const [isEmbedded, setIsEmbedded] = useState(false);
  const [pdvLockState, setPdvLockState] = useState<PdvLockState | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<ReceiptData | null>(null);
  const [isSwitchingQrMode, setIsSwitchingQrMode] = useState(false);
  const [showQrModePinDialog, setShowQrModePinDialog] = useState(false);
  const [customerTabSearch, setCustomerTabSearch] = useState('');
  const [customerTabResults, setCustomerTabResults] = useState<CustomerTab[]>([]);
  const [isCustomerTabSearching, setIsCustomerTabSearching] = useState(false);
  const [isFinalizingCustomerTab, setIsFinalizingCustomerTab] = useState<string | null>(null);

  // Filtra solicitações das últimas 2 horas para manter a tela limpa
  const now = new Date();
  const visibleRequests = serviceRequests.filter(req => {
    const createdAt = req.createdAt instanceof Date ? req.createdAt : new Date(req.createdAt);
    const diffHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    return diffHours < 2;
  });
  const permissionOverrides = settings.pdvPermissions;
  const userPermissionOverrides = settings.pdvUserPermissions;
  const canClearResolvedRequests = can(currentSeller, 'manageSettings', permissionOverrides, userPermissionOverrides);

  // Referência para o container de scroll da lista de solicitações
  const listRef = useRef<HTMLDivElement>(null);
  const prevRequestsLength = useRef(visibleRequests.length);

  useEffect(() => {
    setIsEmbedded(window.self !== window.top);
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('openCash') === '1') {
      setCashDialog('open');
    }
    if (searchParams.get('closeCash') === '1') {
      setCashDialog('close');
    }
  }, []);

  // Auto-scroll para o topo quando uma nova solicitação chega
  useEffect(() => {
    if (visibleRequests.length > prevRequestsLength.current) {
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevRequestsLength.current = visibleRequests.length;
  }, [visibleRequests.length]);

  // Verificação de Modo Pânico (5 minutos) - considerando apenas as visíveis
  useEffect(() => {
    const checkPanic = () => {
      const nowCheck = new Date();
      const hasOldAlert = visibleRequests.some(req => {
        if (req.status === 'resolved') return false;
        const createdAt = req.createdAt instanceof Date ? req.createdAt : new Date(req.createdAt);
        const diffMinutes = (nowCheck.getTime() - createdAt.getTime()) / (1000 * 60);
        return diffMinutes >= 5;
      });

      if (hasOldAlert) {
        if (!isPanicDismissed) setHasPanicAlert(true);
      } else {
        setHasPanicAlert(false);
        setIsPanicDismissed(false);
      }
    };

    const interval = setInterval(checkPanic, 5000);
    return () => clearInterval(interval);
  }, [visibleRequests, isPanicDismissed]);

  // Se o número de solicitações visíveis mudar, reseta o dismiss
  useEffect(() => {
    setIsPanicDismissed(false);
  }, [visibleRequests.length]);

  // Auto-sync para o PDV em tempo real
  useEffect(() => {
    let isSyncing = false;

    const runSync = async (reason: string) => {
      if (isSyncing) return;
      isSyncing = true;
      try {
        console.log(`PDV syncing: ${reason}`);
        await syncData();
      } catch (error) {
        console.warn('Falha ao sincronizar PDV:', error);
      } finally {
        isSyncing = false;
      }
    };

    const interval = setInterval(() => {
      runSync('interval');
    }, 5000);

    const handleResume = () => {
      if (!document.hidden) runSync('resume');
    };

    window.addEventListener('focus', handleResume);
    window.addEventListener('online', handleResume);
    document.addEventListener('visibilitychange', handleResume);
    runSync('mount');

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('online', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, [syncData]);

  useEffect(() => {
    if (!categories.length) return;
    if (!activeCategory || !categories.some(category => category.id === activeCategory)) {
      setActiveCategory(categories[0].id);
    }
  }, [categories, activeCategory]);

  useEffect(() => {
    if (!currentSeller) {
      setPdvLockState(null);
      return;
    }

    let cancelled = false;

    async function loadLockState() {
      try {
        const state = await AppApi.getPdvLockState();
        if (!cancelled) setPdvLockState(state);
      } catch (error) {
        console.warn('Falha ao consultar bloqueio do PDV:', error);
      }
    }

    loadLockState();
    const timer = window.setInterval(loadLockState, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentSeller]);

  useEffect(() => {
    if (cashDialog !== 'open' || !cashState?.hasPreviousClosing) return;
    const cents = Math.round(Number(cashState.lastClosingBalance || 0) * 100);
    setCashValue(formatMoneyInput(String(cents)));
  }, [cashDialog, cashState?.hasPreviousClosing, cashState?.lastClosingBalance]);

  const handleLogin = async () => {
    if (pin.length !== 4) {
      setLoginError('Digite os 4 dígitos do seu PIN.');
      return;
    }
    const success = await login(pin);
    if (!success) {
      setLoginError('PIN incorreto ou sem acesso neste terminal.');
      setPin('');
      setTimeout(() => setLoginError(''), 3000);
    }
  };

  if (!currentSeller) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center font-['Outfit'] p-4 sm:p-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card w-full max-w-md p-6 sm:p-12 border-white/10 shadow-2xl flex flex-col items-center"
        >
          <div className="w-20 h-20 bg-primary/10 rounded-[2rem] flex items-center justify-center text-primary mb-8">
            <Users size={40} />
          </div>
          <h2 className="text-3xl font-black italic tracking-tighter mb-2">IDENTIFICAÇÃO <span className="text-primary">PDV</span></h2>
          <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-12 text-center leading-relaxed">Insira seu PIN de acesso para entrar no terminal operacional</p>

          <div className="w-full space-y-6">
            <div className="relative">
              <input 
                type="password"
                name="pin"
                aria-label="PIN de acesso do PDV"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                  if (loginError) setLoginError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className={`w-full glass py-8 px-6 rounded-3xl text-4xl text-center font-black tracking-[0.5em] outline-none border-2 transition-all ${loginError ? 'border-rose-500 animate-shake text-rose-500' : 'border-white/10 focus:border-primary'}`}
                placeholder="****"
                maxLength={4}
                autoFocus
              />
              {loginError && <p role="alert" className="mt-4 text-center text-[10px] font-black uppercase text-rose-500">{loginError}</p>}
            </div>

            <button 
              type="button"
              onClick={handleLogin}
              className="w-full btn-beco btn-beco-purple py-6 text-xl font-black rounded-2xl shadow-2xl shadow-primary/20"
            >
              ENTRAR
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Derived state
  const currentTable = tables.find(t => t.id === selectedTable?.id);
  const managedTable = currentTable || selectedTable;
  const cart = currentTable?.cart || [];

  const handlePrintOpenTableReceipt = (table: TableType) => {
    const subtotal = getOrderItemsTotal(table.orders || []);
    setReceiptPreview({
      title: `Mesa ${table.number}`,
      subtitle: 'CONTA ABERTA',
      tableNumber: table.number,
      sellerName: currentSeller?.name,
      items: table.orders || [],
      subtotal,
      serviceFee: 0,
      total: subtotal,
    });
  };

  // Stats
  const todayKey = getLocalDateKey();
  const todayBills = closedBills
    .filter(bill => isSameSaoPauloDate(bill.closedAt, todayKey));
  const totalToday = todayBills
    .reduce((acc, bill) => acc + Number(bill.subtotal || 0), 0);
  const salesBreakdown = todayBills.reduce((acc, bill) => {
    const billSubtotal = Number(bill.subtotal || 0);
    const billTotal = Number(bill.total || 0);
    const paymentTotal = (bill.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const productRatio = paymentTotal > 0 ? billSubtotal / paymentTotal : billTotal > 0 ? billSubtotal / billTotal : 0;

    (bill.payments || []).forEach((payment) => {
      if (!acc[payment.method]) acc[payment.method] = { total: 0, count: 0 };
      acc[payment.method].total += Number(payment.amount || 0) * productRatio;
      acc[payment.method].count += 1;
    });
    return acc;
  }, {
    credit: { total: 0, count: 0 },
    debit: { total: 0, count: 0 },
    cash: { total: 0, count: 0 },
    pix: { total: 0, count: 0 },
  } as Record<'credit' | 'debit' | 'cash' | 'pix', { total: number; count: number }>);
  const totalTodayByPayments = Object.values(salesBreakdown).reduce((sum, item) => sum + item.total, 0);
  const salesBreakdownItems = [
    { method: 'credit' as const, label: 'Crédito', tone: 'text-violet-300', bg: 'bg-violet-500/10', border: 'border-violet-400/20' },
    { method: 'debit' as const, label: 'Débito', tone: 'text-sky-300', bg: 'bg-sky-500/10', border: 'border-sky-400/20' },
    { method: 'cash' as const, label: 'Dinheiro', tone: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-400/20' },
    { method: 'pix' as const, label: 'Pix', tone: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-400/20' },
  ];
  const isCashOpen = Boolean(cashState?.isOpen);
  const isCashOverdue = Boolean(cashState?.requiresClosing);
  const canViewSalesTotals = can(currentSeller, 'viewSalesTotals', permissionOverrides, userPermissionOverrides);
  const canCancelTableItem = can(currentSeller, 'cancelTableItem', permissionOverrides, userPermissionOverrides);
  const canCloseBill = can(currentSeller, 'closeBill', permissionOverrides, userPermissionOverrides);
  const canLaunchPayment = can(currentSeller, 'launchPayment', permissionOverrides, userPermissionOverrides);
  const canOpenCash = can(currentSeller, 'openCash', permissionOverrides, userPermissionOverrides);
  const canCloseCash = can(currentSeller, 'closeCash', permissionOverrides, userPermissionOverrides);
  const canUseCashAction = isCashOpen ? canCloseCash : canOpenCash;
  const canOpenTable = can(currentSeller, 'openTable', permissionOverrides, userPermissionOverrides);
  const canUpdateTableStatus = can(currentSeller, 'updateTableStatus', permissionOverrides, userPermissionOverrides);
  const canViewOtherOperatorTables = can(currentSeller, 'viewOtherOperatorTables', permissionOverrides, userPermissionOverrides);
  const canAddOrderItem = can(currentSeller, 'addOrderItem', permissionOverrides, userPermissionOverrides);
  const canSendOrderToProduction = can(currentSeller, 'sendOrderToProduction', permissionOverrides, userPermissionOverrides);
  const canSellUnavailableProduct = can(currentSeller, 'sellUnavailableProduct', permissionOverrides, userPermissionOverrides);
  const canAddItems = canAddOrderItem && canSendOrderToProduction;
  const canResolveServiceRequests = can(currentSeller, 'resolveServiceRequest', permissionOverrides, userPermissionOverrides);
  const currentSellerPermission = currentSeller?.permission === 'admin'
    ? 'admin'
    : currentSeller?.permission === 'manager' || currentSeller?.permission === 'standard'
      ? 'manager'
      : 'operator';
  const canSwitchQrModeDirectly = currentSellerPermission === 'admin' || currentSellerPermission === 'manager';
  const canUseQrModeSwitch = Boolean(currentSeller);
  const canInspectCustomerTabs = canViewSalesTotals;
  const isAdminProfile = currentSeller.permission === 'admin';
  const canPreviewTablesWithClosedCash = isAdminProfile;
  const isComandaMode = settings.qrMode === 'comanda';
  const cashActionLabel = isCashOpen ? 'Fechar caixa' : 'Abrir caixa';
  const canAccessTable = (table: TableType) => (
    canViewOtherOperatorTables || !table.currentSellerId || table.currentSellerId === currentSeller.id
  );
  const visibleTables = tables
    .filter(table => (isComandaMode ? table.number <= 200 : table.number <= 50))
    .filter(canAccessTable);
  const activeVisibleTables = visibleTables.filter(t => t.status === 'ordering' || t.status === 'bill_requested' || t.customerTab);
  const activeTablesCount = activeVisibleTables.length;
  const visibleTableNumbers = new Set(visibleTables.map(table => Number(table.number || 0)));
  const servedTablesToday = new Set<string>();
  todayBills.forEach((bill) => {
    const tableNumber = Number(bill.tableNumber || 0);
    if (tableNumber > 0 && visibleTableNumbers.has(tableNumber)) {
      servedTablesToday.add(`mesa:${tableNumber}`);
    }
  });
  activeVisibleTables.forEach((table) => {
    const tableNumber = Number(table.number || 0);
    if (tableNumber > 0) servedTablesToday.add(`mesa:${tableNumber}`);
  });
  const servedTablesTodayCount = servedTablesToday.size;
  const openTablesAmount = visibleTables.reduce((sum, table) => {
    const ordersTotal = getOrderItemsTotal(table.orders || []);
    const paymentsTotal = (table.payments || []).reduce((acc, payment) => acc + Number(payment.amount || 0), 0);
    const customerBalance = Number(table.customerTab?.totals?.balance ?? NaN);
    const balance = Number.isFinite(customerBalance)
      ? customerBalance
      : Math.max(0, ordersTotal - paymentsTotal);
    return sum + Math.max(0, balance);
  }, 0);

  const parseMoneyValue = (value: string) => {
    const digits = value.replace(/\D/g, '');
    return (Number(digits) || 0) / 100;
  };

  const submitQrModeSwitch = async (authorizationPin?: string) => {
    if (isSwitchingQrMode) return;
    setIsSwitchingQrMode(true);
    const nextMode = isComandaMode ? 'mesa' : 'comanda';
    try {
      const result = await AdminApi.setQrMode(nextMode, authorizationPin);
      setSettingsFromQrModeResult(result.settings, nextMode);
      addNotification(nextMode === 'comanda' ? 'Modo comanda ativado no QR.' : 'Modo mesa ativado no QR.', 'info');
      setShowQrModePinDialog(false);
      await syncData({ includeCatalog: false });
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Não foi possível alterar o modo do QR.', 'error');
      throw error;
    } finally {
      setIsSwitchingQrMode(false);
    }
  };

  const switchQrMode = async () => {
    if (!canUseQrModeSwitch || isSwitchingQrMode) return;
    if (!canSwitchQrModeDirectly) {
      setShowQrModePinDialog(true);
      return;
    }
    try {
      await submitQrModeSwitch();
    } catch {
      // A notificação já foi exibida em submitQrModeSwitch.
    }
  };

  const runCustomerTabSearch = async (query = customerTabSearch) => {
    if (!canInspectCustomerTabs) return;
    setIsCustomerTabSearching(true);
    try {
      const result = await CustomerTabApi.lookup(query);
      setCustomerTabResults(result.tabs);
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Falha ao buscar comandas.', 'error');
    } finally {
      setIsCustomerTabSearching(false);
    }
  };

  const finalizeCustomerTab = async (tab: CustomerTab) => {
    if (!canCloseBill) return;
    setIsFinalizingCustomerTab(tab.id);
    try {
      await CustomerTabApi.finalize(tab.id);
      addNotification(`Comanda ${tab.tableNumber} finalizada.`, 'info');
      await runCustomerTabSearch(customerTabSearch);
      await syncData({ includeCatalog: false });
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Falha ao finalizar comanda.', 'error');
    } finally {
      setIsFinalizingCustomerTab(null);
    }
  };

  const submitCashDialog = async () => {
    const value = parseMoneyValue(cashValue);
    setCashError('');
    if ((cashDialog === 'open' || cashDialog === 'close') && !/^\d{4}$/.test(cashConfirmationPin)) {
      setCashError('Digite o PIN de 4 dígitos de quem está fazendo esta ação no caixa.');
      return;
    }
    setIsCashSubmitting(true);
    try {
      if (cashDialog === 'open') await openCash(value, cashNotes, cashConfirmationPin);
      if (cashDialog === 'close') await closeCash(value, cashNotes, cashConfirmationPin);
      setCashDialog(null);
      setCashValue('');
      setCashNotes('');
      setCashConfirmationPin('');
      await syncData({ includeCatalog: false });
    } catch (error) {
      setCashError(error instanceof Error ? error.message : 'Falha ao processar caixa.');
    } finally {
      setIsCashSubmitting(false);
    }
  };

  const handleTableClick = (table: TableType) => {
    if (!canAccessTable(table)) {
      addNotification('Mesa vinculada a outro operador.', 'error');
      return;
    }
    setSelectedTable(table);
    setCurrentTableId(table.id);
    if (table.status === 'available') {
      setShowProductMenu(true);
      if (categories.length > 0) setActiveCategory(categories[0].id);
    }
  };

  const hasProductionInProgress = (table: TableType) => {
    return kitchenOrders.some(order => order.tableId === table.id && order.status !== 'ready');
  };

  const getStatusColor = (table: TableType) => {
    if (table.customerTab?.status === 'paid') return 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300';
    if (table.customerTab?.status === 'open') return 'bg-amber-500/20 border-amber-400/40 text-amber-300';
    switch (table.status) {
      case 'available': return 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500';
      case 'bill_requested': return 'bg-rose-600/20 border-rose-500/40 text-rose-400';
      case 'ordering': return hasProductionInProgress(table)
        ? 'bg-amber-500/20 border-amber-400/40 text-amber-300'
        : 'bg-purple-600/20 border-purple-500/30 text-purple-400';
      default: return 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500';
    }
  };

  const getModifierGroupsLabel = (product: Product) => {
    const groupCount = product.modifierGroups?.length || 0;
    if (groupCount === 0) return 'Sem opcionais';
    if (groupCount === 1) return '1 grupo de opcionais';
    return `${groupCount} grupos de opcionais`;
  };

  return (
    <div 
      className="h-[100dvh] min-h-screen bg-transparent text-white font-['Outfit'] p-4 sm:p-6 xl:p-8 relative overflow-x-hidden overflow-y-auto custom-scrollbar"
      onClick={() => {
        if (hasPanicAlert) {
          setHasPanicAlert(false);
          setIsPanicDismissed(true);
        }
      }}
    >
      {/* MODO PÂNICO OVERLAY */}
      <AnimatePresence>
        {pdvLockState?.locked && currentSeller.permission !== 'admin' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="solid-panel fixed inset-0 z-[1400] flex flex-col items-center justify-center bg-[#11090c] p-6 text-center sm:p-10"
          >
            <div className="mb-7 grid h-24 w-24 place-items-center rounded-full border-2 border-rose-500/40 bg-rose-500/10 shadow-[0_0_80px_rgba(244,63,94,0.22)]">
              <LockKeyhole size={48} className="text-rose-500" />
            </div>
            <h1 className="text-5xl sm:text-7xl xl:text-8xl font-black italic tracking-tighter text-rose-500">
              PDV BLOQUEADO
            </h1>
            <div className="mt-8 w-full max-w-3xl rounded-[2rem] border-2 border-rose-500/35 bg-white px-7 py-8 shadow-2xl sm:px-12 sm:py-10">
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.25em] text-zinc-500">Recado da gerência</p>
              <p className="whitespace-pre-wrap text-2xl font-black leading-tight text-rose-600 sm:text-4xl">
                {pdvLockState.message || 'Aguarde orientação da gerência.'}
              </p>
            </div>
          </motion.div>
        )}
        {hasPanicAlert && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="solid-panel fixed inset-0 z-[999] bg-rose-600/95 backdrop-blur-2xl flex flex-col items-center justify-center"
          >
            <div className="animate-pulse flex flex-col items-center text-center p-12">
               <AlertTriangle size={120} className="text-white mb-8 animate-bounce" />
               <h1 className="text-4xl sm:text-6xl xl:text-8xl font-black italic tracking-tighter text-white mb-4">ATENÇÃO CRÍTICA!</h1>
               <p className="text-base sm:text-xl xl:text-2xl font-black uppercase tracking-[0.16em] sm:tracking-[0.3em] text-white/80">EXISTEM SOLICITAÇÕES PENDENTES HÁ MAIS DE 5 MINUTOS</p>
               <p className="mt-12 text-sm font-bold bg-white text-rose-600 px-8 py-4 rounded-full uppercase tracking-widest shadow-2xl">Clique em qualquer lugar para silenciar</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER */}
      <PdvTicker enabled={settings.pdv?.tickerEnabled !== false} text={settings.pdv?.tickerText} />
      <PdvGoalTicker totalToday={totalToday} />
      {/* Barra de comando: status do caixa + operador + ações rápidas em UMA linha. */}
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3 py-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${isCashOpen ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isCashOpen ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-black leading-tight">
              PDV <span className="text-primary">Becoartes</span>
            </p>
            <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
              {isCashOpen ? 'Caixa aberto' : 'Caixa fechado'}
              {cashState?.sandbox && ' · sandbox'}
              {' · '}{currentSeller.nickname || currentSeller.name}
              {' · '}{getPermissionLabel(currentSeller)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Abrir gestão de cardápio"
            onClick={() => useStore.getState().setActiveView('admin', 'products', 'menu')}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400 transition-colors hover:border-emerald-400/40 hover:text-emerald-400"
            title="Gestão de Cardápio"
          >
            <Soup size={18} />
          </button>
          {isAdminProfile && canViewSalesTotals && (
            <button
              type="button"
              aria-label="Abrir fechamentos e pagamentos"
              onClick={() => useStore.getState().setActiveView('admin', 'finance', 'settings')}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400 transition-colors hover:border-emerald-400/40 hover:text-emerald-400"
              title="Fechamentos e pagamentos"
            >
              <Wallet size={18} />
            </button>
          )}
          {can(currentSeller, 'manageSettings', permissionOverrides, userPermissionOverrides) && (
            <button
              type="button"
              aria-label="Abrir configurações gerais"
              onClick={() => useStore.getState().setActiveView('admin', 'config', 'settings')}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400 transition-colors hover:border-primary/40 hover:text-primary"
              title="Configurações Gerais"
            >
              <Settings size={18} />
            </button>
          )}
          <ThemeToggleButton />
          <button
            type="button"
            aria-label="Sair do PDV"
            onClick={logout}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400 transition-colors hover:border-rose-400/40 hover:text-rose-400"
            title="Sair"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Faixa única de indicadores + progresso da meta. */}
      {(() => {
        const dailyGoal = getDailyGoal();
        const missingToday = Math.max(0, dailyGoal - totalToday);
        const goalPercent = dailyGoal > 0 ? Math.min(100, Math.round((totalToday / dailyGoal) * 100)) : 0;
        return (
          <section className="metal-surface metal-flow mb-3 rounded-[1.25rem]">
            <div className={`grid ${canViewSalesTotals && dailyGoal > 0 ? 'grid-cols-2 md:grid-cols-5' : canViewSalesTotals ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>
              {canViewSalesTotals && (
                <button
                  type="button"
                  onClick={() => setShowSalesBreakdown(true)}
                  className="px-4 py-3 text-left transition-colors hover:bg-emerald-400/[0.06]"
                  title="Ver vendas de produtos de hoje por forma de pagamento"
                >
                  <span className="block truncate text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">Vendas de produtos · hoje</span>
                  <span className="mt-0.5 block truncate text-lg font-black tabular-nums leading-tight text-emerald-400">{formatCurrency(totalToday)}</span>
                </button>
              )}
              {canViewSalesTotals && dailyGoal > 0 && (
                <>
                  <div className="border-l border-white/10 px-4 py-3 max-md:border-l-0 max-md:border-t md:border-t-0">
                    <span className="block truncate text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">Meta do dia</span>
                    <span className="mt-0.5 block truncate text-lg font-black tabular-nums leading-tight">{formatCurrency(dailyGoal)}</span>
                  </div>
                  <div className="border-l border-white/10 px-4 py-3 max-md:border-l-0 max-md:border-t">
                    <span className="block truncate text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">Faltam</span>
                    <span className={`mt-0.5 block truncate text-lg font-black tabular-nums leading-tight ${missingToday > 0 ? 'text-yellow-300' : 'text-emerald-400'}`}>
                      {missingToday > 0 ? formatCurrency(missingToday) : 'Meta batida'}
                    </span>
                  </div>
                </>
              )}
              <div className={`${canViewSalesTotals ? 'border-l border-white/10 max-md:border-t' : ''} px-4 py-3`}>
                <span className="block truncate text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">Mesas ativas</span>
                <span className="mt-0.5 block truncate text-lg font-black tabular-nums leading-tight text-primary">{activeTablesCount}</span>
                <div className="mt-1 flex items-center justify-between gap-2 border-t border-white/10 pt-1">
                  <span className="truncate text-[8px] font-black uppercase tracking-[0.14em] text-zinc-500">Atendidas hoje</span>
                  <span className="shrink-0 text-sm font-black tabular-nums leading-none text-zinc-700">{servedTablesTodayCount}</span>
                </div>
              </div>
              <div className="border-l border-white/10 px-4 py-3 max-md:border-l-0 max-md:border-t">
                <span className="block truncate text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">Mesas em aberto</span>
                <span className="mt-0.5 block truncate text-lg font-black tabular-nums leading-tight text-amber-300">{formatCurrency(openTablesAmount)}</span>
              </div>
            </div>
            {canViewSalesTotals && dailyGoal > 0 && (
              <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full ${goalPercent >= 100 ? 'bg-gradient-to-r from-primary to-yellow-300' : 'bg-primary'}`}
                    style={{ width: `${goalPercent}%` }}
                  />
                </div>
                <span className="whitespace-nowrap text-[10px] font-black tabular-nums uppercase tracking-[0.14em] text-zinc-500">
                  {goalPercent}% da meta
                </span>
              </div>
            )}
          </section>
        );
      })()}

      {/* Fileira de ações operacionais. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={switchQrMode}
          disabled={!canUseQrModeSwitch || isSwitchingQrMode}
          className={`flex h-11 items-center gap-2.5 rounded-xl border px-3.5 transition-colors ${
            canUseQrModeSwitch
              ? (isComandaMode
                ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
                : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20')
              : 'cursor-not-allowed border-white/5 opacity-40 text-zinc-600'
          }`}
          title="Modo comanda desligado = modo mesa. Modo comanda ligado = comandas."
        >
          <span className={`relative h-5 w-10 shrink-0 rounded-full border p-0.5 transition-colors ${
            isComandaMode ? 'border-emerald-300/50 bg-emerald-400/25' : 'border-white/20 bg-white/10'
          }`}>
            <span className={`block h-3.5 w-3.5 rounded-full transition-transform ${
              isComandaMode ? 'translate-x-5 bg-emerald-200' : 'translate-x-0 bg-zinc-400'
            }`} />
          </span>
          <span className="text-[10px] font-black uppercase tracking-[0.14em]">
            {isSwitchingQrMode ? 'Salvando...' : `Comanda ${isComandaMode ? 'ligada' : 'desligada'}`}
            <span className="ml-1.5 text-white/35">QR {isComandaMode ? '200' : '50'}</span>
          </span>
        </button>
        <button
          onClick={() => canUseCashAction && setCashDialog(isCashOpen ? 'close' : 'open')}
          disabled={!canUseCashAction}
          className={`flex h-11 items-center gap-2 rounded-xl border px-3.5 text-[10px] font-black uppercase tracking-[0.14em] transition-colors ${
            canUseCashAction
              ? (isCashOpen
                ? 'border-rose-400/25 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15'
                : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15')
              : 'cursor-not-allowed border-white/5 opacity-40 text-zinc-600'
          }`}
          title={cashActionLabel}
        >
          <Wallet size={16} />
          {cashActionLabel}
        </button>
        {/* Venda balcão: ação principal do turno — destaque amarelo, canto direito. */}
        <button
          onClick={() => setShowCounterSale(true)}
          disabled={!isCashOpen || !canAddOrderItem || !canLaunchPayment || !canCloseBill}
          className={`ml-auto flex h-12 items-center gap-2.5 rounded-xl px-6 text-[11px] font-black uppercase tracking-[0.16em] transition-all ${
            isCashOpen && canAddOrderItem && canLaunchPayment && canCloseBill
              ? 'bg-gradient-to-b from-yellow-300 to-amber-400 text-black shadow-lg shadow-amber-400/30 hover:brightness-105 hover:shadow-amber-400/45 active:scale-[0.98]'
              : 'cursor-not-allowed border border-white/5 bg-white/[0.02] opacity-40 text-zinc-600'
          }`}
          title="Venda balcão"
        >
          <ShoppingBag size={18} />
          Venda balcão
        </button>
      </div>

      {isEmbedded && (
        <button
          onClick={() => window.open('/pdv', '_blank', 'noopener,noreferrer')}
          className="fixed right-8 bottom-8 z-50 glass-card p-4 border-primary/30 text-primary hover:bg-primary/10 transition-all"
          title="Abrir PDV em nova janela"
        >
          <ExternalLink size={24} />
        </button>
      )}

      {!isCashOpen && !canPreviewTablesWithClosedCash && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed inset-x-4 sm:inset-x-8 top-48 sm:top-64 bottom-8 z-30 flex items-center justify-center pointer-events-none"
        >
          <div className="pointer-events-auto max-w-xl w-full glass-card border-amber-400/30 p-10 text-center shadow-2xl shadow-black/40">
            <div className="w-20 h-20 rounded-[2rem] bg-amber-400/10 text-amber-300 flex items-center justify-center mx-auto mb-6">
              <LockKeyhole size={38} />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-300 mb-3">Operação bloqueada</p>
            <h2 className="text-4xl font-black tracking-tight mb-4">Abra o caixa para operar o PDV</h2>
            <p className="text-sm font-bold text-zinc-500 leading-relaxed mb-8">
              As mesas, lançamentos e fechamento ficam pausados até alguém da equipe abrir a casa.
            </p>
            <button
              onClick={() => setCashDialog('open')}
              className="btn-beco btn-beco-purple px-10 py-5 rounded-2xl font-black uppercase tracking-widest"
            >
              Abrir caixa agora
            </button>
            {cashState?.lastClosingBalance !== undefined && (
              <p className="mt-5 text-[11px] font-black uppercase tracking-widest text-zinc-600">
                Último fechamento: {formatCurrency(cashState.lastClosingBalance)}
              </p>
            )}
          </div>
        </motion.div>
      )}

      {isCashOverdue && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed inset-x-4 sm:inset-x-8 top-48 sm:top-64 bottom-8 z-30 flex items-center justify-center pointer-events-none"
        >
          <div className="pointer-events-auto max-w-xl w-full glass-card border-rose-400/35 p-10 text-center shadow-2xl shadow-black/40">
            <div className="w-20 h-20 rounded-[2rem] bg-rose-400/10 text-rose-300 flex items-center justify-center mx-auto mb-6">
              <LockKeyhole size={38} />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-rose-300 mb-3">Operação bloqueada</p>
            <h2 className="text-4xl font-black tracking-tight mb-4">Caixa aberto desde ontem</h2>
            <p className="text-sm font-bold text-zinc-500 leading-relaxed mb-8">
              Este caixa está aberto há mais de 18 horas. Feche o caixa e faça uma nova abertura para continuar.
            </p>
            <button
              onClick={() => setCashDialog('close')}
              className="btn-beco btn-beco-purple px-10 py-5 rounded-2xl font-black uppercase tracking-widest"
            >
              Fechar caixa
            </button>
          </div>
        </motion.div>
      )}

      <div className={`grid grid-cols-1 xl:grid-cols-12 gap-6 xl:gap-8 min-h-[calc(100vh-220px)] xl:h-[calc(100vh-200px)] transition-all duration-300 ${
        (isCashOpen || canPreviewTablesWithClosedCash) && !isCashOverdue ? '' : 'blur-sm opacity-40 pointer-events-none select-none'
      }`}>
        {/* LEFT: MAPA DE MESAS */}
        <div className="xl:col-span-8 flex flex-col gap-5 xl:gap-6 xl:overflow-y-auto xl:pr-4 custom-scrollbar min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">
              <LayoutDashboard size={14} className="text-primary" /> Mapa de Mesas
            </h2>
            <div className="flex flex-wrap gap-3 sm:gap-4">
              <button 
                onClick={() => setShowOnlyActive(!showOnlyActive)}
                className={`px-5 sm:px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${showOnlyActive ? 'bg-primary text-black' : 'bg-white/5 text-zinc-500'}`}
              >
                {showOnlyActive ? 'Apenas Ativas' : 'Todas as Mesas'}
              </button>
              <span className="flex items-center gap-2 text-[10px] font-black uppercase text-zinc-500">
                <div className="w-3 h-3 rounded-full bg-zinc-800 border border-zinc-700" /> Livre
              </span>
              <span className="flex items-center gap-2 text-[10px] font-black uppercase text-purple-400">
                <div className="w-3 h-3 rounded-full bg-purple-600/40 border border-purple-500" /> Ocupada
              </span>
              <span className="flex items-center gap-2 text-[10px] font-black uppercase text-amber-400">
                <div className="w-3 h-3 rounded-full bg-amber-500/40 border border-amber-400" /> Em preparo
              </span>
              <span className="flex items-center gap-2 text-[10px] font-black uppercase text-rose-400">
                <div className="w-3 h-3 rounded-full bg-rose-600/40 border border-rose-500" /> Conta
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
            {visibleTables
              .filter(t => !showOnlyActive || t.status !== 'available' || t.customerTab)
              .map((table) => (
              <motion.button
                key={table.id}
                whileTap={{ scale: 0.97 }}
                onClick={() => handleTableClick(table)}
                className={`h-24 sm:h-28 rounded-2xl border p-3.5 flex flex-col justify-between transition-colors relative overflow-hidden group ${getStatusColor(table)}`}
              >
                <div className="flex justify-between items-start relative z-10">
                  <span className="text-2xl font-black tabular-nums tracking-tight leading-none">{table.number}</span>
                  {table.status !== 'available' && (
                    <Users size={16} className="opacity-40" />
                  )}
                </div>

                <div className="relative z-10 text-left">
                  {table.status === 'available' ? (
                    <span className="text-[9px] font-black uppercase tracking-[0.16em] opacity-50 group-hover:opacity-100 transition-opacity">Iniciar</span>
                  ) : (
                    <div className="flex flex-col items-start">
                      <span className="text-sm sm:text-base font-black tabular-nums tracking-tight leading-tight">
                        {formatCurrency(getOrderItemsTotal(table.orders))}
                      </span>
                      {table.customerTab && (
                        <span className="mt-0.5 max-w-full truncate text-[9px] font-black uppercase tracking-[0.12em] text-white/55">
                          {table.customerTab.customerName}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* RIGHT: LANÇAMENTOS & ACTIVITY */}
        <div className="xl:col-span-4 glass-card border-white/5 flex flex-col overflow-hidden min-h-[360px] xl:min-h-0">
          {isComandaMode && canInspectCustomerTabs && (
            <div className="border-b border-white/5 bg-amber-400/[0.03] p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-300">Saída</p>
                  <h3 className="text-xl font-black italic tracking-tight">Conferir comanda</h3>
                </div>
                <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-amber-200">
                  CPF chave
                </span>
              </div>
              <div className="flex gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4">
                  <Search size={16} className="text-amber-300" />
                  <input
                    value={customerTabSearch}
                    onChange={(event) => setCustomerTabSearch(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && runCustomerTabSearch()}
                    className="w-full bg-transparent py-4 text-sm font-black outline-none placeholder:text-zinc-600"
                    placeholder="CPF, nome ou telefone"
                  />
                </div>
                <button
                  onClick={() => runCustomerTabSearch()}
                  disabled={isCustomerTabSearching}
                  className="rounded-2xl bg-amber-300 px-4 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
                >
                  {isCustomerTabSearching ? '...' : 'Buscar'}
                </button>
              </div>
              <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                {customerTabResults.map((result) => {
                  const balance = result.totals?.balance || 0;
                  const isPaid = result.status === 'paid' || balance <= 0.009;
                  return (
                    <div key={result.id} className={`rounded-3xl border p-4 ${isPaid ? 'border-emerald-400/20 bg-emerald-400/10' : 'border-rose-400/20 bg-rose-400/10'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-black">{result.customerName}</p>
                          <p className="text-[10px] font-black uppercase tracking-widest text-white/45">
                            Comanda {result.tableNumber} • {result.cpfMasked}
                          </p>
                          <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-white/35">
                            Celular {result.phone || 'não informado'}
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${isPaid ? 'bg-emerald-400 text-black' : 'bg-rose-500 text-white'}`}>
                          {isPaid ? 'Liberado' : 'Pendente'}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-2xl bg-black/20 p-3">
                          <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Consumo</p>
                          <p className="text-sm font-black">{formatCurrency(result.totals?.orders || 0)}</p>
                        </div>
                        <div className="rounded-2xl bg-black/20 p-3">
                          <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Pago</p>
                          <p className="text-sm font-black">{formatCurrency(result.totals?.payments || 0)}</p>
                        </div>
                        <div className="rounded-2xl bg-black/20 p-3">
                          <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Saldo</p>
                          <p className={`text-sm font-black ${balance > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{formatCurrency(balance)}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => finalizeCustomerTab(result)}
                        disabled={!canCloseBill || !isPaid || isFinalizingCustomerTab === result.id}
                        className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.06] py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                      >
                        {isFinalizingCustomerTab === result.id ? 'Finalizando...' : isPaid ? 'Finalizar e desvincular CPF' : 'Precisa pagar antes'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* SOLICITAÇÕES DE SERVIÇO */}
          {visibleRequests.length > 0 && (
            <div className="solid-panel flex-1 flex flex-col min-h-0 border-b border-white/5 relative z-10">
              <div className={`p-5 sm:p-8 border-b border-white/20 flex justify-between items-center ${visibleRequests.some(r => r.status !== 'resolved') ? 'bg-rose-600 animate-pulse' : 'bg-emerald-600'} shrink-0`}>
                <h3 className="text-xs sm:text-sm font-black uppercase tracking-[0.16em] sm:tracking-[0.2em] flex items-center gap-3 text-white">
                  <Bell size={16} className={visibleRequests.some(r => r.status !== 'resolved') ? 'animate-bounce' : ''} /> 
                  {visibleRequests.some(r => r.status !== 'resolved') ? 'Novas Solicitações' : 'Solicitações Atendidas'}
                </h3>
                <span className="bg-white text-zinc-900 px-3 py-1 rounded-full text-xs font-black shadow-xl">
                  {visibleRequests.filter(r => r.status !== 'resolved').length || visibleRequests.length}
                </span>
              </div>
              <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar bg-[#0d0d0f]">
                {visibleRequests.map((req) => {
                  const isResolved = req.status === 'resolved';
                  const isOrderActionable = req.type === 'order_ready' || req.type === 'new_order';
                  return (
                    <motion.div 
                      key={req.id} 
                      animate={!isResolved ? { y: [0, -4, 0] } : { y: 0 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "easeInOut" }}
                      onClick={() => {
                        setSelectedRequestForDetails(req);
                      }}
                      className={`p-4 sm:p-6 border-b border-white/10 last:border-0 flex justify-between items-center gap-3 group transition-colors cursor-pointer ${isResolved ? 'bg-emerald-500/20 hover:bg-emerald-500/30' : 'bg-rose-600 hover:bg-rose-500'}`}
                    >
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                         <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center font-black italic text-xl shadow-inner shrink-0 ${isResolved ? 'bg-emerald-500 text-white' : 'bg-white/20 text-white'}`}>
                           {req.tableNumber}
                         </div>
                         <div className="min-w-0">
                           <div className="flex items-center gap-2 mb-1">
                             <p className="text-sm sm:text-base font-black text-white uppercase tracking-tight truncate">
                               {req.type === 'waiter' ? 'Chamar Garçom' : 
                                req.type === 'bill' ? 'Pedido de Conta' : 
                                req.type === 'glass' ? 'Copo Extra' :
                                req.type === 'cutlery' ? 'Pedir Talher' :
                                req.type === 'order_ready' ? 'Pedido Pronto' :
                                req.type === 'new_order' ? 'Novo Pedido' :
                                req.type}
                             </p>
                             {isOrderActionable && (
                               <span className="bg-white/20 text-[9px] px-2 py-0.5 rounded-full font-black uppercase">
                                 {req.type === 'order_ready' ? 'Entrega' : 'Bebidas'}
                               </span>
                             )}
                           </div>
                           <p className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 ${isResolved ? 'text-emerald-400' : 'text-white/60'}`}>
                             <Clock size={10} /> 
                             {new Date(req.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • 
                             {isResolved ? 'Atendimento Concluído' : (req.type === 'order_ready' ? 'Retirar na Cozinha' : (req.type === 'new_order' ? 'Preparar Bebidas/Drinks' : (req.message || 'Aguardando atendimento')))}
                           </p>
                           {isOrderActionable && (
                             <div className="mt-3">
                               <OrderItemDetails
                                 items={req.items}
                                 fallbackMessage={req.message}
                                 compact
                               />
                               <div className="mt-1 flex items-center gap-1 text-[8px] font-black text-white/40 uppercase">
                                 Ver movimento completo <ChevronRight size={8} />
                               </div>
                             </div>
                           )}
                         </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {canClearResolvedRequests && isResolved && (
                          <button
                            type="button"
                            aria-label="Limpar solicitação"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearServiceRequest(req.id);
                            }}
                            className="w-10 h-10 rounded-2xl flex items-center justify-center bg-white/10 text-white/70 border border-white/10 hover:bg-white hover:text-zinc-950 transition-all active:scale-90"
                            title="Limpar solicitação"
                          >
                            <X size={18} strokeWidth={4} />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isResolved || !canResolveServiceRequests) return;
                            resolveService(req.id);
                          }}
                          disabled={!isResolved && !canResolveServiceRequests}
                          className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-2xl transition-all ${isResolved ? 'bg-emerald-500 text-white hover:scale-105' : 'bg-white text-rose-600 hover:scale-110 active:scale-90'} ${!isResolved && !canResolveServiceRequests ? 'opacity-50 cursor-not-allowed' : ''}`}
                          title={isResolved ? "Atendimento concluído" : "Dar Ciente"}
                        >
                          <Check size={24} strokeWidth={4} />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="p-5 sm:p-8 border-t border-white/5 space-y-4 shrink-0 bg-[#0d0d0f]/50 mt-auto">
             <button 
               onClick={() => {
                 setShowOnlyActive(false);
               }}
               className="w-full btn-beco bg-zinc-800 hover:bg-zinc-700 py-6 font-black uppercase tracking-widest text-xs rounded-2xl flex items-center justify-center gap-3"
             >
               <LayoutDashboard size={18} /> Abrir Mesa
             </button>
             <button 
               onClick={() => setShowManualLog(true)}
               className="w-full btn-beco btn-beco-purple py-6 font-black uppercase tracking-widest text-xs rounded-2xl flex items-center justify-center gap-3"
             >
               <PlusCircle size={18} /> Novo Lançamento Manual
             </button>
          </div>
        </div>
      </div>

      {/* SELECTED TABLE OVERLAY (Management) */}
      <AnimatePresence>
        {selectedTable && managedTable && canAccessTable(managedTable) && (
          <motion.div 
            initial={{ x: 600 }}
            animate={{ x: 0 }}
            exit={{ x: 600 }}
            className="fixed inset-y-0 right-0 w-full sm:w-[500px] bg-[#0d0d0f] border-l border-white/10 z-[300] shadow-2xl p-4 sm:p-7 lg:p-9 flex flex-col"
          >
            <div className="flex justify-between items-center mb-6 sm:mb-8">
              <h2 className="text-4xl sm:text-5xl font-black italic tracking-tighter">Mesa <span className="text-primary">{selectedTable.number}</span></h2>
              <button type="button" aria-label="Fechar mesa" onClick={() => setSelectedTable(null)} className="p-4 glass rounded-2xl hover:text-rose-500 transition-all"><X size={24}/></button>
            </div>

            {managedTable?.status === 'available' ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-12">
                <div className="w-24 h-24 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 mb-8 animate-pulse">
                  <PlusCircle size={48} />
                </div>
                <h3 className="text-2xl font-black italic tracking-tight mb-4">Mesa disponível</h3>
                <p className="text-zinc-500 text-sm font-medium mb-12">Inicie um novo atendimento para adicionar itens e gerenciar esta mesa.</p>
                <button 
                  onClick={() => canOpenTable && canAddItems && setShowProductMenu(true)}
                  disabled={!canOpenTable || !canAddItems}
                  className={`w-full btn-beco py-8 text-xl font-black rounded-3xl ${
                    canOpenTable && canAddItems
                      ? 'btn-beco-purple'
                      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  ABRIR ATENDIMENTO
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-3 custom-scrollbar mb-8">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-3">Pedidos Ativos</h4>
                  {(managedTable?.orders || []).map((o, idx) => (
                    <div key={idx} className="rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-primary/35 hover:bg-white/[0.06] sm:px-4">
                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 flex-1 text-base font-black leading-tight text-zinc-50">{o.quantity}x {o.name}</p>
                          <div className="flex shrink-0 items-center gap-2">
                            <p className="text-sm font-black tabular-nums text-zinc-200">{formatCurrency(getOrderItemTotal(o))}</p>
                            {canCancelTableItem && (
                              <button
                                type="button"
                                aria-label={`Cancelar ${o.name} da mesa`}
                                onClick={() => {
                                  setCancelReasonCode('');
                                  setCancelReasonNotes('');
                                  setCancelItemDialog({ item: o, tableId: managedTable?.id || selectedTable.id, tableNumber: selectedTable.number });
                                }}
                                className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-rose-500 transition-all hover:border-rose-500/30 hover:bg-rose-500/10"
                                title="Cancelar item da mesa"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                        {(o.categoryName || o.categoryId) && (
                          <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-zinc-500">
                            {o.categoryName || o.categoryId}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {(o.selectedModifiers || []).map(m => (
                            <span key={m.id} className="rounded bg-white/5 px-1.5 py-0.5 text-[8px] font-black text-zinc-500">+{m.name}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-4 pt-6 border-t border-white/5">
                  <div className="flex justify-between items-end mb-6">
                    <div>
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Total Acumulado</span>
                      <p className="text-4xl sm:text-5xl font-black italic tracking-tighter text-emerald-400">
                        {formatCurrency(getOrderItemsTotal(managedTable?.orders || []))}
                      </p>
                    </div>
                    <div className="flex w-[142px] flex-col gap-2">
                      <div className="grid grid-cols-[44px_1fr] gap-2">
                        <button
                          type="button"
                          aria-label="Imprimir conta aberta"
                          onClick={() => handlePrintOpenTableReceipt(managedTable)}
                          className="glass flex h-11 items-center justify-center rounded-xl text-emerald-300 transition-all hover:bg-emerald-500/10"
                          title="Imprimir conta aberta"
                        >
                          <Printer size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => canCloseBill && setShowCheckout(true)}
                          disabled={!canCloseBill}
                          className={`glass h-11 rounded-xl border-white/10 px-2 font-black text-[8px] uppercase tracking-widest ${
                            canCloseBill
                              ? 'text-emerald-200 hover:bg-emerald-500/10'
                              : 'text-zinc-600 opacity-50 cursor-not-allowed'
                          }`}
                        >
                          CPF/CNPJ
                        </button>
                      </div>
                      <button
                        onClick={() => canCloseBill && setShowCheckout(true)}
                        disabled={!canCloseBill}
                        className={`glass h-14 rounded-2xl border-amber-500/20 px-4 font-black text-[9px] uppercase tracking-widest ${
                          canCloseBill
                            ? 'text-amber-400 hover:bg-amber-500/10'
                            : 'text-zinc-600 opacity-50 cursor-not-allowed'
                        }`}
                      >
                        Solicitar Conta
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button 
                      onClick={() => canAddItems && setShowProductMenu(true)}
                      disabled={!canAddItems}
                      className={`btn-beco py-6 rounded-2xl font-black text-sm ${
                        canAddItems
                          ? 'bg-zinc-800 hover:bg-zinc-700'
                          : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      }`}
                    >
                      ADICIONAR ITENS
                    </button>
                    {getOrderItemsTotal(managedTable?.orders || []) === 0 ? (
                      <button 
                        onClick={async () => {
                          if (!canUpdateTableStatus) return;
                          const cleaned = await updateTableStatus(managedTable.id, 'available');
                          if (cleaned) setSelectedTable(null);
                        }}
                        disabled={!canUpdateTableStatus}
                        className={`btn-beco py-6 rounded-2xl font-black text-sm ${
                          canUpdateTableStatus
                            ? 'bg-rose-500/20 text-rose-500 hover:bg-rose-500/30'
                            : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                        }`}
                      >
                        LIMPAR MESA (R$ 0,00)
                      </button>
                    ) : (
                      <button
                        onClick={() => canCloseBill && setShowCheckout(true)}
                        disabled={!canCloseBill}
                        className={`btn-beco py-6 rounded-2xl font-black text-sm ${
                          canCloseBill
                            ? 'btn-beco-purple'
                            : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                        }`}
                      >
                        FINALIZAR CONTA
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* PRODUCT SELECTION OVERLAY */}
      <AnimatePresence>
        {showProductMenu && selectedTable && managedTable && canAccessTable(managedTable) && (
          <motion.div 
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="!fixed inset-0 z-[500] glass-card m-0 sm:m-6 xl:m-12 bg-transparent/95 border-white/10 flex flex-col overflow-hidden p-4 sm:p-8 xl:p-12"
          >
            <div className="flex justify-between items-start gap-4 mb-6 xl:mb-12">
               <div>
                 <h2 className="text-3xl sm:text-4xl font-black italic tracking-tighter leading-none">Adicionar à <span className="text-primary">Mesa {selectedTable.number}</span></h2>
                 <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Selecione os produtos abaixo</p>
               </div>
               <button type="button" aria-label="Fechar cardápio" onClick={() => setShowProductMenu(false)} className="p-4 sm:p-6 glass rounded-3xl hover:text-rose-500 transition-all shrink-0"><X size={28}/></button>
            </div>

            <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-8 overflow-hidden min-h-0">
               {/* CATEGORIES */}
               <div className="w-full lg:w-64 flex lg:flex-col gap-3 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto pb-2 lg:pb-0 lg:pr-2 custom-scrollbar shrink-0">
                  {categories.map(cat => (
                    <button 
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-5 py-4 lg:p-6 rounded-3xl font-black text-left uppercase text-xs tracking-widest transition-all whitespace-nowrap lg:whitespace-normal ${
                        activeCategory === cat.id 
                          ? 'bg-primary text-white shadow-2xl shadow-primary/20 border border-primary' 
                          : 'bg-[#121214] border border-white/10 text-zinc-400 hover:text-white hover:bg-[#1a1a1e]'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
               </div>

               <div className="flex-1 overflow-y-auto lg:pr-4 custom-scrollbar min-h-0">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                    {menu
                      .filter(p => p.visible || canSellUnavailableProduct)
                      .filter(p => !activeCategory || p.categoryId === activeCategory)
                      .map(product => (
                      <motion.button
                        key={product.id}
                        whileHover={{ x: 6 }}
                        onClick={() => {
                          if (!canAddOrderItem) return;
                          if (product.modifierGroups?.length) {
                            setSelectedProduct(product);
                            return;
                          }

                          addToCart(product, 1, []);
                          addAuditLog({
                            action: 'item_added',
                            details: { product_name: product.name, price: product.price },
                            table_number: selectedTable.number.toString(),
                            origin: 'pdv'
                          });
                        }}
                        disabled={!canAddOrderItem}
                        className={`bg-[#121214] border border-white/10 rounded-3xl p-4 sm:p-6 flex justify-between items-center gap-3 group relative overflow-hidden text-left transition-all shadow-lg ${
                          canAddOrderItem
                            ? 'hover:bg-[#1a1a1e]'
                            : 'opacity-40 grayscale cursor-not-allowed'
                        }`}
                      >
                         <div className="flex items-center gap-4 min-w-0">
                           <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-black transition-all shrink-0">
                              {product.modifierGroups?.length ? <Sparkles size={20} /> : <Plus size={20} />}
                           </div>
                           <div className="min-w-0">
                             <h4 className="text-lg sm:text-xl font-bold italic tracking-tight leading-none text-white truncate">{product.name}</h4>
                             <div className="flex flex-wrap items-center gap-2 mt-2">
                               <span className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">
                                 {product.categoryName || product.categoryId}
                               </span>
                               <span className={`text-[10px] font-black uppercase tracking-widest ${
                                 product.modifierGroups?.length ? 'text-primary' : 'text-zinc-600'
                               }`}>
                                 {getModifierGroupsLabel(product)}
                               </span>
                             </div>
                           </div>
                         </div>
                         
                         <div className="flex items-center gap-6 shrink-0">
                           <span className="text-base sm:text-lg font-black italic tracking-tighter text-emerald-400 whitespace-nowrap">{formatCurrency(product.price)}</span>
                         </div>
                      </motion.button>
                    ))}
                  </div>
               </div>
            </div>

            {cart.length > 0 && (
              <div className="mt-4 sm:mt-6 rounded-[2rem] border border-white/10 bg-black/35 overflow-hidden shrink-0">
                <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-white/10">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.28em] text-primary">Pedido antes de enviar</p>
                    <p className="text-[11px] font-bold text-zinc-500">Toque em +, - ou lixeira para corrigir sem refazer o lançamento.</p>
                  </div>
                  <span className="text-xs font-black uppercase tracking-widest text-zinc-400 whitespace-nowrap">
                    {cart.reduce((acc, item) => acc + item.quantity, 0)} un.
                  </span>
                </div>

                <div className="max-h-40 sm:max-h-48 overflow-y-auto custom-scrollbar divide-y divide-white/5">
                  {cart.map((item) => (
                    <div key={item.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-6 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm sm:text-base font-black italic tracking-tight text-white truncate">{item.name}</p>
                        {item.selectedModifiers?.length > 0 && (
                          <p className="text-[10px] font-bold uppercase tracking-widest text-primary truncate">
                            {item.selectedModifiers.map(modifier => modifier.name).join(', ')}
                          </p>
                        )}
                        {item.notes && (
                          <p className="text-[10px] font-bold text-zinc-500 truncate">{item.notes}</p>
                        )}
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="flex items-center rounded-2xl border border-white/10 bg-[#121214] p-1">
                          <button
                            type="button"
                            onClick={() => updateCartItemQuantity(item.id, item.quantity - 1)}
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                            aria-label={`Diminuir ${item.name}`}
                          >
                            <Minus size={16} />
                          </button>
                          <span className="w-10 text-center text-sm font-black text-white">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateCartItemQuantity(item.id, item.quantity + 1)}
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                            aria-label={`Aumentar ${item.name}`}
                          >
                            <Plus size={16} />
                          </button>
                        </div>

                        <span className="w-24 text-right text-sm sm:text-base font-black italic text-emerald-400">
                          {formatCurrency(getOrderItemTotal(item))}
                        </span>

                        <button
                          type="button"
                          onClick={() => removeFromCart(item.id)}
                          className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-300 hover:bg-rose-500 hover:text-white transition-colors flex items-center justify-center"
                          aria-label={`Remover ${item.name}`}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-white/10 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 shrink-0">
              <div className="flex gap-6 sm:gap-8">
                 <div>
                   <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Itens no Pedido</span>
                   <span className="text-2xl sm:text-3xl font-black italic tracking-tighter text-white">{cart.length} ITENS</span>
                 </div>
                 <div>
                   <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Subtotal</span>
                   <span className="text-2xl sm:text-3xl font-black italic tracking-tighter text-emerald-400">{formatCurrency(getOrderItemsTotal(cart))}</span>
                 </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <button 
                  onClick={() => setShowProductMenu(false)}
                  className="btn-beco bg-zinc-800 py-5 sm:py-8 px-8 sm:px-12 text-base sm:text-xl font-black rounded-3xl"
                >
                  CANCELAR
                </button>
                <button 
                  disabled={isSendingOrder || cart.length === 0 || !canSendOrderToProduction}
                  onClick={async () => {
                    if (cart.length > 0) {
                      setIsSendingOrder(true);
                      try {
                        await sendToKitchen(selectedTable.id, 'pdv', currentSeller?.id || 'sistema');
                        if (!useStore.getState().currentSeller) return;
                        addAuditLog({
                          action: 'item_added',
                          details: { items_count: cart.length },
                          table_number: selectedTable.number.toString(),
                          origin: 'pdv'
                        });
                        setShowProductMenu(false);
                      } catch (err) {
                        console.error("Erro ao enviar pedido para a cozinha:", err);
                        addNotification("Não foi possível enviar o pedido. Confira o aviso na tela e tente novamente.", "error");
                      } finally {
                        setIsSendingOrder(false);
                      }
                    } else {
                      setShowProductMenu(false);
                    }
                  }}
                  className="btn-beco btn-beco-purple py-5 sm:py-8 px-8 sm:px-16 xl:px-24 text-base sm:text-xl font-black rounded-3xl shadow-2xl shadow-primary/20 disabled:opacity-20 disabled:grayscale transition-all"
                >
                  {isSendingOrder ? 'ENVIANDO...' : 'CONFIRMAR E ENVIAR'}
                </button>
                {!canSendOrderToProduction && (
                  <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 text-center sm:text-right">
                    Seu perfil não pode enviar pedido para produção/bar.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCounterSale && (
          <CounterSaleModal
            onClose={() => setShowCounterSale(false)}
            canAddOrderItem={canAddOrderItem}
            canSellUnavailableProduct={canSellUnavailableProduct}
            canChangeItemQuantity={can(currentSeller, 'changeItemQuantity', permissionOverrides, userPermissionOverrides)}
            canEditItemNotes={can(currentSeller, 'editItemNotes', permissionOverrides, userPermissionOverrides)}
            canLaunchPayment={canLaunchPayment}
            canCloseBill={canCloseBill}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSalesBreakdown && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-xl flex items-center justify-center p-3 sm:p-6"
          >
            <motion.div
              initial={{ scale: 0.96, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 20 }}
              className="glass-card w-full max-w-3xl border-emerald-400/20 p-5 sm:p-8 shadow-2xl shadow-black/40"
            >
              <div className="flex items-start justify-between gap-6 mb-7">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300 mb-2">Vendas de hoje</p>
                  <h3 className="text-3xl sm:text-4xl font-black tracking-tight">Resumo por pagamento</h3>
                  <p className="mt-2 text-xs sm:text-sm font-bold text-zinc-500">
                    {todayBills.length} mesa(s) fechada(s) hoje, separadas por forma lançada no PDV.
                  </p>
                </div>
                <button type="button" aria-label="Fechar resumo de vendas" onClick={() => setShowSalesBreakdown(false)} className="glass p-3 rounded-2xl text-zinc-400 hover:text-white">
                  <X size={22} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {salesBreakdownItems.map((item) => {
                  const data = salesBreakdown[item.method];
                  const percent = totalTodayByPayments > 0 ? (data.total / totalTodayByPayments) * 100 : 0;
                  return (
                    <div key={item.method} className={`rounded-3xl border ${item.border} ${item.bg} p-5`}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">{item.label}</p>
                          <p className={`mt-2 text-2xl sm:text-3xl font-black ${item.tone}`}>{formatCurrency(data.total)}</p>
                        </div>
                        <div className="rounded-2xl bg-black/25 border border-white/10 px-3 py-2 text-right">
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Lanç.</p>
                          <p className="text-lg font-black text-white">{data.count}</p>
                        </div>
                      </div>
                      <div className="mt-5 h-2 rounded-full bg-white/10 overflow-hidden">
                        <div className={`h-full rounded-full ${item.method === 'cash' ? 'bg-emerald-300' : item.method === 'pix' ? 'bg-amber-300' : item.method === 'debit' ? 'bg-sky-300' : 'bg-violet-300'}`} style={{ width: `${Math.min(percent, 100)}%` }} />
                      </div>
                      <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-zinc-600">
                        {percent.toFixed(1)}% dos pagamentos lançados
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Total fechado</p>
                  <p className="text-2xl font-black text-white">{formatCurrency(totalToday)}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Total lançado por pagamento</p>
                  <p className="text-2xl font-black text-emerald-300">{formatCurrency(totalTodayByPayments)}</p>
                </div>
              </div>

              {Math.abs(totalToday - totalTodayByPayments) > 0.01 && (
                <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-5 py-4 text-xs font-black uppercase tracking-widest text-amber-200">
                  Atenção: total fechado e total por pagamentos têm diferença de {formatCurrency(totalToday - totalTodayByPayments)}.
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CHECKOUT MODAL */}
      <AnimatePresence>
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            canChangeItemQuantity={can(currentSeller, 'changeItemQuantity', permissionOverrides, userPermissionOverrides)}
            canEditItemNotes={can(currentSeller, 'editItemNotes', permissionOverrides, userPermissionOverrides)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cashDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-xl flex items-center justify-center p-3 sm:p-6"
          >
            <motion.div
              initial={{ scale: 0.96, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 20 }}
              className="glass-card w-full max-w-xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto custom-scrollbar border-primary/30 p-5 sm:p-8"
            >
              <div className="flex items-start justify-between gap-6 mb-8">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">
                    {cashDialog === 'open' ? 'Abertura da casa' : 'Fechamento da casa'}
                  </p>
                  <h3 className="text-3xl font-black tracking-tight">
                    {cashDialog === 'open' ? 'Abrir caixa' : 'Fechar caixa'}
                  </h3>
                </div>
                <button type="button" aria-label="Fechar caixa" onClick={() => setCashDialog(null)} className="glass p-3 rounded-2xl text-zinc-400 hover:text-white">
                  <X size={22} />
                </button>
              </div>

              {cashError && (
                <div className="mb-5 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm font-black text-rose-200">
                  {cashError}
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    {cashDialog === 'open' ? 'Valor inicial na gaveta' : 'Valor físico final na gaveta'}
                  </label>
                  <input
                    value={cashValue}
                    onChange={(event) => setCashValue(formatMoneyInput(event.target.value))}
                    readOnly={cashDialog === 'open' && Boolean(cashState?.hasPreviousClosing)}
                    placeholder="R$ 0,00"
                    inputMode="numeric"
                    className="mt-3 w-full bg-white/[0.04] border border-white/10 rounded-3xl px-5 sm:px-6 py-5 sm:py-6 outline-none text-3xl sm:text-4xl font-black text-accent focus:border-primary/60 read-only:cursor-not-allowed read-only:opacity-80"
                    autoFocus
                  />
                </div>

                {cashDialog === 'open' && (
                  <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2">Último fechamento</p>
                    <p className="text-xl font-black text-white">{formatCurrency(cashState?.lastClosingBalance || 0)}</p>
                    <p className="mt-2 text-xs font-bold text-zinc-500">
                      {cashState?.hasPreviousClosing
                        ? 'A abertura herda obrigatoriamente o valor físico do último fechamento.'
                        : 'Primeiro caixa: informe o fundo inicial para começar o histórico.'}
                    </p>
                  </div>
                )}

                {(cashDialog === 'open' || cashDialog === 'close') && (
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                      PIN de confirmação
                    </label>
                    <input
                      value={cashConfirmationPin}
                      onChange={(event) => setCashConfirmationPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="****"
                      inputMode="numeric"
                      type="password"
                      maxLength={4}
                      className="mt-3 w-full bg-white/[0.04] border border-white/10 rounded-3xl px-6 py-5 outline-none text-3xl font-black tracking-[0.5em] text-white focus:border-primary/60"
                    />
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                      Com o valor conferido, use o PIN de quem está fechando. Se houver diferença, solicite o PIN do superadministrador.
                    </p>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Observação</label>
                  <textarea
                    value={cashNotes}
                    onChange={(event) => setCashNotes(event.target.value)}
                    placeholder="Ex: diferença no fundo de caixa, conferência manual..."
                    className="mt-3 w-full h-28 bg-white/[0.04] border border-white/10 rounded-3xl px-5 py-4 outline-none text-sm font-bold resize-none focus:border-primary/60"
                  />
                </div>
              </div>

              <button
                onClick={submitCashDialog}
                disabled={isCashSubmitting}
                className="mt-8 w-full btn-beco btn-beco-purple py-6 rounded-2xl font-black uppercase tracking-widest disabled:opacity-40"
              >
                {isCashSubmitting ? 'Processando...' : cashDialog === 'open' ? 'Abrir caixa e liberar PDV' : 'Fechar caixa e bloquear PDV'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showQrModePinDialog && (
          <ActionDialog
            isOpen
            title=""
            confirmLabel="Confirmar"
            input={{
              label: 'PIN',
              placeholder: '****',
              type: 'password',
              inputMode: 'numeric',
            }}
            confirmDisabled={isSwitchingQrMode}
            onClose={() => setShowQrModePinDialog(false)}
            onConfirm={async (value) => {
              await submitQrModeSwitch(value);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cancelItemDialog && (
          <ActionDialog
            isOpen
            tone="danger"
            title="Cancelar item?"
            description={`Remover ${cancelItemDialog.item.quantity}x ${cancelItemDialog.item.name} da Mesa ${cancelItemDialog.tableNumber}. O total do pedido será recalculado.`}
            cancelLabel="Voltar"
            confirmLabel="Cancelar item"
            confirmDisabled={!cancelReasonCode || cancelReasonNotes.trim().length < 3}
            onClose={() => {
              setCancelItemDialog(null);
              setCancelReasonCode('');
              setCancelReasonNotes('');
            }}
            onConfirm={async () => {
              const reason = CANCEL_REASONS.find(item => item.code === cancelReasonCode);
              await removeOrderItem(cancelItemDialog.item.id, {
                tableId: cancelItemDialog.tableId,
                tableNumber: cancelItemDialog.tableNumber,
                itemName: cancelItemDialog.item.name,
                quantity: cancelItemDialog.item.quantity,
                sellerName: currentSeller?.name,
                sellerPermission: currentSeller?.permission,
                reasonCode: reason?.code,
                reasonLabel: reason?.label,
                reasonNotes: cancelReasonNotes.trim()
              });
              try {
                await addAuditLog({
                  action: 'item_cancelled',
                  details: {
                    product_name: cancelItemDialog.item.name,
                    quantity: cancelItemDialog.item.quantity,
                    reason_code: reason?.code,
                    reason_label: reason?.label,
                    reason_notes: cancelReasonNotes.trim(),
                  },
                  table_number: cancelItemDialog.tableNumber.toString(),
                  origin: 'pdv'
                });
              } catch (error) {
                console.warn('Item removido, mas auditoria falhou:', error);
              }
            }}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CANCEL_REASONS.map((reason) => (
                  <button
                    key={reason.code}
                    type="button"
                    onClick={() => setCancelReasonCode(reason.code)}
                    className={`rounded-2xl border px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest transition-all ${
                      cancelReasonCode === reason.code
                        ? 'border-rose-400 bg-rose-500/20 text-white shadow-lg shadow-rose-950/20'
                        : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/25 hover:text-white'
                    }`}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
              <textarea
                value={cancelReasonNotes}
                onChange={(event) => setCancelReasonNotes(event.target.value)}
                placeholder="Justificativa obrigatória. Ex: cliente desistiu depois de pedir, item lançado em duplicidade..."
                className="w-full min-h-20 glass rounded-2xl border-white/10 p-4 text-sm font-bold outline-none focus:border-rose-400/50"
              />
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-rose-200/80">
                Selecione um motivo e escreva a justificativa antes de cancelar.
              </p>
            </div>
          </ActionDialog>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCheckout && selectedTable && managedTable && canAccessTable(managedTable) && (
          <CheckoutModal 
            table={managedTable || selectedTable} 
            onClose={() => {
              setShowCheckout(false);
              setSelectedTable(null);
            }} 
          />
        )}
      </AnimatePresence>

      {/* MANUAL LOG MODAL */}
      <AnimatePresence>
        {showManualLog && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[600] flex items-center justify-center p-3 sm:p-8 lg:p-12"
          >
            <div className="absolute inset-0 bg-black/90 backdrop-blur-3xl" onClick={() => setShowManualLog(false)} />
            <div className="glass-card w-full max-w-xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto custom-scrollbar p-5 sm:p-8 lg:p-12 relative z-10 border-white/10 shadow-2xl">
               <div className="flex justify-between items-center mb-8 sm:mb-12">
                  <h2 className="text-2xl sm:text-3xl font-black italic tracking-tighter uppercase">Novo <span className="text-primary">Lançamento</span></h2>
                  <button type="button" aria-label="Fechar lançamento manual" onClick={() => setShowManualLog(false)} className="p-4 glass rounded-2xl hover:text-rose-500"><X size={20}/></button>
               </div>

               <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 block">Ação / Título</label>
                    <input 
                      value={logAction} onChange={(e) => setLogAction(e.target.value)}
                      className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-lg bg-transparent"
                      placeholder="Ex: Sangria de Caixa, Entrada Manual..."
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 block">Detalhes / Observações</label>
                    <textarea 
                      value={logDetails} onChange={(e) => setLogDetails(e.target.value)}
                      className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-lg bg-transparent h-32"
                      placeholder="Descreva o motivo do lançamento..."
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 block">Mesa Relacionada (Opcional)</label>
                    <input 
                      value={logTable} onChange={(e) => setLogTable(e.target.value)}
                      className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-lg bg-transparent"
                      placeholder="Ex: 12"
                    />
                  </div>
               </div>

               <button 
                  onClick={async () => {
                    await addAuditLog({
                      action: logAction || 'Lançamento Manual',
                      details: logDetails,
                      table_number: logTable,
                      origin: 'pdv'
                    });
                    setShowManualLog(false);
                    setLogAction('');
                    setLogDetails('');
                    setLogTable('');
                  }}
                  className="w-full btn-beco btn-beco-purple py-5 sm:py-8 text-base sm:text-xl font-black rounded-3xl mt-8 sm:mt-12"
               >
                  REGISTRAR LANÇAMENTO
               </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL DE DETALHES DA SOLICITAÇÃO */}
      <AnimatePresence>
        {selectedRequestForDetails && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-8"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] bg-[#111115] rounded-[2rem] sm:rounded-[3rem] border border-white/10 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className={`p-5 sm:p-10 border-b border-white/5 flex justify-between items-center ${
                selectedRequestForDetails.status === 'resolved'
                  ? 'bg-emerald-600'
                  : selectedRequestForDetails.type === 'new_order'
                    ? 'bg-indigo-600'
                    : 'bg-rose-600'
              }`}>
                <div>
                  <h2 className="text-3xl sm:text-4xl font-black italic tracking-tighter text-white">Mesa <span className="text-white/60">{selectedRequestForDetails.tableNumber}</span></h2>
                  <p className="text-white/80 font-black uppercase tracking-widest text-[10px] mt-1 flex items-center gap-2">
                    <Clock size={12} /> {new Date(selectedRequestForDetails.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • {selectedRequestForDetails.status === 'resolved' ? 'Atendimento concluído' : 'Aguardando atendimento'}
                  </p>
                </div>
                <button type="button" aria-label="Fechar solicitação" onClick={() => setSelectedRequestForDetails(null)} className="p-4 bg-white/20 rounded-full text-white hover:bg-white/30 transition-all">
                  <X size={28} />
                </button>
              </div>

              <div className="p-5 sm:p-10 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <div className="bg-white/5 rounded-3xl p-5 border border-white/5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Movimento</p>
                    <p className="text-xl font-black text-white uppercase">
                      {selectedRequestForDetails.type === 'waiter' ? 'Chamar Garçom' :
                       selectedRequestForDetails.type === 'bill' ? 'Pedido de Conta' :
                       selectedRequestForDetails.type === 'glass' ? 'Copo Extra' :
                       selectedRequestForDetails.type === 'cutlery' ? 'Pedir Talher' :
                       selectedRequestForDetails.type === 'order_ready' ? 'Pedido Pronto' :
                       selectedRequestForDetails.type === 'new_order' ? 'Novo Pedido' :
                       selectedRequestForDetails.type}
                    </p>
                  </div>
                  <div className="bg-white/5 rounded-3xl p-5 border border-white/5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Status</p>
                    <p className={`text-xl font-black uppercase ${selectedRequestForDetails.status === 'resolved' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {selectedRequestForDetails.status === 'resolved' ? 'Atendido' : 'Pendente'}
                    </p>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-6">
                   <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-5">
                     {selectedRequestForDetails.type === 'new_order'
                       ? 'Itens do pedido'
                       : selectedRequestForDetails.type === 'order_ready'
                         ? 'Itens prontos para entrega'
                         : 'Mensagem da solicitação'}
                   </h3>
                   {selectedRequestForDetails.type === 'new_order' || selectedRequestForDetails.type === 'order_ready' ? (
                     <OrderItemDetails
                       items={selectedRequestForDetails.items}
                       fallbackMessage={selectedRequestForDetails.message}
                     />
                   ) : (
                     <p className="text-xl sm:text-3xl font-black text-white leading-relaxed">
                       {selectedRequestForDetails.message || 'Sem observação adicional.'}
                     </p>
                   )}
                </div>

                <div className="grid grid-cols-1 gap-4 mt-10">
                  <button 
                    onClick={() => {
                      if (selectedRequestForDetails.status === 'resolved') {
                        setSelectedRequestForDetails(null);
                        return;
                      }
                      if (!canResolveServiceRequests) return;
                      resolveService(selectedRequestForDetails.id);
                      setSelectedRequestForDetails(null);
                    }}
                    disabled={selectedRequestForDetails.status !== 'resolved' && !canResolveServiceRequests}
                    className={`w-full py-5 sm:py-8 text-white rounded-[2rem] text-lg sm:text-2xl font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all flex items-center justify-center gap-4 ${
                      selectedRequestForDetails.status === 'resolved'
                        ? 'bg-rose-500 shadow-rose-500/20'
                        : canResolveServiceRequests
                          ? 'bg-emerald-500 shadow-emerald-500/20'
                          : 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                    }`}
                  >
                    <Check size={32} strokeWidth={4} /> {selectedRequestForDetails.status === 'resolved' ? 'Atendimento Concluído' : 'Dar Ciente'}
                  </button>
                  {canClearResolvedRequests && selectedRequestForDetails.status === 'resolved' && (
                    <button
                      onClick={() => {
                        clearServiceRequest(selectedRequestForDetails.id);
                        setSelectedRequestForDetails(null);
                      }}
                      className="w-full py-6 text-white/80 rounded-[2rem] text-xl font-black uppercase tracking-widest border border-white/10 bg-white/5 hover:bg-white hover:text-zinc-950 active:scale-95 transition-all flex items-center justify-center gap-4"
                    >
                      <X size={28} strokeWidth={4} /> Limpar Solicitação
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ReceiptPrintModal
        data={receiptPreview}
        onClose={() => setReceiptPreview(null)}
      />
    </div>
  );
}
