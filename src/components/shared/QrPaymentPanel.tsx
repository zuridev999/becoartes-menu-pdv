import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, CreditCard, Loader2, QrCode } from 'lucide-react';
import { QrPaymentsApi, type QrPaymentContext, type QrPaymentIntent, type QrPaymentSummary } from '../../lib/api';
import { formatCurrency } from '../../lib/format';

let sdkPromise: Promise<void> | null = null;
async function loadCardSdk() {
  if (window.PagSeguro?.encryptCard) return window.PagSeguro;
  if (!sdkPromise) sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); sdkPromise = null; reject(new Error('Não foi possível carregar o pagamento. Tente novamente.')); };
    document.head.appendChild(script);
  });
  await sdkPromise;
  if (!window.PagSeguro?.encryptCard) throw new Error('Pagamento por cartão indisponível.');
  return window.PagSeguro;
}
const inputClass = 'min-h-12 w-full min-w-0 rounded-xl border border-white/15 bg-white/5 px-3 text-base text-white';

export function QrPaymentPanel({ context, onPaid }: { context: QrPaymentContext; onPaid: () => void }) {
  const [summary, setSummary] = useState<QrPaymentSummary | null>(null);
  const [intent, setIntent] = useState<QrPaymentIntent | null>(null);
  const [method, setMethod] = useState<'pix' | 'credit'>('pix');
  const [customer, setCustomer] = useState({ name: '', email: '', taxId: '' });
  const [card, setCard] = useState({ number: '', expiry: '', cvv: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [image, setImage] = useState('');
  const [copied, setCopied] = useState(false);
  const lock = useRef(false);
  const paidCallback = useRef(onPaid);
  paidCallback.current = onPaid;
  const contextKey = JSON.stringify(context);
  useEffect(() => {
    let active = true;
    QrPaymentsApi.summary(context).then(result => { if (active) { setSummary(result); setIntent(result.intent); } }).catch(() => { if (active) setError('Não foi possível consultar o pagamento. Tente reabrir Minha conta.'); });
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
          if (result.hasErrors || !result.encryptedCard) throw new Error('Confira número, validade, código e nome do cartão.');
          encryptedCard = result.encryptedCard;
        }
      }
      const next = await QrPaymentsApi.create(context, { method, expectedAmount: summary.balance, customer, encryptedCard });
      setIntent(next); setCard({ number: '', expiry: '', cvv: '' });
      if (next.status === 'paid') paidCallback.current();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir o pagamento.');
      const current = await QrPaymentsApi.summary(context).catch(() => null);
      if (current) { setSummary(current); setIntent(current.intent); }
    } finally { lock.current = false; setBusy(false); }
  };
  const simulate = async (outcome: string) => {
    if (!intent || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const next = await QrPaymentsApi.simulate(context, intent.id, outcome); setIntent(next); if (next.status === 'paid') paidCallback.current(); }
    catch { setError('Falha ao simular. Tente novamente.'); }
    finally { lock.current = false; setBusy(false); }
  };
  if (intent?.status === 'paid') return <div role="status" className="mt-6 space-y-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-emerald-300"><CheckCircle2 /><p className="text-xl font-bold">Pagamento confirmado</p><p>{formatCurrency(intent.amount)} registrados nesta conta. A equipe já pode conferir no PDV.</p></div>;
  if (!summary) return <p role="status" className="mt-6 text-sm text-zinc-300">{error || 'Consultando opções de pagamento…'}</p>;
  if (!summary.enabled) return <p className="mt-6 text-sm text-zinc-300">Para pagar, chame a equipe.</p>;
  if (summary.balance <= 0 && !intent) return null;
  const blocked = intent && ['creating', 'pending', 'unknown', 'review'].includes(intent.status);
  return <section className="mt-6 min-w-0 space-y-4 border-t border-white/10 pt-6" aria-label="Pagamento da conta">
    <h3 className="text-2xl font-bold">Pagar minha conta</h3>
    {summary.testLimit && <p className="rounded-xl bg-amber-400/15 p-3 text-sm text-amber-200">TESTE REAL · até {formatCurrency(summary.testLimit)}. Ao confirmar, você cria uma cobrança real na conta PagBank do Becoartes.</p>}
    {summary.environment !== 'production' && <p className="rounded-xl bg-amber-400/15 p-3 text-sm text-amber-200">{summary.environment === 'simulator' ? 'DEMONSTRAÇÃO LOCAL — nenhuma cobrança real.' : 'SANDBOX PAGBANK — use somente dados de teste.'}</p>}
    {error && <p role="alert" className="rounded-xl bg-rose-500/15 p-3 text-sm text-rose-200">{error}</p>}
    {blocked ? <div className="min-w-0 space-y-3">
      <p className="font-semibold">{formatCurrency(intent.amount)} · {intent.method === 'pix' ? 'Pix' : 'Cartão de crédito'}</p>
      <p role="status" className="text-sm text-zinc-300">{intent.status === 'review' ? 'Recebemos uma divergência na confirmação. Chame a equipe para conferir este pagamento.' : intent.status === 'unknown' || intent.status === 'creating' ? 'Conferindo a cobrança. Aguarde a confirmação antes de tentar outro pagamento.' : 'Aguardando confirmação do pagamento.'}</p>
      {intent.method === 'pix' && intent.status === 'pending' && <>
        {image && <img src={image} alt="QR Code para pagar com Pix" className="mx-auto h-56 w-56 max-w-full rounded-xl" />}
        <p className="text-sm text-zinc-400">Válido até {new Date(intent.instructions.expiresAt || intent.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</p>
        <textarea aria-label="Pix copia e cola" readOnly value={intent.instructions.qrCodeText || ''} className={`${inputClass} h-20 break-all py-3 text-xs`} />
        {summary.environment !== 'simulator' && <button type="button" className="min-h-12 w-full rounded-xl bg-accent p-3 font-bold text-white" onClick={async () => { try { await navigator.clipboard.writeText(intent.instructions.qrCodeText || ''); setCopied(true); } catch { setError('Selecione e copie o código Pix no campo acima.'); } }}>{copied ? 'Código copiado' : 'Copiar código Pix'}</button>}
      </>}
      {summary.environment === 'simulator' && intent.status === 'pending' && <div className="flex flex-wrap gap-2"><button disabled={busy} type="button" className="min-h-12 rounded-xl bg-emerald-600 p-3 font-bold" onClick={() => void simulate('paid')}>Simular aprovação</button><button disabled={busy} type="button" className="min-h-12 rounded-xl bg-white/10 p-3" onClick={() => void simulate('declined')}>Simular recusa</button></div>}
    </div> : <form onSubmit={submit} className="min-w-0 space-y-4">
      {intent && ['failed', 'expired'].includes(intent.status) && <p role="status" className="text-amber-200">{intent.status === 'expired' ? 'O Pix expirou. Você pode gerar outro.' : 'Pagamento recusado. Confira os dados e tente novamente.'}</p>}
      <div className="grid grid-cols-2 gap-2">{(['pix', 'credit'] as const).map(value => <button key={value} type="button" aria-pressed={method === value} onClick={() => setMethod(value)} className={`flex min-h-14 items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold ${method === value ? 'border-accent bg-accent/20' : 'border-white/15'}`}>{value === 'pix' ? <QrCode size={18} /> : <CreditCard size={18} />}{value === 'pix' ? 'Pix' : 'Crédito'}</button>)}</div>
      <label className="block text-sm">Nome completo<input autoComplete="name" required maxLength={100} className={`${inputClass} mt-1`} value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} /></label>
      <label className="block text-sm">E-mail<input type="email" autoComplete="email" required maxLength={150} className={`${inputClass} mt-1`} value={customer.email} onChange={e => setCustomer({ ...customer, email: e.target.value })} /></label>
      <label className="block text-sm">CPF<input inputMode="numeric" required pattern="[0-9]{11}" maxLength={11} placeholder="Somente os 11 números" className={`${inputClass} mt-1`} value={customer.taxId} onChange={e => setCustomer({ ...customer, taxId: e.target.value.replace(/\D/g, '') })} /></label>
      {method === 'credit' && <fieldset className="min-w-0 space-y-3"><legend className="mb-2 text-sm font-bold">Cartão de crédito · à vista</legend>
        <label className="block text-sm">Número do cartão<input autoComplete="cc-number" inputMode="numeric" required maxLength={23} className={`${inputClass} mt-1`} value={card.number} onChange={e => setCard({ ...card, number: e.target.value.replace(/[^\d ]/g, '') })} /></label>
        <div className="grid grid-cols-2 gap-3"><label className="block text-sm">Validade<input autoComplete="cc-exp" inputMode="numeric" placeholder="MM/AA" required maxLength={7} className={`${inputClass} mt-1`} value={card.expiry} onChange={e => { const digits = e.target.value.replace(/\D/g, '').slice(0, 6); setCard({ ...card, expiry: digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits }); }} /></label><label className="block text-sm">Código de segurança<input type="password" autoComplete="cc-csc" inputMode="numeric" required minLength={3} maxLength={4} className={`${inputClass} mt-1`} value={card.cvv} onChange={e => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '') })} /></label></div>
        <p className="text-xs text-zinc-400">O nome informado deve ser o do titular. O cartão é criptografado no navegador pelo PagBank.</p>
      </fieldset>}
      <p className="text-sm text-zinc-300">Total: <strong>{formatCurrency(summary.balance)}</strong>, com taxa de serviço incluída. Para ajustar a taxa, chame a equipe.</p>
      <button disabled={busy} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent p-3 text-lg font-bold text-white disabled:opacity-50">{busy && <Loader2 className="animate-spin" size={20} />}{busy ? 'Processando…' : method === 'pix' ? 'Gerar Pix' : `Pagar ${formatCurrency(summary.balance)}`}</button>
    </form>}
  </section>;
}
