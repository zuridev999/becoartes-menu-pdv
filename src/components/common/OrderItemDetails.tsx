import { MessageSquareText, Plus } from 'lucide-react';
import type { Modifier, OrderItem } from '../../types';

export type OrderItemPresentation = {
  name: string;
  modifiers: Modifier[];
};

type OrderItemDetailsProps = {
  items?: OrderItem[];
  fallbackMessage?: string;
  compact?: boolean;
  maxItems?: number;
  maxModifiers?: number;
  tone?: 'dark' | 'light';
  operational?: boolean;
  presentItem?: (item: OrderItem) => OrderItemPresentation;
};

const defaultPresentation = (item: OrderItem): OrderItemPresentation => ({
  name: item.name,
  modifiers: Array.isArray(item.selectedModifiers)
    ? item.selectedModifiers.filter((modifier) => String(modifier?.name || '').trim())
    : [],
});

export function OrderItemDetails({
  items = [],
  fallbackMessage = '',
  compact = false,
  maxItems,
  maxModifiers,
  tone = 'dark',
  operational = false,
  presentItem = defaultPresentation,
}: OrderItemDetailsProps) {
  const isLight = tone === 'light';

  if (items.length === 0) {
    return (
      <p className={[
        compact ? 'text-[11px] font-bold leading-relaxed' : 'text-lg sm:text-2xl font-black leading-relaxed',
        isLight ? 'text-black/75' : 'text-white/80',
      ].join(' ')}>
        {fallbackMessage || 'Itens não disponíveis para esta solicitação.'}
      </p>
    );
  }

  const itemLimit = maxItems ?? (compact ? 2 : items.length);
  const modifierLimit = maxModifiers ?? (compact ? 3 : Number.POSITIVE_INFINITY);
  const visibleItems = items.slice(0, itemLimit);
  const hiddenItems = Math.max(0, items.length - visibleItems.length);

  return (
    <div className={[
      compact ? (operational ? 'space-y-4' : 'space-y-2.5') : 'divide-y',
      isLight ? 'divide-black/10' : 'divide-white/10',
    ].join(' ')}>
      {visibleItems.map((item) => {
        const presentation = presentItem(item);
        const visibleModifiers = presentation.modifiers.slice(0, modifierLimit);
        const hiddenModifiers = Math.max(0, presentation.modifiers.length - visibleModifiers.length);

        return (
          <div
            key={item.id}
            className={[
              compact ? (operational ? 'border-l-[3px] pl-4' : 'border-l-2 pl-3') : 'py-5 first:pt-0 last:pb-0',
              compact && (isLight ? 'border-black/15' : 'border-white/25'),
            ].join(' ')}
          >
            <p className={[
              compact
                ? `${operational ? 'text-base sm:text-2xl' : 'text-[11px]'} font-black leading-snug`
                : 'text-xl sm:text-3xl font-black leading-tight',
              isLight ? 'text-black' : 'text-white',
            ].join(' ')}>
              <span className={isLight ? 'text-amber-700' : 'text-yellow-300'}>{item.quantity}x</span>{' '}
              {presentation.name}
            </p>

            {visibleModifiers.length > 0 && (
              <div className={compact ? 'mt-1.5 space-y-1' : 'mt-3 space-y-2'}>
                {visibleModifiers.map((modifier) => (
                  <p
                    key={`${item.id}-${modifier.id}`}
                    className={[
                      'flex items-start gap-1.5 font-black',
                      compact
                        ? `${operational ? 'text-sm sm:text-xl' : 'text-[10px]'} leading-snug`
                        : 'text-sm sm:text-xl leading-tight',
                      isLight ? 'text-amber-700' : 'text-yellow-200',
                    ].join(' ')}
                  >
                    <Plus size={compact ? (operational ? 16 : 11) : 18} strokeWidth={4} className="mt-0.5 shrink-0" />
                    <span>{item.quantity > 1 ? `${item.quantity}x ` : ''}{modifier.name}</span>
                  </p>
                ))}
                {hiddenModifiers > 0 && (
                  <p className={[
                    'text-[9px] font-black uppercase tracking-widest',
                    isLight ? 'text-black/50' : 'text-white/55',
                  ].join(' ')}>
                    + {hiddenModifiers} escolha{hiddenModifiers === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            )}

            {item.notes && (
              <p className={[
                'flex items-start gap-2 font-bold',
                compact
                  ? `mt-1.5 ${operational ? 'text-xs sm:text-lg' : 'text-[9px]'} leading-snug`
                  : 'mt-3 text-sm sm:text-xl leading-relaxed',
                isLight ? 'text-rose-700' : 'text-rose-200',
              ].join(' ')}>
                <MessageSquareText size={compact ? (operational ? 15 : 11) : 18} className="mt-0.5 shrink-0" />
                <span>{item.notes}</span>
              </p>
            )}
          </div>
        );
      })}

      {hiddenItems > 0 && (
        <p className={[
          compact ? 'pl-3 text-[9px]' : 'pt-4 text-xs',
          'font-black uppercase tracking-widest',
          isLight ? 'text-black/50' : 'text-white/60',
        ].join(' ')}>
          + {hiddenItems} item{hiddenItems === 1 ? '' : 's'} no pedido
        </p>
      )}
    </div>
  );
}
