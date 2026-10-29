import { useState } from 'react';
import { ChevronDown, Plus, Unlink } from 'lucide-react';
import type { ModifierGroup, Product } from '../../types';
import { SharedGroupEditor } from './SharedGroupEditor';

export function ProductModifierGroupsEditor({ product, products, groups, productMapping, categoryMapping, categoryName, canEdit, isExistingProduct, onDraftGroupsChange, onLinkDirect, onSaveGroup, onDirtyChange }: {
  product: Product; products: Product[]; groups: ModifierGroup[]; productMapping: Record<string, string[]>; categoryMapping: Record<string, string[]>;
  categoryName?: string; canEdit: boolean; isExistingProduct: boolean;
  onDraftGroupsChange: (groups: ModifierGroup[]) => void; onLinkDirect: (groupId: string, linked: boolean) => Promise<void>;
  onSaveGroup: (group: ModifierGroup) => Promise<void>; onDirtyChange: (groupId: string, dirty: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');
  const directIds = new Set(isExistingProduct ? productMapping[product.id] || [] : product.modifierGroups.map(g => g.id));
  const inheritedIds = new Set(categoryMapping[product.categoryId] || []);
  const linkedIds = new Set([...directIds, ...inheritedIds]);
  const linked = groups.filter(g => linkedIds.has(g.id)).sort((a, b) => Number(/sabor/i.test(b.name)) - Number(/sabor/i.test(a.name)));
  const changeLink = async (group: ModifierGroup, value: boolean) => {
    if (!canEdit || linking) return;
    if (!isExistingProduct) { onDraftGroupsChange(value ? [...product.modifierGroups, group] : product.modifierGroups.filter(g => g.id !== group.id)); return; }
    setLinking(true); setError('');
    try { await onLinkDirect(group.id, value); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível alterar o vínculo.'); } finally { setLinking(false); }
  };
  return <div className="product-groups">
    <h4>Sabores e adicionais</h4><p className="editor-help">Abra um grupo para escolher as opções visíveis neste produto.</p>
    {!linked.length && <p className="editor-help">Este produto ainda não tem grupos vinculados.</p>}
    {linked.map(group => {
      const direct = directIds.has(group.id), inherited = inheritedIds.has(group.id);
      const origin = direct && inherited ? 'Categoria + direto' : inherited ? `Herdado de ${categoryName || 'categoria'}` : 'Vínculo direto';
      const affected = products.filter(p => productMapping[p.id]?.includes(group.id) || categoryMapping[p.categoryId]?.includes(group.id));
      const open = expanded.includes(group.id);
      return <section className="product-group" key={group.id}>
        <button type="button" className="product-group-heading" aria-expanded={open} onClick={() => setExpanded(open ? expanded.filter(id => id !== group.id) : [...expanded, group.id])}><span><strong>{group.name}</strong><small>{origin} · {group.isRequired ? 'Obrigatório' : 'Opcional'}{group.status === 'inactive' ? ' · Grupo inativo' : ''}</small></span><ChevronDown size={20}/></button>
        <div hidden={!open} className="product-group-body">
          <SharedGroupEditor group={group} products={products} affectedProducts={affected} canEdit={canEdit} onSave={onSaveGroup} onDirtyChange={dirty => onDirtyChange(group.id, dirty)}/>
          {direct && !inherited && <button type="button" className="editor-secondary" disabled={!canEdit || linking} onClick={() => { if (window.confirm(`Retirar ${group.name} apenas de ${product.name}?`)) void changeLink(group, false); }}><Unlink size={15}/> Desvincular deste produto</button>}
          {inherited && <p className="editor-help">Vínculo definido na categoria. Para retirar, ajuste a categoria em Adicionais.</p>}
        </div>
      </section>;
    })}
    {error && <p role="alert" className="editor-error">{error}</p>}
    <details className="editor-rules"><summary>Vincular um grupo existente</summary>
      <label className="editor-search">Buscar grupo<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ex.: sabores, acompanhamentos"/></label>
      <div className="group-picker">{groups.filter(g => g.status !== 'inactive' && !linkedIds.has(g.id) && g.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(g => <button className="editor-secondary" type="button" key={g.id} disabled={!canEdit || linking} onClick={() => void changeLink(g, true)}><Plus size={16}/>{g.name}</button>)}</div>
      <p className="editor-help">Novos grupos só podem ser criados pelo superadmin.</p>
    </details>
    {!isExistingProduct && <p className="editor-help">Salve o produto para confirmar seus vínculos.</p>}
  </div>;
}
