import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ShoppingBag, LayoutDashboard, Bell, FileText, Send } from 'lucide-react';
import { useStore, type Product } from '../../store';
import { MenuCatalog } from '../../components/shared/MenuCatalog';
import { ProductModal } from '../../components/modals/ProductModal';
import { CustomerAccountModal } from '../../components/modals/CustomerAccountModal';
import { CustomerOrderModal } from '../../components/modals/CustomerOrderModal';
import { ServiceRequestModal } from '../../components/modals/ServiceRequestModal';
import { getOrderItemsTotal } from '../../lib/totals';

export function QRView() {
  const { currentTableId, tables, setCurrentTableId } = useStore();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isOrderOpen, setIsOrderOpen] = useState(false);
  const [isServiceOpen, setIsServiceOpen] = useState(false);
  const [routeTableNumber, setRouteTableNumber] = useState<number | null>(null);
  const isCouponRulesPage = window.location.pathname.includes('regulamento-cupom');

  useEffect(() => {
    const pathMatch = window.location.pathname.match(/(?:^|\/)mesa\/(\d+)(?:\/)?$/);
    const params = new URLSearchParams(window.location.search);
    const tableFromUrl = pathMatch?.[1] || params.get('mesa') || params.get('table');
    const tableNumber = Number(tableFromUrl);

    if (!Number.isFinite(tableNumber) || tableNumber <= 0) return;

    setRouteTableNumber(tableNumber);

    const table = tables.find(t => t.number === tableNumber);
    if (table && table.id !== currentTableId) {
      setCurrentTableId(table.id);
    }
  }, [currentTableId, setCurrentTableId, tables]);

  const routeTable = routeTableNumber ? tables.find(t => t.number === routeTableNumber) : null;
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
            <p className="text-[8px] font-black uppercase text-gray-500">Mesa</p>
            <h2 className="text-xl font-black tracking-tighter">{currentTable?.number}</h2>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsServiceOpen(true)} 
            className="p-3 glass rounded-xl text-primary active:scale-95 transition-all"
            aria-label="Chamar atendimento"
          >
            <Bell size={18} />
          </button>
          <button 
            onClick={handlePrimaryAccountAction}
            className="btn-beco btn-beco-purple px-4 py-3 relative active:scale-95"
            aria-label={hasCartItems ? 'Ver pedido antes de enviar' : 'Ver minha conta'}
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
          viewMode="grid"
          navigationMode="continuous"
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
                ? `Enviar meu pedido - R$ ${cartTotal.toFixed(2)}`
                : `Minha conta - R$ ${accountTotal.toFixed(2)}`}
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
