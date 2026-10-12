import { ChevronRight, Plus, Search, Sparkles } from 'lucide-react';
import type { ModifierGroup } from '../../types';

type Props = {
  groups: ModifierGroup[];
  productMapping: Record<string, string[]>;
  categoryMapping: Record<string, string[]>;
  selectedGroupId: string | null;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onSelect: (groupId: string) => void;
};

export function ModifierGroupCatalog({
  groups,
  productMapping,
  categoryMapping,
  selectedGroupId,
  searchTerm,
  onSearchChange,
  onCreate,
  onSelect,
}: Props) {
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('pt-BR');
  const visibleGroups = groups.filter((group) => {
    if (!normalizedSearch) return true;
    return [group.name, group.id, ...group.modifiers.map(modifier => modifier.name)]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(normalizedSearch));
  });

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-5 px-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">Catálogo de adicionais</p>
          <h3 className="mt-2 flex items-center gap-4 text-3xl font-black"><Sparkles size={28}/> Grupos e sabores</h3>
          <p className="mt-2 max-w-2xl text-sm font-bold text-zinc-500">Visualize cada grupo como no catálogo de produtos, identifique onde ele está aplicado e evite confundir grupos com nomes parecidos.</p>
        </div>
        <div className="flex w-full gap-3 lg:w-auto">
          <label className="glass flex min-w-0 flex-1 items-center gap-3 rounded-2xl border-white/10 px-4 lg:w-80">
            <Search size={17} className="shrink-0 text-zinc-500" />
            <input
              value={searchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar grupo ou sabor..."
              className="min-w-0 flex-1 bg-transparent py-4 text-sm font-bold outline-none placeholder:text-zinc-700"
            />
          </label>
          <button
            type="button"
            onClick={onCreate}
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/20 transition-all hover:scale-105"
            title="Criar grupo"
          >
            <Plus size={20}/>
          </button>
        </div>
      </div>

      <div className="glass max-h-[52vh] overflow-y-auto rounded-[2rem] border-white/5 custom-scrollbar">
        {visibleGroups.map((group) => {
          const categoryLinks = Object.values(categoryMapping).filter(groupIds => groupIds.includes(group.id)).length;
          const productLinks = Object.values(productMapping).filter(groupIds => groupIds.includes(group.id)).length;
          const visibleOptions = group.modifiers.filter(modifier => modifier.status !== 'inactive' && !modifier.inheritedUnavailable).length;
          const selected = selectedGroupId === group.id;

          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onSelect(group.id)}
              className={`group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-white/5 p-4 text-left transition-all last:border-b-0 sm:p-5 ${selected ? 'bg-primary/10' : 'hover:bg-white/[0.03]'}`}
            >
              <div className={`grid h-12 w-12 place-items-center rounded-2xl ${selected ? 'bg-primary text-white' : 'bg-white/5 text-primary'}`}>
                <Sparkles size={19} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className={`truncate text-base font-black sm:text-lg ${selected ? 'text-primary' : 'text-white'}`}>{group.name}</h4>
                  <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-wider ${group.isRequired ? 'bg-amber-400/15 text-amber-300' : 'bg-sky-400/10 text-sky-300'}`}>
                    {group.isRequired ? 'Obrigatório' : 'Opcional'}
                  </span>
                  {group.status === 'inactive' && <span className="rounded-full bg-zinc-500/15 px-2 py-1 text-[8px] font-black uppercase text-zinc-400">Inativo</span>}
                </div>
                <p className="mt-1 truncate text-[9px] font-black uppercase tracking-widest text-zinc-600">ID {group.id}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-zinc-400">
                  <span>{visibleOptions}/{group.modifiers.length} opções visíveis</span>
                  <span>{categoryLinks} categoria{categoryLinks === 1 ? '' : 's'}</span>
                  <span>{productLinks} vínculo{productLinks === 1 ? '' : 's'} direto{productLinks === 1 ? '' : 's'}</span>
                </div>
              </div>
              <ChevronRight size={20} className={`text-zinc-600 transition-transform ${selected ? 'translate-x-1 text-primary' : 'group-hover:text-zinc-300'}`} />
            </button>
          );
        })}
        {visibleGroups.length === 0 && (
          <div className="px-6 py-12 text-center">
            <Search className="mx-auto text-zinc-700" size={28} />
            <p className="mt-3 text-sm font-black text-zinc-400">Nenhum grupo encontrado</p>
            <p className="mt-1 text-xs font-bold text-zinc-600">Busque pelo nome do grupo, ID ou sabor.</p>
          </div>
        )}
      </div>
    </section>
  );
}
