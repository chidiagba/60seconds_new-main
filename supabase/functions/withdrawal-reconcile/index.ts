import { workerAuthorized } from '../_shared/worker-auth.ts';
import { processWithdrawal, withdrawalDatabase } from '../_shared/withdrawals.ts';
Deno.serve(async req=>{
  if(!await workerAuthorized(req,Deno.env.get('WITHDRAWAL_WORKER_SECRET'))) return new Response('Unauthorized',{status:401});
  const input=await req.json().catch(()=>({}));
  if(input.action==='health')return Response.json({ok:true});
  const db=withdrawalDatabase();
  const {data:holds,error}=await db.from('withdrawal_holds').select('*').eq('state','pending').order('updated_at').limit(3);
  if(error) return new Response('Queue unavailable',{status:503});
  let completed=0,unresolved=0;
  await Promise.all((holds||[]).map(async hold=>{
    try {await processWithdrawal(db,hold);completed++;} catch {
      unresolved++;
      // Rotate unresolved attempts so one provider outage cannot starve the queue.
      await db.from('withdrawal_holds').update({updated_at:new Date().toISOString()}).eq('reference',hold.reference).eq('state','pending');
    }
  }));
  return Response.json({checked:completed,unresolved});
});
