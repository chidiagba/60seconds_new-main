import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe';
import { corsForRequest } from './cors.ts';
import { currencyDigits } from '../../../utils/commerce-rules.ts';

type Hold = {
  reference: string; user_id: string; amount: number; currency: string;
  provider: 'paystack' | 'stripe'; state: string; created_at: string;
  destination: {recipient: string; connected_account: string; external_account: string};
  provider_data: {transfer_id?: string; payout_id?: string}; alreadyReserved?: boolean;
};
type Database = ReturnType<typeof withdrawalDatabase>;
export function withdrawalDatabase() {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing withdrawal configuration');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function save(db: Database, hold: Hold, state: string, data: Record<string,unknown> = {}) {
  const {error} = await db.rpc('finish_withdrawal',{p_reference:hold.reference,p_state:state,p_data:data});
  if(error) throw error;
}
async function paystack(path: string, body?: Record<string,unknown>) {
  const key = Deno.env.get('PAYSTACK_SECRET_KEY');
  if(!key) throw new Error('Missing Paystack configuration');
  const response = await fetch(`https://api.paystack.co/${path}`,{
    method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if(!response.ok || result.status!==true) throw new Error('Provider result uncertain');
  return result.data;
}
/** All exceptions leave the hold intact. Only verified terminal results release it. */
export async function processWithdrawal(db: Database, hold: Hold, initiate = false) {
  if(hold.state!=='pending') return hold.state;
  const amount = Math.round(Number(hold.amount)*10**currencyDigits(hold.currency));
  if(hold.provider==='paystack') {
    const transfer = initiate
      ? await paystack('transfer',{source:'balance',amount,recipient:hold.destination.recipient,reference:hold.reference,reason:'Wallet withdrawal'})
      : await paystack(`transfer/verify/${encodeURIComponent(hold.reference)}`);
    const recipient = typeof transfer.recipient==='string'?transfer.recipient:transfer.recipient?.recipient_code;
    if(transfer.reference!==hold.reference || Number(transfer.amount)!==amount || String(transfer.currency).toUpperCase()!==hold.currency.toUpperCase() || recipient!==hold.destination.recipient) throw new Error('Provider transfer mismatch');
    const state=transfer.status==='success'?'completed':['failed','reversed'].includes(transfer.status)?transfer.status:'pending';
    await save(db,hold,state,{transfer_id:String(transfer.transfer_code),provider_status:transfer.status});
    return state;
  }
  const key=Deno.env.get('STRIPE_SECRET_KEY');
  if(!key) throw new Error('Missing Stripe configuration');
  const stripe=new Stripe(key,{maxNetworkRetries:1,timeout:20000});
  // Stripe expires idempotency keys after 24h. Uncertain older attempts require operator investigation.
  const canCreate=Date.now()-Date.parse(hold.created_at)<23*3600000;
  let transfer;
  if(hold.provider_data.transfer_id) transfer=await stripe.transfers.retrieve(hold.provider_data.transfer_id);
  else {
    if(!canCreate) throw new Error('Withdrawal requires provider investigation');
    transfer=await stripe.transfers.create({amount,currency:hold.currency.toLowerCase(),destination:hold.destination.connected_account,metadata:{reference:hold.reference}}, {idempotencyKey:`${hold.reference}_transfer`});
    await save(db,hold,'pending',{transfer_id:transfer.id});
  }
  if(transfer.amount!==amount || transfer.destination!==hold.destination.connected_account) throw new Error('Stripe transfer mismatch');
  if(transfer.reversed) { await save(db,hold,'reversed',{transfer_id:transfer.id}); return 'reversed'; }
  let payout;
  if(hold.provider_data.payout_id) payout=await stripe.payouts.retrieve(hold.provider_data.payout_id,{}, {stripeAccount:hold.destination.connected_account});
  else {
    if(!canCreate) throw new Error('Withdrawal requires provider investigation');
    payout=await stripe.payouts.create({amount,currency:hold.currency.toLowerCase(),destination:hold.destination.external_account,metadata:{reference:hold.reference}}, {stripeAccount:hold.destination.connected_account,idempotencyKey:`${hold.reference}_payout`});
    await save(db,hold,'pending',{transfer_id:transfer.id,payout_id:payout.id});
  }
  if(payout.amount!==amount || payout.destination!==hold.destination.external_account) throw new Error('Stripe payout mismatch');
  if(['failed','canceled'].includes(payout.status)) {
    // Recover platform funds before returning the wallet hold.
    const reversal=await stripe.transfers.createReversal(transfer.id,{}, {idempotencyKey:`${hold.reference}_reverse`});
    if(reversal.amount!==amount) throw new Error('Incomplete transfer reversal');
    await save(db,hold,'reversed',{transfer_id:transfer.id,payout_id:payout.id});
    return 'failed';
  }
  const state=payout.status==='paid'?'completed':'pending';
  await save(db,hold,state,{transfer_id:transfer.id,payout_id:payout.id});
  return state;
}
export function withdrawalHandler(provider: 'paystack'|'stripe') {
  return async (req: Request): Promise<Response> => {
    const headers={...corsForRequest(req),'Content-Type':'application/json'};
    const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(req.method==='OPTIONS') return new Response('ok',{headers});
    if(req.method!=='POST') return respond({error:'Method not allowed'},405);
    try {
      const db=withdrawalDatabase();
      const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if(!token) return respond({error:'Authentication required'},401);
      const {data:auth,error:authError}=await db.auth.getUser(token);
      if(authError || !auth.user) return respond({error:'Authentication required'},401);
      let payload;
      try {payload=await req.json();} catch {return respond({error:'Invalid JSON'},400);}
      const amount=Number(payload.amount);
      const bank=String(payload.businessBankAccountId||'');
      const key=String(payload.idempotencyKey||payload.withdrawalRequestId||'');
      const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if(!Number.isFinite(amount)||amount<=0||!uuid.test(bank)||!uuid.test(key)) return respond({error:'Valid amount, saved bank account and idempotency key required'},400);
      const {data:hold,error}=await db.rpc('reserve_withdrawal',{p_user:auth.user.id,p_amount:amount,p_bank:bank,p_provider:provider,p_key:key});
      if(error) return respond({success:false,error:'Withdrawal unavailable: check balance, currency and verified bank account'},409);
      let state=hold.state;
      // A replay must verify the original transfer, never create another one.
      try {state=await processWithdrawal(db,hold,!hold.alreadyReserved);} catch {return respond({success:true,status:'pending',reference:hold.reference,withdrawalTransactionId:hold.transaction_id},202);}
      return respond({success:!['failed','reversed'].includes(state),status:state,reference:hold.reference,withdrawalTransactionId:hold.transaction_id},state==='pending'?202:['failed','reversed'].includes(state)?422:200);
    } catch {return respond({success:false,error:'Withdrawal service unavailable'},503);}
  };
}
