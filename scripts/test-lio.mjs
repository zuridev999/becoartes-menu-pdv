import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { createServer } from 'node:http';
import { migrateLio } from '../server/lio/schema.mjs';
import { createLioService } from '../server/lio/service.mjs';
import { createLioRuntime } from '../server/lio/runtime.mjs';
import { createLioHandler } from '../server/lio/http.mjs';
import { buildOrderItems, catalogForLio, orderFingerprint, verifyCieloOrder, receipt } from '../server/lio/domain.mjs';
import { createCieloClient } from '../server/lio/cielo.mjs';

let assertions=0;
const check=(actual,expected)=>{assert.deepEqual(actual,expected);assertions++;};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);assertions++;};
const previousLioFlag=process.env.LIO_ENABLED;
delete process.env.LIO_ENABLED;
try {
  const disabled=await createLioRuntime({db:{execute:()=>{throw new Error('Disabled LIO queried the database');}}});
  check(disabled.service,null);
} finally {
  if (previousLioFlag === undefined) delete process.env.LIO_ENABLED;
  else process.env.LIO_ENABLED=previousLioFlag;
}
const db=createClient({url:'file::memory:'});
await migrateLio(db); await migrateLio(db);
const users=[{id:'u1',name:'Operador',status:'active',permission:'operator',pin:'1530'},{id:'u2',name:'Outra pessoa',status:'active',permission:'operator',pin:'2468'}];
const admin={id:'admin',permission:'admin'};
const table={id:'t1',number:1,status:'ordering',orders:[{id:'i1',orderId:'o1',productId:'p1',quantity:1,price:35.90,name:'Prato',selectedModifiers:[]}],payments:[]};
const catalog={categories:[{id:'c1',name:'Pratos'}],menuItems:[{id:'p1',name:'Prato',price:35.90,visible:true,categoryId:'c1'},{id:'p2',name:'Oculto',visible:false}],
  modifierGroups:[{id:'g1',name:'Sabor',status:'active',minChoices:1,maxChoices:1,isRequired:true,modifiers:[{id:'m1',name:'Limão',price:0,status:'active'},{id:'m2',name:'Indisponível',price:1,status:'inactive'}]}],productMapping:{p1:['g1']}};
