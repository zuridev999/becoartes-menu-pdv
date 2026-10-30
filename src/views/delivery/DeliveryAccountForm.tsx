import {useState} from 'react';
import {DeliveryApi, type DeliveryCheckoutInput, type DeliveryCustomerAccount} from '../../lib/api';
import {deliveryText} from './copy';

export function DeliveryAccountForm({locale,customer,onLogin}:{locale:string;customer:DeliveryCheckoutInput['customer'];onLogin:(customer:DeliveryCustomerAccount,token:string)=>void}) {
  const [mode,setMode]=useState<'login'|'register'|'verify'|'forgot'|'reset'>('login');
  const [values,setValues]=useState({identity:'',password:'',name:'',phone:'',code:''});
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const d=(key:string)=>deliveryText(locale,key);
  const keys=mode==='register'?['name','phone','identity','password']:mode==='verify'?['identity','code']:mode==='forgot'?['identity']:mode==='reset'?['identity','code','password']:['identity','password'];
  return <form className="space-y-4" onSubmit={async e=>{
    e.preventDefault();setBusy(true);setNotice('');
    try {
      if(mode==='register') { await DeliveryApi.registerCustomer({customer:{...customer,name:values.name,phone:values.phone,email:values.identity,joinClub:false},password:values.password});setMode('verify');setNotice('codeSent'); }
      else if(mode==='forgot') { await DeliveryApi.forgotPassword(values.identity);setMode('reset');setNotice('codeSent'); }
      else {
        const result=mode==='verify'?await DeliveryApi.verifyCustomerCode(values):mode==='reset'?await DeliveryApi.resetPassword(values):await DeliveryApi.loginCustomer(values);
        onLogin(result.customer,result.session.token);setValues(v=>({...v,password:'',code:''}));
      }
    } catch {setNotice('error');} finally {setBusy(false);}
  }}>
    <p className="text-sm text-zinc-400">{d('accountHint')}</p>
    {notice&&<p role="status">{d(notice)}</p>}
    {keys.map(key=><label className="block" key={key}>{d(key==='identity'?'email':key)}<input required type={key==='password'?'password':key==='identity'?'email':key==='phone'?'tel':'text'} minLength={key==='password'?6:undefined} autoComplete={key==='password'?(mode==='login'?'current-password':'new-password'):key==='code'?'one-time-code':undefined} value={values[key as keyof typeof values]} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))} className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base"/></label>)}
    <button disabled={busy} className="w-full bg-white text-red-700 font-bold rounded-xl p-3">{d(busy?'working':mode==='login'?'enter':mode==='forgot'?'next':mode)}</button>
    <div className="flex flex-wrap gap-4 text-sm">{(['login','register','forgot'] as const).filter(m=>m!==mode).map(m=><button type="button" className="underline p-2" key={m} onClick={()=>{setMode(m);setNotice('');}}>{d(m)}</button>)}</div>
  </form>;
}
