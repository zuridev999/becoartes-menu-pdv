import { X } from 'lucide-react';
import type { useAvailabilityImpact } from './useAvailabilityImpact';

type Controller = ReturnType<typeof useAvailabilityImpact>;

export function AvailabilityImpactDialog({ availability }: { availability: Controller }) {
  const { product, impact, selected, setSelected, busy, changeSource, save, hideOnly, close } = availability;
  if (!product || !impact) return null;
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Impacto de disponibilidade">
    <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl border border-white/15 bg-[#17141e] p-5 sm:p-7 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Disponibilidade por insumo</p><h2 className="mt-2 text-2xl font-black text-white">{product.name}</h2><p className="mt-2 text-sm text-zinc-400">Escolha o insumo e confira todos os lugares afetados. O saldo do estoque não controla esta ação.</p></div>
        <button className="rounded-xl p-2 text-zinc-300 hover:bg-white/10" onClick={close} aria-label="Fechar"><X size={20}/></button>
      </div>
      <label className="mt-6 block text-xs font-black uppercase tracking-widest text-zinc-400" htmlFor="availability-source">Insumo / SKU</label>
      <select id="availability-source" className="mt-2 w-full rounded-xl border border-white/15 bg-[#211d2a] p-3 text-white" value={impact.sourceId || ''} disabled={busy} onChange={event => void changeSource(event.target.value)}>
        {!impact.sourceId && <option value="">Selecione o insumo</option>}
        {impact.sources.map(source => <option key={source.id} value={source.id}>{source.name}{source.hidden ? ' — oculto' : ''}</option>)}
      </select>
      {impact.sourceId && <><p className="mt-5 text-sm font-bold text-zinc-200">Marque onde a ocultação deve valer. Vínculos confirmados já vêm selecionados; candidatos de ficha exigem sua revisão.</p>
        <div className="mt-3 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
          {impact.candidates.map(candidate => <label key={candidate.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <input type="checkbox" className="h-5 w-5 shrink-0 accent-violet-500" checked={selected.includes(candidate.key)} disabled={busy} onChange={event => setSelected(previous => event.target.checked ? [...previous, candidate.key] : previous.filter(value => value !== candidate.key))}/>
            <span className="min-w-0 flex-1 text-sm font-bold text-white">{candidate.name}<span className="ml-2 text-[10px] font-medium text-zinc-400">{candidate.kind === 'modifier' ? 'Adicional' : 'Produto'} · {candidate.reviewed ? 'vínculo confirmado' : 'revisar vínculo'}{!candidate.baseVisible ? ' · já oculto' : ''}</span></span>
          </label>)}
          {!impact.candidates.length && <p className="rounded-xl bg-amber-500/10 p-4 text-sm text-amber-200">Nenhum produto ou adicional ligado a este insumo. Nada será ocultado automaticamente.</p>}
        </div>
      </>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {!impact.hidden && product.visible && <button className="rounded-xl border border-white/15 px-4 py-3 text-xs font-black uppercase text-zinc-300" disabled={busy} onClick={() => void hideOnly()}>Ocultar só este produto</button>}
        {impact.hidden ? <>
          <button className="rounded-xl border border-emerald-500/50 px-4 py-3 text-xs font-black uppercase text-emerald-300 disabled:opacity-50" disabled={busy || !impact.sourceId} onClick={() => void save(false)}>Restaurar este insumo</button>
          <button className="rounded-xl bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50" disabled={busy || !selected.length} onClick={() => void save(true)}>Atualizar usos selecionados</button>
        </> : <button className="rounded-xl bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50" disabled={busy || !impact.sourceId || !selected.length} onClick={() => void save(true)}>Ocultar usos selecionados</button>}
      </div>
    </div>
  </div>;
}
