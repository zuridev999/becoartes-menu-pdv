import { motion } from 'framer-motion';
import { useState } from 'react';
import { X, FileText, Receipt, LayoutDashboard, QrCode, CreditCard, Landmark, Loader2 } from 'lucide-react';
import { useStore } from '../../store';
import { CustomerTabApi } from '../../lib/api';
import { calculateBillTotal, calculateServiceFee, clampServiceFeePercent, formatPercent, MAX_SERVICE_FEE_PERCENT, roundMoney } from '../../lib/billing';
import { formatCurrency } from '../../lib/format';

type PaymentMethod = 'pix' | 'credit' | 'debit';

const paymentOptions: Array<{
  method: PaymentMethod;
  label: string;
  description: string;
  icon: typeof QrCode;
}> = [
  { method: 'pix', label: 'Pagar via Pix', description: 'Abre o checkout seguro do PagBank.', icon: QrCode },
  { method: 'credit', label: 'Cartão de crédito', description: 'Pague no ambiente protegido do PagBank.', icon: CreditCard },
  { method: 'debit', label: 'Cartão de débito', description: 'Use o checkout hospedado do PagBank.', icon: Landmark },
];

export function CustomerAccountModal({ onClose }: { onClose: () => void }) {
  const { currentTableId, tables, settings, addNotification } = useStore();
  const [loadingMethod, setLoadingMethod] = useState<PaymentMethod | null>(null);
  const table = tables.find(t => t.id === currentTableId);

  if (!table) return null;

  const subtotal = roundMoney(table.orders.reduce((acc, o) => {
    const modifiersTotal = o.selectedModifiers?.reduce((mAcc, m) => mAcc + m.price, 0) || 0;
    return acc + ((o.price + modifiersTotal) * o.quantity);
  }, 0));

  const serviceFeePercent = clampServiceFeePercent(Number(settings.serviceTax ?? MAX_SERVICE_FEE_PERCENT));
  const serviceFee = calculateServiceFee(subtotal, serviceFeePercent);
  const total = calculateBillTotal({ subtotal, serviceFee, discount: 0 });
  const paid = roundMoney((table.payments || [])
    .filter(payment => payment.status !== 'cancelled')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  const balance = Math.max(0, roundMoney(total - paid));
  const canPayOnline = Boolean(table.customerTab?.id) && balance > 0.009;

  const handlePayment = async (method: PaymentMethod) => {
    if (!table.customerTab?.id) {
      addNotification('Pagamento online disponível apenas no modo comanda.', 'error');
      return;
    }

    setLoadingMethod(method);
    try {
      const result = await CustomerTabApi.createPaymentLink({
        tabId: table.customerTab.id,
        method,
        returnUrl: window.location.href,
      });
      if (!result.checkoutUrl) {
        throw new Error('PagBank não retornou link de pagamento.');
      }
      window.location.href = result.checkoutUrl;
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Não foi possível gerar o pagamento.', 'error');
    } finally {
      setLoadingMethod(null);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-3 backdrop-blur-md sm:p-8"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0c] shadow-2xl sm:max-h-[90vh] sm:rounded-[3rem]"
      >
        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] p-4 sm:p-10">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/20 text-accent sm:h-16 sm:w-16 sm:rounded-3xl">
              <Receipt size={28} />
            </div>
            <div>
              <h2 className="mb-1 text-3xl font-black italic tracking-tighter sm:text-5xl">Minha <span className="text-accent">Conta</span></h2>
              <p className="text-gray-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
                <LayoutDashboard size={14} /> Mesa {table.number}
              </p>
            </div>
          </div>
          <button type="button" aria-label="Fechar conta" onClick={onClose} className="glass shrink-0 rounded-full p-3 text-rose-500 transition-all hover:bg-rose-500/20 sm:p-4">
            <X size={28} />
          </button>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto p-4 sm:p-12">
          <div className="mb-8 space-y-6 sm:mb-12">
            {table.orders.length === 0 ? (
              <div className="text-center py-20 opacity-20">
                <FileText size={80} className="mx-auto mb-6" />
                <p className="text-2xl font-black uppercase tracking-widest">Nenhum consumo ainda</p>
              </div>
            ) : (
              table.orders.map((item, idx) => (
                <div key={idx} className="flex justify-between items-start pb-6 border-b border-white/5 last:border-0 group">
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-2xl font-black italic tracking-tighter">{item.quantity}x {item.name}</p>
                      <p className="text-lg font-black text-white/90 sm:text-2xl">{formatCurrency((item.price + (item.selectedModifiers?.reduce((acc, m) => acc + m.price, 0) || 0)) * item.quantity)}</p>
                    </div>
                    {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                      <p className="text-sm text-gray-500 font-bold">
                        + {item.selectedModifiers.map(m => m.name).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <section className="space-y-4 border-y border-white/10 py-6 sm:space-y-6 sm:py-8">
            <div className="flex justify-between items-center text-gray-500 font-black uppercase tracking-[0.2em] text-sm">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between items-center text-gray-500 font-black uppercase tracking-[0.2em] text-sm">
              <span>Taxa de serviço ({formatPercent(serviceFeePercent)}%)</span>
              <span>{formatCurrency(serviceFee)}</span>
            </div>
            <div className="pt-6 border-t border-white/10 flex justify-between items-center">
              <span className="text-3xl font-black italic tracking-tighter uppercase">Total</span>
              <span className="text-3xl font-black text-accent italic tracking-tighter sm:text-5xl">{formatCurrency(total)}</span>
            </div>
            {paid > 0 && (
              <div className="flex justify-between items-center text-emerald-400 font-black uppercase tracking-[0.2em] text-sm">
                <span>Já pago</span>
                <span>{formatCurrency(paid)}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-white font-black uppercase tracking-[0.2em] text-sm">
              <span>Saldo aberto</span>
              <span>{formatCurrency(balance)}</span>
            </div>
          </section>

          <section className="mt-8 border-t border-white/10 pt-7">
            <div className="mb-5">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-accent">Pagamento online</p>
              <h3 className="text-2xl font-black italic tracking-tighter mt-1">Escolha como pagar</h3>
              <p className="text-sm font-bold text-zinc-500 mt-2">
                Você será levado para o ambiente seguro do PagBank. A baixa entra automaticamente quando o pagamento for confirmado.
              </p>
            </div>

            {!canPayOnline ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 text-sm font-black text-zinc-500">
                {balance <= 0.009 ? 'Esta conta não tem saldo em aberto.' : 'Abra uma comanda para usar pagamento online.'}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {paymentOptions.map(option => {
                  const Icon = option.icon;
                  const isLoading = loadingMethod === option.method;
                  return (
                    <button
                      key={option.method}
                      onClick={() => handlePayment(option.method)}
                      disabled={Boolean(loadingMethod)}
                      className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 text-left transition-all hover:border-accent/70 hover:bg-accent/10 disabled:opacity-60"
                    >
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                        {isLoading ? <Loader2 size={24} className="animate-spin" /> : <Icon size={24} />}
                      </div>
                      <p className="text-base font-black uppercase tracking-tight text-white">{isLoading ? 'Gerando...' : option.label}</p>
                      <p className="mt-1 text-xs font-bold leading-relaxed text-zinc-500">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="p-10 bg-white/[0.02] border-t border-white/5">
          <button
            onClick={onClose}
            className="w-full py-8 btn-beco bg-white/5 text-white/50 text-xl font-black tracking-widest rounded-[2rem] hover:bg-white/10 transition-all uppercase"
          >
            Voltar ao Cardápio
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
