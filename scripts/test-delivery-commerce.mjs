import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDeliveryCommerce, deliveryCommerceSchema, defaultDeliverySettings, normalizeDeliverySettings, deliveryOpenNow, priceDeliveryItems } from '../server/delivery/commerce.mjs';
const dir=await mkdtemp(join(tmpdir(),'beco-delivery-tests-'));
const db=createClient({url:`file:${join(dir,'test.db')}`});
try {
  const source=await readFile(new URL('../server/bff.mjs',import.meta.url),'utf8');
  const tables=['app_settings','delivery_orders','delivery_order_items','delivery_customers','delivery_events','audit_logs'];
  for(const table of tables) {
    const line=source.split('\n').find(l=>l.includes(`"CREATE TABLE IF NOT EXISTS ${table} (`));
    assert.ok(line,table); await db.execute(JSON.parse(line.trim().replace(/,$/,'')));
  }
  for(const sql of deliveryCommerceSchema)await db.execute(sql);
  const now=new Date('2026-10-29T18:00:00Z');
  const settings={...defaultDeliverySettings,acceptingOrders:true,pickupEnabled:true,deliveryEnabled:true,pickupAddress:'Endereço de teste',postalPrefixes:['054'],deliveryFee:7.5,hours:defaultDeliverySettings.hours.map(()=>({enabled:true,start:'10:00',end:'23:00'})),coupons:[{code:'TESTE',type:'percent',value:10,minSubtotal:0,maxDiscount:5}]};
  assert.equal(deliveryOpenNow(settings,now),true);
  assert.equal(deliveryOpenNow(settings,new Date('2026-10-29T08:00Z')),false);
  assert.equal(deliveryOpenNow({...settings,hours:settings.hours.map(()=>({enabled:true,start:'18:00',end:'02:00'}))},new Date('2026-10-30T04:00Z')),true);
  assert.throws(()=>normalizeDeliverySettings({...settings,deliveryFee:-1}));
  assert.equal(normalizeDeliverySettings({...settings,ifood:{enabled:true}}).ifood.enabled,false);
  const catalog={categories:[{id:'c',visible:true}],menuItems:[{id:'food',name:'Produto',price:10,visible:true,deliveryVisible:true,categoryId:'c'}],modifierGroups:[{id:'flavor',isRequired:true,minChoices:1,maxChoices:1,modifiers:[{id:'cheese',name:'Queijo',price:2,status:'active'}]}],productMapping:{food:['flavor']},categoryMapping:{}};
  const items=[{productId:'food',name:'Fake',price:0.01,quantity:2,selectedModifiers:[{id:'cheese',price:0}],notes:''}];
  assert.equal(priceDeliveryItems(items,catalog)[0].price,10);
  assert.throws(()=>priceDeliveryItems([{...items[0],quantity:-1}],catalog));
  assert.throws(()=>priceDeliveryItems([{...items[0],selectedModifiers:[]}],catalog));
  assert.throws(()=>priceDeliveryItems([{...items[0],selectedModifiers:[{id:'hidden'}]}],catalog));
  let calls=0,dispatches=0,nextStatus='PAID',timeout=false,responseMethod='CREDIT_CARD',responseAmount=2400, lastPayload;
  const service=createDeliveryCommerce({db,ensureReady:async()=>{},getCatalog:async()=>catalog,normalizeCustomer:c=>({...c,taxId:c.taxId||'',coupon:c.coupon||'',joinClub:!!c.joinClub}),publicStatus:'open',provider:'pagbank',token:'fake-test-token',apiBase:'https://provider.invalid',localDatabase:true,kitchenMode:'production',clock:()=>now,
    buildPayload:({orderId,customer,totals})=>({reference_id:orderId,customer,amount:totals.total}),instructions:()=>({qrCodeText:'test-pix'}),trackingToken:({orderId})=>`tracking_${orderId}`,
    authorizeOrder:async i=>assert.equal(i.trackingToken,`tracking_${i.orderId}`),
    readOrder:async ({orderId})=>({order:(await db.execute({sql:'SELECT * FROM delivery_orders WHERE id=?',args:[orderId]})).rows[0]}),dispatch:async()=>{dispatches++;},
    fetchImpl:async (_url,options)=>{calls++;lastPayload=JSON.parse(options.body);assert.equal(options.headers['x-idempotency-key'],lastPayload.reference_id);if(timeout)throw new Error('timeout');return {ok:true,json:async()=>({id:`ext_${lastPayload.reference_id}`,reference_id:lastPayload.reference_id,charges:[{status:nextStatus,amount:{value:responseAmount,currency:'BRL'},payment_method:{type:responseMethod}}]})};}
  });
  await service.saveSettings(settings,{name:'Test'});
  const customer={name:'Pessoa Teste',phone:'11999999999',email:'test@example.com',taxId:'52998224725',fulfillment:'pickup',paymentMethod:'credit',street:'Teste',number:'1',neighborhood:'Teste',city:'São Paulo',state:'SP',postalCode:'05401000',complement:'',notes:''};
  const start=async(overrides={})=>{const c={...customer,...overrides};const q=await service.quote({customer:c,items});return {orderId:`delivery_${randomUUID()}`,requestKey:randomUUID(),customer:{...c,quoteId:q.quote.quoteId},items,payment:{card:{encrypted:'secret-ciphertext',installments:1}}};};
  const input=await start();
  const first=await service.checkout(input);assert.equal(first.order.total,24);assert.equal(first.order.payment_status,'paid');assert.equal(calls,1);
  await service.checkout(input);assert.equal(calls,1,'Retry must not charge again');
  await assert.rejects(()=>service.checkout({...input,requestKey:randomUUID()}),/deliveryUnauthorized/);
  assert.equal((await db.execute('SELECT COUNT(*) n FROM delivery_receipts')).rows[0].n,1);
  const fingerprintLog=JSON.stringify((await db.execute('SELECT * FROM delivery_events')).rows);assert.ok(!fingerprintLog.includes('secret-ciphertext'));
  const paidBody={id:`ext_${input.orderId}`,reference_id:input.orderId,charges:[{status:'PAID',amount:{value:2400,currency:'BRL'},payment_method:{type:'CREDIT_CARD'}}]};
  await service.webhook(paidBody);assert.equal((await db.execute('SELECT COUNT(*) n FROM delivery_receipts')).rows[0].n,1);
  await service.webhook({...paidBody,charges:[{status:'WAITING'}]});assert.equal((await service.checkout(input)).order.payment_status,'paid');
  nextStatus='AUTHORIZED';const pre=await start();assert.equal((await service.checkout(pre)).order.payment_status,'payment_pending');
  nextStatus='DECLINED';const declined=await start();assert.equal((await service.checkout(declined)).order.payment_status,'payment_failed');
  nextStatus='PAID';responseAmount=1;const wrong=await start();assert.equal((await service.checkout(wrong)).order.payment_status,'review');
  responseAmount=2400;timeout=true;const uncertain=await start();assert.equal((await service.checkout(uncertain)).order.payment_status,'unknown');const before=calls;await service.checkout(uncertain);assert.equal(calls,before);timeout=false;
  const out=await start();await assert.rejects(()=>service.checkout({...out,customer:{...out.customer,quoteId:'missing'}}),/deliveryQuoteExpired/);
  await assert.rejects(()=>service.quote({customer:{...customer,fulfillment:'delivery',postalCode:'99999999'},items}),/deliveryOutsideArea/);
  const shipping=await service.quote({customer:{...customer,fulfillment:'delivery',coupon:'TESTE'},items});assert.equal(shipping.quote.total,29.1);assert.equal(shipping.quote.deliveryFee,7.5);assert.equal(shipping.quote.discount,2.4);
  await service.saveSettings({...settings,acceptingOrders:false},{name:'Test'});await assert.rejects(()=>service.checkout(out),/deliveryClosed/);
  assert.ok(dispatches>=1);
  console.log('PASS: preços autoritativos, adicionais, horários, CEP, frete/cupom, bloqueio fechado, idempotência, autorização não capturada, recusa, divergência, timeout, webhook repetido e dados sensíveis.');
} finally { db.close(); await rm(dir,{recursive:true,force:true}); }
