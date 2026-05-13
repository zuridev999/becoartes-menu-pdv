import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, ShoppingBag, Trash2, Send, CheckCircle2 } from 'lucide-react';
import { useStore } from '../../store';

export function CustomerOrderModal({ onClose }: { onClose: () => void }) {
  const { currentTableId, tables, removeFromCart, sendToKitchen, addNotification } = useStore();
  const [isSending, setIsSending] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  
  const table = tables.find(t => t.id === currentTableId);
  if (!table) return null;

  const cartTotal = table.cart.reduce((acc, item) => {
    const modifiersTotal = item.selectedModifiers?.reduce((mAcc, m) => mAcc + m.price, 0) || 0;
    return acc + ((item.price + modifiersTotal) * item.quantity);
  }, 0);

  const handleSendOrder = async () => {
    if (!isConfirmed) {
      addNotification('Por favor, confirme seu pedido antes de enviar.', 'info');
      return;
    }
    
    setIsSending(true);
    try {
      await sendToKitchen(table.id, 'tablet');
      addNotification('Pedido enviado para a cozinha!', 'order');
      onClose();
    } catch (error) {
      addNotification('Erro ao enviar pedido. Tente novamente.', 'error');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-8 bg-black/80 backdrop-blur-md"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="w-full max-w-3xl bg-[#0a0a0c] rounded-[3rem] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-10 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-primary/20 rounded-3xl flex items-center justify-center text-primary">
              <ShoppingBag size={32} />
            </div>
            <div>
              <h2 className="text-5xl font-black italic tracking-tighter mb-1">Meu <span className="text-primary">Pedido</span></h2>
              <p className="text-gray-500 font-black uppercase tracking-widest text-xs">Revise seus itens antes de enviar</p>
            </div>
          </div>
          <button onClick={onClose} className="p-4 glass rounded-full hover:bg-rose-500/20 text-rose-500 transition-all">
            <X size={32} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
          {table.cart.length === 0 ? (
            <div className="text-center py-24 opacity-20">
              <ShoppingBag size={100} className="mx-auto mb-8" />
              <p className="text-3xl font-black uppercase tracking-widest italic">Seu pedido está vazio</p>
            </div>
          ) : (
            <div className="space-y-8">
              {table.cart.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center group bg-white/[0.02] p-6 rounded-[2rem] border border-white/5">
                  <div className="flex-1">
                    <div className="flex items-center gap-6 mb-2">
                       <div className="bg-primary/10 text-primary w-12 h-12 rounded-xl flex items-center justify-center font-black text-2xl">
                          {item.quantity}
                       </div>
                       <div>
                          <p className="text-2xl font-black italic tracking-tighter leading-none mb-1">{item.name}</p>
                          <p className="text-accent font-black">R$ {(item.price * item.quantity).toFixed(2)}</p>
                       </div>
                    </div>
                    {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                      <div className="flex flex-wrap gap-2 ml-[4.5rem]">
                        {item.selectedModifiers.map((m, mIdx) => (
                          <span key={mIdx} className="text-[10px] font-black uppercase bg-white/5 px-3 py-1 rounded-lg border border-white/5 text-gray-400">+{m.name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => removeFromCart(item.id)} className="p-4 glass rounded-2xl text-rose-500 hover:bg-rose-500/20 transition-all">
                    <Trash2 size={24} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-10 bg-black/40 border-t border-white/5 space-y-8">
           <div className="flex justify-between items-end">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-2">Total do Pedido</p>
                <p className="text-6xl font-black text-accent italic tracking-tighter">R$ {cartTotal.toFixed(2)}</p>
              </div>
           </div>

           <div className="grid grid-cols-2 gap-6">
              <button
                onClick={() => setIsConfirmed(!isConfirmed)}
                className={`py-8 rounded-[2rem] font-black text-xl uppercase tracking-widest transition-all flex items-center justify-center gap-4 ${isConfirmed ? 'bg-emerald-500 text-white shadow-xl shadow-emerald-500/20' : 'bg-white/5 text-white/50 border border-white/10 hover:border-emerald-500/50'}`}
              >
                {isConfirmed ? <CheckCircle2 size={24}/> : null}
                {isConfirmed ? 'PEDIDO CONFIRMADO' : 'CONFIRMAR PEDIDO'}
              </button>
              
              <button
                onClick={handleSendOrder}
                disabled={isSending || table.cart.length === 0 || !isConfirmed}
                className="py-8 btn-beco btn-beco-purple text-2xl font-black tracking-widest rounded-[2rem] shadow-2xl shadow-primary/30 disabled:opacity-20 flex items-center justify-center gap-4 animate-pulse-slow"
              >
                <Send size={28} /> ENVIAR PEDIDO
              </button>
           </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
