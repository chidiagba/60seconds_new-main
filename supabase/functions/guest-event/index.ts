import { createWebEventCheckout, webEventCheckoutStatus } from '../_shared/web-event-checkout.ts';
import { corsForRequest } from '../_shared/cors.ts';
import { initializeGuestPaystack } from '../_shared/guest-paystack.ts';
import { eventShareExpired, toMinorUnits } from '../../../utils/commerce-rules.ts';
import { resolveEventCurrency } from '../../../utils/country-currency.ts';
import Stripe from 'npm:stripe@23.2.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async req => {
  const headers = corsForRequest(req);
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' },405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const input = await req.json();
    if (input.action === 'checkout-status') {
      const result = await webEventCheckoutStatus(db, input.eventId, input.requestKey);
      return reply(result.body, result.status);
    }
    if (input.action === 'deals') {
      const size = input.limit ?? 60;
      const offset = input.offset ?? 0;
      if (!Number.isInteger(size) || size < 1 || size > 100 || !Number.isInteger(offset) || offset < 0) {
        return reply({ error: 'Invalid page' }, 400);
      }
      const { data, error } = await db.rpc('public_deals_events', { page_size: size, page_offset: offset });
      if (error) throw error;
      return reply(data);
    }
    if (input.action === 'venue-checkout') {
      const token = req.headers.get('authorization')?.replace(/^Bearer /i, '');
      const { data: auth, error: authError } = await db.auth.getUser(token || '');
      if (authError || !auth.user) return reply({error:'Sign in to book a table'},401);
      const {data: table} = await db.from('venue_tables').select('venue_id,currency').eq('id',input.tableId).eq('is_active',true).single();
      if (!table) return reply({error:'Table unavailable'},404);
      if (['BHD','JOD','KWD','OMR','TND','ISK'].includes(String(table.currency).toUpperCase())) return reply({error:'Checkout is unavailable for this currency'},409);
      if (String(table.currency).toUpperCase() === 'NGN') {
        if (!Deno.env.get('PAYSTACK_SECRET_KEY')) return reply({error:'Paystack payments are unavailable'},409);
        const {data: order,error: reserveError} = await db.rpc('reserve_venue_order',{table_key:input.tableId,guest_key:auth.user.id,arrival:input.startsAt,party:input.partySize,buyer_name:input.name,buyer_email:input.email,note:input.note || null});
        if (reserveError) return reply({error:'Request could not be completed'},400);
        return reply(await initializeGuestPaystack(db,order,`/tables/venue?venueId=${table.venue_id}`));
      }
      const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {maxNetworkRetries:2});
      const {data: owner} = await db.from('profiles').select('stripe_connected_account_id').eq('id',table.venue_id).single();
      if (!owner?.stripe_connected_account_id) return reply({error:'This business has not enabled payments yet'},409);
      const account = await stripe.accounts.retrieve(owner.stripe_connected_account_id);
      if (!account.charges_enabled || !account.payouts_enabled) return reply({error:'Business payments are unavailable'},409);
      const {data: order,error: reserveError} = await db.rpc('reserve_venue_order',{table_key:input.tableId,guest_key:auth.user.id,arrival:input.startsAt,party:input.partySize,buyer_name:input.name,buyer_email:input.email,note:input.note || null});
      if (reserveError) return reply({error:'Request could not be completed'},400);
      const base = (Deno.env.get('PUBLIC_EVENT_BASE_URL') || 'https://events.60secondsapp.io').replace(/\/$/,'');
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create({mode:'payment',allowed_payment_method_types:['card'],customer_email:order.guest_email,
          client_reference_id:order.id,metadata:{guest_order_id:order.id},expires_at:Math.floor(Date.now()/1000)+1800,
          line_items:order.items.map((i:any)=>({quantity:i.quantity,price_data:{currency:order.currency.toLowerCase(),unit_amount:toMinorUnits(i.price,order.currency),product_data:{name:i.name}}})),
          payment_intent_data:{application_fee_amount:toMinorUnits(order.total_amount-order.total_amount/1.04,order.currency),transfer_data:{destination:owner.stripe_connected_account_id}},
          success_url:`${base}/tables/venue?venueId=${table.venue_id}&purchased=1`,cancel_url:`${base}/tables/venue?venueId=${table.venue_id}&cancelled=1`,
        },{idempotencyKey:`guest-${order.id}`});
      } catch(error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError) await db.rpc('finish_guest_order',{order_key:order.id,paid:false,session_key:''});
        throw error;
      }
      const {error: saveError} = await db.from('guest_checkouts').update({session_id:session.id}).eq('order_id',order.id);
      if (saveError) throw saveError;
      return reply({url:session.url});
    }
    if (!/^[0-9a-f-]{36}$/i.test(input.eventId || '')) return reply({ error: 'Invalid event' },400);
    const { data: event, error } = await db.from('events').select('id,event_name,description,image_url,start_date,end_date,location_name,currency,business_id,user_id,status,video:videos!events_video_id_fkey(video_url,thumbnail_url)').eq('id',input.eventId).eq('is_public',true).single();
    if (error || !event || !['published','open','completed','closed'].includes(event.status)) return reply({ error: 'Event unavailable' },404);
    const expiry = Date.parse(event.end_date || event.start_date) + 48*60*60*1000;
    if (eventShareExpired(event.end_date,event.start_date)) return reply({ error: 'This event link has expired' },410);
    const { data: products, error: productError } = await db.from('products').select('id,name,description,price,currency,type,image_url,available_quantity').eq('event_id',event.id).eq('is_active',true).gt('price',0);
    if (productError) throw productError;
    event.currency = resolveEventCurrency(products || [], event.currency);
    const video = Array.isArray(event.video) ? event.video[0] : event.video;
    event.image_url ||= video?.thumbnail_url;
    const { data: tables, error: tableError } = await db.rpc('event_table_inventory', { event_key: event.id });
    if (tableError) throw tableError;
    if (input.action !== 'checkout') return reply({ event, products: products || [], tables: tables || [], expiresAt: new Date(expiry).toISOString() });
    if (input.paymentMethod || input.buyerRegion || input.requestKey) {
      const result = await createWebEventCheckout(db, event, input);
      return reply(result.body, result.status);
    }
    if (['BHD','JOD','KWD','OMR','TND','ISK'].includes(String(event.currency).toUpperCase())) return reply({error:'Web checkout is not available for this currency yet'},409);
    if (String(event.currency).toUpperCase() === 'NGN') {
      if (!Deno.env.get('PAYSTACK_SECRET_KEY')) return reply({error:'Paystack payments are unavailable'},409);
      const {data: order,error: reserveError} = await db.rpc('reserve_event_order',{event_key:event.id,buyer_email:String(input.email || '').trim(),requested_items:input.items || [],requested_tables:input.tables || []});
      if (reserveError) return reply({error:'Request could not be completed'},400);
      return reply(await initializeGuestPaystack(db,order,`/web-event/${event.id}`));
    }
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { maxNetworkRetries: 2 });
    const ownerId = event.business_id || event.user_id;
    const { data: owner } = await db.from('profiles').select('stripe_connected_account_id').eq('id',ownerId).single();
    if (!owner?.stripe_connected_account_id) return reply({ error: 'This seller has not enabled web payments yet' },409);
    const account = await stripe.accounts.retrieve(owner.stripe_connected_account_id);
    if (!account.charges_enabled || !account.payouts_enabled) return reply({ error: 'Seller payments are not available yet' },409);
    const { data: order, error: reserveError } = await db.rpc('reserve_event_order',{ event_key: event.id, buyer_email: String(input.email || '').trim(), requested_items: input.items || [], requested_tables: input.tables || [] });
    if (reserveError) return reply({ error: 'Request could not be completed' },400);
    let session: Stripe.Checkout.Session;
    try {
      const base = (Deno.env.get('PUBLIC_EVENT_BASE_URL') || 'https://events.60secondsapp.io').replace(/\/$/,'');
      session = await stripe.checkout.sessions.create({ mode:'payment',allowed_payment_method_types:['card'],customer_email:order.guest_email,
        client_reference_id:order.id,metadata:{guest_order_id:order.id},expires_at:Math.floor(Date.now()/1000)+1800,
        line_items:order.items.map((i: any) => ({ quantity:i.quantity,price_data:{currency:order.currency.toLowerCase(),unit_amount:toMinorUnits(i.price,order.currency),product_data:{name:i.name}} })),
        payment_intent_data:{application_fee_amount:toMinorUnits(order.total_amount-order.total_amount/1.04,order.currency),transfer_data:{destination:owner.stripe_connected_account_id}},
        success_url:`${base}/web-event/${event.id}?purchased=1`,cancel_url:`${base}/web-event/${event.id}?cancelled=1`,
      },{idempotencyKey:`guest-${order.id}`});
    } catch (error) {
      // A timeout may occur after Stripe accepted the session. Keep that reservation
      // until reconciliation rather than releasing stock for a potentially paid order.
      if (error instanceof Stripe.errors.StripeInvalidRequestError) await db.rpc('finish_guest_order',{order_key:order.id,paid:false,session_key:''});
      throw error;
    }
    const { error: saveError } = await db.from('guest_checkouts').update({session_id:session.id}).eq('order_id',order.id);
    if (saveError) throw saveError;
    return reply({ url:session.url });
  } catch (error) {
    console.error('Guest checkout failed',error);
    return reply({ error: 'Unable to complete checkout. Please try again.' },500);
  }
});
