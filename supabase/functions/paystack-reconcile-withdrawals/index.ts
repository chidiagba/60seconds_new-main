import { withdrawalDatabase, processWithdrawal } from '../_shared/withdrawals.ts';
import { corsForRequest } from '../_shared/cors.ts';
Deno.serve(async req=>{
 const headers={...corsForRequest(req),'Content-Type':'application/json'};
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 try{
  const db=withdrawalDatabase();
  const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]||'';
  const {data:auth,error}=await db.auth.getUser(token);
  if(error||!auth.user)return new Response('Unauthorized',{status:401,headers});
  const {data:holds,error:queryError}=await db.from('withdrawal_holds').select('*').eq('user_id',auth.user.id).eq('state','pending').limit(20);
  if(queryError)throw queryError;
  let completed=0,unchanged=0;
  for(const hold of holds||[]) {
   try{if(await processWithdrawal(db,hold)==='completed')completed++;else unchanged++;}catch{unchanged++;}
  }
  return new Response(JSON.stringify({success:true,completed,unchanged}),{headers});
 }catch{return new Response('Reconciliation unavailable',{status:503,headers});}
});
