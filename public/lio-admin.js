(() => {
  const el=id=>document.getElementById(id);
  const status=text=>el('status').textContent=text;
  async function api(path,body) {
    const response=await fetch('/api/lio/admin/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:{
      'content-type':'application/json','x-beco-session':localStorage.getItem('beco_bff_session_token')||'',
    },...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json(); if(!response.ok) throw new Error(data.error||'Falha na operação'); return data;
  }
  const action=fn=>async()=>{try{await fn();}catch(e){status(e.message);}};
  function option(parent,id,text){const o=document.createElement('option');o.value=id;o.textContent=text;parent.append(o);}
  function revocation(parent,text,kind,id){const row=document.createElement('p');row.textContent=text+' ';const b=document.createElement('button');b.textContent='Revogar';b.onclick=action(async()=>{await api('revoke',{kind,id});await load();status('Acesso revogado.');});row.append(b);parent.append(row);}
  async function load(){const s=await api('state');for(const id of ['terminal','seller','devices','operators'])el(id).replaceChildren();
    s.terminals.forEach(t=>option(el('terminal'),t,t));s.sellers.forEach(u=>option(el('seller'),u.id,u.name));
    s.devices.filter(d=>d.active).forEach(d=>revocation(el('devices'),'LIO '+d.terminal,'device',d.id));
    s.operators.filter(o=>o.active).forEach(o=>revocation(el('operators'),s.sellers.find(s=>s.id===o.seller_id)?.name||o.seller_id,'operator',o.seller_id));
    el('pending').textContent=s.pending.length?s.pending.map(p=>`${p.id}\nMesa ${p.table_id} • ${p.method} • R$ ${(p.amount/100).toFixed(2)} • ${p.status}`).join('\n\n'):'Nenhuma operação pendente.';
    status(s.cieloReady?'Integração Cielo configurada.':'Credenciais Cielo ainda pendentes; pagamentos eletrônicos bloqueados.');}
  el('enroll').onclick=action(async()=>{const r=await api('enroll',{terminal:el('terminal').value});el('code').textContent=r.code+' — válido por 10 minutos';});
  el('save').onclick=action(async()=>{await api('operator',{sellerId:el('seller').value});await load();status('Funcionário liberado. Ele já pode entrar com o PIN atual do PDV.');});
  el('cancel').onclick=action(async()=>{if(!window.confirm('Você conferiu na Cielo que esta operação NÃO foi aprovada? Esta ação não faz estorno.'))return;await api('cancel-pending',{id:el('cancel-id').value.trim(),reason:el('cancel-reason').value.trim()});await load();status('Operação liberada com registro de conferência.');});
  action(load)();
})();
