import {corsForRequest} from '../_shared/cors.ts';
Deno.serve(req=>{
 const headers={...corsForRequest(req),'Content-Type':'application/json'};
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 return new Response(JSON.stringify({error:'Client-priced checkout is retired. Update the app and use stripe-create-checkout with items.',code:'CHECKOUT_UPGRADE_REQUIRED'}),{status:426,headers});
});
