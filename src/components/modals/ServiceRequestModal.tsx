import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  X, Utensils, ScrollText, 
  HelpCircle, AlertTriangle, MessageSquare, 
  Wallet, CupSoda, Snowflake, Citrus, Users 
} from 'lucide-react';
import { useStore } from '../../store';

export function ServiceRequestModal({ onClose }: { onClose: () => void }) {
  const { currentTableId, requestService, addNotification } = useStore();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const options = [
    { id: 'waiter', label: 'Chamar Garçom', icon: Users },
    { id: 'bill', label: 'Fechar Conta', icon: Wallet },
    { id: 'glass', label: 'Pedir Copo Extra', icon: CupSoda },
    { id: 'cutlery', label: 'Pedir Talher', icon: Utensils },
  ];

  const handleSend = async (type: string, directLabel?: string) => {
    if (!currentTableId) return;
    setIsSending(true);
    await requestService(currentTableId, type, message || directLabel || '');
    addNotification('Solicitação enviada!');
    setIsSending(false);
    onClose();
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
        className="w-full max-w-4xl bg-[#111115] rounded-[3rem] border border-white/5 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-10 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
          <div>
            <h2 className="text-5xl font-black italic tracking-tighter mb-2">Chamar <span className="text-primary">Garçom</span></h2>
            <p className="text-gray-500 font-black uppercase tracking-widest text-xs">Como podemos ajudar você hoje?</p>
          </div>
          <button onClick={onClose} className="p-4 glass rounded-full hover:bg-rose-500/20 text-rose-500 transition-all">
            <X size={32} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
          <div className="grid grid-cols-2 gap-4 mb-10">
            {options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleSend(opt.id, opt.label)}
                className="flex items-center gap-6 p-6 glass rounded-3xl border border-white/5 hover:border-primary/50 hover:bg-primary/5 transition-all text-left group"
              >
                <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center group-hover:bg-primary/20 transition-all">
                  <opt.icon size={28} className="text-primary" />
                </div>
                <span className="font-black text-xl tracking-tight">{opt.label}</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <p className="text-xs font-black uppercase tracking-widest text-gray-500 ml-4">Digite sua solicitação (opcional)</p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ex: Trazer mais 2 copos com gelo e limão..."
              className="w-full h-32 bg-white/5 border border-white/10 rounded-[2rem] p-8 text-xl font-bold focus:outline-none focus:border-primary/50 transition-all resize-none"
            />
          </div>
        </div>

        <div className="p-10 bg-white/[0.02] border-t border-white/5">
          <button
            onClick={() => handleSend('other', message)}
            disabled={isSending || !message.trim()}
            className="w-full py-8 btn-beco btn-beco-purple text-2xl font-black tracking-widest rounded-[2rem] disabled:opacity-20 shadow-2xl shadow-primary/20"
          >
            ENVIAR SOLICITAÇÃO
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