const products=catalogForLio(catalog);check(products.length,1);
check(buildOrderItems([{productId:'p1',quantity:2,modifierIds:['m1'],price:0}],products,'order')[0].price,35.90);
for(const selection of [[],[{productId:'p2',quantity:1}],[{productId:'p1',quantity:1,modifierIds:[]}],[{productId:'p1',quantity:1,modifierIds:['m2']}],[{productId:'p1',quantity:0,modifierIds:['m1']}],[{productId:'p1',quantity:1,modifierIds:['m1','m1']}]]){
  assert.throws(()=>buildOrderItems(selection,products,'order'));assertions++;
}
let denied='',submissions=0,closed=0;
const seen=new Set();
const pdv={
  getAuthSellers:async()=>users,getSettings:async()=>({}),requirePermission:(_s,p)=>{if(p===denied)throw new Error('permission denied');},
  ensureTableAccess:async()=>{},getTables:async()=>[structuredClone(table)],getCatalogData:async()=>catalog,assertCashOperationAllowed:async()=>{},
  getActiveTablePaymentBalance:async()=>{const sub=Math.round(table.orders.reduce((s,i)=>s+i.quantity*i.price,0)*100);const fee=Math.round(sub*.13);const paid=Math.round(table.payments.reduce((s,p)=>s+p.amount,0)*100);return {subtotalCents:sub,serviceFeeCents:fee,paidCents:paid,balanceCents:Math.max(0,sub+fee-paid)};},
  sendToKitchen:async d=>{if(!seen.has(d.orderId)){seen.add(d.orderId);submissions++;}return {ok:true};},
  createTablePayment:async d=>{if(!table.payments.some(p=>p.id===d.id))table.payments.push({...d,status:'active'});return {ok:true};},
  closeBillWithInventorySync:async d=>{check(d.total,40.57);check(d.payments.length,2);closed++;table.status='available';table.orders=[];table.payments=[];return {ok:true};},
};
const cielo={ready:()=>true,request:i=>({reference:i.id,value:String(i.amount)}),verify:async i=>({transactionId:'tx_'+i.id,orderId:'order_'+i.id,method:i.method})};
const service=createLioService({db,pdv,secret:'isolated-test-secret-not-production',cielo});
await rejects(()=>service.enrollDevice('not-listed',admin),/fora/);
const enrollment=await service.enrollDevice('02322106',admin);
check(enrollment.code.length,12);
const activation=await service.activate(enrollment.code);
await rejects(()=>service.activate(enrollment.code),/inválido/);
await service.setOperator('u1',null,admin);
await service.setOperator('u2',null,admin);
await rejects(()=>service.login('wrong','1530'),/não autorizada/);
await rejects(()=>service.login(activation.deviceToken,'000'),/quatro/);
await rejects(()=>service.login(activation.deviceToken,'0000'),/inválido/);
const login=await service.login(activation.deviceToken,'1530');
const ctx=await service.authenticate(activation.deviceToken,login.session);
check(ctx.actor.id,'u1');
const state=await service.adminState();check(JSON.stringify(state).includes('pin_lookup'),false);
const q=await service.quote('t1',ctx);check(q.balanceCents,4057);check(receipt(table,q).includes('Serviço'),false);check(receipt(table,q).includes('4,67'),true);
const request={requestId:'payment1',tableId:'t1',fingerprint:q.fingerprint,method:'debit',amount:4000,received:4000};
denied='launchPayment';await rejects(()=>service.prepare(request,ctx),/permission/);denied='';
await rejects(()=>service.prepare({...request,amount:4058,received:4058},ctx),/maior/);
await rejects(()=>service.prepare({...request,received:5000},ctx),/Troco/);
await rejects(()=>service.prepare({...request,fingerprint:'stale'},ctx),/mudou/);
const intent=await service.prepare(request,ctx);check(intent.request.value,'4000');
await rejects(()=>service.assertUnlocked('t1'),/pagamento/);
await service.assertUnlocked('t1',{lioIntentId:intent.id});
check((await service.prepare(request,ctx)).recovery,true);
await rejects(()=>service.prepare({...request,requestId:'second'},ctx),/pendente/);
await rejects(()=>service.prepare({...request,amount:3999},ctx),/outros dados/);
const settled=await service.settle({id:intent.id},ctx);check(settled.status,'done');check(table.payments.length,1);
check(await service.settle({id:intent.id},ctx),settled);check(table.payments.length,1);
await rejects(()=>service.cancelPending(intent.id,'Conferido sem cobrança na Cielo',admin),/Somente/);
await service.assertUnlocked('t1');
const after=await service.quote('t1',ctx);check(after.balanceCents,57);
const cash=await service.prepare({requestId:'cash',tableId:'t1',fingerprint:after.fingerprint,method:'cash',amount:57,received:1000},ctx);
check((await service.settle({id:cash.id},ctx)).changeCents,943);
await service.finish({tableId:'t1',fingerprint:after.fingerprint},ctx);check(closed,1);check(table.status,'available');
check((await service.finish({tableId:'t1',fingerprint:after.fingerprint},ctx)).closed,true);check(closed,1);
await service.order({tableId:'t1',requestId:'order1',items:[{productId:'p1',quantity:1,modifierIds:['m1']}]},ctx);
await service.order({tableId:'t1',requestId:'order1',items:[{productId:'p1',quantity:1,modifierIds:['m1']}]},ctx);check(submissions,1);
users[0].status='inactive';await rejects(()=>service.authenticate(activation.deviceToken,login.session),/inativo/);users[0].status='active';
await service.revoke('device',ctx.device.id,admin);await rejects(()=>service.authenticate(activation.deviceToken,login.session),/não autorizada/);

const expected={id:'intent1',amount:1000};const valid={id:'order1',reference:'intent1',price:1000,remaining:0,status:'PAID',transactions:[{id:'transaction1',status:'CONFIRMED',transaction_type:'PAYMENT',terminal_number:2322106,amount:1000,payment_product:{primary_product_name:'DEBITO'}}]};
check(verifyCieloOrder(valid,expected,'02322106').method,'debit');
for(const bad of [{...valid,status:'ENTERED'},{...valid,reference:'other'},{...valid,price:999},{...valid,remaining:1},{...valid,transactions:[{...valid.transactions[0],amount:999}]},{...valid,transactions:[{...valid.transactions[0],terminal_number:123}]},{...valid,transactions:[{...valid.transactions[0],status:'PENDING'}]},{...valid,transactions:[{...valid.transactions[0],payment_product:{primary_product_name:'unknown'}}]}]){
  assert.throws(()=>verifyCieloOrder(bad,expected,'02322106'));assertions++;
}
assert.throws(()=>createCieloClient({}).request(expected),/não configurada/);assertions++;
let called='';const remote=createCieloClient({LIO_CIELO_CLIENT_ID:'test',LIO_CIELO_ACCESS_TOKEN:'test',LIO_CIELO_MERCHANT_ID:'test'},async(url)=>{called=url;return {ok:true,json:async()=>valid};});
await remote.verify(expected,'02322106','order1');check(called,'https://api.cielo.com.br/sandbox-lio/order-management/v1/orders/order1');

const handler=createLioHandler({service,getSessionFromRequest:()=>null,isAdminSession:()=>false,enabled:true});
const server=createServer(async(req,res)=>{await handler(req,res,new URL(req.url,'http://localhost'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
try {
  check((await fetch(base+'/api/lio/admin/state')).status,403);
  check((await fetch(base+'/api/lio/tables')).status,401);
  check((await fetch(base+'/api/lio/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:'1530'})})).status,401);
}finally{await new Promise(resolve=>server.close(resolve));db.close();}
console.log(`LIO: ${assertions} verificações passaram (banco isolado; zero chamadas de produção).`);
