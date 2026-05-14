import { useState, useEffect, useRef } from 'react';
import { Clock, CheckCircle2, X, AlertCircle, Bell } from 'lucide-react';
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
      <div className="absolute -top-6 -left-6 w-16 h-16 bg-black text-white rounded-full flex items-center justify-center font-black text-4xl shadow-2xl z-20 border-4 border-white">
        {index}
      </div>

      <div className="flex justify-between items-start mb-6">
        <h3 className="text-6xl font-black italic tracking-tighter">Mesa {order.tableNumber}</h3>
        <div className="flex items-center gap-2 font-black text-black">
          <Clock size={28} />
          <span className="text-3xl">{timeText}</span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden mt-4">
        <p className="text-sm font-black uppercase tracking-[0.3em] mb-4 opacity-40">{order.items.length} Itens no Pedido</p>
        <div className={`mt-2 ${order.items.length > 5 ? 'grid grid-cols-2 gap-x-8 gap-y-3' : 'space-y-3'}`}>
          {order.items.slice(0, 10).map((item: any, idx: number) => (
            <div key={idx} className="flex gap-3 items-center min-w-0">
              <span className="font-black text-2xl text-black shrink-0">{item.quantity}X</span>
              <span className="font-black text-lg tracking-tighter truncate leading-none">{item.name}</span>
            </div>
          ))}
          {order.items.length > 10 && (
            <p className="text-xl font-black mt-4 ml-12 text-red-600 animate-pulse">+ {order.items.length - 10} OUTROS ITENS...</p>
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
        </div>         <div className="flex-1 overflow-y-auto p-12 custom-scrollbar bg-white">
            <div className="grid grid-cols-1 gap-6">
               {order.items.map((item: any, idx: number) => (
                 <div key={idx} className="p-8 bg-gray-50 rounded-[2.5rem] border-2 border-gray-100 flex flex-col justify-between shadow-sm">
                    <div>
                      <div className="flex items-center gap-8">
                         <div className="w-20 h-20 shrink-0 bg-white shadow-md border-2 border-gray-100 rounded-[1.5rem] flex items-center justify-center text-4xl font-black text-black">
                           {item.quantity}X
                         </div>
                         <h4 className="text-5xl font-black tracking-tighter text-black leading-tight uppercase">{item.name}</h4>
                      </div>

                      {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                        <div className="mt-6 flex flex-wrap gap-3 ml-28">
                           {item.selectedModifiers.map((m: any, mIdx: number) => (
                             <span key={mIdx} className="px-5 py-2 bg-black text-white rounded-xl text-xl font-black uppercase tracking-widest">
                               + {m.name}
                             </span>
                           ))}
                        </div>
                      )}
                    </div>

                    {item.notes && (
                      <div className="mt-6 p-6 bg-rose-50 border-2 border-rose-100 rounded-[1.5rem] ml-28">
                         <p className="text-xs font-black uppercase text-rose-600 mb-2 tracking-[0.3em]">Observação do Cliente:</p>
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
  const { kitchenOrders, updateKitchenOrderStatus, syncData } = useStore();
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const lastOrderIds = useRef<string[]>([]);

  const activeOrders = kitchenOrders.filter((o: any) => o.status !== 'ready');

  // Auto-sync na Cozinha (30s)
  useEffect(() => {
    const interval = setInterval(() => {
      console.log("🔄 Kitchen auto-syncing...");
      syncData();
    }, 30000);
    return () => clearInterval(interval);
  }, [syncData]);

  // Função para tocar o sininho (Web Audio API)
  const playBellSound = async () => {
    try {
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      const audioCtx = new AudioContextClass();
      
      // Se estiver suspenso, não adianta tentar tocar agora (precisa de clique)
      if (audioCtx.state === 'suspended') {
        console.warn("⚠️ AudioContext suspenso. Clique na tela para ativar o som.");
        return;
      }

      const playDing = (time: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'sine'; 
        osc.frequency.setValueAtTime(1046.50, time); 
        osc.frequency.exponentialRampToValueAtTime(523.25, time + 0.5); 
        
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.3, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.6);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start(time);
        osc.stop(time + 0.6);
      };

      let startTime = audioCtx.currentTime + 0.1;
      for (let set = 0; set < 4; set++) {
        for (let ding = 0; ding < 3; ding++) {
          playDing(startTime);
          startTime += 0.25;
        }
        startTime += 1.5;
      }
    } catch (e) {
      console.warn("Erro ao reproduzir som:", e);
    }
  };

  // Detectar Novos Pedidos
  useEffect(() => {
    const currentIds = activeOrders.map(o => o.id);
    const hasNewOrder = currentIds.some(id => !lastOrderIds.current.includes(id));
    
    if (hasNewOrder && lastOrderIds.current.length > 0) {
      console.log("🔔 Novo pedido detectado! Tocando sininho...");
      playBellSound();
    }
    
    lastOrderIds.current = currentIds;
  }, [activeOrders]);
  
  return (
    <div className="p-4 bg-white h-screen text-black font-['Outfit'] overflow-hidden flex flex-col uppercase">
      {!audioUnlocked && (
        <div className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-12 text-center">
           <div className="w-32 h-32 bg-primary/20 rounded-full flex items-center justify-center text-primary mb-8 animate-pulse">
              <Bell size={64} />
           </div>
           <h2 className="text-5xl font-black text-white mb-6">Modo Cozinha</h2>
           <p className="text-gray-400 text-xl max-w-md mb-12 uppercase font-bold tracking-widest leading-relaxed">O navegador exige um clique para ativar os alertas sonoros de novos pedidos.</p>
           <button 
             onClick={() => {
               const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
               const audioCtx = new AudioContextClass();
               audioCtx.resume();
               setAudioUnlocked(true);
             }}
             className="btn-beco btn-beco-purple px-16 py-8 text-2xl font-black rounded-[2.5rem] shadow-2xl shadow-primary/40 active:scale-95 transition-all"
           >
             ATIVAR ALERTAS SONOROS
           </button>
        </div>
      )}

      <div className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar py-4 px-4">
        <div className="grid grid-rows-2 grid-flow-col gap-10 h-full" style={{ gridAutoColumns: 'calc(40% - 24px)', minWidth: '100%' }}>
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
