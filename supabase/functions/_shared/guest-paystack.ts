import { toMinorUnits } from '../../../utils/commerce-rules.ts';
import { fulfillGuestSession } from './guest-fulfillment.ts';

async function paystack(path: string, body?: unknown) {
  const key = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!key) throw new Error('Paystack payments are not configured');
  const response = await fetch(`https://api.paystack.co/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok || !result.status) throw new Error(result.message || 'Paystack is unavailable');
  return result.data;
}

export async function initializeGuestPaystack(db: any, order: any, returnPath: string) {
  const reference = `guest_paystack_${order.id}`;
  const fee = Number((order.total_amount - order.total_amount / 1.04).toFixed(2));
  const base = (Deno.env.get('PUBLIC_EVENT_BASE_URL') || 'https://events.60secondsapp.io').replace(/\/$/, '');
  // Persist the provider/reference before the network call, including uncertain timeouts.
  const { error: checkoutError } = await db.from('guest_checkouts').update({ provider: 'paystack', session_id: reference }).eq('order_id', order.id);
  if (checkoutError) throw checkoutError;
  const { error: orderError } = await db.from('orders').update({payment_method:'paystack',payment_provider:'paystack',payment_reference:reference,platform_fee:fee,subtotal:order.total_amount-fee}).eq('id',order.id);
  if (orderError) throw orderError;
  const { data: routes, error: routeError } = await db.from('business_bank_accounts').select('paystack_subaccount_code,metadata').eq('user_id',order.business_id).eq('is_active',true).order('updated_at',{ascending:false}).limit(20);
  if (routeError) console.warn('Paystack bank routing unavailable; checking legacy payout metadata:', routeError.message);
  let subaccount = (routes || []).map((r:any)=>r.paystack_subaccount_code || r.metadata?.business_bank_account?.paystack_subaccount_code || r.metadata?.business_bank_account?.paystackSubaccountCode || r.metadata?.paystack_subaccount_code || r.metadata?.paystackSubaccountCode).find(Boolean);
  if (!subaccount) {
    const {data: owner} = await db.auth.admin.getUserById(order.business_id);
    subaccount = owner?.user?.user_metadata?.business_bank_account?.paystack_subaccount_code || owner?.user?.user_metadata?.business_bank_account?.paystackSubaccountCode || owner?.user?.user_metadata?.paystack_subaccount_code || owner?.user?.user_metadata?.paystackSubaccountCode;
  }
  const initialized = await paystack('transaction/initialize', {
    reference, email: order.guest_email, amount: toMinorUnits(order.total_amount,order.currency), currency: order.currency,
    callback_url: `${base}${returnPath}${returnPath.includes('?') ? '&' : '?'}payment=processing`,
    metadata: { guest_order_id: order.id, orderId: order.id, paymentType: 'guest_booking' },
    ...(subaccount ? {subaccount, transaction_charge:toMinorUnits(fee,order.currency),bearer:'account'} : {}),
  });
  if (!/^https:\/\/checkout\.paystack\.com\//.test(initialized.authorization_url || '')) throw new Error('Invalid Paystack checkout URL');
  return { url: initialized.authorization_url, provider: 'paystack' };
}

/** Re-query Paystack; browser redirects and webhook metadata never prove payment. */
export async function reconcileGuestPaystack(db: any, reference: string): Promise<Response> {
  if (!/^guest_paystack_[0-9a-f-]{36}$/.test(reference)) throw new Error('Invalid booking reference');
  const id = reference.slice('guest_paystack_'.length);
  const {data: checkout,error} = await db.from('guest_checkouts').select('*').eq('order_id',id).eq('provider','paystack').eq('session_id',reference).single();
  if (error || !checkout) throw new Error('Booking checkout not found');
  let transaction;
  try { transaction = await paystack(`transaction/verify/${encodeURIComponent(reference)}`); }
  catch(error) {
    if (checkout.state === 'reserved' && Date.now() >= Date.parse(checkout.expires_at) && /transaction.*(not found|does not exist)|invalid.*reference/i.test(String(error.message))) {
      return fulfillGuestSession({id:reference,metadata:{guest_order_id:id}},false);
    }
    throw error;
  }
  if (transaction.reference !== reference || transaction.metadata?.guest_order_id !== id) throw new Error('Paystack booking reference mismatch');
  const session = {id:reference,metadata:{guest_order_id:id},amount_total:transaction.amount,currency:String(transaction.currency).toLowerCase()};
  if (transaction.status !== 'success') {
    if (checkout.state === 'reserved' && Date.now() >= Date.parse(checkout.expires_at) && !['pending','processing','ongoing','queued'].includes(transaction.status)) return fulfillGuestSession(session,false);
    return new Response('Payment pending');
  }
  const {data: order,error: orderError} = await db.from('orders').select('*').eq('id',id).single();
  if (orderError || !order || transaction.amount !== toMinorUnits(order.total_amount,order.currency) || transaction.currency !== order.currency) throw new Error('Paystack payment amount mismatch');
  // Expired Paystack links can still accept a late payment. Never allocate an
  // already released table: refund the verified transaction instead.
  if (checkout.state === 'released') {
    if (checkout.refund_id) return new Response('Refund already requested');
    const {error: markError} = await db.from('guest_checkouts').update({refund_pending:true}).eq('order_id',id);
    if (markError) throw markError;
    const refunds = await paystack(`refund?transaction=${encodeURIComponent(transaction.id)}`);
    const existing = refunds.find((r:any)=>Number(r.amount) === transaction.amount && !['failed','cancelled'].includes(r.status));
    const refund = existing || await paystack('refund',{transaction:reference,amount:transaction.amount,customer_note:'Your table checkout expired before payment completed. Your payment is being refunded.'});
    const {error: refundError} = await db.from('guest_checkouts').update({refund_id:String(refund.id),refund_pending:false}).eq('order_id',id);
    if (refundError) throw refundError;
    return new Response('Refund requested');
  }
  const {error: finishError} = await db.rpc('finish_guest_order',{order_key:id,paid:true,session_key:reference});
  if (finishError) throw finishError;
  const {data: settled} = await db.from('guest_checkouts').select('state').eq('order_id',id).single();
  if (settled?.state === 'paid') {
    const gross = Number(order.total_amount), net = Number((gross/1.04).toFixed(2));
    const {error: ledgerError} = await db.rpc('finalize_paystack_ledger',{
      p_order_id:id,p_reference:reference,p_transaction_id:String(transaction.id),p_owner_id:order.business_id,p_buyer_id:order.user_id,
      p_gross:gross,p_net:net,p_fee:Number((gross-net).toFixed(2)),p_currency:order.currency,p_metadata:{items:order.items},
    });
    if (ledgerError) throw ledgerError;
  }
  // Handle expiry racing a verified payment by rechecking the settled state.
  if (settled?.state === 'released') return reconcileGuestPaystack(db,reference);
  return fulfillGuestSession(session,true);
}
