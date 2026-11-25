import Stripe from 'npm:stripe@23.2.0';
import { webPaymentRoute, validWebAttempt, webCheckoutItems } from '../../../utils/web-payment-methods.ts';
import { toMinorUnits } from '../../../utils/commerce-rules.ts';
import { initializeGuestPaystack, reconcileGuestPaystack } from './guest-paystack.ts';
import { fulfillGuestSession } from './guest-fulfillment.ts';

const publicBase = () => (Deno.env.get('PUBLIC_EVENT_BASE_URL') || 'https://events.60secondsapp.io').replace(/\/$/, '');
const safeUrl = (url: unknown) => typeof url === 'string' && /^https:\/\/checkout\.(stripe|paystack)\.com\//.test(url);
export async function createWebEventCheckout(db: any, event: any, input: any) {
  let route, items, tables;
  try {
    route = webPaymentRoute(input.buyerRegion, event.currency, input.paymentMethod);
    if (!validWebAttempt(input.requestKey)) throw new Error('Invalid checkout attempt.');
    if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || input.email.length > 254) throw new Error('Enter a valid email address.');
    items = webCheckoutItems(input.items || [], 30);
    tables = webCheckoutItems(input.tables || [], 20);
    if (!items.length && !tables.length) throw new Error('Select tickets, products or table seats first.');
    if (['BHD','JOD','KWD','OMR','TND','ISK'].includes(String(event.currency).toUpperCase())) throw new Error('Checkout is unavailable for this event currency.');
  } catch (error) { return { status: 400, body: { error: error instanceof Error ? error.message : 'Invalid checkout request', reserved: false } }; }
  if (!Deno.env.get(route.provider === 'paystack' ? 'PAYSTACK_SECRET_KEY' : 'STRIPE_SECRET_KEY')) {
    return { status: 409, body: { error: 'The selected payment provider is unavailable.', reserved: false } };
  }
  const { data: attempt, error: reserveError } = await db.rpc('reserve_web_event_checkout', {
    event_key: event.id, buyer_email: input.email, requested_items: items, requested_tables: tables,
    request_key: input.requestKey, buyer_region: input.buyerRegion, payment_method: route.id,
  });
  if (reserveError || !attempt?.order) {
    const existing = await db.from('web_checkout_attempts').select('order_id').eq('request_key', input.requestKey).maybeSingle();
    return { status: 409, body: { error: 'Checkout could not be reserved. Check the basket, availability and any existing payment attempt.',
      ...(!existing.error && !existing.data ? { reserved: false } : {}) } };
  }
  if (attempt.state === 'paid') return { status: 200, body: { completed: true, requestKey: input.requestKey } };
  if (attempt.state !== 'reserved' || Date.parse(attempt.expiresAt) <= Date.now()) {
    return { status: 409, body: { error: 'This checkout has expired. Check payment status before starting another purchase.' } };
  }
  if (safeUrl(attempt.url)) return { status: 200, body: { url: attempt.url, provider: route.provider, requestKey: input.requestKey } };
  if (!attempt.fresh) return { status: 409, body: { error: 'This payment is being prepared or awaiting confirmation. Check payment status before trying again.' } };
  const order = attempt.order;
  // Fail closed if the database quote differs from the allowed payment currency.
  webPaymentRoute(input.buyerRegion, order.currency, route.id);
  const returnPath = `/web-event/${event.id}?attempt=${encodeURIComponent(input.requestKey)}`;
  let result: { url: string; provider: string };
  if (route.provider === 'paystack') {
    result = await initializeGuestPaystack(db, order, returnPath, route.channel);
  } else {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { maxNetworkRetries: 2 });
    const { data: owner, error: ownerError } = await db.from('profiles').select('stripe_connected_account_id').eq('id', order.business_id).maybeSingle();
    if (ownerError) throw ownerError;
    // Match mobile: connected sellers receive a destination charge; otherwise
    // collect on the platform and use the existing verified guest wallet ledger.
    let destination: string | undefined;
    if (owner?.stripe_connected_account_id) {
      const account = await stripe.accounts.retrieve(owner.stripe_connected_account_id);
      if (!account.charges_enabled || !account.payouts_enabled) throw new Error('Seller payments are not available yet.');
      destination = owner.stripe_connected_account_id;
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', allowed_payment_method_types: ['card'], customer_email: order.guest_email,
      client_reference_id: order.id, metadata: { guest_order_id: order.id },
      expires_at: Math.floor(Date.now() / 1000) + 1860,
      line_items: order.items.map((item: any) => ({ quantity: item.quantity, price_data: {
        currency: order.currency.toLowerCase(), unit_amount: toMinorUnits(item.price, order.currency), product_data: { name: item.name },
      } })),
      ...(destination ? { payment_intent_data: {
        application_fee_amount: toMinorUnits(order.total_amount - order.total_amount / 1.04, order.currency),
        transfer_data: { destination },
      } } : {}),
      success_url: `${publicBase()}${returnPath}&payment=processing`,
      cancel_url: `${publicBase()}${returnPath}&cancelled=1`,
    }, { idempotencyKey: `web-guest-${order.id}` });
    if (!safeUrl(session.url)) throw new Error('Invalid checkout URL');
    const { error } = await db.from('guest_checkouts').update({ provider: 'stripe', session_id: session.id, expires_at: new Date(session.expires_at * 1000).toISOString() }).eq('order_id', order.id);
    if (error) throw error;
    result = { url: session.url!, provider: 'stripe' };
  }
  const { error } = await db.from('web_checkout_attempts').update({ checkout_url: result.url }).eq('request_key', input.requestKey);
  if (error) throw error;
  return { status: 200, body: { ...result, requestKey: input.requestKey } };
}

