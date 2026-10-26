import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, CreditCard, Loader2, QrCode } from 'lucide-react';
import { QrPaymentsApi, type QrPaymentContext, type QrPaymentIntent, type QrPaymentSummary } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { usePublicI18n } from '../../lib/public-i18n';

let sdkPromise: Promise<void> | null = null;
async function loadCardSdk() {
  if (window.PagSeguro?.encryptCard) return window.PagSeguro;
  if (!sdkPromise) sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); sdkPromise = null; reject(new Error('paymentError')); };
    document.head.appendChild(script);
  });
  await sdkPromise;
  if (!window.PagSeguro?.encryptCard) throw new Error('paymentError');
  return window.PagSeguro;
}
const inputClass = 'min-h-12 w-full min-w-0 rounded-xl border border-white/15 bg-white/5 px-3 text-base text-white';

export function QrPaymentPanel({ context, onPaid, expanded, onExpand }: { context: QrPaymentContext; onPaid: () => void; expanded: boolean; onExpand: () => void }) {
  const { t, locale } = usePublicI18n();
  const reducedMotion = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (expanded) headingRef.current?.focus({ preventScroll: true }); }, [expanded]);
  const [summary, setSummary] = useState<QrPaymentSummary | null>(null);
  const [intent, setIntent] = useState<QrPaymentIntent | null>(null);
  const [method, setMethod] = useState<'pix' | 'credit'>('pix');
  const [customer, setCustomer] = useState({ name: '', email: '', taxId: '' });
  const [card, setCard] = useState({ number: '', expiry: '', cvv: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [image, setImage] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const lock = useRef(false);
  const paidCallback = useRef(onPaid);
  paidCallback.current = onPaid;
  const contextKey = JSON.stringify(context);
  useEffect(() => {
    let active = true;
    QrPaymentsApi.summary(context).then(result => { if (active) { setSummary(result); setIntent(result.intent); } }).catch(() => { if (active) setError('paymentLoadError'); });
    return () => { active = false; };
  // contextKey represents the complete authorization target.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);
  useEffect(() => {
    if (!intent || !['creating', 'pending', 'unknown'].includes(intent.status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await QrPaymentsApi.status(context, intent.id);
        if (!active) return;
        setIntent(next);
        if (next.status === 'paid') { paidCallback.current(); return; }
        if (!['creating', 'pending', 'unknown'].includes(next.status)) return;
      } catch { /* Keep existing charge; a network error must not create another one. */ }
      if (active) timer = setTimeout(poll, 6000);
    };
    timer = setTimeout(poll, 4000);
    return () => { active = false; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.id, intent?.status, contextKey]);
  useEffect(() => {
    let active = true;
    setImage('');
    const text = intent?.instructions.qrCodeText;
    if (text && summary?.environment !== 'simulator') QRCode.toDataURL(text, { margin: 2, width: 256 }).then(value => { if (active) setImage(value); });
    return () => { active = false; };
  }, [intent?.instructions.qrCodeText, summary?.environment]);
  useEffect(() => { setError(''); }, [summary?.balance]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current || !summary) return;
    lock.current = true; setBusy(true); setError('');
    try {
      let encryptedCard: string | undefined;
      if (method === 'credit') {
        if (summary.environment === 'simulator') encryptedCard = 'SIMULATED_ENCRYPTED_CARD';
        else {
          const key = await QrPaymentsApi.publicKey(context);
          const sdk = await loadCardSdk();
          const parts = card.expiry.split('/').map(value => value.trim());
          const result = sdk.encryptCard({ publicKey: key.publicKey, holder: customer.name,
            number: card.number.replace(/\D/g, ''), expMonth: parts[0],
            expYear: parts[1]?.length === 2 ? `20${parts[1]}` : parts[1], securityCode: card.cvv });
          if (result.hasErrors || !result.encryptedCard) throw new Error('paymentCardInvalid');
          encryptedCard = result.encryptedCard;
        }
      }
      const next = await QrPaymentsApi.create(context, { method, expectedAmount: summary.balance, customer, encryptedCard });
      setIntent(next); setCopied(false); setCard({ number: '', expiry: '', cvv: '' });
      if (next.status === 'paid') paidCallback.current();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
      setError(['paymentAmountRejected', 'paymentCpfInvalid', 'paymentSetupError'].includes(code) ? code : message === 'paymentCardInvalid' ? message : message.includes('conta foi atualizada') ? 'paymentUpdated' : message.includes('Informe nome') ? 'paymentCustomerRequired' : 'paymentError');
      const current = await QrPaymentsApi.summary(context).catch(() => null);
      if (current) { setSummary(current); setIntent(current.intent); }
    } finally { lock.current = false; setBusy(false); }
  };
  const simulate = async (outcome: string) => {
    if (!intent || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const next = await QrPaymentsApi.simulate(context, intent.id, outcome); setIntent(next); if (next.status === 'paid') paidCallback.current(); }
    catch { setError('paymentSimulateError'); }
    finally { lock.current = false; setBusy(false); }
  };
  const switchFromPix = async () => {
    if (!intent || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const next = await QrPaymentsApi.abandon(context, intent.id);
      if (next.status === 'paid') { setIntent(next); paidCallback.current(); return; }
      if (next.status !== 'abandoned') { setIntent(next); setError(next.status === 'review' ? 'paymentReview' : 'paymentChangeError'); return; }
      const current = await QrPaymentsApi.summary(context);
      setSummary(current); setIntent(current.intent); setMethod('credit'); setConfirmSwitch(false); setCopied(false); setImage('');
    } catch { setError('paymentChangeError'); }
    finally { lock.current = false; setBusy(false); }
  };
  if (!summary) return <p role="status" className="mt-6 text-sm text-zinc-300">{t(error || 'paymentLoading')}</p>;
  if (!summary.enabled) return <p className="mt-6 text-sm text-zinc-300">{t('paymentUnavailable')}</p>;
  if (summary.balance <= 0 && !intent) return null;
  const blocked = intent && ['creating', 'pending', 'unknown', 'review'].includes(intent.status);
  if (!expanded) return <button type="button" onClick={onExpand} className="mt-6 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-white px-4 py-4 text-base font-bold text-red-700 transition hover:bg-red-50 sm:text-lg">
    <CreditCard size={22} className="shrink-0" />{t(blocked || intent?.status === 'paid' ? 'paymentView' : 'paymentStart')}
  </button>;
  return <motion.section initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.2 }} className="mx-auto min-w-0 max-w-lg space-y-6" aria-label={t('paymentTitle')}>
    <div className="space-y-2 text-center">
      <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none sm:text-2xl">{t('paymentTitle')}</h3>
      <p className="text-sm text-zinc-400">{t('paymentAmount')}</p>
      <p className="break-words text-4xl font-black tracking-tight">{formatCurrency(intent && (blocked || intent.status === 'paid') ? intent.amount : summary.balance, locale)}</p>
    </div>
    {summary.environment !== 'production' && <p className="rounded-xl bg-amber-400/15 p-3 text-sm text-amber-200">{t(summary.environment === 'simulator' ? 'paymentSimulator' : 'paymentSandbox')}</p>}
    {error && <p role="alert" className="rounded-xl bg-rose-500/15 p-3 text-sm text-rose-200">{t(error)}</p>}
    {intent?.status === 'paid' ? <div role="status" className="space-y-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-emerald-300"><CheckCircle2 size={32} /><p className="text-xl font-bold">{t('paymentConfirmed')}</p><p>{t('paymentConfirmedDetail', { amount: formatCurrency(intent.amount, locale) })}</p></div>
    : blocked ? <div className="min-w-0 space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
      <p className="font-semibold">{intent.method === 'pix' ? 'Pix' : t('paymentCredit')}</p>
      <p role="status" className="text-sm text-zinc-300">{t(intent.status === 'review' ? 'paymentReview' : intent.status === 'unknown' || intent.status === 'creating' ? 'paymentChecking' : 'paymentWaiting')}</p>
      {intent.method === 'pix' && intent.status === 'pending' && <>
        {image && <img src={image} alt={t('paymentPixQr')} className="mx-auto h-56 w-56 max-w-full rounded-xl" />}
        <p className="text-sm text-zinc-400">{t('paymentExpires', { time: new Date(intent.instructions.expiresAt || intent.expiresAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) })}</p>
        <textarea aria-label={t('paymentPixCode')} readOnly value={intent.instructions.qrCodeText || ''} className={`${inputClass} h-20 break-all py-3 text-xs`} />
        {summary.environment !== 'simulator' && <button type="button" className="min-h-12 w-full rounded-xl bg-white p-3 font-bold text-red-700 hover:bg-red-50" onClick={async () => { try { await navigator.clipboard.writeText(intent.instructions.qrCodeText || ''); setCopied(true); } catch { setError('paymentCopyError'); } }}>{t(copied ? 'paymentCopied' : 'paymentCopy')}</button>}
        {!confirmSwitch ? <button type="button" disabled={busy} className="min-h-12 w-full rounded-xl border border-white/20 p-3 font-semibold text-white hover:bg-white/5" onClick={() => setConfirmSwitch(true)}>{t('paymentChangeMethod')}</button>
        : <div className="space-y-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4"><p className="text-sm leading-relaxed text-amber-100">{t('paymentChangeWarning')}</p><div className="grid gap-2 sm:grid-cols-2"><button type="button" disabled={busy} className="min-h-12 rounded-xl border border-white/20 p-3 font-semibold" onClick={() => setConfirmSwitch(false)}>{t('paymentKeepPix')}</button><button type="button" disabled={busy} className="min-h-12 rounded-xl bg-white p-3 font-bold text-red-700 hover:bg-red-50" onClick={() => void switchFromPix()}>{busy ? t('paymentProcessing') : t('paymentConfirmChange')}</button></div></div>}
      </>}
      {summary.environment === 'simulator' && intent.status === 'pending' && <div className="flex flex-wrap gap-2"><button disabled={busy} type="button" className="min-h-12 rounded-xl bg-emerald-600 p-3 font-bold" onClick={() => void simulate('paid')}>{t('paymentSimulatePaid')}</button><button disabled={busy} type="button" className="min-h-12 rounded-xl bg-white/10 p-3" onClick={() => void simulate('declined')}>{t('paymentSimulateDeclined')}</button></div>}
    </div> : <form aria-busy={busy} onSubmit={submit} className="min-w-0">
      <fieldset disabled={busy} className="min-w-0 space-y-5">
      <legend className="sr-only">{t('paymentMethod')}</legend>
      {intent && ['failed', 'expired'].includes(intent.status) && <p role="status" className="text-amber-200">{t(intent.status === 'expired' ? 'paymentExpired' : 'paymentDeclined')}</p>}
      <div className="grid grid-cols-2 gap-3">{(['pix', 'credit'] as const).map(value => <button key={value} type="button" aria-pressed={method === value} onClick={() => { setMethod(value); setError(''); }} className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-sm font-bold transition ${method === value ? 'border-red-700 bg-white text-red-700 ring-2 ring-red-700' : 'border-red-200 bg-white text-red-700 hover:bg-red-50'}`}>{value === 'pix' ? <QrCode size={24} /> : <CreditCard size={24} />}{value === 'pix' ? 'Pix' : t('paymentCredit')}</button>)}</div>
      <div className="space-y-4">
        <label className="block text-sm text-zinc-300">{t('paymentFullName')}<input autoComplete="name" required maxLength={100} className={`${inputClass} mt-2`} value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} /></label>
        <label className="block text-sm text-zinc-300">{t('paymentEmail')}<input type="email" autoComplete="email" autoCapitalize="none" required maxLength={150} className={`${inputClass} mt-2`} value={customer.email} onChange={e => setCustomer({ ...customer, email: e.target.value })} /></label>
        <label className="block text-sm text-zinc-300">{t('paymentCpf')}<input inputMode="numeric" required pattern="[0-9]{11}" maxLength={11} placeholder={t('paymentCpfHint')} className={`${inputClass} mt-2`} value={customer.taxId} onChange={e => setCustomer({ ...customer, taxId: e.target.value.replace(/\D/g, '') })} /></label>
      </div>
      {method === 'credit' && <fieldset className="min-w-0 space-y-4 border-t border-white/10 pt-5"><legend className="sr-only">{t('paymentCredit')}</legend>
        <label className="block text-sm text-zinc-300">{t('paymentCardNumber')}<input autoComplete="cc-number" inputMode="numeric" required maxLength={23} className={`${inputClass} mt-2`} value={card.number} onChange={e => setCard({ ...card, number: e.target.value.replace(/[^\d ]/g, '') })} /></label>
        <div className="grid grid-cols-2 gap-3"><label className="block text-sm text-zinc-300">{t('paymentExpiry')}<input autoComplete="cc-exp" inputMode="numeric" placeholder={t('paymentExpiryHint')} required maxLength={7} className={`${inputClass} mt-2`} value={card.expiry} onChange={e => { const digits = e.target.value.replace(/\D/g, '').slice(0, 6); setCard({ ...card, expiry: digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits }); }} /></label><label className="block text-sm text-zinc-300">{t('paymentSecurityCode')}<input type="password" autoComplete="cc-csc" inputMode="numeric" required minLength={3} maxLength={4} className={`${inputClass} mt-2`} value={card.cvv} onChange={e => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '') })} /></label></div>
        <p className="text-xs leading-relaxed text-zinc-400">{t('paymentCardHint')}</p>
      </fieldset>}
      <button disabled={busy} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-lg font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">{busy && <Loader2 className="animate-spin" size={20} />}{busy ? t('paymentProcessing') : method === 'pix' ? t('paymentGeneratePix') : t('paymentPayAmount', { amount: formatCurrency(summary.balance, locale) })}</button>
      </fieldset>
    </form>}
  </motion.section>;
}
