import { motion } from 'framer-motion';
import { X, FileText, Receipt, LayoutDashboard } from 'lucide-react';
import { useStore } from '../../store';
import { calculateBillTotal, calculateServiceFee, clampServiceFeePercent, formatPercent, MAX_SERVICE_FEE_PERCENT, roundMoney } from '../../lib/billing';
import { formatCurrency } from '../../lib/format';
import { usePublicI18n } from '../../lib/public-i18n';

export function CustomerAccountModal({ onClose, locationLabel }: { onClose: () => void; locationLabel?: string }) {
  const { currentTableId, tables, settings } = useStore();
  const { t, locale, catalogText } = usePublicI18n();
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
        className="mobile-dialog flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0c] shadow-2xl sm:max-h-[90vh] sm:rounded-[3rem]"
      >
        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] p-4 sm:p-10">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/20 text-accent sm:h-16 sm:w-16 sm:rounded-3xl">
              <Receipt size={28} />
            </div>
            <div>
              <h2 className="mb-1 text-3xl font-black italic tracking-tighter sm:text-5xl">{t('account')}</h2>
              <p className="text-gray-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
                <LayoutDashboard size={14} /> {locationLabel || `${t('table')} ${table.number}`}
              </p>
            </div>
          </div>
          <button type="button" aria-label={t('close')} onClick={onClose} className="glass shrink-0 rounded-full p-3 text-rose-500 transition-all hover:bg-rose-500/20 sm:p-4">
            <X size={28} />
          </button>
        </div>

        <div className="ios-touch-scroll custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-12">
          <div className="mb-8 space-y-6 sm:mb-12">
            {table.orders.length === 0 ? (
              <div className="text-center py-20 opacity-20">
                <FileText size={80} className="mx-auto mb-6" />
                <p className="text-2xl font-black uppercase tracking-widest">{t('noConsumption')}</p>
              </div>
            ) : (
              table.orders.map((item, idx) => (
                <div key={idx} className="flex justify-between items-start pb-6 border-b border-white/5 last:border-0 group">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap justify-between items-center gap-2 mb-1">
                      <p className="text-2xl font-black italic tracking-tighter">{item.quantity}x {catalogText(item.productId, item.name, 'name')}</p>
                      <p className="text-lg font-black text-white/90 sm:text-2xl">{formatCurrency((item.price + (item.selectedModifiers?.reduce((acc, m) => acc + m.price, 0) || 0)) * item.quantity, locale)}</p>
                    </div>
                    {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                      <p className="text-sm text-gray-500 font-bold">
                        + {item.selectedModifiers.map(m => catalogText(m.id, m.name, 'name')).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <section className="space-y-4 border-y border-white/10 py-6 sm:space-y-6 sm:py-8">
            <div className="flex justify-between items-center text-gray-500 font-black uppercase tracking-[0.2em] text-sm">
              <span>{t('subtotal')}</span>
              <span>{formatCurrency(subtotal, locale)}</span>
            </div>
            <div className="flex justify-between items-center text-gray-500 font-black uppercase tracking-[0.2em] text-sm">
              <span>{t('serviceFee', { rate: formatPercent(serviceFeePercent) })}</span>
              <span>{formatCurrency(serviceFee, locale)}</span>
            </div>
            <div className="pt-6 border-t border-white/10 flex justify-between items-center">
              <span className="text-3xl font-black italic tracking-tighter uppercase">{t('total')}</span>
              <span className="text-3xl font-black text-accent italic tracking-tighter sm:text-5xl">{formatCurrency(total, locale)}</span>
            </div>
            {paid > 0 && (
              <div className="flex justify-between items-center text-emerald-400 font-black uppercase tracking-[0.2em] text-sm">
                <span>{t('paid')}</span>
                <span>{formatCurrency(paid, locale)}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-white font-black uppercase tracking-[0.2em] text-sm">
              <span>{t('openBalance')}</span>
              <span>{formatCurrency(balance, locale)}</span>
            </div>
          </section>

          <p className="mt-6 rounded-2xl border border-white/10 p-4 text-sm text-zinc-300">
            {balance <= 0.009 ? t('noOpenBalance') : t('payWithStaff')}
          </p>
        </div>

        <div className="shrink-0 p-3 sm:p-6 bg-white/[0.02] border-t border-white/5">
          <button
            onClick={onClose}
            className="w-full py-3 sm:py-5 btn-beco bg-white/5 text-white/50 text-xl font-black tracking-widest rounded-[2rem] hover:bg-white/10 transition-all uppercase"
          >
            {t('backToMenu')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