/** Browser query parameters are never treated as proof of a successful payment. */
export async function webEventCheckoutStatus(db: any, eventId: unknown, key: unknown) {
  if (!validWebAttempt(key)) return { status: 400, body: { error: 'Invalid checkout attempt.' } };
  const { data: attempt, error } = await db.from('web_checkout_attempts').select('order_id,event_id,checkout_url').eq('request_key', key).maybeSingle();
  if (error) throw error;
  if (!attempt || attempt.event_id !== eventId) return { status: 404, body: { error: 'Checkout not found. Retry with the same checkout details.' } };
  const read = () => db.from('guest_checkouts').select('state,provider,session_id,expires_at,email_sent_at,tracking_code').eq('order_id', attempt.order_id).single();
  let { data: checkout, error: readError } = await read();
  if (readError || !checkout) throw readError || new Error('Checkout unavailable');
  if (checkout.state === 'reserved' && checkout.session_id) {
    try {
      if (checkout.provider === 'paystack') await reconcileGuestPaystack(db, checkout.session_id);
      else {
        const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { maxNetworkRetries: 2 });
        const session = await stripe.checkout.sessions.retrieve(checkout.session_id);
        if (session.metadata?.guest_order_id !== attempt.order_id) throw new Error('Checkout mismatch');
        if (session.payment_status === 'paid' || session.status === 'expired') await fulfillGuestSession(session, session.payment_status === 'paid');
      }
    } catch { /* Retain the durable state and allow server reconciliation to retry. */ }
    const refreshed = await read();
    if (refreshed.error || !refreshed.data) throw refreshed.error || new Error('Checkout unavailable');
    checkout = refreshed.data;
  }
  return { status: 200, body: {
    state: checkout.state, provider: checkout.provider, expiresAt: checkout.expires_at,
    emailSent: !!checkout.email_sent_at, trackingCode:checkout.tracking_code,
    url: checkout.state === 'reserved' && Date.parse(checkout.expires_at) > Date.now() && safeUrl(attempt.checkout_url) ? attempt.checkout_url : null,
  } };
}
