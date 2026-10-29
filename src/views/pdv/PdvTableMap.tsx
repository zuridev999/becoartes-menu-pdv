import { useState } from 'react';
import { CheckCircle2, Search, ChevronRight } from 'lucide-react';
import type { Table, ServiceRequest } from '../../types';
import { formatCurrency } from '../../lib/format';
import { getOrderItemsTotal } from '../../lib/totals';
import { getOnlinePaymentLabel, isOnlinePaidAwaitingConference } from '../../lib/online-payment';
import './pdv-table-map.css';

export function PdvTableMap({ tables, requests, serviceTax, onlyActive, onOnlyActive, onOpen, isPreparing, statusClass, modeAction }: {
  tables: Table[]; requests: ServiceRequest[]; serviceTax: number; onlyActive: boolean; onOnlyActive: (value: boolean) => void;
  onOpen: (table: Table) => void; isPreparing: (table: Table) => boolean;
  statusClass: (table: Table) => string; modeAction?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [paidOnly, setPaidOnly] = useState(false);
  const paid = tables.filter(table => isOnlinePaidAwaitingConference(table, serviceTax));
  const occupied = tables.filter(table => table.status !== 'available' || table.customerTab);
  const visible = tables.filter(table => (!onlyActive || occupied.includes(table)) && (!paidOnly || paid.includes(table)) &&
    `${table.number} ${table.nickname || ''} ${table.customerTab?.customerName || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="pdv-table-map" aria-label="Mesas e conferência">
    <div className="pdv-map-heading"><div><h2>Mesas</h2><p>{occupied.length} em atendimento · {tables.length - occupied.length} livres</p></div>{modeAction}</div>
    {paid.length > 0 && <button className="pdv-paid-summary" onClick={() => setPaidOnly(value => !value)} aria-pressed={paidOnly}><CheckCircle2 size={25}/><span><strong>{paid.length} {paid.length === 1 ? 'mesa paga pelo cliente' : 'mesas pagas pelos clientes'}</strong><small>Conferir recebimento e dar baixa</small></span><ChevronRight size={22}/></button>}
    <div className="pdv-map-tools"><label><Search size={19}/><input aria-label="Buscar mesa ou cliente" placeholder="Mesa ou cliente" value={query} onChange={e => setQuery(e.target.value)}/></label><button aria-pressed={onlyActive} onClick={() => onOnlyActive(!onlyActive)}>{onlyActive ? 'Só em atendimento' : 'Todas as mesas'}</button>{paidOnly && <button onClick={() => setPaidOnly(false)}>Limpar filtro de pagas</button>}</div>
    <div className="pdv-tables-grid">
      {visible.map(table => {
        const online = paid.includes(table);
        const bill = requests.find(request => request.type === 'bill' && request.status === 'pending' && (request.tableId === table.id || request.sourceTableId === table.id));
        const free = table.status === 'available' && !table.customerTab;
        const status = online ? 'Pago · conferir' : bill ? (bill.message?.includes('maquininha') ? 'Maquininha solicitada' : 'Conta solicitada') : free ? 'Livre' : table.status === 'bill_requested' ? 'Conta solicitada' : table.customerTab?.status === 'paid' ? 'Comanda paga' : isPreparing(table) ? 'Em preparo' : 'Em atendimento';
        return <button key={table.id} onClick={() => onOpen(table)} className={`pdv-table-tile ${statusClass(table)} ${free ? 'is-free' : ''} ${bill && !online ? 'pdv-bill-attention' : ''}`} aria-label={`Mesa ${table.number}, ${online ? 'paga pelo cliente, aguardando conferência' : status}`}>
          <span className="pdv-table-number"><small>Mesa</small><strong>{table.number}</strong></span>
          <span className="pdv-table-detail"><strong>{free ? 'Iniciar pedido' : formatCurrency(online ? (table.payments || []).filter(payment => payment.status === 'active').reduce((sum,payment) => sum + payment.amount, 0) : getOrderItemsTotal(table.orders))}</strong><span>{status}</span>{online && <small>{getOnlinePaymentLabel(table)} · confirmado</small>}{table.nickname && <small className="pdv-table-nickname">{table.nickname}</small>}{table.customerTab?.customerName && <small>{table.customerTab.customerName}</small>}</span>
          {online ? <CheckCircle2 size={23}/> : <ChevronRight size={18}/>}
        </button>;
      })}
    </div>
    {!visible.length && <p className="pdv-map-empty">Nenhuma mesa neste filtro.</p>}
  </section>;
}
