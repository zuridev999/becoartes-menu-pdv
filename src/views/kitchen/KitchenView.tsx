import { useState, useEffect } from 'react';
import { Clock, CheckCircle2, X, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../store';

function KitchenOrderCard({ order, index, onClick }: { order: any, index: number, onClick: () => void }) {
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
      className={`p-6 pt-6 cursor-pointer relative border-[3px] rounded-[2.5rem] transition-all duration-300 h-full flex flex-col shadow-lg uppercase ${
        isDanger ? 'bg-red-600 border-red-700 text-black shadow-red-200' : 
        isWarning ? 'bg-amber-400 border-amber-500 text-black shadow-amber-100' : 
        'bg-white border-gray-100 text-black'
      }`}
    >
      {/* Sequence Number */}
      <div className="absolute -top-4 -left-4 w-12 h-12 bg-black text-white rounded-full flex items-center justify-center font-black text-2xl shadow-xl z-20 border-4 border-white">
        {index}
      </div>

      <div className="flex justify-between items-start mb-4">
        <h3 className="text-4xl font-black italic tracking-tighter">Mesa {order.tableNumber}</h3>
        <div className="flex items-center gap-1 font-black text-black">
          <Clock size={18} />
          <span className="text-xl">{timeText}</span>
        </div>
      </div>

      <div className="flex-1">
        <p className="text-xs font-black uppercase tracking-widest mb-3 opacity-60">{order.items.length} Itens</p>
        <div className="space-y-2">
          {order.items.slice(0, 3).map((item: any, idx: number) => (
            <div key={idx} className="flex gap-2 items-center">
              <span className="font-black text-lg text-black">{item.quantity}x</span>
              <span className="font-bold text-lg truncate">{item.name}</span>
            </div>
          ))}
          {order.items.length > 3 && (
            <p className="text-xs font-bold ml-8 opacity-40">+ {order.items.length - 3} outros itens...</p>
          )}
        </div>
      </div>

      <div className={`mt-4 pt-4 border-t flex justify-between items-center ${isDanger ? 'border-black/20' : 'border-black/5'}`}>
        <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Clique para abrir</span>
        <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-black/10 text-black">
          {isDanger ? 'Atrasado' : isWarning ? 'Atenção' : 'Normal'}
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
      className="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 50 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 50 }}
        className="w-full max-w-5xl bg-white rounded-[3rem] shadow-3xl overflow-hidden flex flex-col max-h-[90vh] uppercase"
      >
        <div className="p-10 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-8">
             <div className="w-20 h-20 bg-black/5 rounded-[2rem] flex items-center justify-center text-black">
                <Clock size={40} />
             </div>
             <div>
                <h2 className="text-6xl font-black italic tracking-tighter text-black">Mesa {order.tableNumber}</h2>
                <p className="text-black/60 font-black uppercase tracking-[0.3em] text-sm">Preparando Agora</p>
             </div>
          </div>
          <button onClick={onClose} className="p-6 bg-gray-100 rounded-full hover:bg-rose-50 text-black transition-all">
            <X size={40} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-12 custom-scrollbar bg-white">
           <div className="grid grid-cols-1 gap-6">
              {order.items.map((item: any, idx: number) => (
                <div key={idx} className="p-8 bg-gray-50 rounded-[2.5rem] border border-gray-100">
                   <div className="flex justify-between items-start">
                      <div className="flex items-center gap-6">
                         <div className="w-16 h-16 bg-white shadow-sm border border-gray-100 rounded-2xl flex items-center justify-center text-3xl font-black text-black">
                           {item.quantity}x
                         </div>
                         <h4 className="text-4xl font-black tracking-tight text-black">{item.name}</h4>
                      </div>
                   </div>

                   {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                     <div className="mt-6 flex flex-wrap gap-3 ml-20">
                        {item.selectedModifiers.map((m: any, mIdx: number) => (
                          <span key={mIdx} className="px-5 py-2 bg-black/5 text-black rounded-xl text-sm font-black uppercase tracking-widest border border-black/10">
                            + {m.name}
                          </span>
                        ))}
                     </div>
                   )}

                   {item.notes && (
                     <div className="mt-6 p-6 bg-rose-50 border border-rose-100 rounded-2xl ml-20">
                        <p className="text-xs font-black uppercase text-black mb-2 tracking-widest">Observação do Item:</p>
                        <p className="text-2xl font-bold text-black italic">"{item.notes}"</p>
                     </div>
                   )}
                </div>
              ))}
           </div>
        </div>

        <div className="p-10 bg-gray-50 border-t border-gray-100">
           <button 
             onClick={() => setShowConfirm(true)}
             className="w-full py-8 bg-black text-white rounded-[2rem] text-3xl font-black uppercase tracking-widest shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-4"
           >
             <CheckCircle2 size={36} /> Finalizar Pedido
           </button>
        </div>

        <AnimatePresence>
          {showConfirm && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-[600] bg-white/95 backdrop-blur-sm flex items-center justify-center p-10"
            >
              <div className="text-center max-w-2xl">
                 <div className="w-24 h-24 bg-black/5 text-black rounded-full flex items-center justify-center mx-auto mb-8">
                    <AlertCircle size={60} />
                 </div>
                 <h3 className="text-5xl font-black mb-12 leading-tight text-black">Confirmar finalização de todos os itens?</h3>
                 <div className="grid grid-cols-2 gap-6">
                    <button 
                      onClick={onComplete}
                      className="py-8 bg-black text-white rounded-[2rem] text-xl font-black uppercase tracking-widest shadow-lg"
                    >
                      Sim, finalizar
                    </button>
                    <button 
                      onClick={() => setShowConfirm(false)}
                      className="py-8 bg-gray-100 text-black rounded-[2rem] text-xl font-black uppercase tracking-widest"
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
    <div className="p-4 bg-white h-screen text-black font-['Outfit'] overflow-hidden flex flex-col uppercase">
      <div className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar py-4 px-4">
        <div className="grid grid-rows-2 grid-flow-col gap-8 h-full" style={{ gridAutoColumns: 'calc(33.333% - 24px)', minWidth: '100%' }}>
          {activeOrders.map((order: any, idx: number) => (
            <KitchenOrderCard 
              key={order.id} 
              order={order} 
              index={idx + 1}
              onClick={() => setSelectedOrder(order)} 
            />
          ))}
        </div>
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
