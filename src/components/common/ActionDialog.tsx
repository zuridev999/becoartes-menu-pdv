import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

type ActionDialogProps = {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  input?: {
    label: string;
    defaultValue?: string;
    placeholder?: string;
  };
  onClose: () => void;
  onConfirm?: (value?: string) => void | Promise<void>;
};

export function ActionDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'primary',
  input,
  onClose,
  onConfirm
}: ActionDialogProps) {
  const [value, setValue] = useState(input?.defaultValue || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) setValue(input?.defaultValue || '');
  }, [input?.defaultValue, isOpen]);

  if (!isOpen) return null;

  const isDanger = tone === 'danger';

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm?.(value.trim());
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[900] flex items-center justify-center p-8"
    >
      <button aria-label="Fechar modal" className="absolute inset-0 bg-black/80 backdrop-blur-2xl" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.94, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, y: 16 }}
        className="relative z-10 w-full max-w-lg glass-card border-white/10 p-10 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-6 mb-8">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isDanger ? 'bg-rose-500/10 text-rose-400' : 'bg-primary/10 text-primary'}`}>
            {isDanger ? <AlertTriangle size={28} /> : <CheckCircle2 size={28} />}
          </div>
          <button onClick={onClose} className="p-3 glass rounded-xl hover:text-rose-400 transition-all">
            <X size={18} />
          </button>
        </div>

        <h3 className="text-3xl font-black italic tracking-tighter mb-3">{title}</h3>
        {description && <p className="text-sm font-bold text-zinc-400 leading-relaxed mb-8">{description}</p>}

        {input && (
          <div className="space-y-2 mb-8">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{input.label}</label>
            <input
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleConfirm()}
              placeholder={input.placeholder}
              className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-black text-lg focus:border-primary/40"
            />
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4">
          <button onClick={onClose} className="flex-1 py-5 glass rounded-2xl font-black text-xs uppercase tracking-widest text-zinc-400 hover:text-white transition-all">
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || Boolean(input && !value.trim())}
            className={`flex-1 py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-40 ${isDanger ? 'bg-rose-500 text-white hover:bg-rose-400' : 'btn-beco btn-beco-purple'}`}
          >
            {isSubmitting ? 'Aguarde...' : confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
