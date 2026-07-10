import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShoppingBag, Trash2, Send, CheckCircle2 } from 'lucide-react';
import { useStore } from '../../store';
import { getOrderItemTotal, getOrderItemsTotal } from '../../lib/totals';
import { formatCurrency } from '../../lib/format';

export function CustomerOrderModal({
  onClose,
  onSent,
  origin = 'tablet'
}: {
  onClose: () => void;
  onSent?: () => void;
  origin?: 'tablet' | 'qr';
}) {
  const { currentTableId, tables, removeFromCart, sendToKitchen, addNotification } = useStore();
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  
  const table = tables.find(t => t.id === currentTableId);
  if (!table) return null;

  const cartTotal = getOrderItemsTotal(table.cart);
  const accountTotal = getOrderItemsTotal(table.orders);
  const hasAccountItems = table.orders.length > 0;
  const displayTotal = table.cart.length > 0 ? cartTotal : accountTotal;
  const handleOpenAccount = () => {
    onClose();
    onSent?.();
  };

  const handleSendOrder = async () => {
    if (isSending || isSent) return;
    setIsSending(true);
    try {
      await sendToKitchen(table.id, origin);
      setIsSent(true);
      setTimeout(() => {
        onClose();
        onSent?.();
        setIsSent(false);
      }, 1800);
    } catch {
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
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-8 bg-black/80 backdrop-blur-md"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="w-full max-w-3xl bg-[#0a0a0c] rounded-[2rem] sm:rounded-[3rem] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh] relative"
      >
        <AnimatePresence>
          {isSent && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 z-[300] bg-emerald-500 flex flex-col items-center justify-center text-white p-12 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 12 }}
                className="w-32 h-32 bg-white/20 rounded-full flex items-center justify-center mb-8"
              >
                <CheckCircle2 size={80} />
              </motion.div>
              <h2 className="text-6xl font-black italic tracking-tighter mb-4">Sucesso!</h2>
              <p className="text-2xl font-bold opacity-90 uppercase tracking-widest">Seu pedido foi enviado.</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="p-4 sm:p-10 border-b border-white/5 flex justify-between items-center gap-3 bg-white/[0.02]">
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-primary/20 rounded-2xl sm:rounded-3xl flex shrink-0 items-center justify-center text-primary">
              <ShoppingBag size={24} className="sm:hidden" />
              <ShoppingBag size={32} className="hidden sm:block" />
            </div>
            <div className="min-w-0">
              <h2 className="text-3xl sm:text-5xl font-black italic tracking-tighter mb-1 leading-none">Meu <span className="text-primary">Pedido</span></h2>
              <p className="text-gray-500 font-black uppercase tracking-widest text-[9px] sm:text-xs">Revise antes de enviar</p>
            </div>
          </div>
          <button type="button" aria-label="Fechar pedido" onClick={onClose} className="p-3 sm:p-4 glass rounded-full hover:bg-rose-500/20 text-rose-500 transition-all shrink-0">
            <X size={24} className="sm:hidden" />
            <X size={32} className="hidden sm:block" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-12 custom-scrollbar">
          {table.cart.length === 0 ? (
            <div className={`text-center py-16 sm:py-24 ${hasAccountItems ? '' : 'opacity-20'}`}>
              <ShoppingBag size={76} className="mx-auto mb-8 sm:hidden" />
              <ShoppingBag size={100} className="mx-auto mb-8 hidden sm:block" />
              <p className="text-2xl sm:text-3xl font-black uppercase tracking-widest italic">
                {hasAccountItems ? 'Pedido já enviado' : 'Seu pedido está vazio'}
              </p>
              {hasAccountItems && (
                <p className="mt-4 text-sm sm:text-base font-bold uppercase tracking-widest text-gray-400">
                  Os itens enviados estão em Minha Conta.
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-white/10 border-y border-white/10">
              {table.cart.map((item, idx) => (
                <div key={idx} className="group flex items-center justify-between gap-3 py-4 sm:py-6">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 sm:gap-6 mb-2">
                       <div className="bg-primary/10 text-primary w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex shrink-0 items-center justify-center font-black text-xl sm:text-2xl">
                          {item.quantity}
                       </div>
                       <div className="min-w-0">
                          <p className="text-lg sm:text-2xl font-black italic tracking-tighter leading-tight mb-1">{item.name}</p>
                          <p className="text-accent font-black text-sm sm:text-base">{formatCurrency(getOrderItemTotal(item))}</p>
                       </div>
                    </div>
                    {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                      <div className="flex flex-wrap gap-2 ml-[3.25rem] sm:ml-[4.5rem]">
                        {item.selectedModifiers.map((m, mIdx) => (
                          <span key={mIdx} className="text-[10px] font-black uppercase bg-white/5 px-3 py-1 rounded-lg border border-white/5 text-gray-400">+{m.name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" aria-label={`Remover ${item.name} do pedido`} onClick={() => removeFromCart(item.id)} className="p-3 sm:p-4 glass rounded-2xl text-rose-500 hover:bg-rose-500/20 transition-all shrink-0">
                    <Trash2 size={20} className="sm:hidden" />
                    <Trash2 size={24} className="hidden sm:block" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 sm:p-10 bg-black/40 border-t border-white/5 space-y-4 sm:space-y-8">
           <div className="flex justify-between items-end">
              <div>
                <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-2">
                  {table.cart.length > 0 ? 'Total do Pedido' : 'Total na Minha Conta'}
                </p>
                <p className="text-4xl sm:text-6xl font-black text-accent italic tracking-tighter">{formatCurrency(displayTotal)}</p>
              </div>
           </div>

           <div className="flex gap-6">
              <button
                type="button"
                onClick={table.cart.length === 0 && hasAccountItems ? handleOpenAccount : handleSendOrder}
                disabled={isSending || (table.cart.length === 0 && !hasAccountItems)}
                className="flex-1 py-5 sm:py-9 btn-beco btn-beco-purple text-base sm:text-3xl font-black tracking-[0.16em] sm:tracking-[0.2em] rounded-3xl sm:rounded-[2.5rem] shadow-2xl shadow-primary/30 flex items-center justify-center gap-3 sm:gap-4 animate-pulse-slow disabled:opacity-20"
              >
                <Send size={22} className="sm:hidden" />
                <Send size={32} className="hidden sm:block" />
                {table.cart.length === 0 && hasAccountItems ? 'VER MINHA CONTA' : 'ENVIAR PEDIDO'}
              </button>
           </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
