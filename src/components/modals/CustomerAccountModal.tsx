import { motion } from 'framer-motion';
import { X, FileText, Receipt, LayoutDashboard } from 'lucide-react';
import { useStore } from '../../store';

export function CustomerAccountModal({ onClose }: { onClose: () => void }) {
  const { currentTableId, tables, settings } = useStore();
  const table = tables.find(t => t.id === currentTableId);

  if (!table) return null;

  const subtotal = table.orders.reduce((acc, o) => {
    const modifiersTotal = o.selectedModifiers?.reduce((mAcc, m) => mAcc + m.price, 0) || 0;
    return acc + ((o.price + modifiersTotal) * o.quantity);
  }, 0);

  const serviceFee = subtotal * (settings.serviceTax / 100);
  const total = subtotal + serviceFee;

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
            <div className="w-16 h-16 bg-accent/20 rounded-3xl flex items-center justify-center text-accent">
              <Receipt size={32} />
            </div>
            <div>
              <h2 className="text-5xl font-black italic tracking-tighter mb-1">Minha <span className="text-accent">Conta</span></h2>
              <p className="text-gray-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
                <LayoutDashboard size={14} /> Mesa {table.number}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-4 glass rounded-full hover:bg-rose-500/20 text-rose-500 transition-all">
            <X size={32} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
          <div className="space-y-6 mb-12">
            {table.orders.length === 0 ? (
              <div className="text-center py-20 opacity-20">
                <FileText size={80} className="mx-auto mb-6" />
                <p className="text-2xl font-black uppercase tracking-widest">Nenhum consumo ainda</p>
              </div>
            ) : (
              table.orders.map((item, idx) => (
                <div key={idx} className="flex justify-between items-start pb-6 border-b border-white/5 last:border-0 group">
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-2xl font-black italic tracking-tighter">{item.quantity}x {item.name}</p>
                      <p className="text-2xl font-black text-white/90">R$ {((item.price + (item.selectedModifiers?.reduce((acc, m) => acc + m.price, 0) || 0)) * item.quantity).toFixed(2)}</p>
                    </div>
                    {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                      <p className="text-sm text-gray-500 font-bold">
                        + {item.selectedModifiers.map(m => m.name).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="bg-white/[0.03] rounded-[2.5rem] p-10 space-y-6 border border-white/5">
            <div className="flex justify-between items-center text-gray-500 font-black uppercase tracking-[0.2em] text-sm">
              <span>Subtotal</span>
              <span>R$ {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-gray-500 font-black uppercase tracking-[0.2em] text-sm">
              <span>Taxa de serviço ({settings.serviceTax}%)</span>
              <span>R$ {serviceFee.toFixed(2)}</span>
            </div>
            <div className="pt-6 border-t border-white/10 flex justify-between items-center">
              <span className="text-3xl font-black italic tracking-tighter uppercase">Total</span>
              <span className="text-5xl font-black text-accent italic tracking-tighter">R$ {total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="p-10 bg-white/[0.02] border-t border-white/5">
          <button
            onClick={onClose}
            className="w-full py-8 btn-beco bg-white/5 text-white/50 text-xl font-black tracking-widest rounded-[2rem] hover:bg-white/10 transition-all uppercase"
          >
            Voltar ao Cardápio
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
