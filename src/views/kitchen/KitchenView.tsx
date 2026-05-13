import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { useStore } from '../../store';

function KitchenOrderCard({ order, onComplete }: { order: any, onComplete: (id: string) => void }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const updateTimer = () => {
      const diff = new Date().getTime() - new Date(order.createdAt).getTime();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setElapsed(`${mins}:${secs.toString().padStart(2, '0')}`);
    };
    
    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [order.createdAt]);

  return (
    <div className="glass-card p-10 border-t-[10px] border-accent relative">
      <div className={`absolute top-4 right-6 flex items-center gap-2 font-black ${new Date().getTime() - new Date(order.createdAt).getTime() >= 1200000 ? 'text-rose-500' : new Date().getTime() - new Date(order.createdAt).getTime() >= 600000 ? 'text-orange-500' : 'text-accent'}`}>
        <Clock size={16} />
        <span className="text-xl">{elapsed}</span>
      </div>
      <h3 className="text-4xl font-black mb-6 italic tracking-tighter">Mesa {order.tableNumber}</h3>
      <div className="space-y-4 mb-10">
        {order.items.map((item: any, idx: number) => (
          <div key={idx} className="p-5 glass rounded-2xl border-white/10 group">
            <div className="flex justify-between items-start mb-2">
              <span className="font-black text-2xl tracking-tight">{item.quantity}x {item.name}</span>
            </div>
            
            {item.selectedModifiers && item.selectedModifiers.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {item.selectedModifiers.map((m: any, mIdx: number) => (
                  <span key={mIdx} className="px-3 py-1 bg-primary/20 text-primary rounded-lg text-xs font-black uppercase tracking-widest border border-primary/20">
                    + {m.name}
                  </span>
                ))}
              </div>
            )}

            {item.notes && (
              <div className="mt-4 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                 <p className="text-[10px] font-black uppercase text-rose-500 mb-1">Observação:</p>
                 <p className="text-sm font-bold text-white italic">"{item.notes}"</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <button 
        onClick={() => onComplete(order.id)} 
        className="w-full py-6 btn-beco-purple text-xl rounded-3xl font-black shadow-lg shadow-primary/20"
      >
        Finalizar
      </button>
    </div>
  );
}

export function KitchenView() {
  const { kitchenOrders, updateKitchenOrderStatus } = useStore();
  
  return (
    <div className="p-16 bg-[#0a0a0c] min-h-screen text-white font-['Outfit']">
      <div className="flex justify-between items-center mb-20">
        <h1 className="text-7xl font-black italic tracking-tighter">COZ <span className="text-primary">KDS</span></h1>
        <div className="glass px-8 py-4 rounded-3xl border-white/5 flex items-center gap-4">
           <div className="w-4 h-4 bg-accent rounded-full animate-pulse" />
           <p className="text-xl font-black uppercase tracking-widest">{kitchenOrders.filter(o => o.status !== 'ready').length} Pedidos Ativos</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-12">
        {kitchenOrders.filter((o: any) => o.status !== 'ready').map((order: any) => (
          <KitchenOrderCard 
            key={order.id} 
            order={order} 
            onComplete={(id) => updateKitchenOrderStatus(id, 'ready')} 
          />
        ))}
      </div>
    </div>
  );
}
