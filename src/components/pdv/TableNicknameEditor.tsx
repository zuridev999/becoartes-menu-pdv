import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { OpsApi } from '../../lib/api';
import { useStore } from '../../store';
import type { Table } from '../../types';

export function TableNicknameEditor({ table, canEdit }: { table: Table; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(table.nickname || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const saved = await OpsApi.setTableNickname(table.id, value);
      useStore.setState(state => ({tables: state.tables.map(item => item.id === table.id ? {...item, nickname:saved.nickname} : item)}));
      setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Tente novamente.'); }
    finally { setBusy(false); }
  };
  return <div className="mb-4 shrink-0 space-y-2">
    {editing ? <form onSubmit={event => {event.preventDefault(); void save();}} className="space-y-2">
      <label className="block text-sm font-semibold" htmlFor="table-nickname">Nome ou apelido da mesa</label>
      <input id="table-nickname" autoFocus value={value} onChange={event=>setValue(event.target.value)} maxLength={60} disabled={busy} placeholder="Ex.: João · Aniversário" className="w-full rounded-xl border border-white/25 bg-white/5 px-3 py-3 text-base"/>
      <p className="text-xs text-zinc-400">Válido até o fechamento. Deixe vazio para remover.</p>
      <div className="flex gap-2"><button disabled={busy} className="min-h-11 rounded-xl bg-violet-600 px-4 font-bold">{busy ? 'Salvando…' : 'Salvar nome'}</button><button type="button" disabled={busy} onClick={()=>setEditing(false)} className="min-h-11 rounded-xl border border-white/20 px-4">Cancelar</button></div>
    </form> : <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 break-words text-lg font-semibold">{table.nickname || table.customerTab?.customerName || 'Sem apelido'}</span>{canEdit && <button type="button" onClick={()=>{setValue(table.nickname || '');setError('');setEditing(true);}} aria-label="Editar nome da mesa" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-white/20"><Pencil size={18}/></button>}</div>}
    {table.nickname && table.customerTab?.customerName && <p className="text-sm text-zinc-400">Cliente: {table.customerTab.customerName}</p>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
  </div>;
}
