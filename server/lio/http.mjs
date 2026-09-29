import { assertSameOrigin, readJsonBody, sendJson } from '../http.mjs';
import { fail } from './domain.mjs';

export function createLioHandler({ service, getSessionFromRequest, isAdminSession, enabled }) {
  const attempts = new Map();
  function throttle(key) {
    const minute = Math.floor(Date.now()/60000);
    if (attempts.size>10000) attempts.clear();
    const entry=attempts.get(key);
    const next=entry?.minute===minute?entry:{minute,count:0};
    next.count++; attempts.set(key,next);
    if(next.count>20) fail('Aguarde um minuto antes de tentar novamente.',429);
  }
  return async (req,res,url) => {
    if(!url.pathname.startsWith('/api/lio/')) return false;
    try {
      if(!enabled) fail('Aplicativo LIO ainda não ativado neste servidor.',503);
      assertSameOrigin(req);
      const route=url.pathname.slice('/api/lio/'.length);
      if(!['GET','POST'].includes(req.method)) fail('Método não permitido.',405);
      const body=req.method==='POST'?await readJsonBody(req,{maxBytes:100000}):{};
      let result;
      if(route.startsWith('admin/')) {
        const admin=getSessionFromRequest(req);
        if(!admin || !await isAdminSession(admin)) fail('Somente superadmin do PDV.',403);
        if(route==='admin/state' && req.method==='GET') result=await service.adminState();
        else if(route==='admin/enroll' && req.method==='POST') result=await service.enrollDevice(body.terminal,admin);
        else if(route==='admin/operator' && req.method==='POST') result=await service.setOperator(body.sellerId,body.pin,admin);
        else if(route==='admin/revoke' && req.method==='POST') result=await service.revoke(body.kind,body.id,admin);
        else if(route==='admin/cancel-pending' && req.method==='POST') result=await service.cancelPending(body.id,body.reason,admin);
        else fail('Rota não encontrada.',404);
      } else if(route==='activate' && req.method==='POST') {
        throttle('activate:'+req.socket.remoteAddress);
        result=await service.activate(body.code);
      } else if(route==='login' && req.method==='POST') {
        throttle('login:'+String(req.headers['x-lio-device']||''));
        result=await service.login(req.headers['x-lio-device'],body.pin);
      } else {
        const session=String(req.headers['x-lio-session']||'');
        const ctx=await service.authenticate(String(req.headers['x-lio-device']||''),session);
        if(req.method==='GET' && route==='tables') result=await service.tables(ctx);
        else if(req.method==='GET' && route==='catalog') result=await service.catalog();
        else if(req.method==='GET' && route==='payments/pending') result=await service.pending(ctx);
        else if(req.method==='GET' && route==='quote') result=await service.quote(url.searchParams.get('tableId'),ctx);
        else if(req.method==='POST' && route==='orders') result=await service.order(body,ctx);
        else if(req.method==='POST' && route==='payments/prepare') result=await service.prepare(body,ctx);
        else if(req.method==='POST' && route==='payments/settle') result=await service.settle(body,ctx);
        else if(req.method==='POST' && route==='finish') result=await service.finish(body,ctx);
        else if(req.method==='POST' && route==='logout') result=await service.logout(session);
        else fail('Rota não encontrada.',404);
      }
      sendJson(res,200,result);
    } catch(error) {
      const status=Number(error.statusCode)||500;
      if(status===500) console.error('[lio] request failed',error.code||error.name);
      sendJson(res,status,{error:status===500?'Não foi possível concluir. Atualize ou consulte a operação pendente.':error.message});
    }
    return true;
  };
}
