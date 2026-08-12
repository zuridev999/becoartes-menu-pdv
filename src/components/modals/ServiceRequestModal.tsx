import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  X, Utensils, 
  Wallet, CupSoda, Users 
} from 'lucide-react';
import { useStore } from '../../store';
import { usePublicI18n } from '../../lib/public-i18n';
import type { CustomerTabOrderContext } from '../../lib/api';

export function ServiceRequestModal({ onClose, customerTabContext }: { onClose: () => void; customerTabContext?: CustomerTabOrderContext }) {
  const { currentTableId, requestService, addNotification } = useStore();
  const { t } = usePublicI18n();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const options = [
    { id: 'waiter', label: t('callWaiter'), icon: Users },
    { id: 'bill', label: t('closeBill'), icon: Wallet },
    { id: 'glass', label: t('extraGlass'), icon: CupSoda },
    { id: 'cutlery', label: t('cutlery'), icon: Utensils },
  ];

  const handleSend = async (type: string, directLabel?: string) => {
    if (!currentTableId) return;
    setIsSending(true);
    try {
      await requestService(currentTableId, type, message || directLabel || '', customerTabContext);
      addNotification(t('requestSent'));
      onClose();
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Não foi possível enviar sua solicitação.', 'error');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-3 backdrop-blur-md sm:p-8"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/5 bg-[#111115] shadow-2xl sm:max-h-[90vh] sm:rounded-[3rem]"
      >
        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] p-5 sm:p-10">
          <div>
            <h2 className="mb-2 text-3xl font-black italic tracking-tighter sm:text-5xl">{t('service')}</h2>
            <p className="text-gray-500 font-black uppercase tracking-widest text-xs">{t('helpToday')}</p>
          </div>
          <button type="button" aria-label="Fechar atendimento" onClick={onClose} className="glass shrink-0 rounded-full p-3 text-rose-500 transition-all hover:bg-rose-500/20 sm:p-4">
            <X size={28} />
          </button>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto p-5 sm:p-10">
          <div className="mb-8 grid grid-cols-1 gap-3 sm:mb-10 sm:grid-cols-2 sm:gap-4">
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
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
            <p className="text-xs font-black uppercase tracking-widest text-gray-500 ml-4">{t('serviceRequest')}</p>
            <textarea
              name="service-request"
              aria-label={t('serviceRequest')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('servicePlaceholder')}
              className="w-full h-32 bg-white/5 border border-white/10 rounded-[2rem] p-8 text-xl font-bold focus:outline-none focus:border-primary/50 transition-all resize-none"
            />
          </div>
        </div>

        <div className="p-10 bg-white/[0.02] border-t border-white/5">
          <button
            type="button"
            onClick={() => handleSend('other', message)}
            disabled={isSending || !message.trim()}
            className="w-full py-8 btn-beco btn-beco-purple text-2xl font-black tracking-widest rounded-[2rem] disabled:opacity-20 shadow-2xl shadow-primary/20"
          >
            {t('sendRequest').toUpperCase()}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
