import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ShoppingBag, LayoutDashboard, Bell, FileText, Send, UserRound, Phone, BadgeCheck, QrCode, RefreshCw } from 'lucide-react';
import { useStore, type Product } from '../../store';
import type { CustomerTab, Table } from '../../types';
import { MenuCatalog } from '../../components/shared/MenuCatalog';
import { ProductModal } from '../../components/modals/ProductModal';
import { CustomerAccountModal } from '../../components/modals/CustomerAccountModal';
import { CustomerOrderModal } from '../../components/modals/CustomerOrderModal';
import { ServiceRequestModal } from '../../components/modals/ServiceRequestModal';
import { getOrderItemsTotal } from '../../lib/totals';
import { AppApi, CustomerTabApi, setPublicTableAccess, type QrFlowResolution } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { usePublicI18n } from '../../lib/public-i18n';
import { PublicLanguageMenu } from '../../components/shared/PublicLanguageMenu';

const CUSTOMER_TAB_CPF_KEY = 'becoartes_customer_tab_cpf';

const normalizeCpfInput = (value: string) => value.replace(/\D/g, '').slice(0, 11);

const applyPublicTableState = (table: Table) => useStore.setState((state) => ({
  tables: [...state.tables.filter((entry) => entry.id !== table.id), table].sort((a, b) => a.number - b.number),
}));

