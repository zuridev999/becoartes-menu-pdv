import { Clock3, CopyPlus, MessageSquareText, Pencil } from 'lucide-react';
import type { OrderItem } from '../../types';
import { getOrderItemTotal } from '../../lib/totals';
import './table-order-item-card.css';

type Props = {
  item: OrderItem;
  canCancel: boolean;
  canRepeat: boolean;
  expanded: boolean;
  onView: () => void;
  onToggle: () => void;
  onRepeat: () => void;
  onCancel: (mode: 'all' | 'modifier' | 'product', modifier?: OrderItem['selectedModifiers'][number]) => void;
};

const formatOrderTime = (value?: Date) => {
  if (!value) return '';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Sao_Paulo',
  }).format(parsed);
};

export function TableOrderItemCard({ item, canCancel, canRepeat, expanded, onView, onToggle, onRepeat, onCancel }: Props) {
  const modifiers = item.selectedModifiers || [];
  const notes = String(item.notes || '').trim();
  const orderTime = formatOrderTime(item.orderedAt);
  const hasDetails = modifiers.length > 0 || Boolean(notes);

  return (
    <article className={`pdv-order-card ${hasDetails ? 'pdv-order-card-detailed' : 'pdv-order-card-simple'} ${canCancel ? 'pdv-order-card-admin' : 'pdv-order-card-operator'}`}>
      <button type="button" onClick={onView} className="pdv-order-card-main" aria-label={`Ver detalhes de ${item.quantity}x ${item.name}`}>
        <div className="pdv-order-card-heading">
          <p className="pdv-order-card-title">{item.quantity}x {item.name}</p>
          <div className="pdv-order-card-numbers">
            <strong>{getOrderItemTotal(item).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
            {orderTime && (
              <small title="Horário em que o item foi lançado"><Clock3 size={12} /> {orderTime}</small>
            )}
          </div>
        </div>
        {modifiers.length > 0 && (
          <div className="pdv-order-card-meta">
            {modifiers.map((modifier, index) => (
              <span className="pdv-order-card-option" key={`${modifier.id}-${index}`}>+ {modifier.name}</span>
            ))}
          </div>
        )}
        {notes && (
          <div className="pdv-order-card-note">
            <MessageSquareText size={13} className="mt-0.5 shrink-0" />
            <p>
              <span>Obs.:</span>{' '}
              {notes}
            </p>
          </div>
        )}
      </button>
      {(canRepeat || canCancel) && (
        <footer className={`pdv-order-card-actions${canCancel ? ' pdv-order-card-actions-admin' : ''}`}>
          {canCancel && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="pdv-order-edit"
            >
              <Pencil size={12} /> {expanded ? 'Fechar edição' : 'Editar item'}
            </button>
          )}
          {canRepeat && (
            <button
              type="button"
              onClick={onRepeat}
              className="pdv-order-repeat"
            >
              <CopyPlus size={14} /> Repetir item
            </button>
          )}
        </footer>
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
    </article>
  );
}
