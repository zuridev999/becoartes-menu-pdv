import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, MessageSquareText, Plus, ReceiptText, X } from 'lucide-react';
import type { OrderItem } from '../../types';
import { getOrderItemTotal } from '../../lib/totals';

type Props = {
  item: OrderItem;
  tableNumber: number;
  onClose: () => void;
};

const money = (value: number) => value.toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function TableOrderDetailsDialog({ item, tableNumber, onClose }: Props) {
  const modifiers = item.selectedModifiers || [];
  const notes = String(item.notes || '').trim();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/85 p-0 backdrop-blur-xl sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-order-details-title"
    >
      <button type="button" aria-label="Fechar detalhes" className="absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ y: 36, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 36, scale: 0.97 }}
        className="relative z-10 flex max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-[2rem] border border-white/10 bg-[#111115] shadow-2xl sm:rounded-[2rem]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-white/[0.035] p-5 sm:p-7">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Mesa {tableNumber} · Conferência</p>
            <h2 id="table-order-details-title" className="mt-1 text-2xl font-black leading-tight text-white sm:text-3xl">
              {item.quantity}x {item.name}
            </h2>
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-7">
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center gap-2 text-zinc-400">
              <ReceiptText size={16} />
              <h3 className="text-[10px] font-black uppercase tracking-[0.18em]">Resumo</h3>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider text-zinc-500">Valor unitário</p>
                <p className="mt-1 font-black text-zinc-100">{money(item.price)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black uppercase tracking-wider text-zinc-500">Total do item</p>
                <p className="mt-1 text-lg font-black text-emerald-400">{money(getOrderItemTotal(item))}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.07] p-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Opções e adicionais</h3>
            {modifiers.length > 0 ? (
              <div className="mt-3 space-y-2">
                {modifiers.map((modifier, index) => (
                  <div key={`${modifier.id}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2.5">
                    <p className="flex min-w-0 items-center gap-2 text-sm font-black text-white">
                      <Plus size={15} strokeWidth={4} className="shrink-0 text-violet-300" />
                      <span>{modifier.name}</span>
                    </p>
                    {Number(modifier.price || 0) > 0 && <span className="shrink-0 text-xs font-black text-violet-200">{money(modifier.price)}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm font-bold text-zinc-500">Nenhuma opção ou adicional.</p>
            )}
          </section>

          <section className={`rounded-2xl border p-4 ${notes ? 'border-amber-300/25 bg-amber-400/[0.08]' : 'border-white/10 bg-white/[0.025]'}`}>
            <div className={`flex items-center gap-2 ${notes ? 'text-amber-300' : 'text-zinc-500'}`}>
              <MessageSquareText size={16} />
              <h3 className="text-[10px] font-black uppercase tracking-[0.18em]">Observações</h3>
            </div>
            <p className={`mt-3 whitespace-pre-wrap text-base font-black leading-relaxed ${notes ? 'text-white' : 'text-zinc-500'}`}>
              {notes || 'Sem observações neste item.'}
            </p>
          </section>
        </div>

        <div className="shrink-0 border-t border-white/10 bg-black/30 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:p-6">
          <button type="button" onClick={onClose} className="btn-beco btn-beco-purple flex w-full items-center justify-center gap-3 rounded-2xl py-5 text-sm font-black uppercase tracking-widest">
            <Check size={20} strokeWidth={4} /> OK, entendi
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
