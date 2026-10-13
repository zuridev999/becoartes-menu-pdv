import { AnimatePresence, motion } from 'framer-motion';
import { Banknote, Coins, X } from 'lucide-react';
import type { CashState } from '../../lib/api';
import { CASH_DENOMINATIONS, cashCountTotalCents, type CashCount } from '../../lib/cash-count';

const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMoneyInput = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits ? formatCurrency(Number(digits) / 100) : '';
};

type Props = {
  mode: 'open' | 'close' | null;
  cashState: CashState | null;
  cashValue: string;
  setCashValue: (value: string) => void;
  cashCount: CashCount;
  setCashCount: (count: CashCount) => void;
  confirmationPin: string;
  setConfirmationPin: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  error: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
};

const noteColors: Record<string, string> = {
  note_200: 'border-zinc-300/50 bg-zinc-300/15 text-zinc-200',
  note_100: 'border-cyan-300/50 bg-cyan-300/15 text-cyan-200',
  note_50: 'border-amber-300/50 bg-amber-300/15 text-amber-200',
  note_20: 'border-orange-300/50 bg-orange-300/15 text-orange-200',
  note_10: 'border-rose-300/50 bg-rose-300/15 text-rose-200',
  note_5: 'border-violet-300/50 bg-violet-300/15 text-violet-200',
  note_2: 'border-blue-300/50 bg-blue-300/15 text-blue-200',
};

type Denomination = (typeof CASH_DENOMINATIONS)[number];

function CountRow({ denomination, cashCount, onChange }: { denomination: Denomination; cashCount: CashCount; onChange: (key: Denomination['key'], count: number) => void }) {
  const count = cashCount[denomination.key];
  const note = denomination.kind === 'note';
  return <label className="grid min-h-14 grid-cols-[minmax(0,1fr)_4.25rem_5.5rem] items-center gap-2 border-b border-white/[0.07] px-2 py-1.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_5rem_6.75rem] sm:gap-3 sm:px-3">
    <span className="flex min-w-0 items-center gap-2.5">
      <span className={`relative flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden border ${note ? `rounded-md ${noteColors[denomination.key]}` : 'rounded-full border-amber-300/40 bg-amber-300/10 text-amber-200'}`} aria-hidden="true">
        {note ? <><span className="absolute inset-y-0 left-0 w-1 bg-current opacity-40"/><span className="text-xs font-black tabular-nums">{denomination.cents / 100}</span><Banknote size={13} strokeWidth={1.5} className="absolute bottom-0.5 right-0.5 opacity-55"/></> : <span className="text-xs font-black tabular-nums">{denomination.cents === 100 ? '1' : denomination.cents}</span>}
      </span>
      <span className="truncate text-sm font-black text-white sm:text-base">{denomination.label}</span>
    </span>
    <input
      type="number" min={0} max={10000} step={1} inputMode="numeric"
      value={count || ''}
      onChange={event => {
        const raw = event.target.value;
        if (raw && !/^\d{1,5}$/.test(raw)) return;
        const quantity = raw ? Number(raw) : 0;
        if (quantity <= 10000) onChange(denomination.key, quantity);
      }}
      placeholder="0"
      aria-label={`Quantidade de ${note ? 'notas' : 'moedas'} de ${denomination.label}`}
      className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.05] px-2 text-center text-base font-black text-white outline-none placeholder:text-zinc-600 focus:border-violet-400 focus:bg-violet-500/10 sm:text-lg"
    />
    <strong className={`text-right text-xs tabular-nums sm:text-sm ${count ? 'text-emerald-300' : 'text-zinc-500'}`}>{formatCurrency(count * denomination.cents / 100)}</strong>
  </label>;
}

function CountSection({ kind, cashCount, onChange }: { kind: 'note' | 'coin'; cashCount: CashCount; onChange: (key: Denomination['key'], count: number) => void }) {
  const note = kind === 'note';
  return <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
      <div className="flex items-center gap-2.5">{note ? <Banknote size={20} className="text-emerald-300"/> : <Coins size={20} className="text-amber-300"/>}<h4 className="text-sm font-black uppercase tracking-[0.16em] text-white">{note ? 'Notas' : 'Moedas'}</h4></div>
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Quantidade · subtotal</span>
    </div>
    <div>{CASH_DENOMINATIONS.filter(denomination => denomination.kind === kind).map(denomination => <CountRow key={denomination.key} denomination={denomination} cashCount={cashCount} onChange={onChange}/>)}</div>
  </section>;
}

