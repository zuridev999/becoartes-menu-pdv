import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ShoppingBag, LayoutDashboard, Bell, FileText } from 'lucide-react';
import { useStore, type Product } from '../../store';
import { MenuCatalog } from '../../components/shared/MenuCatalog';
import { ProductModal } from '../../components/modals/ProductModal';
import { CustomerAccountModal } from '../../components/modals/CustomerAccountModal';
import { CustomerOrderModal } from '../../components/modals/CustomerOrderModal';
import { ServiceRequestModal } from '../../components/modals/ServiceRequestModal';

export function QRView() {
  const { currentTableId, tables } = useStore();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isOrderOpen, setIsOrderOpen] = useState(false);
  const [isServiceOpen, setIsServiceOpen] = useState(false);

  const currentTable = tables.find(t => t.id === currentTableId);

  // QR View no Becoartes não trava em mesa, mostra cardápio direto.
  // Se houver ID na URL ele vincula, se não mostra tudo livre.

  const cartTotal = currentTable?.cart.reduce((acc, o) => {
    const itemPrice = o.price + (o.selectedModifiers?.reduce((mAcc, m) => mAcc + m.price, 0) || 0);
    return acc + (itemPrice * o.quantity);
  }, 0) || 0;

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white font-['Outfit']">
      {/* Header Mobile-Friendly */}
      <div className="fixed top-0 left-0 right-0 h-20 glass border-b border-white/5 z-50 flex items-center justify-between px-6 backdrop-blur-3xl bg-black/40">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-primary/20 rounded-2xl flex items-center justify-center text-primary">
            <LayoutDashboard size={20} />
          </div>
          <div>
            <p className="text-[8px] font-black uppercase text-gray-500">Mesa</p>
            <h2 className="text-xl font-black tracking-tighter">{currentTable?.number}</h2>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsServiceOpen(true)} 
            className="p-3 glass rounded-xl text-primary"
          >
            <Bell size={20} />
          </button>
          <button 
            onClick={() => setIsOrderOpen(true)}
            className="btn-beco btn-beco-purple px-4 py-3 relative"
          >
            <ShoppingBag size={20} />
            {currentTable?.cart.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-[#0a0a0c]">
                {currentTable.cart.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="pt-20 pb-24">
        <MenuCatalog onProductSelect={setSelectedProduct} viewMode="grid" />
      </div>

      {/* Floating Action Button para ver a conta */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
        <button 
          onClick={() => setIsAccountOpen(true)}
          className="glass-card px-8 py-4 flex items-center gap-4 border-primary/30 shadow-2xl shadow-primary/20 scale-110 active:scale-95 transition-all"
        >
          <FileText size={20} className="text-accent" />
          <div className="text-left">
            <p className="text-[8px] font-black uppercase text-gray-500">Total do Pedido</p>
            <p className="text-lg font-black text-white leading-none">R$ {cartTotal.toFixed(2)}</p>
          </div>
        </button>
      </div>

      <AnimatePresence>
        {selectedProduct && (
          <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAccountOpen && (
          <CustomerAccountModal onClose={() => setIsAccountOpen(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOrderOpen && (
          <CustomerOrderModal onClose={() => setIsOrderOpen(false)} />
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
