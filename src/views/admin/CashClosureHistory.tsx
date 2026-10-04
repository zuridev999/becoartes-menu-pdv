import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { OperationalApi, type CashClosureCount } from '../../lib/api';
import { CASH_DENOMINATIONS } from '../../lib/cash-count';

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function CashClosureHistory({ from, to }: { from: string; to: string }) {
  const [closures, setClosures] = useState<CashClosureCount[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setClosures([]);
    setLoading(true);
    OperationalApi.getCashClosureCounts({ from, to, limit: 30 })
      .then((result) => { if (!cancelled) setClosures(result.closures); })
      .catch(() => { if (!cancelled) setError('Não foi possível carregar as conferências de caixa.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  return <section className="glass-card overflow-hidden border-white/5">
    <div className="border-b border-white/10 px-5 py-4 sm:px-6">
      <h3 className="text-lg font-black text-white">Conferências do caixa</h3>
      <p className="mt-1 text-xs text-zinc-400">Contagem registrada em cada fechamento. O total em espécie continua sendo o valor do controle de dinheiro. Até 30 registros no período selecionado.</p>
      {error && <p className="mt-2 text-xs font-bold text-rose-300">{error}</p>}
    </div>
    {closures.length === 0 ? <p className="px-5 py-5 text-sm text-zinc-500">{loading ? 'Carregando conferências...' : error ? 'Tente novamente ao reabrir a aba.' : 'Nenhuma contagem detalhada registrada neste período. Fechamentos anteriores a esta atualização não têm discriminação por nota.'}</p> : <div className="divide-y divide-white/10">
      {closures.map((closure) => <details key={closure.id} className="group px-5 py-4 sm:px-6">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-black text-white">Caixa de {closure.businessDate.split('-').reverse().join('/')} <span className="font-medium text-zinc-500">· {closure.actorName}</span></span>
          <span className="flex items-center gap-3 text-sm font-black"><span className="text-emerald-300">{money(closure.total)}</span><span className={closure.difference < 0 ? 'text-rose-300' : closure.difference > 0 ? 'text-amber-300' : 'text-zinc-500'}>{closure.difference === 0 ? 'Sem diferença' : `Diferença ${money(closure.difference)}`}</span><ChevronRight size={16} className="text-zinc-500 transition-transform group-open:rotate-90"/></span>
        </summary>
        <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs sm:grid-cols-3 lg:grid-cols-4">
          {CASH_DENOMINATIONS.map(({ key, label, cents }) => <div key={key} className="flex justify-between gap-2"><span className="text-zinc-400">{label} × {closure.counts[key] || 0}</span><span className="font-bold text-white">{money((closure.counts[key] || 0) * cents / 100)}</span></div>)}
        </div>
        <p className="mt-4 text-xs text-zinc-400">Esperado: {money(closure.expected)} · Fechado em {new Date(closure.closedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
        {closure.notes && <p className="mt-2 text-xs text-zinc-300">Informações adicionais: {closure.notes}</p>}
      </details>)}
    </div>}
  </section>;
}
