import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ShoppingBag, LayoutDashboard, Bell, FileText } from 'lucide-react';
import { useStore, type Product } from '../../store';
import { TabletEntry } from '../entry/TabletEntry';
import { MenuCatalog } from '../../components/shared/MenuCatalog';
import { ProductModal } from '../../components/modals/ProductModal';
import { CustomerAccountModal } from '../../components/modals/CustomerAccountModal';
import { CustomerOrderModal } from '../../components/modals/CustomerOrderModal';
import { ServiceRequestModal } from '../../components/modals/ServiceRequestModal';

export function TabletView() {
  const { currentTableId, tables, settings, syncData } = useStore();
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isOrderOpen, setIsOrderOpen] = useState(false);
  const [isServiceOpen, setIsServiceOpen] = useState(false);

  // Sincronização Automática (60s)
  useEffect(() => {
    const interval = setInterval(() => {
      console.log("🔄 Tablet auto-syncing...");
      syncData();
    }, 60000);
    return () => clearInterval(interval);
  }, [syncData]);

  const currentTable = tables.find(t => t.id === currentTableId);

  // Se não tem mesa selecionada ou não desbloqueou com PIN
  if (!currentTableId || !isUnlocked) {
    return <TabletEntry onUnlock={() => setIsUnlocked(true)} />;
  }

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
              onClick={() => setIsServiceOpen(true)} 
              className="glass px-6 py-4 rounded-2xl flex items-center gap-3 font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95"
            >
              <Bell size={18} className="text-primary" /> Chamar Garçom
            </button>
            <button 
              onClick={() => setIsAccountOpen(true)} 
              className="glass px-6 py-4 rounded-2xl flex items-center gap-3 font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95"
            >
              <FileText size={18} className="text-accent" /> Minha Conta
            </button>
          </div>
        </div>

         <div className="flex items-center gap-6">
            <motion.button 
             onClick={() => setIsOrderOpen(true)} 
             animate={currentTable?.cart.length > 0 ? {
               scale: [1, 1.05, 1],
               transition: { duration: 0.8, repeat: Infinity }
             } : { scale: 1 }}
             className={`px-10 py-5 relative pr-20 shadow-xl overflow-hidden group active:scale-95 transition-all rounded-[2rem] font-black flex items-center ${
               currentTable?.cart.length > 0 
                 ? 'bg-rose-600 text-white shadow-rose-500/30' 
                 : 'bg-primary text-white shadow-primary/30'
             }`}
            >
               <ShoppingBag size={22}/> <span className="font-black text-lg ml-3 uppercase">Enviar Pedido</span>
               <div className={`absolute right-3 top-3 bottom-3 w-14 rounded-2xl flex items-center justify-center font-black text-lg transition-colors ${
                 currentTable?.cart.length > 0 ? 'bg-white/20' : 'bg-black/10'
               }`}>
                 {currentTable?.cart.length || 0}
               </div>
            </motion.button>
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
