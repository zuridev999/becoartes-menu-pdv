import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Eye, EyeOff, Package, Plus, Settings, Sparkles, X } from 'lucide-react';
import type { ModifierGroup, Product } from '../../types';
import { createId } from '../../lib/id';
import { ModifierOptionEditor } from './ModifierOptionEditor';

type Props = {
  product: Product;
  products: Product[];
  groups: ModifierGroup[];
  productMapping: Record<string, string[]>;
  categoryMapping: Record<string, string[]>;
  categoryName?: string;
  canEdit: boolean;
  isExistingProduct: boolean;
  onDraftGroupsChange: (groups: ModifierGroup[]) => void;
  onLinkDirect: (groupId: string, linked: boolean) => Promise<void>;
  onUpdateGroup: (groupId: string, data: Partial<ModifierGroup>) => void;
  onOpenFullGroup: (groupId: string) => void;
};

export function ProductModifierGroupsEditor({
  product,
  products,
  groups,
  productMapping,
  categoryMapping,
  categoryName,
  canEdit,
  isExistingProduct,
  onDraftGroupsChange,
  onLinkDirect,
  onUpdateGroup,
  onOpenFullGroup,
}: Props) {
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [linkingGroupId, setLinkingGroupId] = useState<string | null>(null);

  useEffect(() => {
    setExpandedGroupId(null);
    setLinkingGroupId(null);
  }, [product.id]);

  const directIds = useMemo(() => new Set(
    isExistingProduct
      ? (productMapping[product.id] || [])
      : (product.modifierGroups || []).map(group => group.id),
  ), [isExistingProduct, product.id, product.modifierGroups, productMapping]);
  const inheritedIds = useMemo(
    () => new Set(categoryMapping[product.categoryId] || []),
    [categoryMapping, product.categoryId],
  );
  const linkedIds = useMemo(() => new Set([...directIds, ...inheritedIds]), [directIds, inheritedIds]);
  const linkedGroups = groups.filter(group => linkedIds.has(group.id));
  const availableGroups = groups.filter(group => group.status !== 'inactive' && !linkedIds.has(group.id));

  const changeDirectLink = async (group: ModifierGroup, linked: boolean) => {
    if (!canEdit || linkingGroupId) return;
    if (!isExistingProduct) {
      const current = product.modifierGroups || [];
      onDraftGroupsChange(linked
        ? [...current.filter(candidate => candidate.id !== group.id), group]
        : current.filter(candidate => candidate.id !== group.id));
      return;
    }

    setLinkingGroupId(group.id);
    try {
      await onLinkDirect(group.id, linked);
    } finally {
      setLinkingGroupId(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/20">
      <div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Adicionais vinculados</p>
          <h4 className="mt-1 text-xl font-black text-white">Edite as escolhas dentro do próprio produto</h4>
          <p className="mt-1 text-xs font-bold text-zinc-500">Sabores, acompanhamentos e visibilidade ficam acessíveis sem procurar o grupo na outra aba.</p>
        </div>
        <span className="w-fit rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-primary">
          {linkedGroups.length} grupo{linkedGroups.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-3 p-4 sm:p-5">
        {linkedGroups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 px-5 py-8 text-center">
            <Sparkles className="mx-auto text-zinc-700" size={30} />
            <p className="mt-3 text-sm font-black text-zinc-300">Nenhum adicional vinculado</p>
            <p className="mt-1 text-xs font-bold text-zinc-600">Escolha um grupo abaixo para começar.</p>
          </div>
        )}

        {linkedGroups.map(group => {
          const direct = directIds.has(group.id);
          const inherited = inheritedIds.has(group.id);
          const expanded = expandedGroupId === group.id;
          const activeOptions = group.modifiers.filter(modifier => modifier.status !== 'inactive' && !modifier.inheritedUnavailable).length;
          const originLabel = inherited && direct
            ? 'Categoria + direto'
            : inherited
              ? `Herdado de ${categoryName || 'categoria'}`
              : 'Vínculo direto';

          return (
            <article key={group.id} className={`overflow-hidden rounded-2xl border transition-colors ${expanded ? 'border-primary/35 bg-primary/[0.06]' : 'border-white/10 bg-white/[0.025]'}`}>
              <button
                type="button"
                onClick={() => setExpandedGroupId(expanded ? null : group.id)}
                className="flex w-full items-center gap-4 p-4 text-left sm:p-5"
              >
                <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${expanded ? 'bg-primary text-white' : 'bg-white/5 text-primary'}`}>
                  <Sparkles size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h5 className="truncate text-base font-black text-white sm:text-lg">{group.name}</h5>
                    <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-wider ${group.isRequired ? 'bg-amber-400/15 text-amber-300' : 'bg-sky-400/10 text-sky-300'}`}>
                      {group.isRequired ? 'Obrigatório' : 'Opcional'}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
                    {originLabel} · {activeOptions}/{group.modifiers.length} opções visíveis
                  </p>
                </div>
                <ChevronRight size={20} className={`shrink-0 text-zinc-500 transition-transform ${expanded ? 'rotate-90 text-primary' : ''}`} />
              </button>

              {expanded && (
                <div className="space-y-4 border-t border-white/10 p-4 sm:p-5">
                  <div className="rounded-xl border border-amber-300/15 bg-amber-300/5 px-4 py-3 text-[10px] font-bold leading-relaxed text-amber-100/75">
                    Alterações nas opções valem em todos os produtos que usam este grupo.
                  </div>

                  <div className="space-y-2">
                    {group.modifiers.map((modifier, index) => (
                      <div key={modifier.id || index} className={`grid grid-cols-1 gap-3 rounded-2xl border border-white/5 bg-black/20 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center ${modifier.status === 'inactive' ? 'opacity-50 grayscale' : ''}`}>
                        <ModifierOptionEditor
                          modifier={modifier}
                          products={products}
                          siblingModifiers={group.modifiers}
                          index={index}
                          disabled={!canEdit}
                          onChange={(nextModifier) => {
                            const nextModifiers = [...group.modifiers];
                            nextModifiers[index] = nextModifier;
                            onUpdateGroup(group.id, { modifiers: nextModifiers });
                          }}
                        />
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => {
                            const nextModifiers = [...group.modifiers];
                            nextModifiers[index] = {
                              ...modifier,
                              status: modifier.status === 'inactive' ? 'active' : 'inactive',
                            };
                            onUpdateGroup(group.id, { modifiers: nextModifiers });
                          }}
                          className={`rounded-xl p-3 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${modifier.status === 'inactive' ? 'bg-white/5 text-zinc-500' : 'bg-emerald-400/10 text-emerald-300'}`}
                          title={modifier.status === 'inactive' ? 'Mostrar esta opção' : 'Ocultar esta opção'}
                        >
                          {modifier.status === 'inactive' ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => onUpdateGroup(group.id, { modifiers: group.modifiers.filter((_, modifierIndex) => modifierIndex !== index) })}
                          className="rounded-xl bg-rose-500/10 p-3 text-rose-400 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Remover opção"
                        >
                          <X size={17} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => onUpdateGroup(group.id, {
                        modifiers: [...group.modifiers, { id: createId(), name: '', price: 0, status: 'active' }],
                      })}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-primary/30 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus size={15} /> Adicionar opção
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenFullGroup(group.id)}
                      className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:bg-white/5"
                    >
                      <Settings size={15} /> Edição completa
                    </button>
                    {direct && !inherited && (
                      <button
                        type="button"
                        disabled={!canEdit || linkingGroupId === group.id}
                        onClick={() => void changeDirectLink(group, false)}
                        className="rounded-xl border border-rose-500/20 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-40"
                      >
                        Desvincular
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {availableGroups.length > 0 && (
        <div className="border-t border-white/10 p-4 sm:p-5">
          <p className="mb-3 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Outros grupos disponíveis</p>
          <div className="flex flex-wrap gap-2">
            {availableGroups.map(group => (
              <button
                key={group.id}
                type="button"
                disabled={!canEdit || Boolean(linkingGroupId)}
                onClick={() => void changeDirectLink(group, true)}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[10px] font-black uppercase tracking-wider text-zinc-400 transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {linkingGroupId === group.id ? <Settings className="animate-spin" size={14} /> : <Plus size={14} />}
                {group.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isExistingProduct && (
        <div className="flex items-start gap-3 border-t border-white/10 bg-sky-400/5 px-5 py-4 text-xs font-bold text-sky-100/75">
          <Package className="mt-0.5 shrink-0" size={16} />
          Os vínculos deste produto novo serão gravados junto com o primeiro salvamento.
        </div>
      )}
    </section>
  );
}
