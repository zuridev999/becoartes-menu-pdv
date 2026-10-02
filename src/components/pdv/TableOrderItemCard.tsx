import type { OrderItem } from '../../types';
import { getOrderItemTotal } from '../../lib/totals';

type Props = {
  item: OrderItem;
  canCancel: boolean;
  expanded: boolean;
  onToggle: () => void;
  onCancel: (modifier?: OrderItem['selectedModifiers'][number]) => void;
};

export function TableOrderItemCard({ item, canCancel, expanded, onToggle, onCancel }: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-primary/35 hover:bg-white/[0.06] sm:px-4">
      <div className="flex items-start justify-between gap-3">
        {canCancel ? (
          <button type="button" onClick={onToggle} aria-expanded={expanded} className="min-w-0 flex-1 text-left text-base font-black leading-tight text-zinc-50">
            {item.quantity}x {item.name} <span className="text-[10px] font-bold text-violet-300">Editar</span>
          </button>
        ) : (
          <p className="min-w-0 flex-1 text-base font-black leading-tight text-zinc-50">{item.quantity}x {item.name}</p>
        )}
        <p className="shrink-0 text-sm font-black tabular-nums text-zinc-200">
          {getOrderItemTotal(item).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
        </p>
      </div>
      {(item.categoryName || item.categoryId) && (
        <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-zinc-500">{item.categoryName || item.categoryId}</p>
      )}
      <div className="mt-1 flex flex-wrap gap-1.5">
        {(item.selectedModifiers || []).map(modifier => (
          <span key={modifier.id} className="rounded bg-white/5 px-1.5 py-0.5 text-[8px] font-black text-zinc-500">+{modifier.name}</span>
        ))}
      </div>
      {canCancel && expanded && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
          <button type="button" onClick={() => onCancel()} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300">
            Cancelar {item.name} inteiro
          </button>
          {(item.selectedModifiers || []).map(modifier => (
            <button key={modifier.id} type="button" onClick={() => onCancel(modifier)} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-200">
              Remover só +{modifier.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
