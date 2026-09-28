import { Search, X } from 'lucide-react';
import type { OrderItem } from '../../types';
import { getOrderItemsTotal } from '../../lib/totals';

const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function TableProductSearchHeader({ tableNumber, query, onQueryChange, onClose }: {
  tableNumber: number;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between xl:mb-12">
      <div>
        <h2 className="text-3xl font-black italic tracking-tighter leading-none sm:text-4xl">Adicionar à <span className="text-primary">Mesa {tableNumber}</span></h2>
        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Selecione os produtos abaixo</p>
      </div>
      <div className="flex w-full items-center gap-3 sm:w-auto">
        <div className="relative min-w-0 flex-1 sm:w-80">
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            aria-label="Buscar produtos em todas as categorias"
            placeholder="Buscar produto em todas as categorias"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            className="h-14 w-full rounded-2xl border border-white/10 bg-[#121214] pl-11 pr-4 text-sm font-bold text-white outline-none placeholder:text-zinc-500 focus:border-primary"
          />
        </div>
        <button type="button" aria-label="Fechar cardápio" onClick={onClose} className="glass shrink-0 rounded-2xl p-4 transition-all hover:text-rose-500"><X size={24} /></button>
      </div>
    </div>
  );
}

export function TableDispatchFooter({ cart, kitchen, bar, onKitchenChange, onBarChange, isSending, canSend, onCancel, onConfirm }: {
  cart: OrderItem[];
  kitchen: boolean;
  bar: boolean;
  onKitchenChange: (enabled: boolean) => void;
  onBarChange: (enabled: boolean) => void;
  isSending: boolean;
  canSend: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      {cart.length > 0 && (
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-3 sm:gap-3 sm:p-4">
          <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-zinc-400">Enviar itens para</span>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white">
            <input type="checkbox" aria-label="Enviar itens para a cozinha" checked={kitchen} onChange={event => onKitchenChange(event.target.checked)} disabled={isSending} className="h-4 w-4 accent-violet-500" />
            Cozinha
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white">
            <input type="checkbox" aria-label="Enviar itens para o bar" checked={bar} onChange={event => onBarChange(event.target.checked)} disabled={isSending} className="h-4 w-4 accent-violet-500" />
            Bar
          </label>
          {(!kitchen || !bar) && (
            <span className="text-[11px] font-semibold text-amber-300">O item fica na conta mesmo sem envio ao destino desmarcado.</span>
          )}
        </div>
      )}
      <div className="mt-4 flex shrink-0 flex-col gap-4 border-t border-white/10 pt-4 sm:mt-6 sm:gap-4 sm:pt-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-6 sm:gap-8">
          <div>
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Itens no Pedido</span>
            <span className="text-2xl font-black italic tracking-tighter text-white sm:text-3xl">{cart.length} ITENS</span>
          </div>
          <div>
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Subtotal</span>
            <span className="text-2xl font-black italic tracking-tighter text-emerald-400 sm:text-3xl">{formatCurrency(getOrderItemsTotal(cart))}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <button type="button" onClick={onCancel} className="btn-beco rounded-3xl bg-zinc-800 px-8 py-5 text-base font-black sm:px-12 sm:py-8 sm:text-xl">CANCELAR</button>
          <button type="button" onClick={onConfirm} disabled={isSending || cart.length === 0 || !canSend} className="btn-beco btn-beco-purple rounded-3xl px-8 py-5 text-base font-black shadow-2xl shadow-primary/20 transition-all disabled:opacity-20 disabled:grayscale sm:px-16 sm:py-8 sm:text-xl xl:px-24">
            {isSending ? 'SALVANDO...' : !kitchen && !bar ? 'REGISTRAR NA MESA' : 'CONFIRMAR E ENVIAR'}
          </button>
          {!canSend && <p className="text-center text-[10px] font-black uppercase tracking-widest text-rose-400 sm:text-right">Seu perfil não pode enviar pedido para produção/bar.</p>}
        </div>
      </div>
    </>
  );
}
