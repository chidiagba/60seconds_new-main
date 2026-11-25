import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsForRequest} from '../_shared/cors.ts';
Deno.serve(async req=>{
  const headers={...corsForRequest(req),'Content-Type':'application/json'};
  const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return respond({error:'Method not allowed'},405);
  try {
    const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),paystack=Deno.env.get('PAYSTACK_SECRET_KEY');
    if(!url||!key||!paystack)throw new Error('Missing funding configuration');
    const db=createClient(url,key,{auth:{persistSession:false}});
    const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]||'';
    const {data:auth,error}=await db.auth.getUser(token);
    if(error||!auth.user?.email)return respond({error:'Authentication required'},401);
    const payload=await req.json();
    // The order flow has a separate server-priced endpoint. Never accept order amounts here.
    const requestedType=payload.paymentType||payload.metadata?.paymentType;
    if(requestedType&&requestedType!=='wallet_funding')return respond({error:'Use server-priced order checkout',code:'CHECKOUT_UPGRADE_REQUIRED'},426);
    const amount=Number(payload.amount);
    if(!Number.isFinite(amount)||amount<100||amount>10000000||String(payload.currency||'NGN').toUpperCase()!=='NGN')return respond({error:'Enter a valid NGN funding amount (minimum 100)'},400);
    const {data:wallet,error:walletError}=await db.from('wallets').select('id,currency').eq('user_id',auth.user.id).single();
    if(walletError||wallet?.currency!=='NGN')return respond({error:'An NGN wallet is required'},409);
    let callback: string|undefined;
    if(payload.callback_url) {
      const candidate=new URL(payload.callback_url);
      const allowed=(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(s=>s.trim());
      if(candidate.protocol!=='https:'||candidate.username||candidate.password||!allowed.includes(candidate.origin))return respond({error:'Invalid callback URL'},400);
      callback=candidate.href;
    }
    const reference=`fund_${crypto.randomUUID().replaceAll('-','')}`;
    const kobo=Math.round(amount*100);
    const response=await fetch('https://api.paystack.co/transaction/initialize',{
      method:'POST',headers:{Authorization:`Bearer ${paystack}`,'Content-Type':'application/json'},
      body:JSON.stringify({email:auth.user.email,amount:kobo,currency:'NGN',reference,callback_url:callback,
        metadata:{paymentType:'wallet_funding',userId:auth.user.id,walletId:wallet.id,app_name:'60Seconds'}}),
      signal:AbortSignal.timeout(20000),
    });
    const result=await response.json();
    if(!response.ok||result.status!==true)return respond({success:false,error:'Funding provider unavailable'},502);
    return respond({success:true,data:{authorization_url:result.data.authorization_url,access_code:result.data.access_code,reference,amount_kobo:kobo,amount_ngn:kobo/100,rate:1,rate_source:'identity',original_amount:amount,original_currency:'NGN'}});
  }catch{return respond({success:false,error:'Funding service unavailable'},503);}
});
