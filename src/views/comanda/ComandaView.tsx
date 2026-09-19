import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  LockKeyhole,
  Phone,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type { CustomerTab } from '../../types';
import { ComandaApi } from '../../lib/api';

const formatDate = (value?: Date | string | null) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

const formatMoney = (value: number) => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const statusLabel = (tab: CustomerTab) => tab.status === 'paid' ? 'PAGAMENTO REGISTRADO' : 'CONTA EM ABERTO';

function PinGate({ onAuthorized }: { onAuthorized: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (pin.length !== 4 || isSubmitting) {
      setError('Digite os 4 dígitos do PIN.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const result = await ComandaApi.access(pin);
      if (!result.authorized) {
        setError('PIN incorreto.');
        setPin('');
        return;
      }
      sessionStorage.setItem('beco_comanda_access', 'granted');
      onAuthorized();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível liberar o acesso.');
      setPin('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="comanda-shell flex min-h-[100dvh] items-center justify-center px-5 py-8">
      <section className="comanda-panel w-full max-w-sm p-7 sm:p-9">
        <div className="comanda-brand-mark mb-7"><LockKeyhole size={24} strokeWidth={2.3} /></div>
        <p className="comanda-kicker">Becoartes · saída</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Conferir comanda</h1>
        <p className="mt-3 text-sm font-medium leading-6 text-zinc-400">
          Digite o PIN para consultar uma comanda antes de liberar a saída.
        </p>
        <label className="mt-8 block text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500" htmlFor="comanda-pin">
          PIN de acesso
        </label>
        <input
          id="comanda-pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoFocus
          maxLength={4}
          value={pin}
          onChange={(event) => { setPin(event.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
          onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
          className="comanda-input mt-2 w-full text-center text-3xl font-black tracking-[0.45em]"
          placeholder="••••"
          aria-describedby={error ? 'comanda-pin-error' : undefined}
        />
        {error && <p id="comanda-pin-error" role="alert" className="mt-3 text-center text-xs font-bold text-rose-300">{error}</p>}
        <button type="button" onClick={() => void submit()} disabled={isSubmitting} className="comanda-primary-button mt-6 w-full">
          {isSubmitting ? 'LIBERANDO...' : 'ENTRAR'}
        </button>
        <p className="mt-6 text-center text-[11px] font-semibold text-zinc-500">Acesso exclusivo para conferência de saída.</p>
      </section>
    </main>
  );
}

function ResultCard({ tab }: { tab: CustomerTab }) {
  const balance = Number(tab.totals?.balance || 0);
  const isPaid = tab.status === 'paid';
  return (
    <article className="comanda-result-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="comanda-avatar"><UserRound size={20} /></div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-white">{tab.customerName}</h2>
            <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Mesa {tab.tableNumber}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black tracking-[0.1em] ${isPaid ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-300/15 text-amber-200'}`}>
          {isPaid ? 'PAGO' : 'EM ABERTO'}
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="comanda-detail"><span>CPF</span><strong>{tab.cpfMasked || `final ${tab.cpfLast4}`}</strong></div>
        <div className="comanda-detail"><span>Telefone</span><strong>{tab.phone || 'Não informado'}</strong></div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-4 border-t border-white/8 pt-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{statusLabel(tab)}</p>
          <p className="mt-1 text-xs font-semibold text-zinc-400">{formatDate(tab.openedAt)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{isPaid ? 'Total pago' : 'Saldo restante'}</p>
          <p className={`mt-1 text-xl font-black ${isPaid ? 'text-emerald-300' : 'text-amber-200'}`}>{formatMoney(isPaid ? Number(tab.totals?.payments || 0) : balance)}</p>
        </div>
      </div>
    </article>
  );
}

export function ComandaView() {
  const [isAuthorized, setIsAuthorized] = useState(() => sessionStorage.getItem('beco_comanda_access') === 'granted');
  const [identifier, setIdentifier] = useState('');
  const [results, setResults] = useState<CustomerTab[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');

  const digits = useMemo(() => identifier.replace(/\D/g, ''), [identifier]);

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    if (digits.length < 4 || isSearching) {
      setError('Digite um CPF ou telefone válido.');
      return;
    }
    setIsSearching(true);
    setHasSearched(true);
    setError('');
    try {
      const response = await ComandaApi.lookup(digits);
      setResults(response.tabs);
    } catch (requestError) {
      setResults([]);
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível consultar a comanda.');
    } finally {
      setIsSearching(false);
    }
  };

  if (!isAuthorized) return <PinGate onAuthorized={() => setIsAuthorized(true)} />;

  return (
    <main className="comanda-shell comanda-scroll-area min-h-[100dvh] overflow-y-auto px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-amber-200"><ShieldCheck size={18} /><span className="comanda-kicker">Saída segura</span></div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Conferir comanda</h1>
            <p className="mt-2 text-sm font-medium text-zinc-400">Consulte pelo CPF ou telefone para liberar a saída.</p>
          </div>
          <button type="button" onClick={() => { sessionStorage.removeItem('beco_comanda_access'); setIsAuthorized(false); }} className="comanda-icon-button" aria-label="Sair">
            <ArrowLeft size={19} />
          </button>
        </header>

        <section className="comanda-search-panel mt-7 p-4 sm:p-5">
          <form onSubmit={search}>
            <label htmlFor="comanda-identifier" className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400">CPF ou telefone</label>
            <div className="mt-2 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-amber-300" size={18} />
                <input
                  id="comanda-identifier"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="Digite CPF ou telefone"
                  className="comanda-input w-full pl-11"
                />
              </div>
              <button type="submit" disabled={isSearching} className="comanda-primary-button shrink-0 px-5 sm:px-7">
                {isSearching ? '...' : 'Buscar'}
              </button>
            </div>
            <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-zinc-500"><Phone size={14} /> A busca é somente por CPF ou telefone.</p>
          </form>
        </section>

        {error && <div role="alert" className="comanda-alert mt-5"><AlertCircle size={18} /><span>{error}</span></div>}

        <section className="mt-7" aria-live="polite">
          {!hasSearched && (
            <div className="comanda-empty py-16 text-center"><ShieldCheck className="mx-auto text-zinc-600" size={34} /><h2 className="mt-4 text-lg font-black text-zinc-300">Pronto para conferir</h2><p className="mt-2 text-sm text-zinc-500">Digite o documento ou telefone da pessoa na saída.</p></div>
          )}
          {hasSearched && !isSearching && results.length === 0 && !error && (
            <div className="comanda-empty py-16 text-center"><AlertCircle className="mx-auto text-amber-300" size={34} /><h2 className="mt-4 text-lg font-black text-zinc-300">Nenhuma comanda encontrada</h2><p className="mt-2 text-sm text-zinc-500">Confira os números digitados e tente novamente.</p></div>
          )}
          {results.length > 0 && <div className="space-y-3">{results.map(tab => <ResultCard key={tab.id} tab={tab} />)}</div>}
          {isSearching && <div className="comanda-empty py-16 text-center"><CheckCircle2 className="mx-auto animate-pulse text-amber-300" size={34} /><p className="mt-4 text-sm font-bold text-zinc-400">Consultando comanda...</p></div>}
        </section>

        <footer className="pb-6 pt-10 text-center text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">Comanda Becoartes · acesso de saída</footer>
      </div>
    </main>
  );
}
