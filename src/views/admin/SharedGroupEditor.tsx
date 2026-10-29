import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Plus, Settings2, Trash2 } from 'lucide-react';
import type { ModifierGroup, Product } from '../../types';
import { createId } from '../../lib/id';
import { ModifierThumbnail } from '../../components/shared/ModifierThumbnail';
import { ModifierOptionEditor } from './ModifierOptionEditor';

export function SharedGroupEditor({ group, products, affectedProducts, canEdit, onSave, onDirtyChange }: {
  group: ModifierGroup; products: Product[]; affectedProducts: Product[]; canEdit: boolean;
  onSave: (group: ModifierGroup) => Promise<void>; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<ModifierGroup>(() => structuredClone(group));
  const [dirty, setDirty] = useState(false);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => { if (!dirty) setDraft(structuredClone(group)); }, [group, dirty]);
  useEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useEffect(() => () => { dirtyCallback.current?.(false); }, []);
  const change = (next: ModifierGroup) => { setDraft(next); setDirty(true); setReview(false); setError(''); setSaved(false); };
  const active = draft.modifiers.filter(m => m.status !== 'inactive' && !m.inheritedUnavailable).length;
  const validate = () => {
    if (!draft.name.trim() || draft.modifiers.some(m => !m.name.trim())) return 'Preencha o nome do grupo e de todas as opções.';
    if (!Number.isInteger(draft.minChoices) || !Number.isInteger(draft.maxChoices) || draft.minChoices < 0 || draft.maxChoices < 1 || draft.minChoices > draft.maxChoices) return 'Revise a quantidade mínima e máxima de escolhas.';
    if (draft.modifiers.some(m => !Number.isFinite(Number(m.price)) || Number(m.price) < 0)) return 'O valor de uma opção não pode ser negativo.';
    if (draft.status !== 'inactive' && active < Math.max(draft.isRequired ? 1 : 0, draft.minChoices)) return 'Mantenha opções suficientes visíveis para a escolha obrigatória. Para suspender vendas, oculte os produtos na aba Exibição.';
    return '';
  };
  const save = async () => {
    const message = validate();
    if (message) { setError(message); return; }
    if (!review) { setReview(true); return; }
    setSaving(true);
    try { await onSave(draft); setDirty(false); setReview(false); setSaved(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar. Suas alterações continuam aqui.'); }
    finally { setSaving(false); }
  };
  return <section className="shared-group-editor" aria-label={`Editar ${group.name}`}>
    <p className="editor-help">{draft.isRequired ? 'Escolha obrigatória' : 'Escolha opcional'} · {draft.minChoices} a {draft.maxChoices} opção(ões) · {active} disponíveis</p>
    <p className="editor-help">Alterações nas opções valem em todos os produtos que usam este grupo.</p>
    <details className="editor-affected"><summary>Usado em {affectedProducts.length} produto(s)</summary><ul>{affectedProducts.map(p => <li key={p.id}>{p.name}</li>)}</ul></details>
    <fieldset disabled={!canEdit || saving}>
      <div className="option-rows">
        {draft.modifiers.map((modifier, index) => {
          const master = products.find(p => p.id === modifier.linkedProductId);
          const blocked = modifier.inheritedUnavailable || (master && !master.visible);
          const reason = master?.availabilityBlocked ? 'Indisponível pelo estoque' : 'Produto de origem oculto';
          return <div key={modifier.id} className="option-row">
            <div className="option-main"><ModifierThumbnail modifier={modifier} products={products} name={modifier.name}/><div><strong>{modifier.name || 'Nova opção'}</strong><span>{modifier.price ? `+ ${Number(modifier.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : 'Sem acréscimo'}</span>{blocked && <small>{reason}. Ajuste o produto de origem para disponibilizar.</small>}</div>
              <button type="button" className={`visibility-switch ${modifier.status !== 'inactive' && !blocked ? 'is-visible' : ''}`} aria-pressed={modifier.status !== 'inactive'} aria-label={`${modifier.status === 'inactive' ? 'Mostrar' : 'Ocultar'} ${modifier.name}`} onClick={() => change({ ...draft, modifiers: draft.modifiers.map((m, i) => i === index ? { ...m, status: m.status === 'inactive' ? 'active' : 'inactive' } : m) })}>
                {modifier.status === 'inactive' || blocked ? <EyeOff size={18}/> : <Eye size={18}/>}{modifier.status === 'inactive' ? 'Oculto' : blocked ? 'Bloqueado' : 'Visível'}
              </button>
              <button type="button" className="editor-icon" aria-label={`Editar opção ${modifier.name}`} onClick={() => setEditing(editing === modifier.id ? null : modifier.id)}><Settings2 size={18}/></button>
            </div>
            {editing === modifier.id && <div className="option-detail"><ModifierOptionEditor modifier={modifier} products={products} siblingModifiers={draft.modifiers} index={index} disabled={!canEdit || saving} onChange={m => change({ ...draft, modifiers: draft.modifiers.map((v, i) => i === index ? m : v) })}/><button className="editor-danger" type="button" onClick={() => change({ ...draft, modifiers: draft.modifiers.filter(m => m.id !== modifier.id) })}><Trash2 size={16}/> Remover do grupo</button></div>}
          </div>;
        })}
      </div>
      <button type="button" className="editor-secondary" disabled={!canEdit} onClick={() => { const id = createId(); change({ ...draft, modifiers: [...draft.modifiers, { id, name: '', price: 0, status: 'active' }] }); setEditing(id); }}><Plus size={17}/> Adicionar opção</button>
      <details className="editor-rules"><summary>Regras de escolha</summary><div className="editor-fields">
        <label>Nome do grupo<input value={draft.name} onChange={e => change({ ...draft, name: e.target.value })}/></label>
        <label>Mínimo<input type="number" min="0" step="1" value={draft.minChoices} onChange={e => change({ ...draft, minChoices: Number(e.target.value) })}/></label>
        <label>Máximo<input type="number" min="1" step="1" value={draft.maxChoices} onChange={e => change({ ...draft, maxChoices: Number(e.target.value) })}/></label>
        <label className="editor-checkbox"><input type="checkbox" checked={draft.isRequired} onChange={e => change({ ...draft, isRequired: e.target.checked, minChoices: e.target.checked ? Math.max(1, draft.minChoices) : 0 })}/> Obrigatório</label>
      </div></details>
    </fieldset>
    {error && <p role="alert" className="editor-error">{error}</p>}
    {saved && <p role="status" className="editor-success">Grupo salvo. Disponibilidade atualizada nos produtos vinculados.</p>}
    {review && <div className="editor-review"><strong>Confirmar mudança compartilhada</strong><p>O grupo será atualizado em: {affectedProducts.map(p => p.name).join(', ') || 'nenhum produto vinculado'}. Pedidos já lançados serão preservados.</p></div>}
    {dirty && <div className="editor-actions"><button type="button" className="editor-secondary" disabled={saving} onClick={() => { setDirty(false); setReview(false); setError(''); }}>Descartar</button><button type="button" className="editor-primary" disabled={!canEdit || saving} onClick={() => void save()}>{saving ? 'Salvando…' : review ? 'Confirmar e salvar grupo' : 'Revisar e salvar grupo'}</button></div>}
  </section>;
}
