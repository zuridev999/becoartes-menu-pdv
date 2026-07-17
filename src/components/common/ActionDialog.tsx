import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { InputHTMLAttributes } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

type ActionDialogProps = {
  isOpen: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  input?: {
    label: string;
    defaultValue?: string;
    placeholder?: string;
    type?: string;
    inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
    multiline?: boolean;
    maxLength?: number;
  };
  children?: ReactNode;
  confirmDisabled?: boolean;
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
  children,
  confirmDisabled = false,
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
  const hasHeader = Boolean(title || description);

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
      className="fixed inset-0 z-[900] flex items-center justify-center p-4 sm:p-8"
    >
      <button aria-label="Fechar modal" className="absolute inset-0 bg-black/80 backdrop-blur-2xl" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.94, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, y: 16 }}
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden glass-card border-white/10 shadow-2xl"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 sm:p-10">
          {hasHeader ? (
            <div className="flex items-start justify-between gap-6 mb-6 sm:mb-8">
              <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center ${isDanger ? 'bg-rose-500/10 text-rose-400' : 'bg-primary/10 text-primary'}`}>
                {isDanger ? <AlertTriangle size={26} /> : <CheckCircle2 size={26} />}
              </div>
              <button type="button" aria-label="Fechar confirmação" onClick={onClose} className="p-3 glass rounded-xl hover:text-rose-400 transition-all">
                <X size={18} />
              </button>
            </div>
          ) : (
            <button type="button" aria-label="Fechar confirmação" onClick={onClose} className="absolute right-5 top-5 p-3 glass rounded-xl hover:text-rose-400 transition-all">
              <X size={18} />
            </button>
          )}

          {title && <h3 className="text-3xl font-black italic tracking-tighter mb-3">{title}</h3>}
          {description && <p className="text-sm font-bold text-zinc-400 leading-relaxed mb-6 sm:mb-8">{description}</p>}

          {children && <div className="mb-6 sm:mb-8">{children}</div>}

          {input && (
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{input.label}</label>
              {input.multiline ? (
                <textarea
                  inputMode={input.inputMode}
                  autoFocus
                  rows={4}
                  maxLength={input.maxLength}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={input.placeholder}
                  className="w-full resize-none glass p-5 rounded-2xl border-white/10 outline-none font-black text-lg leading-relaxed focus:border-primary/40"
                />
              ) : (
                <input
                  type={input.type || 'text'}
                  inputMode={input.inputMode}
                  autoFocus
                  maxLength={input.maxLength}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleConfirm()}
                  placeholder={input.placeholder}
                  className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-black text-lg focus:border-primary/40"
                />
              )}
              {input.maxLength && (
                <p className="text-right text-[10px] font-black tracking-widest text-zinc-600">{value.length}/{input.maxLength}</p>
              )}
            </div>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-1 gap-3 border-t border-white/10 bg-black/30 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-xl sm:grid-cols-2 sm:gap-4 sm:p-6">
          <button onClick={onClose} className="flex-1 py-5 glass rounded-2xl font-black text-xs uppercase tracking-widest text-zinc-400 hover:text-white transition-all">
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || confirmDisabled || Boolean(input && !value.trim())}
            className={`flex-1 py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-40 ${isDanger ? 'bg-rose-500 text-white hover:bg-rose-400' : 'btn-beco btn-beco-purple'}`}
          >
            {isSubmitting ? 'Aguarde...' : confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
