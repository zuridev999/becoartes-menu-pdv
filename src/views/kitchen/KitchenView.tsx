import { useState, useEffect } from 'react';
import { Clock, CheckCircle2, X, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../store';

function KitchenOrderCard({ order, onClick }: { order: any, onClick: () => void }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const { serverTimeOffset } = useStore();

  useEffect(() => {
    const updateTimer = () => {
      if (!order.createdAt) return;
      const createdDate = new Date(order.createdAt);
      if (isNaN(createdDate.getTime())) return;
      const serverNow = new Date().getTime() + serverTimeOffset;
      setElapsedMs(Math.max(0, serverNow - createdDate.getTime()));
    };
    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [order.createdAt]);

  const mins = Math.floor(elapsedMs / 60000);
  const secs = Math.floor((elapsedMs % 60000) / 1000);
  const timeText = `${mins}:${secs.toString().padStart(2, '0')}`;
  const isWarning = mins >= 10 && mins < 20;
  const isDanger = mins >= 20;

  return (
    <motion.div 
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`glass-card p-6 cursor-pointer relative border-t-[8px] transition-all duration-300 h-full flex flex-col ${
        isDanger ? 'bg-rose-500/20 border-rose-500 shadow-xl shadow-rose-500/10' : 
        isWarning ? 'bg-amber-500/10 border-amber-500' : 
        'bg-white/5 border-accent'
      }`}
    >
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-4xl font-black italic tracking-tighter">Mesa {order.tableNumber}</h3>
        <div className={`flex items-center gap-1 font-black ${isDanger ? 'text-rose-500 animate-pulse' : isWarning ? 'text-amber-500' : 'text-accent'}`}>
          <Clock size={18} />
          <span className="text-xl">{timeText}</span>
        </div>
      </div>

      <div className="flex-1">
        <p className="text-xs font-black uppercase tracking-widest text-white/40 mb-3">{order.items.length} Itens</p>
        <div className="space-y-2">
          {order.items.slice(0, 3).map((item: any, idx: number) => (
            <div key={idx} className="flex gap-2 items-center">
              <span className="font-black text-accent text-lg">{item.quantity}x</span>
              <span className="font-bold text-lg truncate">{item.name}</span>
            </div>
          ))}
          {order.items.length > 3 && (
            <p className="text-xs font-bold text-white/30 ml-8">+ {order.items.length - 3} outros itens...</p>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
        <span className="text-[10px] font-black uppercase tracking-widest text-white/30">Clique para abrir</span>
        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${isDanger ? 'bg-rose-500 text-white' : 'bg-accent/20 text-accent'}`}>
          {isDanger ? 'Atrasado' : 'Em Preparo'}
        </span>
      </div>
    </motion.div>
  );
}

function KitchenOrderDetailModal({ order, onClose, onComplete }: { order: any, onClose: () => void, onComplete: () => void }) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 50 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 50 }}
        className="w-full max-w-5xl bg-[#0d0d0f] rounded-[3rem] border border-white/10 shadow-3xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-10 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
          <div className="flex items-center gap-8">
             <div className="w-20 h-20 bg-accent/20 rounded-[2rem] flex items-center justify-center text-accent">
                <Clock size={40} />
             </div>
             <div>
                <h2 className="text-6xl font-black italic tracking-tighter">Mesa {order.tableNumber}</h2>
                <p className="text-accent font-black uppercase tracking-[0.3em] text-sm">Detalhes do Pedido</p>
             </div>
          </div>
          <button onClick={onClose} className="p-6 glass rounded-full hover:bg-rose-500/20 text-rose-500 transition-all">
            <X size={40} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
           <div className="grid grid-cols-1 gap-6">
              {order.items.map((item: any, idx: number) => (
                <div key={idx} className="p-8 glass rounded-[2.5rem] border-white/5 bg-white/[0.01]">
                   <div className="flex justify-between items-start">
                      <div className="flex items-center gap-6">
                         <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center text-3xl font-black text-accent">
                           {item.quantity}x
                         </div>
                         <h4 className="text-4xl font-black tracking-tight">{item.name}</h4>
                      </div>
                   </div>

                   {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                     <div className="mt-6 flex flex-wrap gap-3 ml-20">
                        {item.selectedModifiers.map((m: any, mIdx: number) => (
                          <span key={mIdx} className="px-5 py-2 bg-accent/10 text-accent rounded-xl text-sm font-black uppercase tracking-widest border border-accent/20">
                            + {m.name}
                          </span>
                        ))}
                     </div>
                   )}

                   {item.notes && (
                     <div className="mt-6 p-6 bg-rose-500/5 border border-rose-500/10 rounded-2xl ml-20">
                        <p className="text-xs font-black uppercase text-rose-500 mb-2 tracking-widest">Observação do Item:</p>
                        <p className="text-2xl font-bold text-white italic">"{item.notes}"</p>
                     </div>
                   )}
                </div>
              ))}
           </div>
        </div>

        <div className="p-10 bg-black/60 border-t border-white/5">
           <button 
             onClick={() => setShowConfirm(true)}
             className="w-full py-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-[2rem] text-3xl font-black uppercase tracking-widest shadow-2xl shadow-emerald-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-4"
           >
             <CheckCircle2 size={36} /> Finalizar Pedido
           </button>
        </div>

        <AnimatePresence>
          {showConfirm && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-[600] bg-black/95 backdrop-blur-md flex items-center justify-center p-10"
            >
              <div className="text-center max-w-2xl">
                 <div className="w-24 h-24 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-8">
                    <AlertCircle size={60} />
                 </div>
                 <h3 className="text-5xl font-black mb-12 leading-tight">Você confirma que todos os itens deste pedido foram finalizados?</h3>
                 <div className="grid grid-cols-2 gap-6">
                    <button 
                      onClick={onComplete}
                      className="py-8 bg-emerald-500 text-white rounded-[2rem] text-xl font-black uppercase tracking-widest"
                    >
                      Sim, finalizar
                    </button>
                    <button 
                      onClick={() => setShowConfirm(false)}
                      className="py-8 bg-white/5 text-white/60 rounded-[2rem] text-xl font-black uppercase tracking-widest border border-white/10"
                    >
                      Não, voltar
                    </button>
                 </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

export function KitchenView() {
  const { kitchenOrders, updateKitchenOrderStatus } = useStore();
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  const activeOrders = kitchenOrders.filter((o: any) => o.status !== 'ready');
  
  return (
    <div className="p-12 bg-[#08080a] min-h-screen text-white font-['Outfit'] overflow-hidden flex flex-col">
      <div className="flex justify-between items-center mb-12">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-accent rounded-3xl flex items-center justify-center text-black">
             <CheckCircle2 size={32} />
          </div>
          <h1 className="text-6xl font-black italic tracking-tighter uppercase">Cozinha <span className="text-accent">Live</span></h1>
        </div>
        <div className="glass px-8 py-4 rounded-3xl border-white/5 flex items-center gap-4">
           <div className="w-4 h-4 bg-accent rounded-full animate-pulse shadow-[0_0_15px_rgba(255,200,0,0.5)]" />
           <p className="text-2xl font-black uppercase tracking-widest">{activeOrders.length} Pedidos na Fila</p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 auto-rows-fr">
        {activeOrders.map((order: any) => (
          <KitchenOrderCard 
            key={order.id} 
            order={order} 
            onClick={() => setSelectedOrder(order)} 
          />
        ))}
      </div>

      <AnimatePresence>
        {selectedOrder && (
          <KitchenOrderDetailModal 
            order={selectedOrder} 
            onClose={() => setSelectedOrder(null)}
            onComplete={() => {
              updateKitchenOrderStatus(selectedOrder.id, 'ready');
              setSelectedOrder(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
