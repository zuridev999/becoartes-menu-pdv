import { motion, AnimatePresence } from 'framer-motion';
import { Info, AlertCircle, ShoppingBag, Bell, X } from 'lucide-react';
import { useStore } from '../../store';

export function NotificationDisplay() {
  const { notifications, clearNotification } = useStore();

  const getIcon = (type: string) => {
    switch (type) {
      case 'info': return <Info size={18} className="text-emerald-400" />;
      case 'error': return <AlertCircle size={18} className="text-rose-500" />;
      case 'order': return <ShoppingBag size={18} className="text-primary" />;
      case 'service': return <Bell size={18} className="text-amber-500" />;
      default: return <Bell size={18} className="text-zinc-500" />;
    }
  };

  const getBorder = (type: string) => {
    switch (type) {
      case 'info': return 'border-emerald-500/20 bg-emerald-500/5';
      case 'error': return 'border-rose-500/20 bg-rose-500/5';
      case 'order': return 'border-primary/20 bg-primary/5';
      case 'service': return 'border-amber-500/20 bg-amber-500/5';
      default: return 'border-white/10 bg-white/5';
    }
  };

  return (
    <div className="fixed top-5 right-5 sm:top-8 sm:right-8 z-[1000] flex flex-col gap-4 w-[min(20rem,calc(100vw-2.5rem))] pointer-events-none font-['Outfit']">
      <AnimatePresence>
        {notifications.map((notif) => (
          <motion.div
            key={notif.id}
            initial={{ opacity: 0, y: -18, x: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, x: 16, scale: 0.96 }}
            className={`pointer-events-auto p-5 rounded-2xl border backdrop-blur-xl shadow-2xl flex items-start gap-4 ${getBorder(notif.type)}`}
          >
            <div className="mt-1">
              {getIcon(notif.type)}
            </div>
            <div className="flex-1">
              <p className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-1">{notif.type === 'service' ? 'Solicitação' : 'Notificação'}</p>
              <p className="text-sm font-bold text-white leading-tight">{notif.message}</p>
            </div>
            <button
              type="button"
              aria-label="Fechar notificação"
              onClick={() => clearNotification(notif.id)}
              className="text-zinc-500 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
