import { useRef, useState } from 'react';
import { CreditCard, Receipt, CheckCircle2 } from 'lucide-react';
import { useStore } from '../../store';
import { usePublicI18n } from '../../lib/public-i18n';
import type { QrPaymentContext } from '../../lib/api';

export function AccountStaffActions({ context }: { context: QrPaymentContext }) {
  const { requestService, serviceRequests } = useStore();
  const { t, errorText } = usePublicI18n();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const pending = serviceRequests.some(request => request.tableId === context.tableId && request.type === 'bill' && request.status === 'pending');
  const send = async (machine: boolean) => {
    if (lock.current || pending) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await requestService(context.tableId, 'bill', machine
        ? 'Cliente pediu a conta e a maquininha para pagar na mesa. Conferir pagamentos online antes de cobrar.'
        : 'Cliente pediu a conta à equipe. Conferir pagamentos online antes de cobrar.', context.customerTabContext);
      setSent(machine ? 'accountMachineSent' : 'accountBillSent');
    } catch (cause) { setError(errorText(cause)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="mt-6 space-y-3 border-t border-white/10 pt-6" aria-label={t('accountStaffTitle')}>
    <h3 className="text-lg font-bold">{t('accountStaffTitle')}</h3>
    <p className="text-sm text-zinc-400">{t('accountStaffDescription')}</p>
    {pending || sent ? <p role="status" className="flex items-start gap-3 rounded-xl bg-emerald-500/10 p-4 text-emerald-300"><CheckCircle2 className="shrink-0" size={22}/>{t(sent || 'accountStaffPending')}</p>
      : <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={busy} onClick={() => void send(false)} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/25 px-3 py-4 text-base font-semibold disabled:opacity-50"><Receipt size={22}/>{t('closeBill')}</button>
        <button type="button" disabled={busy} onClick={() => void send(true)} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-white/25 px-3 py-4 text-base font-semibold disabled:opacity-50"><CreditCard size={22}/>{t('accountRequestMachine')}</button>
      </div>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
  </section>;
}
