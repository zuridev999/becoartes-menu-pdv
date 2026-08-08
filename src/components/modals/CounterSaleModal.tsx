import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CreditCard, Landmark, Plus, Search, ShoppingBag, Trash2, Wallet, X } from 'lucide-react';
import { useStore, type Modifier, type OrderItem, type Product } from '../../store';
import { createId } from '../../lib/id';
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
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.id || '');
  const [query, setQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [payments, setPayments] = useState<Array<{ id: string; method: PaymentMethod; amount: number }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!activeCategory && categories[0]?.id) setActiveCategory(categories[0].id);
  }, [activeCategory, categories]);

  const subtotal = getOrderItemsTotal(cart);
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const remaining = Math.max(0, subtotal - paid);
  const change = Math.max(0, paid - subtotal);
  const hasCashPayment = payments.some((payment) => payment.method === 'cash');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = menu
    .filter((product) => product.visible || canSellUnavailableProduct)
    .filter((product) => !activeCategory || product.categoryId === activeCategory)
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
    const amount = Number(String(paymentAmount || '').replace(',', '.')) || remaining;
    if (amount <= 0) {
      addNotification('Informe um valor de pagamento maior que zero.', 'error');
      return;
    }
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
        <div className="glass-card pointer-events-auto w-full max-w-7xl border-white/10 shadow-2xl flex flex-col overflow-visible xl:overflow-hidden xl:h-[calc(100dvh-1.5rem)] mb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="p-4 sm:p-6 xl:p-8 border-b border-white/10 flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-3xl bg-amber-400 text-black flex items-center justify-center shadow-2xl shadow-amber-500/20 shrink-0">
                <ShoppingBag size={24} strokeWidth={3} />
              </div>
              <div className="min-w-0 pr-14 sm:pr-0">
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-300">PDV</p>
                <h2 className="text-3xl sm:text-5xl font-black italic tracking-tighter text-white leading-none">Venda Balcão</h2>
                <p className="text-xs font-bold text-zinc-500 mt-2">Sem mesa, sem gorjeta, com baixa de estoque.</p>
              </div>
            </div>
            <button onClick={onClose} className="absolute top-4 right-4 xl:static p-4 glass rounded-2xl hover:text-rose-400">
              <X size={24} />
            </button>
          </div>

          <div className="xl:flex-1 xl:min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_430px]">
            <div className="xl:min-h-0 flex flex-col p-4 sm:p-6">
              <div className="flex flex-col md:flex-row gap-3 mb-4">
                <div className="relative flex-1">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar produto para venda balcão"
                    className="w-full h-14 rounded-2xl bg-white/[0.04] border border-white/10 pl-12 pr-4 text-sm font-bold text-white outline-none focus:border-amber-300/60"
                  />
                </div>
                <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      onClick={() => setActiveCategory(category.id)}
                      className={`px-5 h-14 rounded-2xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap border transition-all ${
                        activeCategory === category.id
                          ? 'bg-amber-400 text-black border-amber-400'
                          : 'bg-white/[0.03] text-zinc-400 border-white/10 hover:text-white'
                      }`}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-[34dvh] xl:max-h-none xl:flex-1 xl:min-h-0 overflow-y-auto custom-scrollbar pr-1">
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
                  {visibleProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => product.modifierGroups?.length ? setSelectedProduct(product) : addCounterItem(product)}
                      disabled={!canAddOrderItem}
                      className="rounded-3xl bg-[#121214] border border-white/10 p-4 text-left hover:border-amber-300/50 hover:bg-[#1a1a1e] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-lg font-black italic tracking-tight text-white truncate">{product.name}</h3>
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mt-1">{product.categoryName || product.categoryId}</p>
                        </div>
                        <div className="w-10 h-10 rounded-2xl bg-amber-400/10 text-amber-300 flex items-center justify-center shrink-0">
                          <Plus size={20} strokeWidth={3} />
                        </div>
                      </div>
                      <p className="mt-4 text-xl font-black text-emerald-400">{formatCurrency(product.price)}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <aside className="xl:min-h-0 border-t xl:border-t-0 xl:border-l border-white/10 bg-black/20 flex flex-col">
              <div className="p-4 sm:p-6 border-b border-white/10">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Total balcão</p>
                <p className="text-4xl sm:text-5xl font-black italic tracking-tighter text-amber-300 mt-2">{formatCurrency(subtotal)}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-2">Taxa de serviço: R$ 0,00</p>
              </div>

              <div className="max-h-[28dvh] xl:max-h-none xl:flex-1 xl:min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-3">
                {cart.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 p-8 text-center text-zinc-500 text-sm font-bold">
                    Adicione produtos para iniciar a venda balcão.
                  </div>
                ) : cart.map((item) => (
                  <div key={item.id} className="rounded-3xl bg-white/[0.04] border border-white/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-black text-white">{item.quantity}x {item.name}</h4>
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
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQuantity(item.id, -1)} disabled={!canChangeItemQuantity} className="w-9 h-9 rounded-xl bg-white/10 text-white disabled:opacity-30">-</button>
                        <span className="w-8 text-center font-black text-white">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.id, 1)} disabled={!canChangeItemQuantity} className="w-9 h-9 rounded-xl bg-white/10 text-white disabled:opacity-30">+</button>
                      </div>
                      <p className="text-lg font-black text-emerald-400">{formatCurrency(getOrderItemTotal(item))}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 sm:p-6 border-t border-white/10 space-y-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PAYMENT_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.id}
                        onClick={() => {
                          setPaymentMethod(option.id);
                          setPaymentAmount(remaining > 0 ? remaining.toFixed(2) : '');
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
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    placeholder={remaining > 0 ? remaining.toFixed(2) : '0,00'}
                    className="flex-1 h-14 rounded-2xl bg-white/[0.04] border border-white/10 px-4 text-xl font-black text-white outline-none focus:border-amber-300/60"
                  />
                  <button onClick={addPayment} disabled={!canLaunchPayment || !paymentMethod} className="h-14 px-5 rounded-2xl bg-amber-400 text-black text-xs font-black uppercase tracking-widest disabled:opacity-30">
                    Lançar
                  </button>
                </div>

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
