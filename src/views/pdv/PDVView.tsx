import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, ShoppingCart, 
  Trash2, Wallet, LogOut, CheckCircle2
} from 'lucide-react';
import { useStore, type Product } from '../../store';
import { Badge } from '../../components/common/UI';
import { ProductModal } from '../../components/modals/ProductModal';
import { CheckoutModal } from '../../components/modals/CheckoutModal';
import { OpenTableModal } from '../../components/modals/OpenTableModal';

import { isItemAvailable } from '../../lib/utils';

export function PDVView() {
  const { 
    menu, tables, logout, currentSeller, 
    setCurrentTableId, currentTableId,
    removeOrderItem, sendToKitchen, categories: dbCategories
  } = useStore();
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOpenTableModalOpen, setIsOpenTableModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  
  console.log("🛒 PDVView Render", { menu: menu?.length, categories: dbCategories?.length, tableId: currentTableId });

  const categories = ['Todos', ...dbCategories.map(c => c.name)];
  const currentTable = tables.find(t => t.id === currentTableId);

  const filteredMenu = menu.filter(p => {
    if (!p.visible) return false;
    
    // Category Schedule
    const cat = dbCategories.find(c => c.id === p.categoryId);
    if (cat) {
      const { available: catAvailable } = isItemAvailable(cat.schedule);
      if (!catAvailable && cat.schedule?.hideTotally) return false;
    }

    // Product Schedule
    const { available } = isItemAvailable(p.schedule);
    if (!available && p.schedule?.hideTotally) return false;

    return (selectedCategory === 'Todos' || p.categoryName === selectedCategory);
  });

  const cartTotal = currentTable?.orders.reduce((acc: number, o: any) => {
    const modifiersTotal = o.selectedModifiers?.reduce((mAcc: number, m: any) => mAcc + m.price, 0) || 0;
    return acc + ((o.price + modifiersTotal) * o.quantity);
  }, 0) || 0;

  return (
    <div className="flex h-screen bg-[#0a0a0c] text-white font-['Outfit'] overflow-hidden">
      {/* Sidebar de Mesas */}
      <div className="w-96 glass border-r border-white/5 flex flex-col p-8 z-30">
        <div className="flex justify-between items-center mb-12">
           <h2 className="text-4xl font-black italic tracking-tighter">Beco <span className="text-primary">Tables</span></h2>
           <button onClick={() => setIsOpenTableModalOpen(true)} className="p-3 bg-primary/20 text-primary rounded-xl hover:bg-primary hover:text-white transition-all"><LayoutDashboard size={20}/></button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
          {tables.filter((t: any) => t.status !== 'available').map((table: any) => (
            <button 
              key={table.id} 
              onClick={() => setCurrentTableId(table.id)}
              className={`w-full p-6 rounded-[2rem] border text-left transition-all relative overflow-hidden group ${currentTableId === table.id ? 'bg-primary border-primary shadow-2xl shadow-primary/20 scale-[1.02]' : 'glass border-white/5 hover:bg-white/5'}`}
            >
              <div className="flex justify-between items-start mb-4">
                 <div><p className="font-black text-2xl tracking-tighter italic">Mesa {table.number}</p><Badge color={table.status === 'ordering' ? 'amber' : 'rose'}>{table.status}</Badge></div>
                 <div className="text-right"><p className="text-[10px] font-black uppercase text-white/50">Total</p><p className="font-black text-lg text-accent">R$ {table.orders.reduce((acc: number, o: any) => acc + (o.price * o.quantity), 0).toFixed(2)}</p></div>
              </div>
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{table.orders.length} Itens no pedido</p>
            </button>
          ))}
        </div>
        <div className="mt-8 pt-8 border-t border-white/10 flex items-center justify-between">
           <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center font-black text-xl">{currentSeller?.name.charAt(0)}</div>
              <div><p className="font-black text-sm">{currentSeller?.name}</p><p className="text-[10px] uppercase font-black text-gray-500 tracking-widest">{currentSeller?.role}</p></div>
           </div>
           <button onClick={logout} className="p-4 glass rounded-2xl text-rose-500 hover:bg-rose-500/10"><LogOut size={24}/></button>
        </div>
      </div>

      {/* Grid de Produtos */}
      <div className="flex-1 flex flex-col p-12 overflow-hidden bg-white/[0.01]">
         <div className="flex gap-4 mb-12 overflow-x-auto pb-4 no-scrollbar">
            {categories.map(cat => (
              <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest whitespace-nowrap transition-all ${selectedCategory === cat ? 'bg-primary text-white shadow-xl shadow-primary/20' : 'glass text-gray-500 hover:text-white'}`}>{cat}</button>
            ))}
         </div>
         <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredMenu.map(p => (
                <button key={p.id} onClick={() => setSelectedProduct(p)} className="glass-card p-4 border-white/5 hover:border-primary/30 transition-all group relative overflow-hidden h-fit">
                   <div className="h-40 rounded-2xl overflow-hidden mb-4"><img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-all duration-500" /></div>
                   <h4 className="font-black text-lg mb-1 italic tracking-tighter truncate">{p.name}</h4>
                   <p className="text-accent font-black text-xl tracking-tighter">R$ {p.price.toFixed(2)}</p>
                </button>
              ))}
            </div>
         </div>
      </div>

      {/* Painel de Carrinho */}
      <div className="w-[450px] glass border-l border-white/5 flex flex-col z-30">
        <div className="p-10 border-b border-white/5">
           <h3 className="text-4xl font-black italic tracking-tighter mb-2 flex items-center gap-4">Pedido <ShoppingCart className="text-primary"/></h3>
           <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">Mesa {currentTable?.number || '---'}</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
           {currentTable?.orders.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center opacity-20"><ShoppingCart size={80} className="mb-6"/><p className="text-xl font-black uppercase tracking-widest">Pedido Vazio</p></div>
           ) : (
             currentTable?.orders.map((item: any, idx: number) => (
               <div key={idx} className="flex justify-between items-center group animate-in slide-in-from-right duration-300">
                  <div className="flex-1">
                    <div className="flex gap-4 mb-2">
                       <div className="w-16 h-16 rounded-2xl overflow-hidden shrink-0"><img src={item.image} className="w-full h-full object-cover" /></div>
                       <div>
                         <p className="font-black text-lg italic tracking-tighter leading-none mb-1">{item.name}</p>
                         <p className="text-[10px] font-bold text-primary">{item.quantity}x R$ {item.price.toFixed(2)}</p>
                       </div>
                    </div>
                    {item.selectedModifiers?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {item.selectedModifiers.map((m: any) => (
                          <span key={m.id} className="text-[9px] font-black bg-white/5 px-2 py-0.5 rounded border border-white/5 text-gray-400">+{m.name}</span>
                        ))}
                      </div>
                    )}
                    {item.notes && (
                      <p className="text-[10px] text-rose-400 font-bold italic truncate">"{item.notes}"</p>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                     <p className="font-black text-xl text-accent">R$ {(item.price * item.quantity).toFixed(2)}</p>
                     <button onClick={() => removeOrderItem(item.id)} className="text-rose-500 p-2 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={20}/></button>
                  </div>
               </div>
             ))
           )}
        </div>

        <div className="p-10 bg-black/40 border-t border-white/5 space-y-8 shadow-2xl">
           <div className="space-y-3">
              <div className="flex justify-between text-gray-500 font-bold uppercase text-[10px] tracking-widest"><span>Subtotal</span><span>R$ {cartTotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-4xl font-black text-accent italic tracking-tighter"><span>Total</span><span>R$ {cartTotal.toFixed(2)}</span></div>
           </div>
           
           <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => sendToKitchen(currentTableId!, 'pdv', currentSeller?.id)}
                disabled={!currentTableId || currentTable?.orders.length === 0}
                className="btn-beco btn-beco-purple py-6 font-black text-xs uppercase tracking-widest disabled:opacity-20 flex items-center justify-center gap-3"
              >
                Cozinha <CheckCircle2 size={18}/>
              </button>
              <button 
                onClick={() => setIsCheckoutOpen(true)}
                disabled={!currentTableId || currentTable?.orders.length === 0}
                className="btn-beco btn-beco-purple py-6 font-black text-xs uppercase tracking-widest disabled:opacity-20 flex items-center justify-center gap-3 bg-accent text-black"
              >
                Checkout <Wallet size={18}/>
              </button>
           </div>
        </div>
      </div>

      <AnimatePresence>
        {selectedProduct && (
          <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCheckoutOpen && currentTable && (
          <CheckoutModal table={currentTable} onClose={() => setIsCheckoutOpen(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpenTableModalOpen && (
          <OpenTableModal onClose={() => setIsOpenTableModalOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
