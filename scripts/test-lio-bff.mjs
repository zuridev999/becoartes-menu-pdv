import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { migrateLio } from '../server/lio/schema.mjs';

// Real BFF + real schema, isolated file DB. Block every outbound HTTP call in the child.
const dir=mkdtempSync(join(tmpdir(),'becoartes-lio-e2e-'));
const db=createClient({url:'file:'+join(dir,'test.db')});
const secret='lio-e2e-isolated-test-only';
const port=Number(process.env.LIO_TEST_PORT||18198);
const base=`http://127.0.0.1:${port}`;
let child,log='';
const adminPayload=Buffer.from(JSON.stringify({sub:'lio_test_admin',name:'Admin Teste',permission:'admin',osRole:'super_admin',exp:Date.now()+600000})).toString('base64url');
const admin=adminPayload+'.'+createHmac('sha256',secret).update(adminPayload).digest('base64url');
let device='',session='';
async function request(path,body,status=200,asAdmin=false){
  const headers={'content-type':'application/json',...(asAdmin?{'x-beco-session':admin}:{'x-lio-device':device,'x-lio-session':session})};
  const res=await fetch(base+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});
  const data=await res.json();assert.equal(res.status,status,`${path}: ${JSON.stringify(data)}`);return data;
}
try {
  await migrateLio(db);
  child=spawn(process.execPath,['--input-type=module','-e',`globalThis.fetch=async()=>{throw new Error('Outbound HTTP disabled in LIO E2E');};await import('./server/bff.mjs');`],{
    cwd:process.cwd(),env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:String(port),TURSO_DATABASE_URL:'file:'+join(dir,'test.db'),BFF_SESSION_SECRET:secret,
      OS_EMPRESA_ID:'lio_test',OS_SYSTEM_USER_ID:'lio_test_admin',DEFAULT_MANAGER_PIN:'135790',DEFAULT_OPERATOR_PIN:'246801',
      TABLET_SETUP_PIN:'975310',CASH_SANDBOX_MODE:'1',INVENTORY_RECONCILIATION_DISABLED:'1',LIO_ENABLED:'1'},stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',c=>log+=c);
  let healthy=false;for(let i=0;i<80;i++){try{const h=await fetch(base+'/api/health');if(h.ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(healthy,'BFF did not start: '+log);
  await db.batch([
    {sql:"INSERT INTO sellers(id,name,status,role,permission,pin) VALUES ('lio_test_admin','Admin Teste','active','Vendedor','admin','1530')",args:[]},
    {sql:"INSERT INTO categories(id,name,visible,sort_order) VALUES ('lio_cat','Pratos',1,0)",args:[]},
    {sql:"INSERT INTO menu(id,name,price,category_id,visible,image) VALUES ('lio_product','Prato de teste',35.90,'lio_cat',1,'')",args:[]},
  ],'write');
  await request('/api/cash/open',{openingBalance:0,confirmationPin:'1530'},200,true);
  const enrollment=await request('/api/lio/admin/enroll',{terminal:'02322106'},200,true);
  device=(await request('/api/lio/activate',{code:enrollment.code})).deviceToken;
  await request('/api/lio/admin/operator',{sellerId:'lio_test_admin'},200,true);
  session=(await request('/api/lio/login',{pin:'1530'})).session;
  const catalog=await request('/api/lio/catalog');assert.ok(catalog.products.some(p=>p.id==='lio_product'));
  const order={requestId:'order-e2e',tableId:'1',items:[{productId:'lio_product',quantity:1,modifierIds:[]}]};
  await request('/api/lio/orders',order);await request('/api/lio/orders',order);
  const q=await request('/api/lio/quote?tableId=1');assert.equal(q.table.orders.length,1);assert.equal(q.balanceCents,4057);
  const data={requestId:'cash-e2e',tableId:'1',method:'cash',amount:4057,received:5000,fingerprint:q.fingerprint};
  const payment=await request('/api/lio/payments/prepare',data);
  await request('/api/lio/orders',{...order,requestId:'blocked'},409);
  // Existing desktop PDV mutation must also respect the in-flight terminal payment.
  await request('/api/tables/status',{tableId:'1',status:'available'},409,true);
  const paid=await request('/api/lio/payments/settle',{id:payment.id});assert.equal(paid.changeCents,943);
  await request('/api/lio/payments/settle',{id:payment.id});
  const q2=await request('/api/lio/quote?tableId=1');assert.equal(q2.balanceCents,0);assert.equal(q2.table.payments.length,1);
  await request('/api/lio/finish',{tableId:'1',fingerprint:q2.fingerprint});
  const q3=await request('/api/lio/quote?tableId=1');assert.equal(q3.table.status,'available');assert.equal(q3.table.orders.length,0);
  const bills=await db.execute('SELECT COUNT(*) as total FROM closed_bills');assert.equal(bills.rows[0].total,1);
  console.log('LIO BFF E2E passed: provision → login → real catalog → idempotent order → R$ 50 cash → R$ 9.43 change → ledger → close → desktop table free. Outbound HTTP blocked.');
}finally{
  if(child && child.exitCode===null && child.signalCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await stopped;}
  db.close();rmSync(dir,{recursive:true,force:true});
}