const usePublicTablePolling = (input: {
  tableId: string;
  tableNumber?: number;
  customerTabContext?: { customerTabId: string; sourceTableId: string; sourceTableNumber: number };
} | null) => {
  const tableId = input?.tableId;
  const tableNumber = input?.tableNumber;
  const customerTabId = input?.customerTabContext?.customerTabId;
  const sourceTableId = input?.customerTabContext?.sourceTableId;
  const sourceTableNumber = input?.customerTabContext?.sourceTableNumber;
  useEffect(() => {
    if (!tableId) return;
    let cancelled = false;
    const refresh = () => AppApi.getPublicTableState({
      tableId,
      tableNumber,
      customerTabContext: customerTabId && sourceTableId && sourceTableNumber
        ? { customerTabId, sourceTableId, sourceTableNumber }
        : undefined,
    })
      .then(({ table }) => { if (!cancelled) applyPublicTableState(table); })
      .catch(() => undefined);
    const interval = window.setInterval(refresh, 45_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tableId, tableNumber, customerTabId, sourceTableId, sourceTableNumber]);
};

const getRouteTableNumber = () => {
  const pathMatch = window.location.pathname.match(/(?:^|\/)mesa\/(\d+)(?:\/)?$/);
  const params = new URLSearchParams(window.location.search);
  const rawValue = pathMatch?.[1] || params.get('mesa') || params.get('table');
  const tableNumber = Number(rawValue);
  return Number.isFinite(tableNumber) && tableNumber > 0 ? tableNumber : null;
};

export function QRView() {
  const { currentTableId, tables, setCurrentTableId, settings } = useStore();
  const { t } = usePublicI18n();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isOrderOpen, setIsOrderOpen] = useState(false);
  const [isServiceOpen, setIsServiceOpen] = useState(false);
  const [routeTableNumber, setRouteTableNumber] = useState<number | null>(getRouteTableNumber);
  const [qrResolution, setQrResolution] = useState<QrFlowResolution | null>(null);
  const [isTableAccessReady, setIsTableAccessReady] = useState(false);
  const [tableAccessError, setTableAccessError] = useState('');
  const [tableAccessRetry, setTableAccessRetry] = useState(0);
  const isCouponRulesPage = window.location.pathname.includes('regulamento-cupom');

  usePublicTablePolling(qrResolution?.flow === 'mesa' ? {
    tableId: qrResolution.physicalTable.id,
    tableNumber: qrResolution.physicalTable.number,
  } : null);

  const routeTable = routeTableNumber ? tables.find(t => t.number === routeTableNumber) : null;

  useEffect(() => {
    const tableNumber = getRouteTableNumber();
    setRouteTableNumber(tableNumber);
    if (!tableNumber || isCouponRulesPage) return;

    let cancelled = false;
    setIsTableAccessReady(false);
    setTableAccessError('');
    setQrResolution(null);
    AppApi.resolveQrFlow(tableNumber)
      .then(async (resolution) => {
        if (cancelled) return;
        setQrResolution(resolution);
        setPublicTableAccess(resolution.access);
        if (resolution.flow === 'mesa') {
          setCurrentTableId(resolution.physicalTable.id);
          const { table } = await AppApi.getPublicTableState({
            tableId: resolution.physicalTable.id,
            tableNumber: resolution.physicalTable.number,
          });
          if (cancelled) return;
          applyPublicTableState(table);
        }
        setIsTableAccessReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setIsTableAccessReady(false);
          setTableAccessError('Não foi possível validar esta mesa agora.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isCouponRulesPage, setCurrentTableId, settings.qrMode, tableAccessRetry]);

  const currentTable = routeTableNumber ? routeTable : tables.find(t => t.id === currentTableId);

  if (isCouponRulesPage) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] text-white font-['Outfit'] flex items-center justify-center p-5">
        <div className="glass-card w-full max-w-2xl p-7 sm:p-10 border-primary/30">
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-primary mb-3">Regulamento</p>
          <h1 className="text-4xl sm:text-5xl font-black italic tracking-tighter mb-6">Campanha WhatsApp</h1>
          <div className="space-y-4 text-sm sm:text-base font-bold text-gray-300 leading-relaxed">
            <p>O cliente poderá escolher entre R$30 de desconto ou 1 drink cortesia.</p>
            <p>Válido para pedidos acima de R$50.</p>
            <p>Uso único por cliente e não cumulativo com outras promoções.</p>
            <p>O drink cortesia é válido apenas para maiores de 18 anos.</p>
            <p>O cupom deve ser apresentado antes do fechamento da conta.</p>
            <p className="text-amber-300">Válido até 29/05/2026.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!routeTableNumber) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a0c] p-6 text-center text-white font-['Outfit']">
        <section className="w-full max-w-md border-y border-white/10 py-9">
          <QrCode className="mx-auto h-12 w-12 text-primary" aria-hidden="true" />
          <p className="mt-5 text-[10px] font-black uppercase tracking-[0.24em] text-primary">{t('menu')}</p>
          <h1 className="mt-2 text-4xl font-black leading-tight">{t('scanTableQr')}</h1>
          <p className="mx-auto mt-4 max-w-sm text-sm font-semibold leading-relaxed text-zinc-400">
            {t('scanTableQrDescription')}
          </p>
        </section>
      </main>
    );
  }

  if (isTableAccessReady && qrResolution?.flow === 'comanda') {
    return (
      <ComandaQRExperience
        sourceTableId={qrResolution.physicalTable.id}
        sourceTableNumber={qrResolution.physicalTable.number}
      />
    );
  }

  if (routeTableNumber && tables.length === 0) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] text-white font-['Outfit'] flex items-center justify-center p-8 text-center">
        <div className="glass-card max-w-md p-8 border-primary/30">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-3">Validando mesa</p>
          <h1 className="text-4xl font-black tracking-tighter mb-3">Mesa {routeTableNumber}</h1>
          <p className="text-sm font-bold text-gray-400">
            Estamos abrindo o cardápio desta mesa.
          </p>
        </div>
      </div>
    );
  }

  if (routeTableNumber && tables.length > 0 && !routeTable) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] text-white font-['Outfit'] flex items-center justify-center p-8 text-center">
        <div className="glass-card max-w-md p-8 border-red-500/30">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-300 mb-3">Mesa não encontrada</p>
          <h1 className="text-4xl font-black tracking-tighter mb-3">Mesa {routeTableNumber}</h1>
          <p className="text-sm font-bold text-gray-400">
            Este QR Code não encontrou uma mesa ativa. Chame a equipe para conferir o cadastro.
          </p>
        </div>
      </div>
    );
  }

  if (routeTableNumber && currentTable && !isTableAccessReady) {
    if (tableAccessError) {
      return (
        <main className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a0c] p-6 text-center text-white font-['Outfit']">
          <section className="w-full max-w-md border-y border-rose-500/25 py-8">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-rose-300">Acesso à mesa</p>
            <h1 className="mt-2 text-3xl font-black">Mesa {routeTableNumber}</h1>
            <p className="mt-3 text-sm font-semibold text-zinc-400">{tableAccessError}</p>
            <button
              type="button"
              onClick={() => setTableAccessRetry((current) => current + 1)}
              className="btn-beco btn-beco-purple mx-auto mt-6 inline-flex min-h-11 items-center gap-2 px-5 py-3"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Tentar novamente
            </button>
          </section>
        </main>
      );
    }
    return (
      <div className="min-h-screen bg-[#0a0a0c] text-white font-['Outfit'] flex items-center justify-center p-8 text-center">
        <div className="glass-card max-w-md p-8 border-primary/30">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-3">Validando acesso</p>
          <h1 className="text-4xl font-black tracking-tighter mb-3">Mesa {routeTableNumber}</h1>
          <p className="text-sm font-bold text-gray-400">Estamos liberando o cardápio seguro desta mesa.</p>
        </div>
      </div>
    );
  }

  const cartTotal = getOrderItemsTotal(currentTable?.cart || []);
  const accountTotal = getOrderItemsTotal(currentTable?.orders || []);
  const cartCount = currentTable?.cart.length || 0;
  const accountCount = currentTable?.orders.length || 0;
  const hasCartItems = cartCount > 0;
  const hasAccountItems = accountCount > 0;
  const handlePrimaryAccountAction = () => {
    if (hasCartItems) {
      setIsOrderOpen(true);
      return;
    }
    setIsAccountOpen(true);
  };

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#0a0a0c] text-white font-['Outfit']">
      {/* Header Mobile-Friendly */}
      <div className="fixed top-0 left-0 right-0 h-16 sm:h-20 glass border-b border-white/5 z-50 flex items-center justify-between px-3 sm:px-6 backdrop-blur-3xl bg-black/50">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 bg-primary/20 rounded-2xl flex shrink-0 items-center justify-center text-primary">
            <LayoutDashboard size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[8px] font-black uppercase text-gray-500">{t('table')}</p>
            <h2 className="text-xl font-black tracking-tighter">{currentTable?.number}</h2>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <PublicLanguageMenu />
          <button 
            onClick={() => setIsServiceOpen(true)} 
            className="p-3 glass rounded-xl text-primary active:scale-95 transition-all"
            aria-label={t('callService')}
          >
            <Bell size={18} />
          </button>
          <button 
            onClick={handlePrimaryAccountAction}
            className="btn-beco btn-beco-purple px-4 py-3 relative active:scale-95"
            aria-label={hasCartItems ? t('order') : t('viewAccount')}
          >
            <ShoppingBag size={18} />
            {(hasCartItems || hasAccountItems) && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-[#0a0a0c]">
                {hasCartItems ? cartCount : accountCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="h-full pt-16 sm:pt-20 pb-[6.5rem] sm:pb-28">
        <MenuCatalog
          onProductSelect={setSelectedProduct}
          viewMode="list"
          navigationMode="continuous"
          presentation="compact-menu"
          footerContent={(
            <footer className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-4 text-center shadow-2xl shadow-black/20">
              <p className="text-[10px] sm:text-xs font-black uppercase tracking-[0.24em] text-zinc-500">
                Becoartes Ltda • CNPJ 35.118.706.0001-37
              </p>
            </footer>
          )}
        />
      </div>

      {/* CTA principal do celular: revisar/enviar pedido quando houver carrinho */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50">
        <button 
          onClick={handlePrimaryAccountAction}
          className="w-full sm:w-auto glass-card px-5 sm:px-8 py-4 flex items-center justify-center gap-4 border-primary/30 shadow-2xl shadow-primary/20 sm:scale-110 active:scale-95 transition-all"
        >
          {hasCartItems ? <Send size={20} className="text-accent" /> : <FileText size={20} className="text-accent" />}
          <div className="text-left">
            <p className="text-[8px] font-black uppercase text-gray-500">
              {hasCartItems
                ? `${cartCount} item${cartCount > 1 ? 's' : ''} no pedido`
                : hasAccountItems
                  ? `${accountCount} item${accountCount > 1 ? 's' : ''} na minha conta`
                  : 'Nenhum consumo lançado ainda'}
            </p>
            <p className="text-lg font-black text-white leading-none">
              {hasCartItems
                ? `Enviar meu pedido - ${formatCurrency(cartTotal)}`
                : `Minha conta - ${formatCurrency(accountTotal)}`}
            </p>
          </div>
        </button>
      </div>

      <AnimatePresence>
        {selectedProduct && (
          <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} tabletLandscape qrMobileFlow />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAccountOpen && (
          <CustomerAccountModal onClose={() => setIsAccountOpen(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOrderOpen && (
          <CustomerOrderModal
            onClose={() => setIsOrderOpen(false)}
            onSent={() => setIsAccountOpen(true)}
            origin="qr"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isServiceOpen && (
          <ServiceRequestModal onClose={() => setIsServiceOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function ComandaQRExperience({
  sourceTableId,
  sourceTableNumber,
}: {
  sourceTableId: string;
  sourceTableNumber: number;
}) {
  const { currentTableId, tables, setCurrentTableId } = useStore();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isOrderOpen, setIsOrderOpen] = useState(false);
  const [isServiceOpen, setIsServiceOpen] = useState(false);
  const [tab, setTab] = useState<CustomerTab | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [recoverMode, setRecoverMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const currentTable = tab?.tableId
    ? tables.find(t => t.id === tab.tableId)
    : tables.find(t => t.id === currentTableId);

  usePublicTablePolling(tab ? {
    tableId: tab.tableId,
    customerTabContext: { customerTabId: tab.id, sourceTableId, sourceTableNumber },
  } : null);

  useEffect(() => {
    const savedCpf = localStorage.getItem(CUSTOMER_TAB_CPF_KEY);
    if (!savedCpf) return;
    let cancelled = false;
    CustomerTabApi.recover(savedCpf, { sourceTableId, sourceTableNumber })
      .then(async ({ tab: recovered }) => {
        if (cancelled) return;
        setTab(recovered);
        setCurrentTableId(recovered.tableId);
        const { table } = await AppApi.getPublicTableState({
          tableId: recovered.tableId,
          customerTabContext: { customerTabId: recovered.id, sourceTableId, sourceTableNumber },
        });
        if (!cancelled) applyPublicTableState(table);
      })
      .catch(() => localStorage.removeItem(CUSTOMER_TAB_CPF_KEY));
    return () => {
      cancelled = true;
    };
  }, [setCurrentTableId, sourceTableId, sourceTableNumber]);

  const submit = async () => {
    setError('');
    setIsSubmitting(true);
    const normalizedCpf = normalizeCpfInput(cpf);
    try {
      const result = recoverMode
        ? await CustomerTabApi.recover(normalizedCpf, { sourceTableId, sourceTableNumber })
        : await CustomerTabApi.open({
            customerName,
            phone,
            cpf: normalizedCpf,
            source: { sourceTableId, sourceTableNumber },
          });
      setTab(result.tab);
      setCurrentTableId(result.tab.tableId);
      localStorage.setItem(CUSTOMER_TAB_CPF_KEY, normalizedCpf);
      const { table } = await AppApi.getPublicTableState({
        tableId: result.tab.tableId,
        customerTabContext: { customerTabId: result.tab.id, sourceTableId, sourceTableNumber },
      });
      applyPublicTableState(table);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir sua comanda.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!tab || !currentTable) {
    return (
      <div className="h-[100dvh] overflow-y-auto custom-scrollbar overscroll-contain bg-[#0a0a0c] text-white font-['Outfit'] px-4 py-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex min-h-full w-full max-w-md items-start sm:items-center">
        <div className="w-full glass-card border-primary/30 p-5 sm:p-7 shadow-2xl shadow-primary/10">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-3xl bg-primary/20 text-primary flex items-center justify-center mb-5 sm:mb-6">
            <BadgeCheck size={26} />
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.32em] text-primary mb-3">Modo comanda</p>
          <h1 className="text-3xl sm:text-4xl font-black italic tracking-tighter mb-3">
            {recoverMode ? 'Voltar para minha comanda' : 'Abrir minha comanda'}
          </h1>
          <p className="text-xs sm:text-sm font-bold text-zinc-400 leading-relaxed mb-5 sm:mb-7">
            Use seu CPF para identificar sua comanda e continue neste celular até o fechamento. Se trocar de aparelho, peça ajuda à equipe.
          </p>

          {error && (
            <div className="mb-5 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm font-black text-rose-200">
              {error}
            </div>
          )}

          <div className="space-y-3 sm:space-y-4">
            {!recoverMode && (
              <>
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Nome</span>
                  <div className="mt-2 flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-4">
                    <UserRound size={18} className="text-primary" />
                    <input name="name" autoComplete="name" value={customerName} onChange={e => setCustomerName(e.target.value)} className="w-full bg-transparent py-4 sm:py-5 outline-none font-black" placeholder="Seu nome" />
                  </div>
                </label>
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Telefone</span>
                  <div className="mt-2 flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-4">
                    <Phone size={18} className="text-primary" />
                    <input name="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" className="w-full bg-transparent py-4 sm:py-5 outline-none font-black" placeholder="WhatsApp" />
                  </div>
                </label>
              </>
            )}
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">CPF</span>
              <input
                value={cpf}
                name="cpf"
                autoComplete="off"
                onChange={e => setCpf(normalizeCpfInput(e.target.value))}
                inputMode="numeric"
                className="mt-2 w-full rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 sm:py-5 outline-none text-xl sm:text-2xl font-black tracking-[0.16em] focus:border-primary/70"
                placeholder="00000000000"
              />
            </label>
          </div>

          <button
            onClick={submit}
            disabled={isSubmitting || cpf.length < 11 || (!recoverMode && (!customerName.trim() || !phone.trim()))}
            className="mt-5 sm:mt-7 w-full btn-beco btn-beco-purple py-4 sm:py-5 rounded-2xl font-black uppercase tracking-widest disabled:opacity-40 disabled:grayscale"
          >
            {isSubmitting ? 'Validando...' : recoverMode ? 'Entrar na minha comanda' : 'Abrir comanda'}
          </button>

          <button
            onClick={() => {
              setRecoverMode(!recoverMode);
              setError('');
            }}
            className="mt-3 sm:mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.03] py-4 text-xs font-black uppercase tracking-widest text-zinc-400"
          >
            {recoverMode ? 'Criar nova comanda' : 'Retomar comanda neste celular'}
          </button>
        </div>
        </div>
      </div>
    );
  }

  const cartTotal = getOrderItemsTotal(currentTable.cart || []);
  const accountTotal = getOrderItemsTotal(currentTable.orders || []);
  const cartCount = currentTable.cart.length || 0;
  const accountCount = currentTable.orders.length || 0;
  const hasCartItems = cartCount > 0;
  const hasAccountItems = accountCount > 0;
  const handlePrimaryAccountAction = () => hasCartItems ? setIsOrderOpen(true) : setIsAccountOpen(true);

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#0a0a0c] text-white font-['Outfit']">
      <div className="fixed top-0 left-0 right-0 h-20 glass border-b border-white/5 z-50 flex items-center justify-between px-3 sm:px-6 backdrop-blur-3xl bg-black/60">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 bg-primary/20 rounded-2xl flex shrink-0 items-center justify-center text-primary">
            <BadgeCheck size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[8px] font-black uppercase text-gray-500">Comanda {tab.tableNumber}</p>
            <h2 className="text-lg font-black tracking-tighter truncate">{tab.customerName}</h2>
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Mesa {sourceTableNumber} • {tab.cpfMasked}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsServiceOpen(true)} className="p-3 glass rounded-xl text-primary active:scale-95 transition-all" aria-label="Chamar atendimento">
            <Bell size={18} />
          </button>
          <button onClick={handlePrimaryAccountAction} className="btn-beco btn-beco-purple px-4 py-3 relative active:scale-95" aria-label={hasCartItems ? 'Ver pedido antes de enviar' : 'Ver minha conta'}>
            <ShoppingBag size={18} />
            {(hasCartItems || hasAccountItems) && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-[#0a0a0c]">
                {hasCartItems ? cartCount : accountCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="h-full pt-20 pb-[6.5rem] sm:pb-28">
        <MenuCatalog
          onProductSelect={setSelectedProduct}
          viewMode="grid"
          navigationMode="continuous"
          presentation="compact-menu"
          footerContent={(
            <footer className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-4 text-center shadow-2xl shadow-black/20">
              <p className="text-[10px] sm:text-xs font-black uppercase tracking-[0.24em] text-zinc-500">
                Becoartes Ltda • CNPJ 35.118.706.0001-37
              </p>
            </footer>
          )}
        />
      </div>

      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50">
        <button onClick={handlePrimaryAccountAction} className="w-full sm:w-auto glass-card px-5 sm:px-8 py-4 flex items-center justify-center gap-4 border-primary/30 shadow-2xl shadow-primary/20 sm:scale-110 active:scale-95 transition-all">
          {hasCartItems ? <Send size={20} className="text-accent" /> : <FileText size={20} className="text-accent" />}
          <div className="text-left">
            <p className="text-[8px] font-black uppercase text-gray-500">
              {hasCartItems ? `${cartCount} item${cartCount > 1 ? 's' : ''} no pedido` : hasAccountItems ? `${accountCount} item${accountCount > 1 ? 's' : ''} na minha comanda` : 'Nenhum consumo lançado ainda'}
            </p>
            <p className="text-lg font-black text-white leading-none">
              {hasCartItems ? `Enviar meu pedido - ${formatCurrency(cartTotal)}` : `Minha comanda - ${formatCurrency(accountTotal)}`}
            </p>
          </div>
        </button>
      </div>

      <AnimatePresence>
        {selectedProduct && <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} tabletLandscape qrMobileFlow />}
        {isAccountOpen && (
          <CustomerAccountModal
            onClose={() => setIsAccountOpen(false)}
            locationLabel={`Comanda ${tab.tableNumber} • Mesa ${sourceTableNumber}`}
          />
        )}
        {isOrderOpen && (
          <CustomerOrderModal
            onClose={() => setIsOrderOpen(false)}
            onSent={() => setIsAccountOpen(true)}
            origin="qr"
            customerTabContext={{ customerTabId: tab.id, sourceTableId, sourceTableNumber }}
          />
        )}
        {isServiceOpen && (
          <ServiceRequestModal
            onClose={() => setIsServiceOpen(false)}
            customerTabContext={{ customerTabId: tab.id, sourceTableId, sourceTableNumber }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
