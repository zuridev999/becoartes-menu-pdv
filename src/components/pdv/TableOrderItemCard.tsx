import { MessageSquareText, Pencil, Plus } from 'lucide-react';
import type { OrderItem } from '../../types';
import { getOrderItemTotal } from '../../lib/totals';

type Props = {
  item: OrderItem;
  canCancel: boolean;
  expanded: boolean;
  onView: () => void;
  onToggle: () => void;
  onCancel: (mode: 'all' | 'modifier' | 'product', modifier?: OrderItem['selectedModifiers'][number]) => void;
};

export function TableOrderItemCard({ item, canCancel, expanded, onView, onToggle, onCancel }: Props) {
  const modifiers = item.selectedModifiers || [];
  const notes = String(item.notes || '').trim();

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-primary/35 hover:bg-white/[0.06] sm:px-4">
      <button type="button" onClick={onView} className="block w-full text-left" aria-label={`Ver detalhes de ${item.quantity}x ${item.name}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-base font-black leading-tight text-zinc-50">{item.quantity}x {item.name}</p>
          <p className="shrink-0 text-sm font-black tabular-nums text-zinc-200">
            {getOrderItemTotal(item).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
        </div>
        {(item.categoryName || item.categoryId) && (
          <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-zinc-500">{item.categoryName || item.categoryId}</p>
        )}
        {modifiers.length > 0 && (
          <div className="mt-2">
            <p className="text-[8px] font-black uppercase tracking-[0.16em] text-zinc-500">Opções</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {modifiers.map((modifier, index) => (
                <span key={`${modifier.id}-${index}`} className="inline-flex items-center gap-0.5 rounded-lg bg-violet-500/10 px-2 py-1 text-[9px] font-black text-violet-200">
                  <Plus size={9} strokeWidth={4} /> {modifier.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {notes && (
          <div className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-400/10 px-2.5 py-2 text-amber-100">
            <MessageSquareText size={13} className="mt-0.5 shrink-0" />
            <p className="min-w-0 text-[10px] font-bold leading-snug">
              <span className="font-black uppercase tracking-[0.1em]">Observações:</span>{' '}
              {notes}
            </p>
          </div>
        )}
        <p className="mt-2 text-[8px] font-black uppercase tracking-[0.14em] text-primary/75">Toque para conferir o pedido</p>
      </button>
      {canCancel && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-violet-200"
        >
          <Pencil size={12} /> {expanded ? 'Fechar edição' : 'Editar item'}
        </button>
      )}
      {canCancel && expanded && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
          {(item.selectedModifiers || []).filter(modifier => Number(modifier.price || 0) > 0 || modifier.linkedProductId).map(modifier => (
            <button key={`keep-${modifier.id}`} type="button" onClick={() => onCancel('product', modifier)} className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-bold text-violet-200">
              Cancelar só {item.name} · manter +{modifier.name}
            </button>
          ))}
          <button type="button" onClick={() => onCancel('all')} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300">
            Cancelar {item.name} e adicionais
          </button>
          {(item.selectedModifiers || []).map(modifier => (
            <button key={modifier.id} type="button" onClick={() => onCancel('modifier', modifier)} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-200">
              Remover só +{modifier.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