export function CashRegisterDialog({ mode, cashState, cashValue, setCashValue, cashCount, setCashCount, confirmationPin, setConfirmationPin, notes, setNotes, error, submitting, onClose, onSubmit }: Props) {
  const updateCount = (key: Denomination['key'], quantity: number) => {
    setCashCount({ ...cashCount, [key]: quantity });
  };
  return <AnimatePresence>{mode && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-xl flex items-center justify-center p-3 sm:p-6">
    <motion.div initial={{ scale: 0.96, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 20 }} className={`glass-card w-full max-h-[calc(100dvh-1.5rem)] overflow-y-auto custom-scrollbar border-primary/30 p-4 sm:p-6 ${mode === 'close' ? 'max-w-4xl' : 'max-w-xl'}`}>
      <div className="flex items-start justify-between gap-6 mb-5">
        <div><p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">{mode === 'open' ? 'Abertura da casa' : 'Fechamento da casa'}</p><h3 className="text-3xl font-black tracking-tight">{mode === 'open' ? 'Abrir caixa' : 'Fechar caixa'}</h3></div>
        <button type="button" aria-label="Fechar janela do caixa" onClick={onClose} className="glass p-3 rounded-2xl text-zinc-400 hover:text-white"><X size={22}/></button>
      </div>
      {error && <div className="mb-5 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm font-black text-rose-200">{error}</div>}
      <div className="space-y-5">
        {mode === 'open' ? <>
          <div><label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Valor inicial na gaveta</label><input value={cashValue} onChange={event => setCashValue(formatMoneyInput(event.target.value))} readOnly={Boolean(cashState?.mustInheritLastClosing)} placeholder="R$ 0,00" inputMode="numeric" className="mt-3 w-full bg-white/[0.04] border border-white/10 rounded-3xl px-5 sm:px-6 py-5 sm:py-6 outline-none text-3xl sm:text-4xl font-black text-accent focus:border-primary/60 read-only:cursor-not-allowed read-only:opacity-80" autoFocus/></div>
          <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-5"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2">Último fechamento</p><p className="text-xl font-black text-white">{formatCurrency(cashState?.lastClosingBalance || 0)}</p><p className="mt-2 text-xs font-bold text-zinc-500">{cashState?.mustInheritLastClosing ? 'A abertura herda o valor físico do fechamento de hoje ou de ontem.' : cashState?.hasPreviousClosing ? 'Como passou mais de um dia, confira a gaveta e informe o valor físico atual.' : 'Primeiro caixa: informe o fundo inicial para começar o histórico.'}</p></div>
        </> : <div>
          <p className="mb-3 text-xs font-medium text-zinc-400">Informe a quantidade de cada cédula e moeda. O subtotal e o total são calculados na hora.</p>
          <div className="grid items-start gap-3 md:grid-cols-[1.08fr_.92fr]">
            <CountSection kind="note" cashCount={cashCount} onChange={updateCount}/>
            <CountSection kind="coin" cashCount={cashCount} onChange={updateCount}/>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-2xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-3 sm:px-5"><span className="text-xs font-black uppercase tracking-[0.16em] text-emerald-200">Total em espécie</span><strong className="text-2xl font-black tabular-nums text-emerald-300 sm:text-3xl">{formatCurrency(cashCountTotalCents(cashCount) / 100)}</strong></div>
        </div>}
        <div><label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">PIN de confirmação</label><input value={confirmationPin} onChange={event => setConfirmationPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="****" inputMode="numeric" type="password" maxLength={4} className="mt-3 w-full bg-white/[0.04] border border-white/10 rounded-3xl px-6 py-5 outline-none text-3xl font-black tracking-[0.5em] text-white focus:border-primary/60"/><p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Com o valor conferido, use o PIN de quem está fechando. Se houver diferença, solicite o PIN do superadministrador.</p></div>
        <div><label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Informações adicionais <span className="font-medium normal-case tracking-normal">(opcional)</span></label><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ex: diferença no fundo de caixa, conferência manual..." className="mt-2 w-full h-20 bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-3 outline-none text-sm font-bold resize-none focus:border-primary/60"/></div>
      </div>
      <button onClick={onSubmit} disabled={submitting} className="mt-8 w-full btn-beco btn-beco-purple py-6 rounded-2xl font-black uppercase tracking-widest disabled:opacity-40">{submitting ? 'Processando...' : mode === 'open' ? 'Abrir caixa e liberar PDV' : 'Fechar caixa e bloquear PDV'}</button>
    </motion.div>
  </motion.div>}</AnimatePresence>;
}
