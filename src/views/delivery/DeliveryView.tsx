import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Bike, X, Trash2, ArrowLeft, ShoppingBag, RefreshCw, CreditCard, QrCode } from 'lucide-react';
import { useStore, type Modifier, type OrderItem, type Product } from '../../store';
import { MenuCatalog } from '../../components/shared/MenuCatalog';
import { ProductModal } from '../../components/modals/ProductModal';
import { ModifierThumbnail } from '../../components/shared/ModifierThumbnail';
import { PublicLanguageMenu } from '../../components/shared/PublicLanguageMenu';
import { DeliveryApi, type DeliveryCheckoutInput, type DeliveryConfig, type DeliveryQuoteResult, type DeliveryOrderSummary } from '../../lib/api';
import { getOrderItemTotal, getOrderItemsTotal } from '../../lib/totals';
import { usePublicI18n } from '../../lib/public-i18n';
import { useDialogFocus } from '../../lib/use-dialog-focus';
import { getImageSrc, applyImageFallback } from '../../lib/image';
import { deliveryText } from './copy';
import { DeliveryAccountForm } from './DeliveryAccountForm';

type Customer = DeliveryCheckoutInput['customer'];
type Card = { holder: string; number: string; expiry: string; cvv: string };
const CART = 'beco_delivery_cart_v2', ATTEMPT = 'beco_delivery_attempt_v2', LAST = 'beco_delivery_last_order_id', SESSION = 'beco_delivery_customer_session';
const initialCustomer: Customer = { name:'',phone:'',email:'',taxId:'',street:'',number:'',neighborhood:'',city:'',state:'',postalCode:'',complement:'',reference:'',notes:'',fulfillment:'pickup',paymentMethod:'pix',coupon:'',joinClub:false };
const emptyCard: Card = { holder:'',number:'',expiry:'',cvv:'' };
const storage = { get(key:string) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }, set(key:string,value:string) { try { localStorage.setItem(key,value); } catch { /* Private mode may disallow persistence. */ } }, remove(key:string) { try { localStorage.removeItem(key); } catch { /* optional storage */ } } };
const loadCart = (): OrderItem[] => { try { const saved=JSON.parse(storage.get(CART)); return Date.now()-saved.time<86400000 && Array.isArray(saved.items) ? saved.items : []; } catch { return []; } };
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const digits=(value:string)=>value.replace(/\D/g,'');
declare global { interface Window { PagSeguro?: { encryptCard:(input:{publicKey:string;holder:string;number:string;expMonth:string;expYear:string;securityCode:string})=>{encryptedCard?:string;hasErrors?:boolean;errors?:unknown[]} } } }
let sdkLoading: Promise<void> | null = null;
async function encrypt(card:Card, taxId:string) {
  if (!window.PagSeguro) {
    sdkLoading ||= new Promise<void>((resolve,reject)=>{ const script=document.createElement('script'); script.src='https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js'; script.async=true; script.onload=()=>resolve();script.onerror=()=>{sdkLoading=null;script.remove();reject(new Error('deliveryPaymentError'));};document.head.appendChild(script); });
    await sdkLoading;
  }
  const {publicKey}=await DeliveryApi.pagbankPublicKey();
  if(!publicKey || !window.PagSeguro) throw new Error('deliveryPaymentError');
  const expiry=digits(card.expiry), year=expiry.slice(2);
  const result=window.PagSeguro.encryptCard({publicKey,holder:card.holder,number:digits(card.number),expMonth:expiry.slice(0,2),expYear:year.length===2?`20${year}`:year,securityCode:card.cvv});
  if(result.hasErrors || !result.encryptedCard) throw new Error('deliveryCardInvalid');
  return {encrypted:result.encryptedCard,holderName:card.holder,holderTaxId:taxId,installments:1};
}
function Sheet({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useDialogFocus(onClose); const {locale}=usePublicI18n();
  return <div className="fixed inset-0 z-[200] bg-black/80 sm:p-5 flex items-center justify-center"><div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="w-full max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[92dvh] flex flex-col min-h-0 overflow-hidden bg-[#121015] sm:rounded-3xl border border-white/10"><header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10 shrink-0"><h2 className="text-2xl font-bold">{title}</h2><button className="p-3 rounded-xl bg-white/5" onClick={onClose} aria-label={deliveryText(locale,'close')}><X/></button></header><div className="ios-touch-scroll min-h-0 flex-1 p-5 space-y-5">{children}</div></div></div>;
}
export function DeliveryView() {
  const {locale,catalogText}=usePublicI18n(); const d=(key:string)=>deliveryText(locale,key);
  const menu=useStore(s=>s.menu);
  const [config,setConfig]=useState<DeliveryConfig|null>(null), [error,setError]=useState('');
  const [cart,setCart]=useState<OrderItem[]>(loadCart), [product,setProduct]=useState<Product|null>(null);
  const [step,setStep]=useState<0|1|2|null>(null), [customer,setCustomer]=useState<Customer>(initialCustomer);
  const [quote,setQuote]=useState<DeliveryQuoteResult['quote']|null>(null), [card,setCard]=useState<Card>(emptyCard);
  const [busy,setBusy]=useState(false), [order,setOrder]=useState<DeliveryOrderSummary|null>(null), [showTracking,setShowTracking]=useState(false);
  const [accountOpen,setAccountOpen]=useState(false), [orders,setOrders]=useState<DeliveryOrderSummary[]>([]);
  const [signedIn,setSignedIn]=useState(!!storage.get(SESSION)), [copied,setCopied]=useState(false);
  const inFlight=useRef(false), orderId=order?.orderId || storage.get(LAST);
  const handleError=(e:unknown)=>setError(e instanceof Error && e.message.startsWith('delivery') ? e.message : 'error');
  useEffect(()=>{DeliveryApi.config().then(c=>{setConfig(c);if(!c.settings.pickupEnabled&&c.settings.deliveryEnabled)setCustomer(v=>({...v,fulfillment:'delivery'}));}).catch(()=>setError('error'));},[]);
  useEffect(()=>{storage.set(CART,JSON.stringify({time:Date.now(),items:cart}));},[cart]);
  useEffect(()=>{const id=storage.get(LAST); if(id) DeliveryApi.getOrder(id).then(r=>setOrder(r.order)).catch(()=>{});},[]);
  const refresh=useCallback(async()=>{if(!orderId)return; try {const r=await DeliveryApi.getOrder(orderId);setOrder(r.order);}catch{/* Retain last confirmed state. */}},[orderId]);
  useEffect(()=>{if(!order || ['delivered','abandoned','payment_failed','expired'].includes(order.deliveryStatus) || ['abandoned','payment_failed','expired','review'].includes(order.paymentStatus))return;const timer=setInterval(()=>void refresh(),8000);return()=>clearInterval(timer);},[order,refresh]);
  useEffect(()=>{if(order?.paymentStatus==='paid') {try {const attempt=JSON.parse(storage.get(ATTEMPT));if(attempt.orderId===order.orderId){setCart([]);storage.remove(ATTEMPT);}}catch{/* Historical payment must not erase a new cart. */}}},[order?.paymentStatus,order?.orderId]);
  const update=(key:keyof Customer,value:string|boolean)=>{setCustomer(c=>({...c,[key]:value}));if(['fulfillment','street','number','neighborhood','city','state','postalCode','complement','coupon'].includes(key))setQuote(null);setError('');};
  const add=(p:Product,quantity:number,selectedModifiers:Modifier[],notes='')=>{setCart(c=>[...c,{id:crypto.randomUUID(),productId:p.id,name:p.name,price:p.price,quantity,selectedModifiers,notes,status:'pending',orderedAt:new Date()}]);setQuote(null);};
  const field=(key:keyof Customer,type='text',required=true)=><label className="block min-w-0" key={key}><span className="block text-sm text-zinc-300 mb-2">{d(key)}</span><input className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-base focus:border-red-400 outline-none" name={key} type={type} required={required} value={String(customer[key]??'')} onChange={e=>update(key,e.target.value)} autoComplete={key==='name'?'name':key==='email'?'email':key==='phone'?'tel':key==='postalCode'?'postal-code':undefined}/></label>;
  const totals=quote || {subtotal:getOrderItemsTotal(cart),deliveryFee:0,discount:0,total:getOrderItemsTotal(cart)};
  const totalBlock=<div className="border-t border-white/10 pt-4 space-y-2"><div className="flex justify-between text-zinc-400"><span>{d('subtotal')}</span><span>{money(totals.subtotal)}</span></div><div className="flex justify-between text-zinc-400 gap-3"><span>{d('fee')}</span><span>{quote || customer.fulfillment==='pickup'?money(totals.deliveryFee):d('calculate')}</span></div>{totals.discount>0&&<div className="flex justify-between"><span>{d('discount')}</span><span>−{money(totals.discount)}</span></div>}<div className="flex justify-between text-2xl font-bold"><span>{d('total')}</span><span>{money(totals.total)}</span></div></div>;
  const action='min-h-12 px-5 py-3 rounded-xl font-bold bg-white text-red-700 border border-red-600 disabled:opacity-40';
  const errorBlock=error&&<p role="alert" className="p-4 rounded-xl bg-red-950 text-red-100">{d(error)}</p>;
  const checkout=async()=>{
    if(inFlight.current || !quote)return; inFlight.current=true;setBusy(true);setError('');
    try {
      let attempt:{orderId:string;requestKey:string};
      try{attempt=JSON.parse(storage.get(ATTEMPT));if(!attempt.orderId)throw Error();}catch{attempt={orderId:`delivery_${crypto.randomUUID()}`,requestKey:crypto.randomUUID()};storage.set(ATTEMPT,JSON.stringify(attempt));}
      const encryptedCard=customer.paymentMethod==='credit'&&config?.environment!=='simulation'?await encrypt(card,digits(customer.taxId||'')):null;
      const r=await DeliveryApi.checkout({...attempt,customer:{...customer,taxId:digits(customer.taxId||''),quoteId:quote.quoteId||''},items:cart,payment:encryptedCard?{card:encryptedCard}:undefined});
      storage.set(LAST,r.order.orderId);setOrder(r.order as DeliveryOrderSummary);setShowTracking(true);setStep(null);setCard(emptyCard);
    }catch(e){handleError(e);}finally{setBusy(false);inFlight.current=false;}
  };
  const changePayment=async()=>{if(!order || busy)return;setBusy(true);setError('');try {await DeliveryApi.changePayment(order.orderId);storage.remove(ATTEMPT);storage.remove(LAST);setShowTracking(false);setOrder(null);setQuote(null);setStep(1);setCustomer(c=>({...c,paymentMethod:'credit'}));}catch(e){handleError(e);}finally{setBusy(false);}};
  const loadOrders=async()=>{try{const r=await DeliveryApi.listCustomerOrders(storage.get(SESSION));setOrders(r.orders);}catch(e){handleError(e);}};
  return <div className="h-[100dvh] w-full min-w-0 overflow-hidden flex flex-col bg-[#100e13] text-white font-['Outfit']">
    <header className="shrink-0 px-4 py-3 flex items-center justify-between gap-3 border-b border-white/10"><div className="flex items-center gap-2 min-w-0"><Bike className="text-red-400 shrink-0"/><h1 className="text-lg sm:text-2xl font-bold truncate">{d('home')}</h1></div><PublicLanguageMenu/></header>
    {config?.environment==='simulation'&&<p className="px-4 py-2 text-sm bg-amber-950 text-amber-100">{d('demo')}</p>}
    {!config ? <p className="p-6">{error?d(error):d('working')}</p> : !config.openNow ? <div className="p-6 m-auto max-w-md text-center space-y-4"><Bike size={48} className="mx-auto text-red-400"/><h2 className="text-2xl">{d('closed')}</h2>{config.settings.pickupAddress&&<p>{config.settings.pickupAddress}</p>}{order&&<button className={action} onClick={()=>setShowTracking(true)}>{d('track')}</button>}</div> : <>
      <MenuCatalog onProductSelect={p=>{if(order && ['creating','unknown','payment_pending','review'].includes(order.paymentStatus)){setShowTracking(true);return;}setProduct(p);}} surface="delivery" navigationMode="continuous" presentation="compact-menu" constrainToParent/>
      <footer className="shrink-0 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-white/10 bg-[#100e13] flex flex-wrap gap-2 items-center justify-between">
        <button className="text-sm p-2 underline" onClick={()=>{setError('');setAccountOpen(true);if(signedIn)void loadOrders();}}>{d(signedIn?'orders':'login')}</button>
        {order&&<button className="text-sm p-2 underline" onClick={()=>setShowTracking(true)}>{d('track')}</button>}
        <button className={`${action} flex items-center gap-2`} disabled={!cart.length} onClick={()=>{setError('');if(order && ['creating','unknown','payment_pending','review'].includes(order.paymentStatus)){setShowTracking(true);return;}setStep(0);}}><ShoppingBag size={18}/>{cart.reduce((s,i)=>s+i.quantity,0)} · {money(getOrderItemsTotal(cart))}</button>
      </footer>
    </>}
    {product&&<ProductModal product={product} onClose={()=>setProduct(null)} onAddToCart={add} qrMobileFlow/>}
    {step!==null&&<Sheet title={d(['cart','address','payment'][step])} onClose={()=>{if(!busy)setStep(null);}}>
      <nav aria-label={d('cart')} className="flex gap-2 text-sm text-zinc-400">{['cart','address','payment'].map((key,i)=><span key={key} className={i===step?'text-white font-bold':''}>{i+1}. {d(key)}{i<2?' / ':''}</span>)}</nav>
      {errorBlock}
      {step===0&&<><div className="divide-y divide-white/10">{cart.map(item=>{const p=menu.find(p=>p.id===item.productId);return <article className="flex gap-3 py-4" key={item.id}>{p?.image&&<img className="w-20 h-20 rounded-xl object-cover shrink-0" src={getImageSrc(p.image)} onError={applyImageFallback} alt=""/>}<div className="min-w-0 flex-1"><h3 className="font-bold">{item.quantity}× {catalogText(item.productId,item.name,'name')}</h3><p>{money(getOrderItemTotal(item))}</p>{item.selectedModifiers?.map(m=><div className="flex items-center gap-2 text-sm mt-2" key={m.id}><ModifierThumbnail modifier={m} products={menu} name={catalogText(m.id,m.name,'name')} className="w-9 h-9 rounded-lg"/><span>{catalogText(m.id,m.name,'name')}</span></div>)}{item.notes&&<p className="text-sm text-zinc-400">{item.notes}</p>}</div><button aria-label={d('remove')} onClick={()=>{setCart(c=>c.filter(i=>i.id!==item.id));setQuote(null);}} className="p-2 self-start text-red-300"><Trash2 size={20}/></button></article>;})}</div>{!cart.length&&<p>{d('empty')}</p>}{totalBlock}<button className={`${action} w-full`} disabled={!cart.length} onClick={()=>setStep(1)}>{d('next')}</button></>}
      {step===1&&<form className="space-y-5" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const r=await DeliveryApi.quote({customer,items:cart});setQuote(r.quote);if(r.items)setCart(previous=>previous.map((item,i)=>({...item,...r.items![i],id:item.id})));setStep(2);}catch(e){handleError(e);}finally{setBusy(false);}}}>
        <p className="text-sm text-zinc-400">{d('guest')}</p><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{field('name')}{field('phone','tel')}{field('email','email')}</div>
        <div className="flex gap-3">{(['pickup','delivery'] as const).filter(mode=>mode==='pickup'?config?.settings.pickupEnabled:config?.settings.deliveryEnabled).map(mode=><button type="button" aria-pressed={customer.fulfillment===mode} key={mode} className={`${action} flex-1 ${customer.fulfillment===mode?'ring-2 ring-red-400':''}`} onClick={()=>update('fulfillment',mode)}>{d(mode)}</button>)}</div>
        {customer.fulfillment==='pickup'?<p className="text-zinc-300">{d('pickupAt')}: {config?.settings.pickupAddress}<br/>{config?.settings.preparationMinutes} {d('minutes')}</p>:<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{field('postalCode','text')}<button type="button" className={action} disabled={busy} onClick={async()=>{setBusy(true);try{const r=await DeliveryApi.lookupPostalCode(digits(customer.postalCode));if(r.postalCode.address)setCustomer(c=>({...c,...r.postalCode.address}));}catch(e){handleError(e);}finally{setBusy(false);}}}>{d('search')}</button>{field('street')}{field('number')}{field('neighborhood')}{field('city')}{field('state')}{field('complement','text',false)}{field('reference','text',false)}</div>}
        {field('notes','text',false)}{field('coupon','text',false)}{config?.settings.clubEnabled&&<label className="flex gap-3"><input type="checkbox" checked={customer.joinClub} onChange={e=>update('joinClub',e.target.checked)}/>{d('club')}</label>}
        <div className="flex gap-3"><button type="button" className="p-3" onClick={()=>setStep(0)}><ArrowLeft aria-label={d('back')}/></button><button className={`${action} flex-1`} disabled={busy}>{d(busy?'working':'next')}</button></div>
      </form>}
      {step===2&&<form className="space-y-5" onSubmit={e=>{e.preventDefault();void checkout();}}>{totalBlock}<p className="text-sm text-zinc-300">{d('cpfHint')}</p>{field('taxId')}
        <div className="grid grid-cols-2 gap-3">{(['pix','credit'] as const).map(method=><button type="button" key={method} aria-pressed={customer.paymentMethod===method} className={`${action} ${customer.paymentMethod===method?'ring-2 ring-red-400':''}`} onClick={()=>setCustomer(c=>({...c,paymentMethod:method}))}>{method==='pix'?<QrCode className="mx-auto mb-2"/>:<CreditCard className="mx-auto mb-2"/>}{d(method)}</button>)}</div>
        {customer.paymentMethod==='credit'&&config?.environment!=='simulation'&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{(['holder','number','expiry','cvv'] as const).map(key=><label key={key}><span className="block mb-2 text-sm">{d(key==='number'?'card':key)}</span><input required autoComplete={key==='holder'?'cc-name':key==='number'?'cc-number':key==='expiry'?'cc-exp':'cc-csc'} inputMode={key==='holder'?'text':'numeric'} type={key==='cvv'?'password':'text'} maxLength={key==='cvv'?4:key==='number'?23:key==='expiry'?7:100} value={card[key]} onChange={e=>setCard(c=>({...c,[key]:e.target.value}))} className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base"/></label>)}</div>}
        <p className="text-sm text-zinc-400">{d('secure')}</p><div className="flex gap-3"><button type="button" disabled={busy} className="p-3" onClick={()=>{setStep(1);setError('');}}><ArrowLeft aria-label={d('back')}/></button><button disabled={busy||!quote} className={`${action} flex-1`}>{d(busy?'working':customer.paymentMethod==='pix'?'generate':'pay')}</button></div>
      </form>}
    </Sheet>}
    {showTracking&&order&&<Sheet title={d('track')} onClose={()=>setShowTracking(false)}>{errorBlock}<p className="text-sm text-zinc-400 break-all">#{order.orderId.slice(-8)}</p><h3 className="text-2xl font-bold">{d(order.paymentStatus)}</h3><p className="text-3xl">{money(order.total)}</p>
      {order.paymentStatus==='paid'&&<><p>{d(order.kitchenStatus)}</p><p>{d(order.deliveryStatus)}</p></>}
      {order.paymentStatus==='payment_pending'&&order.paymentInstructions?.qrCodeText&&<>{order.paymentInstructions.qrCodeImage&&<img className="w-56 max-w-full mx-auto bg-white rounded-xl" src={order.paymentInstructions.qrCodeImage} alt="Pix QR code"/>}<textarea readOnly aria-label="Pix" className="w-full rounded-xl p-3 bg-white/5 text-sm break-all" value={order.paymentInstructions.qrCodeText}/><button className={`${action} w-full`} onClick={async()=>{try{await navigator.clipboard.writeText(order.paymentInstructions?.qrCodeText||'');setCopied(true);}catch{setError('error');}}}>{d(copied?'copied':'copy')}</button></>}
      <button className={`${action} w-full flex justify-center gap-2`} onClick={()=>void refresh()}><RefreshCw size={20}/>{d('refresh')}</button>
      {(['payment_failed','expired'].includes(order.paymentStatus)||(order.paymentStatus==='payment_pending'&&order.customer.paymentMethod==='pix'))&&<><p className="text-sm text-zinc-400">{d('changeHint')}</p><button disabled={busy} className={`${action} w-full`} onClick={()=>void changePayment()}>{d(order.paymentStatus==='payment_pending'?'change':'retry')}</button></>}
      {config?.environment==='simulation'&&order.paymentStatus==='payment_pending'&&<button className={`${action} w-full`} onClick={async()=>{try{const r=await DeliveryApi.simulate(order.orderId);setOrder(r.order);}catch(e){handleError(e);}}}>{d('simulate')}</button>}
    </Sheet>}
    {accountOpen&&<Sheet title={d(signedIn?'orders':'login')} onClose={()=>setAccountOpen(false)}>{errorBlock}{signedIn?<><button className={action} onClick={()=>void loadOrders()}>{d('refresh')}</button>{orders.map(o=><button key={o.orderId} className="w-full p-4 border-b border-white/10 flex justify-between" onClick={async()=>{try{const r=await DeliveryApi.getOrder(o.orderId);setOrder(r.order);setShowTracking(true);setAccountOpen(false);}catch(e){handleError(e);}}}><span>{new Date(o.createdAt).toLocaleDateString(locale)} · {d(o.paymentStatus)}</span><span>{money(o.total)}</span></button>)}<button className={action} onClick={()=>{storage.remove(SESSION);setSignedIn(false);setOrders([]);}}>{d('logout')}</button></>:<DeliveryAccountForm locale={locale} customer={customer} onLogin={(c,token)=>{storage.set(SESSION,token);setSignedIn(true);setCustomer(v=>({...v,name:c.name,email:c.email,phone:c.phone}));void loadOrders();}}/>}</Sheet>}
  </div>;
}
