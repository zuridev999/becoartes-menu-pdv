import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ShoppingCart, LayoutDashboard, Bell, FileText } from 'lucide-react';
import { useStore, type Product } from '../../store';
import { TabletEntry } from '../entry/TabletEntry';
import { MenuCatalog } from '../../components/shared/MenuCatalog';
import { ProductModal } from '../../components/modals/ProductModal';
import { CheckoutModal } from '../../components/modals/CheckoutModal';

export function TabletView() {
  const { currentTableId, tables, requestService, addNotification, settings } = useStore();
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);

  const currentTable = tables.find(t => t.id === currentTableId);

  // Se não tem mesa selecionada ou não desbloqueou com PIN
  if (!currentTableId || !isUnlocked) {
    return <TabletEntry onUnlock={() => setIsUnlocked(true)} />;
  }

  const cartTotal = currentTable?.cart.reduce((acc, o) => {
    const itemPrice = o.price + (o.selectedModifiers?.reduce((mAcc, m) => mAcc + m.price, 0) || 0);
    return acc + (itemPrice * o.quantity);
  }, 0) || 0;

  const viewMode = settings.tablet.viewMode;

  return (
    <div className="flex h-screen bg-[#0a0a0c] text-white font-['Outfit'] overflow-hidden relative">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 h-24 glass border-b border-white/5 z-[100] flex items-center justify-between px-12 backdrop-blur-3xl bg-black/40">
        <div className="flex items-center gap-12">
          <div className="flex items-center gap-6">
            <div className="w-14 h-14 bg-primary/20 rounded-3xl flex items-center justify-center text-primary">
              <LayoutDashboard size={28} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase text-gray-500">Mesa</p>
              <h2 className="text-3xl font-black tracking-tighter">{currentTable?.number}</h2>
            </div>
          </div>
          <div className="flex gap-4">
            <button 
              onClick={() => { requestService(currentTableId, 'waiter'); addNotification('Garçom chamado!'); }} 
              className="glass px-6 py-4 rounded-2xl flex items-center gap-3 font-black text-xs uppercase tracking-widest hover:bg-white/10"
            >
              <Bell size={18} className="text-primary" /> Chamar Garçom
            </button>
            <button 
              onClick={() => setIsAccountOpen(true)} 
              className="glass px-6 py-4 rounded-2xl flex items-center gap-3 font-black text-xs uppercase tracking-widest hover:bg-white/10"
            >
              <FileText size={18} className="text-accent" /> Minha Conta
            </button>
          </div>
        </div>

        <div className="flex items-center gap-6">
           <div className="flex flex-col items-end">
             <p className="text-[10px] font-black uppercase text-gray-500">Total Carrinho</p>
             <p className="text-2xl font-black text-accent">R$ {cartTotal.toFixed(2)}</p>
           </div>
           <button 
            onClick={() => setIsAccountOpen(true)} 
            className="btn-beco btn-beco-purple px-10 py-5 relative pr-20 shadow-xl overflow-hidden group"
           >
              <ShoppingCart size={22}/> <span className="font-black text-lg ml-3">CARRINHO</span>
              <div className="absolute right-3 top-3 bottom-3 w-14 bg-white/10 rounded-2xl flex items-center justify-center font-black text-lg">
                {currentTable?.cart.length || 0}
              </div>
           </button>
        </div>
      </div>

      <div className="flex-1 pt-24 h-full">
        <MenuCatalog onProductSelect={setSelectedProduct} viewMode={viewMode} />
      </div>

      <AnimatePresence>
        {selectedProduct && (
          <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAccountOpen && currentTable && (
          <CheckoutModal table={currentTable} onClose={() => setIsAccountOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
