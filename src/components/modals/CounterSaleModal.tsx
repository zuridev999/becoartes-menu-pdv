import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CreditCard, Landmark, Plus, Search, ShoppingBag, Trash2, Wallet, X } from 'lucide-react';
import { useStore, type Modifier, type OrderItem, type Product } from '../../store';
import { createId } from '../../lib/id';
import { applyImageFallback, getImageSrc } from '../../lib/image';
import { buildPdvCatalogCategories, getPdvCategoriesById, getPdvProductCategoryId } from '../../lib/pdv-catalog';
import { getOrderItemTotal, getOrderItemsTotal } from '../../lib/totals';
import { ProductModal } from './ProductModal';

type PaymentMethod = 'credit' | 'debit' | 'cash' | 'pix';

const PAYMENT_OPTIONS: Array<{ id: PaymentMethod; label: string; icon: typeof CreditCard }> = [
  { id: 'credit', label: 'Crédito', icon: CreditCard },
  { id: 'debit', label: 'Débito', icon: CreditCard },
  { id: 'pix', label: 'Pix', icon: Landmark },
  { id: 'cash', label: 'Dinheiro', icon: Wallet },
];

const normalizeSearchText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasVolumeAwareMatch = (haystack: string, term: string) => {
  if (!term) return true;
  const normalizedHaystack = normalizeSearchText(haystack);
  const normalizedTerm = normalizeSearchText(term);

  if (/^\d+$/.test(normalizedTerm)) {
    const escaped = escapeRegExp(normalizedTerm);
    const pattern = new RegExp(`(?:^|[^\\d])${escaped}(?:[^\\d]|$)`);
    return pattern.test(normalizedHaystack);
  }

  return normalizedHaystack.includes(normalizedTerm);
};

const formatCurrency = (value: number) => value.toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const formatPaymentInput = (digits: string) => {
  if (!digits) return '';
  return (Number(digits) / 100).toFixed(2);
};

const createCounterItem = (
  product: Product,
  quantity: number,
  selectedModifiers: Modifier[] = [],
  notes = '',
): OrderItem => ({
  id: createId(),
  productId: product.id,
  categoryId: product.categoryId,
  categoryName: product.categoryName,
  name: product.name,
  price: product.price,
  remoteStockId: product.remoteStockId,
  quantity,
  selectedModifiers,
  notes,
  status: 'pending',
  orderedAt: new Date(),
});

export function CounterSaleModal({
  onClose,
  canAddOrderItem,
  canSellUnavailableProduct,
  canChangeItemQuantity,
  canEditItemNotes,
  canLaunchPayment,
  canCloseBill,
}: {
  onClose: () => void;
  canAddOrderItem: boolean;
  canSellUnavailableProduct: boolean;
  canChangeItemQuantity: boolean;
  canEditItemNotes: boolean;
  canLaunchPayment: boolean;
  canCloseBill: boolean;
}) {
  const { menu, categories, closeCounterSale, addNotification } = useStore();
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [query, setQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentValidationMessage, setPaymentValidationMessage] = useState('');
  const [payments, setPayments] = useState<Array<{ id: string; method: PaymentMethod; amount: number }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const subtotal = getOrderItemsTotal(cart);
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const remaining = Math.max(0, subtotal - paid);
  const change = Math.max(0, paid - subtotal);
  const hasCashPayment = payments.some((payment) => payment.method === 'cash');
  const normalizedQuery = query.trim().toLowerCase();
  const categoriesById = useMemo(() => getPdvCategoriesById(categories), [categories]);
  const pdvProducts = useMemo(
    () => menu.filter((product) => product.visible || canSellUnavailableProduct),
    [canSellUnavailableProduct, menu],
  );
  const pdvCategories = useMemo(
    () => buildPdvCatalogCategories(categories, pdvProducts),
    [categories, pdvProducts],
  );
  useEffect(() => {
    if (!pdvCategories.length) {
      if (activeCategory) setActiveCategory('');
      return;
    }
    if (!pdvCategories.some(category => category.id === activeCategory)) setActiveCategory(pdvCategories[0].id);
  }, [activeCategory, pdvCategories]);

  const visibleProducts = pdvProducts
    .filter((product) => normalizedQuery || getPdvProductCategoryId(product, categoriesById) === activeCategory)
    .filter((product) => {
      if (!normalizedQuery) return true;
      return hasVolumeAwareMatch(`${product.name} ${product.categoryName || ''}`, normalizedQuery);
    });

  const addCounterItem = (product: Product, quantity = 1, selectedModifiers: Modifier[] = [], notes = '') => {
    if (!canAddOrderItem) {
      addNotification('Seu perfil não pode adicionar produtos.', 'error');
      return;
    }
    setCart((current) => [...current, createCounterItem(product, quantity, selectedModifiers, notes)]);
  };

  const updateQuantity = (itemId: string, delta: number) => {
    if (!canChangeItemQuantity) return;
    setCart((current) => current
      .map((item) => item.id === itemId ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item));
  };

  const addPayment = () => {
    if (!canLaunchPayment) {
      addNotification('Seu perfil não pode lançar pagamento.', 'error');
      return;
    }
    if (!paymentMethod) {
      addNotification('Selecione a forma de pagamento.', 'error');
      return;
    }
    const amount = paymentAmount ? Number(paymentAmount) / 100 : remaining;
    if (amount <= 0) {
      addNotification('Informe um valor de pagamento maior que zero.', 'error');
      return;
    }
    if (amount > remaining && paymentMethod !== 'cash') {
      setPaymentValidationMessage(`O valor lançado passou do total da compra (${formatCurrency(remaining)}). Para receber a mais, selecione Dinheiro.`);
      return;
    }
    setPaymentValidationMessage('');
    const label = PAYMENT_OPTIONS.find((option) => option.id === paymentMethod)?.label || paymentMethod;
    const confirmed = window.confirm(`Confirmar pagamento em ${label}? Confira na maquininha antes de lançar.`);
    if (!confirmed) return;
    setPayments((current) => [...current, { id: createId(), method: paymentMethod, amount }]);
    setPaymentMethod('');
    setPaymentAmount('');
  };

  const finishCounterSale = async () => {
    if (!canCloseBill) {
      addNotification('Seu perfil não pode finalizar venda.', 'error');
      return;
    }
    if (cart.length === 0) {
      addNotification('Adicione ao menos um produto na venda balcão.', 'error');
      return;
    }
    if (remaining > 0) {
      addNotification('Ainda falta lançar pagamento para finalizar.', 'error');
      return;
    }
    if (change > 0 && !hasCashPayment) {
      addNotification('Troco só pode existir quando houver dinheiro.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      const success = await closeCounterSale({
        items: cart,
        payments,
        subtotal,
        total: subtotal,
      });
      if (success) onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[620] bg-black/90 backdrop-blur-3xl" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.96, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 20, opacity: 0 }}
        className="fixed inset-0 z-[650] flex items-start xl:items-center justify-center p-2 sm:p-4 xl:p-6 pointer-events-none font-['Outfit'] overflow-y-auto overscroll-contain"
      >
        <div className="glass-card pointer-events-auto w-full max-w-[1440px] border-white/10 shadow-2xl flex flex-col overflow-hidden h-[calc(100dvh-1.5rem)] max-h-[960px] mb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="p-4 xl:p-5 border-b border-white/10 flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-amber-400 text-black flex items-center justify-center shadow-2xl shadow-amber-500/20 shrink-0">
                <ShoppingBag size={22} strokeWidth={3} />
              </div>
              <div className="min-w-0 pr-14 sm:pr-0">
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-300">PDV</p>
                <h2 className="text-2xl sm:text-4xl font-black italic tracking-tighter text-white leading-none">Venda Balcão</h2>
                <p className="text-[11px] font-bold text-zinc-500 mt-1">Sem mesa, sem gorjeta, com baixa de estoque.</p>
              </div>
            </div>
            <button onClick={onClose} className="absolute top-4 right-4 xl:static p-4 glass rounded-2xl hover:text-rose-400">
              <X size={24} />
            </button>
          </div>

          <div className="lg:flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="lg:min-h-0 flex min-w-0 flex-col p-4">
              <div className="mb-4 flex flex-col gap-3">
                <div className="relative flex-1">
                  <Search size={21} className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar produto para venda balcão"
                    aria-label="Buscar produto para venda balcão"
                    className="h-11 w-full rounded-2xl bg-white/[0.05] border border-white/15 pl-12 pr-5 text-sm font-bold text-white outline-none transition-colors placeholder:text-zinc-500 focus:border-amber-300/70 focus:bg-white/[0.07]"
                  />
                </div>
                <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1" role="tablist" aria-label="Categorias do Venda Balcão">
                  {pdvCategories.map((category) => (
                    <button
                      type="button"
                      key={category.id}
                      onClick={() => setActiveCategory(category.id)}
                      role="tab"
                      aria-selected={activeCategory === category.id}
                      className={`px-4 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap border transition-all ${
                        activeCategory === category.id
                          ? 'bg-amber-400 text-black border-amber-400'
                          : 'bg-white/[0.03] text-zinc-400 border-white/10 hover:text-white'
                      }`}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-w-0 max-h-[46dvh] sm:max-h-[52dvh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto custom-scrollbar pr-1">
                <div className="mx-auto grid min-w-0 w-full grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
                  {visibleProducts.length === 0 ? (
                    <div className="md:col-span-2 2xl:col-span-3 flex min-h-48 items-center justify-center rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 text-center">
                      <div>
                        <p className="text-base font-black text-zinc-300">Nenhum produto encontrado</p>
                        <p className="mt-2 text-sm font-bold text-zinc-500">
                          {query ? 'Tente outro nome ou limpe a busca.' : 'Esta categoria não possui produtos visíveis.'}
                        </p>
                      </div>
                    </div>
                  ) : visibleProducts.map((product) => (
                    <button
                      type="button"
                      key={product.id}
                      onClick={() => product.modifierGroups?.length ? setSelectedProduct(product) : addCounterItem(product)}
                      disabled={!canAddOrderItem}
                      className="group min-h-24 min-w-0 w-full overflow-hidden rounded-3xl bg-[#121214] border border-white/10 p-3 sm:p-3.5 text-left hover:border-amber-300/50 hover:bg-[#1a1a1e] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="relative order-2 h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 sm:h-20 sm:w-20">
                          <img
                            src={getImageSrc(product.image)}
                            alt={product.name}
                            onError={applyImageFallback}
                            className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
                          />
                          <span className="absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-xl bg-amber-400 text-black shadow-lg shadow-black/30">
                            <Plus size={18} strokeWidth={3} />
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col self-stretch py-0.5">
                          <h3 className="line-clamp-2 break-words text-base font-black italic leading-tight tracking-tight text-white sm:text-lg">{product.name}</h3>
                          <p className="mt-1 truncate text-[9px] font-black uppercase tracking-widest text-zinc-500">{product.categoryName || product.categoryId}</p>
                          <p className="mt-auto pt-3 text-lg font-black text-emerald-400 sm:text-xl">{formatCurrency(product.price)}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <aside className="lg:min-h-0 border-t lg:border-t-0 lg:border-l border-white/10 bg-black/20 flex flex-col">
              <div className="p-4 border-b border-white/10">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Total balcão</p>
                <p className="text-3xl sm:text-4xl font-black italic tracking-tighter text-amber-300 mt-1">{formatCurrency(subtotal)}</p>
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mt-1">Taxa de serviço: R$ 0,00</p>
              </div>

              <div className="max-h-[28dvh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-3">
                {cart.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 p-8 text-center text-zinc-500 text-sm font-bold">
                    Adicione produtos para iniciar a venda balcão.
                  </div>
                ) : cart.map((item) => (
                  <div key={item.id} className="rounded-2xl bg-white/[0.04] border border-white/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-black text-white">{item.quantity}x {item.name}</h4>
                        {(item.selectedModifiers || []).length > 0 && (
                          <p className="text-[10px] font-bold text-zinc-500 mt-1">
                            {item.selectedModifiers.map((modifier) => modifier.name).join(', ')}
                          </p>
                        )}
                        {item.notes && <p className="text-xs font-bold text-amber-200 mt-2">{item.notes}</p>}
                      </div>
                      <button onClick={() => setCart((current) => current.filter((cartItem) => cartItem.id !== item.id))} className="p-2 rounded-xl bg-rose-500/10 text-rose-300">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQuantity(item.id, -1)} disabled={!canChangeItemQuantity} className="h-8 w-8 rounded-lg bg-white/10 text-white disabled:opacity-30">-</button>
                        <span className="w-8 text-center font-black text-white">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.id, 1)} disabled={!canChangeItemQuantity} className="h-8 w-8 rounded-lg bg-white/10 text-white disabled:opacity-30">+</button>
                      </div>
                      <p className="text-base font-black text-emerald-400">{formatCurrency(getOrderItemTotal(item))}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 border-t border-white/10 space-y-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PAYMENT_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.id}
                        onClick={() => {
                          setPaymentMethod(option.id);
                          setPaymentValidationMessage('');
                          setPaymentAmount(remaining > 0 ? String(Math.round(remaining * 100)) : '');
                        }}
                        className={`rounded-2xl border p-3 flex flex-col items-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all ${
                          paymentMethod === option.id ? 'bg-amber-400 text-black border-amber-400' : 'bg-white/[0.03] border-white/10 text-zinc-400'
                        }`}
                      >
                        <Icon size={18} />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <input
                    value={formatPaymentInput(paymentAmount)}
                    inputMode="decimal"
                    pattern="[0-9.]*"
                    aria-label="Valor do pagamento"
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                      setPaymentAmount(event.target.value.replace(/\D/g, '').slice(0, 9));
                      setPaymentValidationMessage('');
                    }}
                    onKeyDown={(event) => {
                      if (['e', 'E', '+', '-', ','].includes(event.key)) event.preventDefault();
                    }}
                    placeholder={remaining > 0 ? formatPaymentInput(String(Math.round(remaining * 100))) : '0.00'}
                    className="flex-1 h-14 rounded-2xl bg-white/[0.04] border border-white/10 px-4 text-xl font-black text-white outline-none focus:border-amber-300/60"
                  />
                  <button onClick={addPayment} disabled={!canLaunchPayment || !paymentMethod} className="h-14 px-5 rounded-2xl bg-amber-400 text-black text-xs font-black uppercase tracking-widest disabled:opacity-30">
                    Lançar
                  </button>
                </div>
                <p className="-mt-2 text-[10px] font-bold text-zinc-500">Digite somente números: 5000 = R$ 50.00.</p>

                {paymentValidationMessage && (
                  <div role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-xs font-bold leading-relaxed text-rose-200">
                    {paymentValidationMessage}
                  </div>
                )}

                {payments.length > 0 && (
                  <div className="space-y-2">
                    {payments.map((payment) => (
                      <div key={payment.id} className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3 text-xs font-black text-zinc-300">
                        <span>{PAYMENT_OPTIONS.find((option) => option.id === payment.method)?.label}</span>
                        <div className="flex items-center gap-3">
                          <span>{formatCurrency(payment.amount)}</span>
                          <button onClick={() => setPayments((current) => current.filter((item) => item.id !== payment.id))} className="text-rose-300">x</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl bg-white/[0.04] p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Pago</p>
                    <p className="text-sm font-black text-emerald-400">{formatCurrency(paid)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/[0.04] p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Falta</p>
                    <p className="text-sm font-black text-rose-400">{formatCurrency(remaining)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/[0.04] p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Troco</p>
                    <p className="text-sm font-black text-amber-300">{formatCurrency(change)}</p>
                  </div>
                </div>

                <button
                  onClick={finishCounterSale}
                  disabled={isSubmitting || cart.length === 0 || remaining > 0 || !canCloseBill}
                  className="w-full h-16 rounded-3xl bg-emerald-400 text-black text-sm font-black uppercase tracking-[0.2em] shadow-2xl shadow-emerald-900/20 disabled:opacity-30"
                >
                  {isSubmitting ? 'Finalizando...' : 'Finalizar venda balcão'}
                </button>
              </div>
            </aside>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            canChangeItemQuantity={canChangeItemQuantity}
            canEditItemNotes={canEditItemNotes}
            onAddToCart={addCounterItem}
          />
        )}
      </AnimatePresence>
    </>
  );
}
