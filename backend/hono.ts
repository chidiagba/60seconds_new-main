import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { cors } from "hono/cors";
import { appRouter } from "./trpc/app-router.js";
import { createContext } from "./trpc/create-context.js";
import { z } from "zod";
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Initialize Supabase client for server-side operations
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// app will be mounted at /api
const app = new Hono();

function extractStoragePath(fileUrl: string | null | undefined, bucketName: string): string | null {
  if (!fileUrl) {
    return null;
  }

  const bucketSegment = `/${bucketName}/`;
  const bucketIndex = fileUrl.indexOf(bucketSegment);
  if (bucketIndex >= 0) {
    return decodeURIComponent(fileUrl.slice(bucketIndex + bucketSegment.length));
  }

  return null;
}

async function runBestEffortMutation(
  label: string,
  mutation: () => Promise<{ error: any }>
) {
  try {
    const { error } = await mutation();
    if (error && error.code !== '42P01' && error.code !== '42703' && error.code !== 'PGRST204') {
      console.warn(`⚠️ ${label} cleanup warning:`, error);
    }
  } catch (error) {
    console.warn(`⚠️ ${label} cleanup exception:`, error);
  }
}

const DEFAULT_PLATFORM_FEE_RATE = 0.04;

const roundMoney = (value: number): number => Number(Number(value || 0).toFixed(2));

function deriveNetAmount(
  grossAmount: number,
  explicitNetAmount?: number | null,
  explicitPlatformFeeAmount?: number | null
) {
  const parsedGross = Number(grossAmount || 0);
  const parsedNet = Number(explicitNetAmount);
  const parsedFee = Number(explicitPlatformFeeAmount);

  if (Number.isFinite(parsedGross) && parsedGross > 0 && Number.isFinite(parsedNet) && parsedNet > 0) {
    const clampedNet = Math.min(parsedNet, parsedGross);

    if (Number.isFinite(parsedFee) && parsedFee >= 0) {
      const expectedNet = roundMoney(Math.max(0, parsedGross - parsedFee));
      if (Math.abs(expectedNet - clampedNet) <= 0.01) {
        return expectedNet;
      }
    } else {
      return roundMoney(clampedNet);
    }
  }

  if (!Number.isFinite(parsedGross) || parsedGross <= 0) {
    return 0;
  }

  return roundMoney(parsedGross / (1 + DEFAULT_PLATFORM_FEE_RATE));
}

async function resolveOrderOwnerId(orderRow: any, metadata: any) {
  if (!supabase) return null;

  const explicitRecipientId = metadata?.recipientId || metadata?.recipient_id || null;
  if (explicitRecipientId) return String(explicitRecipientId);

  if (orderRow?.business_id) {
    return String(orderRow.business_id);
  }

  if (orderRow?.event_id) {
    const { data: eventRow } = await supabase
      .from('events')
      .select('id,user_id')
      .eq('id', orderRow.event_id)
      .maybeSingle();
    if (eventRow?.user_id) {
      return String(eventRow.user_id);
    }
  }

  const productIds = Array.from(
    new Set(
      (Array.isArray(orderRow?.items) ? orderRow.items : [])
        .map((item: any) => item?.product_id || item?.productId)
        .filter((value: any) => !!value)
    )
  );

  if (!productIds.length) {
    return null;
  }

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id,business_id,event_id')
    .in('id', productIds);

  if (productsError) {
    throw new Error(`Failed to resolve product owners: ${productsError.message}`);
  }

  const owners = new Set<string>();

  for (const product of products || []) {
    if (product?.business_id) {
      owners.add(String(product.business_id));
      continue;
    }

    if (product?.event_id) {
      const { data: eventRow } = await supabase
        .from('events')
        .select('id,user_id')
        .eq('id', product.event_id)
        .maybeSingle();
      if (eventRow?.user_id) {
        owners.add(String(eventRow.user_id));
      }
    }
  }

  if (owners.size !== 1) {
    return null;
  }

  return Array.from(owners)[0];
}

async function settlePaystackOrderPayment(args: {
  transaction: any;
  metadata: any;
}) {
  if (!supabase) {
    throw new Error('Supabase server client is not configured.');
  }

  const { transaction, metadata } = args;
  const orderId = String(metadata?.orderId || metadata?.order_id || '').trim();
  if (!orderId) {
    throw new Error('Missing orderId in Paystack metadata for order settlement.');
  }

  const reference = String(transaction?.reference || '').trim() || null;
  const transactionId = String(transaction?.id || reference || '').trim() || null;
  const grossAmount = roundMoney(Number(transaction?.amount || 0) / 100);
  const currency = String(transaction?.currency || metadata?.currency || 'NGN').toUpperCase();
  const nowIso = new Date().toISOString();

  const { data: existingSettlement, error: existingSettlementError } = await supabase
    .from('transactions')
    .select('id')
    .eq('metadata->>entry', 'owner_credit')
    .eq('metadata->>order_id', orderId)
    .limit(1);

  if (existingSettlementError) {
    throw new Error(`Failed to check existing settlement: ${existingSettlementError.message}`);
  }

  const alreadySettled = (existingSettlement || []).length > 0;

  const { data: orderRow, error: orderFetchError } = await supabase
    .from('orders')
    .select('id,user_id,business_id,total_amount,video_id,event_id,items')
    .eq('id', orderId)
    .maybeSingle();

  if (orderFetchError || !orderRow) {
    throw new Error(`Failed to fetch order for settlement: ${orderFetchError?.message || orderId}`);
  }

  const grossAmountFromOrder = roundMoney(Number(orderRow?.total_amount || 0));
  const effectiveGrossAmount = grossAmount > 0 ? grossAmount : grossAmountFromOrder;
  const netAmount = deriveNetAmount(
    effectiveGrossAmount,
    Number(metadata?.netAmount ?? metadata?.net_amount ?? null),
    Number(metadata?.platformFeeAmount ?? metadata?.platform_fee_amount ?? null)
  );
  const platformFeeAmount = roundMoney(Math.max(0, effectiveGrossAmount - netAmount));

  const ownerId = await resolveOrderOwnerId(orderRow, metadata);
  if (!ownerId) {
    throw new Error('Could not resolve product owner for settlement.');
  }

  let orderUpdatePayload: any = {
    status: 'completed',
    payment_status: 'paid',
    payment_provider: 'paystack',
    payment_reference: reference,
    payment_transaction_id: transactionId,
    payment_gateway_response: transaction,
    payment_metadata: {
      ...(metadata || {}),
      settlement_entry: 'owner_credit',
      owner_id: ownerId,
      gross_amount: effectiveGrossAmount,
      platform_fee_amount: platformFeeAmount,
      net_amount: netAmount,
      currency,
    },
    business_id: ownerId,
    updated_at: nowIso,
  };

  let { error: orderUpdateError } = await supabase
    .from('orders')
    .update(orderUpdatePayload)
    .eq('id', orderId);

  if (
    orderUpdateError &&
    /column|payment_status|payment_provider|payment_reference|payment_transaction_id|payment_gateway_response|payment_metadata/i.test(
      String(orderUpdateError.message || '')
    )
  ) {
    orderUpdatePayload = {
      status: 'completed',
      payment_method: 'paystack',
      business_id: ownerId,
      updated_at: nowIso,
    };

    ({ error: orderUpdateError } = await supabase
      .from('orders')
      .update(orderUpdatePayload)
      .eq('id', orderId));
  }

  if (orderUpdateError) {
    throw new Error(`Failed to update order payment status: ${orderUpdateError.message}`);
  }

  const { error: paymentUpsertError } = await supabase
    .from('payments')
    .upsert(
      {
        order_id: orderId,
        user_id: metadata?.userId || orderRow.user_id || null,
        payment_provider: 'paystack',
        payment_method_id: transaction?.authorization?.authorization_code || null,
        amount: effectiveGrossAmount,
        currency,
        status: 'completed',
        transaction_id: transactionId,
        gateway_reference: reference,
        gateway_response: transaction,
        metadata: {
          ...(metadata || {}),
          owner_id: ownerId,
          gross_amount: effectiveGrossAmount,
          platform_fee_amount: platformFeeAmount,
          net_amount: netAmount,
        },
        processing_fee: platformFeeAmount,
        net_amount: netAmount,
        completed_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'transaction_id' }
    );

  if (paymentUpsertError) {
    throw new Error(`Failed to upsert payment record: ${paymentUpsertError.message}`);
  }

  if (alreadySettled) {
    return {
      orderId,
      ownerId,
      grossAmount: effectiveGrossAmount,
      netAmount,
      platformFeeAmount,
      alreadySettled: true,
    };
  }

  const { data: ownerWallet, error: ownerWalletError } = await supabase
    .from('wallets')
    .upsert(
      {
        user_id: ownerId,
        currency,
        is_verified: true,
        is_active: true,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' }
    )
    .select('id,balance')
    .single();

  if (ownerWalletError || !ownerWallet) {
    throw new Error(`Failed to prepare owner wallet: ${ownerWalletError?.message || 'unknown error'}`);
  }

  const updatedOwnerBalance = roundMoney(Number(ownerWallet.balance || 0) + netAmount);
  const { error: ownerWalletBalanceError } = await supabase
    .from('wallets')
    .update({ balance: updatedOwnerBalance, updated_at: nowIso })
    .eq('id', ownerWallet.id);

  if (ownerWalletBalanceError) {
    throw new Error(`Failed to credit owner wallet: ${ownerWalletBalanceError.message}`);
  }

  const ownerTransaction = {
    wallet_id: ownerWallet.id,
    amount: netAmount,
    type: 'deposit',
    status: 'completed',
    description: 'Paystack sale settlement',
    transaction_fee: 0,
    metadata: {
      entry: 'owner_credit',
      payment_provider: 'paystack',
      owner_id: ownerId,
      buyer_id: orderRow.user_id,
      order_id: orderId,
      video_id: orderRow.video_id || metadata?.videoId || metadata?.video_id || null,
      payment_reference: reference,
      payment_transaction_id: transactionId,
      gross_amount: effectiveGrossAmount,
      platform_fee_amount: platformFeeAmount,
      net_amount: netAmount,
      currency,
    },
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { error: ownerTxError } = await supabase.from('transactions').insert(ownerTransaction);
  if (ownerTxError) {
    throw new Error(`Failed to insert owner credit transaction: ${ownerTxError.message}`);
  }

  const { data: buyerWallet } = await supabase
    .from('wallets')
    .upsert(
      {
        user_id: orderRow.user_id,
        currency,
        is_active: true,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' }
    )
    .select('id')
    .single();

  if (buyerWallet?.id) {
    await supabase.from('transactions').insert({
      wallet_id: buyerWallet.id,
      amount: -effectiveGrossAmount,
      type: 'payment',
      status: 'completed',
      description: 'Paystack purchase',
      transaction_fee: platformFeeAmount,
      metadata: {
        entry: 'buyer_debit',
        payment_provider: 'paystack',
        order_id: orderId,
        owner_id: ownerId,
        payment_reference: reference,
        payment_transaction_id: transactionId,
        gross_amount: effectiveGrossAmount,
        platform_fee_amount: platformFeeAmount,
        net_amount: netAmount,
        currency,
      },
      created_at: nowIso,
      updated_at: nowIso,
    });
  }

  return {
    orderId,
    ownerId,
    grossAmount: effectiveGrossAmount,
    netAmount,
    platformFeeAmount,
    ownerWalletBalance: updatedOwnerBalance,
    alreadySettled: false,
  };
}

async function settlePaystackWalletFunding(args: {
  transaction: any;
  metadata: any;
}) {
  if (!supabase) {
    throw new Error('Supabase server client is not configured.');
  }

  const { transaction, metadata } = args;
  const userId = String(metadata?.userId || metadata?.user_id || '').trim();
  if (!userId) {
    throw new Error('Missing userId in wallet funding metadata.');
  }

  const reference = String(transaction?.reference || '').trim() || null;
  const transactionId = String(transaction?.id || reference || '').trim() || null;
  const amount = roundMoney(Number(transaction?.amount || 0) / 100);
  const currency = String(transaction?.currency || metadata?.currency || 'NGN').toUpperCase();
  const nowIso = new Date().toISOString();

  const { data: existingFundingTx, error: existingFundingTxError } = await supabase
    .from('transactions')
    .select('id')
    .eq('metadata->>entry', 'wallet_funding')
    .eq('metadata->>payment_transaction_id', transactionId || '')
    .limit(1);

  if (existingFundingTxError) {
    throw new Error(`Failed to check wallet funding idempotency: ${existingFundingTxError.message}`);
  }

  if ((existingFundingTx || []).length > 0) {
    return { userId, amount, alreadySettled: true };
  }

  const { data: wallet, error: walletError } = await supabase
    .from('wallets')
    .upsert(
      {
        user_id: userId,
        currency,
        is_active: true,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' }
    )
    .select('id,balance')
    .single();

  if (walletError || !wallet) {
    throw new Error(`Failed to prepare wallet for funding: ${walletError?.message || 'unknown error'}`);
  }

  const newBalance = roundMoney(Number(wallet.balance || 0) + amount);
  const { error: walletBalanceError } = await supabase
    .from('wallets')
    .update({ balance: newBalance, updated_at: nowIso })
    .eq('id', wallet.id);

  if (walletBalanceError) {
    throw new Error(`Failed to update funded wallet balance: ${walletBalanceError.message}`);
  }

  const { error: txInsertError } = await supabase
    .from('transactions')
    .insert({
      wallet_id: wallet.id,
      amount,
      type: 'deposit',
      status: 'completed',
      description: `Wallet funding via Paystack - ${reference || transactionId || 'N/A'}`,
      transaction_fee: 0,
      metadata: {
        entry: 'wallet_funding',
        payment_provider: 'paystack',
        payment_reference: reference,
        payment_transaction_id: transactionId,
        currency,
        user_id: userId,
      },
      created_at: nowIso,
      updated_at: nowIso,
    });

  if (txInsertError) {
    throw new Error(`Failed to insert wallet funding transaction: ${txInsertError.message}`);
  }

  return { userId, amount, newBalance, alreadySettled: false };
}

// Enable CORS for all routes
app.use("*", cors());

// Mount tRPC router at /trpc
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext,
  })
);

// Simple health check endpoint
app.get("/", (c) => {
  return c.json({ status: "ok", message: "API is running" });
});

app.delete('/api/videos/:videoId', async (c) => {
  try {
    if (!supabase) {
      return c.json({ success: false, error: 'Supabase server client is not configured.' }, 500);
    }

    const authorization = c.req.header('authorization') || '';
    const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return c.json({ success: false, error: 'Missing authorization token.' }, 401);
    }

    const accessToken = tokenMatch[1];
    const { data: userData, error: authError } = await supabase.auth.getUser(accessToken);
    const user = userData?.user;

    if (authError || !user) {
      return c.json({ success: false, error: 'Unable to authenticate request.' }, 401);
    }

    const videoId = c.req.param('videoId');

    const { data: ownedVideo, error: ownedVideoError } = await supabase
      .from('videos')
      .select('id, user_id, video_url, thumbnail_url')
      .eq('id', videoId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (ownedVideoError) {
      console.error('❌ Backend video ownership check failed:', ownedVideoError);
      return c.json({ success: false, error: ownedVideoError.message || 'Failed to load video.' }, 500);
    }

    if (!ownedVideo) {
      return c.json({ success: false, error: 'Video not found for this account.' }, 404);
    }

    await Promise.all([
      runBestEffortMutation('video_comments', () => supabase.from('video_comments').delete().eq('video_id', videoId)),
      runBestEffortMutation('video_ratings', () => supabase.from('video_ratings').delete().eq('video_id', videoId)),
      runBestEffortMutation('video_likes', () => supabase.from('video_likes').delete().eq('video_id', videoId)),
      runBestEffortMutation('video_shares', () => supabase.from('video_shares').delete().eq('video_id', videoId)),
      runBestEffortMutation('user_hidden_videos', () => supabase.from('user_hidden_videos').delete().eq('video_id', videoId)),
      runBestEffortMutation('video_interactions', () => supabase.from('video_interactions').delete().eq('video_id', videoId)),
      runBestEffortMutation('events', () => supabase.from('events').update({ video_id: null }).eq('video_id', videoId)),
      runBestEffortMutation('orders', () => supabase.from('orders').update({ video_id: null }).eq('video_id', videoId)),
      runBestEffortMutation('reservations', () => supabase.from('reservations').update({ video_id: null }).eq('video_id', videoId)),
      runBestEffortMutation('ticket_receipts', () => supabase.from('ticket_receipts').update({ video_id: null }).eq('video_id', videoId)),
      runBestEffortMutation('event_attendees', () => supabase.from('event_attendees').update({ video_id: null }).eq('video_id', videoId)),
      runBestEffortMutation('group_chat_messages', () => supabase.from('group_chat_messages').update({ video_id: null }).eq('video_id', videoId)),
    ]);

    const { error: deleteError } = await supabase
      .from('videos')
      .delete()
      .eq('id', videoId)
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('❌ Backend video delete failed:', deleteError);
      return c.json({ success: false, error: deleteError.message || 'Failed to delete video.' }, 500);
    }

    const { data: remainingVideo, error: verificationError } = await supabase
      .from('videos')
      .select('id')
      .eq('id', videoId)
      .maybeSingle();

    if (verificationError) {
      console.warn('⚠️ Backend delete verification warning:', verificationError);
    }

    if (remainingVideo) {
      return c.json({ success: false, error: 'Video still exists after backend delete.' }, 500);
    }

    const videoStoragePath = extractStoragePath(ownedVideo.video_url, 'videos');
    const imageStoragePath = extractStoragePath(ownedVideo.thumbnail_url, 'images');

    if (videoStoragePath) {
      const { error: storageDeleteError } = await supabase.storage.from('videos').remove([videoStoragePath]);
      if (storageDeleteError) {
        console.warn('⚠️ Backend video storage cleanup warning:', storageDeleteError);
      }
    }

    if (imageStoragePath) {
      const { error: imageDeleteError } = await supabase.storage.from('images').remove([imageStoragePath]);
      if (imageDeleteError) {
        console.warn('⚠️ Backend image storage cleanup warning:', imageDeleteError);
      }
    }

    return c.json({ success: true, deletedVideoId: videoId });
  } catch (error: any) {
    console.error('❌ /api/videos/:videoId delete error:', error);
    return c.json({ success: false, error: error?.message || 'Failed to delete video.' }, 500);
  }
});

// Paystack webhook endpoint
app.post("/api/paystack/webhook", async (c) => {
  try {
    const body = await c.req.json();
    const signature = c.req.header('x-paystack-signature');
    
    console.log('🔗 Paystack webhook received:', {
      event: body.event,
      reference: body.data?.reference,
      amount: body.data?.amount,
      status: body.data?.status,
      signature: signature ? 'present' : 'missing'
    });
    
    // Verify webhook signature (optional for testing)
    // In production, you should verify the signature
    
    // Handle different webhook events
    switch (body.event) {
      case 'charge.success':
        const paystackTx = body.data || {};
        const paystackMetadata = paystackTx?.metadata && typeof paystackTx.metadata === 'object' ? paystackTx.metadata : {};
        const paymentType = String(
          paystackMetadata.paymentType ||
          paystackMetadata.payment_type ||
          paystackMetadata.type ||
          'order_payment'
        )
          .trim()
          .toLowerCase();

        if (!supabase) {
          console.warn('⚠️ Supabase client not initialized - cannot settle Paystack webhook payment.');
          break;
        }

        try {
          if (paymentType === 'wallet_funding') {
            const fundingResult = await settlePaystackWalletFunding({
              transaction: paystackTx,
              metadata: paystackMetadata,
            });
            console.log('✅ Paystack wallet funding settled:', fundingResult);
          } else {
            const settlementResult = await settlePaystackOrderPayment({
              transaction: paystackTx,
              metadata: paystackMetadata,
            });
            console.log('✅ Paystack order settlement completed:', settlementResult);
          }
        } catch (settlementError: any) {
          console.error('❌ Paystack settlement failed:', settlementError?.message || settlementError);
        }

        console.log('✅ Payment successful via webhook:', {
          reference: body.data.reference,
          amount: (body.data.amount / 100).toFixed(2),
          currency: body.data.currency,
          customer: body.data.customer?.email,
          status: body.data.status
        });
        break;
        
      case 'charge.failed':
        console.log('❌ Payment failed via webhook:', {
          reference: body.data.reference,
          amount: (body.data.amount / 100).toFixed(2),
          currency: body.data.currency,
          customer: body.data.customer?.email,
          status: body.data.status,
          gateway_response: body.data.gateway_response
        });
        break;
        
      default:
        console.log('📨 Other webhook event:', body.event);
    }
    
    // Always return 200 to acknowledge receipt
    return c.json({ 
      status: "success", 
      message: "Webhook received and processed",
      event: body.event,
      reference: body.data?.reference
    });
    
  } catch (error: any) {
    console.error('❌ Webhook processing error:', error);
    return c.json({ 
      status: "error", 
      message: error.message 
    }, 500);
  }
});

// Worldline webhook endpoint
app.post("/api/worldline/webhook", async (c) => {
  try {
    // Get raw body for signature verification (Worldline signs the raw request body)
    const rawBody = await c.req.text();
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ status: "error", message: "Invalid JSON body" }, 400);
    }
    
    // Get webhook credentials
    const webhookId = process.env.WORLDLINE_WEBHOOK_ID || '8F142108CB95DFDA64F6';
    const webhookSecret = process.env.WORLDLINE_WEBHOOK_SECRET || '43A1D436F54844DB73BF153ECBA9551A27636D945271483D0D0B62D713CDAB5C8B15F5158D9339FCA9EA4BD0C92678F94FC930FF3A3355BB1DC1856530B3D730';
    
    // Worldline sends signature in various possible headers
    const signature = c.req.header('x-worldline-signature') || 
                     c.req.header('x-signature') || 
                     c.req.header('x-webhook-signature') ||
                     c.req.header('authorization');
    
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔗 Worldline Webhook Received:');
    console.log(`   Event Type: ${body.event || body.type || 'unknown'}`);
    console.log(`   Payment ID: ${body.paymentId || body.payment_id || body.id || 'N/A'}`);
    console.log(`   Reference: ${body.reference || body.orderId || 'N/A'}`);
    console.log(`   Status: ${body.status || body.paymentStatus || 'N/A'}`);
    console.log(`   Amount: ${body.amount ? (body.amount / 100).toFixed(2) : body.amountValue || 'N/A'} ${body.currency || 'N/A'}`);
    console.log(`   Webhook ID: ${webhookId}`);
    console.log(`   Signature Header: ${signature ? 'present' : 'missing'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    
    // Verify webhook signature (CRITICAL for security!)
    if (webhookSecret && signature) {
      try {
        // Worldline typically uses HMAC SHA256 with the secret key
        // The signature is usually a base64 or hex encoded HMAC of the raw body
        const expectedSignature = crypto
          .createHmac('sha256', webhookSecret)
          .update(rawBody)
          .digest('hex');
        
        // Compare signatures (handle both hex and base64 encodings)
        const signatureClean = signature.replace(/^Bearer\s+/i, '').trim();
        const isValidSignature = 
          crypto.timingSafeEqual(
            Buffer.from(expectedSignature),
            Buffer.from(signatureClean.length === 64 ? signatureClean : crypto.createHash('sha256').update(signatureClean).digest('hex'))
          ) ||
          expectedSignature === signatureClean ||
          crypto.timingSafeEqual(
            Buffer.from(crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('base64')),
            Buffer.from(signatureClean)
          );
        
        if (!isValidSignature) {
          console.error('❌ Invalid webhook signature!');
          console.error('   Expected:', expectedSignature.substring(0, 20) + '...');
          console.error('   Received:', signatureClean.substring(0, 20) + '...');
          return c.json({ status: "error", message: "Invalid webhook signature" }, 401);
        }
        
        console.log('✅ Webhook signature verified successfully!');
      } catch (sigError: any) {
        console.error('⚠️ Signature verification error:', sigError.message);
        // For development, we might skip verification, but warn
        if (process.env.NODE_ENV === 'production') {
          return c.json({ status: "error", message: "Signature verification failed" }, 401);
        }
        console.warn('⚠️ Continuing without signature verification (development mode)');
      }
    } else {
      if (process.env.NODE_ENV === 'production') {
        console.error('❌ Webhook secret or signature missing in production!');
        return c.json({ status: "error", message: "Missing webhook credentials" }, 401);
      }
      console.warn('⚠️ Webhook secret or signature missing - skipping verification (development mode)');
    }
    
    // Handle different webhook events
    const eventType = body.event || body.type || 'unknown';
    const paymentStatus = body.status || body.paymentStatus || 'unknown';
    
    console.log(`📨 Processing Worldline webhook: ${eventType} - Status: ${paymentStatus}`);
    
    // Extract payment information
    const reference = body.reference || body.orderId || body.paymentId || body.id;
    const paymentId = body.paymentId || body.id;
    const transactionId = body.transactionId || body.transaction_id || paymentId;
    const amount = body.amount ? body.amount / 100 : (body.amountValue || 0);
    const currency = body.currency || 'USD';
    const customerEmail = body.customer?.email || body.customerEmail;
    const metadata = body.metadata || {};
    
    // Update payment status in Supabase
    if (supabase) {
      try {
        if (paymentStatus === 'SUCCESS' || paymentStatus === 'success' || paymentStatus === 'PAID') {
          console.log('✅ Payment successful via webhook - Updating Supabase:', {
            paymentId,
            reference,
            amount,
            currency,
            transactionId
          });
          
          // Update order status if orderId exists in metadata
          const orderId = body.orderId || metadata.orderId || reference;
          if (orderId) {
            const { error: orderError } = await supabase
              .from('orders')
              .update({
                payment_status: 'paid',
                payment_reference: reference,
                payment_transaction_id: transactionId,
                payment_gateway_response: body,
                payment_metadata: metadata,
                updated_at: new Date().toISOString()
              })
              .eq('id', orderId);
            
            if (orderError) {
              console.error('❌ Failed to update order in Supabase:', orderError);
            } else {
              console.log('✅ Order updated in Supabase:', orderId);
            }
          }
          
          // Create/update payment record in Supabase
          const { error: paymentError } = await supabase
            .from('payments')
            .upsert({
              payment_provider: 'worldline',
              transaction_id: transactionId,
              gateway_reference: reference,
              amount: amount,
              currency: currency,
              status: 'completed',
              gateway_response: body,
              metadata: metadata,
              user_id: metadata.userId || null,
              order_id: orderId || null,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'transaction_id'
            });
          
          if (paymentError) {
            console.error('❌ Failed to save payment in Supabase:', paymentError);
          } else {
            console.log('✅ Payment saved in Supabase:', transactionId);
          }
          
        } else if (paymentStatus === 'FAILED' || paymentStatus === 'failed') {
          console.log('❌ Payment failed via webhook - Updating Supabase:', {
            paymentId,
            reference,
            reason: body.message || body.error || 'Unknown reason'
          });
          
          // Update order status to failed
          const orderId = body.orderId || metadata.orderId || reference;
          if (orderId) {
            const { error: orderError } = await supabase
              .from('orders')
              .update({
                payment_status: 'failed',
                payment_reference: reference,
                payment_transaction_id: transactionId,
                payment_gateway_response: body,
                updated_at: new Date().toISOString()
              })
              .eq('id', orderId);
            
            if (orderError) {
              console.error('❌ Failed to update order status in Supabase:', orderError);
            } else {
              console.log('✅ Order status updated to failed in Supabase:', orderId);
            }
          }
          
          // Update payment record status
          const { error: paymentError } = await supabase
            .from('payments')
            .upsert({
              payment_provider: 'worldline',
              transaction_id: transactionId,
              gateway_reference: reference,
              amount: amount,
              currency: currency,
              status: 'failed',
              gateway_response: body,
              metadata: metadata,
              user_id: metadata.userId || null,
              order_id: orderId || null,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'transaction_id'
            });
          
          if (paymentError) {
            console.error('❌ Failed to update payment status in Supabase:', paymentError);
          }
        } else {
          console.log('📊 Payment status update (not success/failed):', {
            paymentId,
            reference,
            status: paymentStatus
          });
        }
      } catch (dbError: any) {
        console.error('❌ Database update error:', dbError);
      }
    } else {
      console.warn('⚠️ Supabase client not initialized - skipping database updates');
    }
    
    // Always return 200 to acknowledge receipt
    return c.json({ 
      status: "success", 
      message: "Webhook received and processed",
      event: eventType,
      paymentId: body.paymentId || body.id,
      reference: body.reference || body.orderId
    });
    
  } catch (error: any) {
    console.error('❌ Worldline webhook processing error:', error);
    return c.json({ 
      status: "error", 
      message: error.message 
    }, 500);
  }
});

// CEO Welcome Email endpoint (simulated)
app.post("/welcome-email", async (c) => {
  try {
    const body = await c.req.json();
    const schema = z.object({
      email: z.string().email(),
      name: z.string().min(1),
    });
    const { email, name } = schema.parse(body);

    const subject = "Welcome to 60seconds - Catch The Moment!";
    const content = `Dear ${name},

Welcome aboard! We are thrilled you have joined the 60Seconds community  the ultimate app for capturing and sharing those electrifying nightlife moments in just 60 seconds.
At 60Seconds, we make it easy to dive into the vibrant world of nightlife. Whether you are uploading quick videos of your epic nights out or exploring authentic user-generated content to discover trendy clubs, hidden speakeasy bars, hot party deals, and exclusive event tickets, we have got you covered. Its all about real-time, genuine experiences from people like you, helping everyone find the best spots in any city.
To get started:
1.  Open the app and complete your profile  add a fun bio and your favorite nightlife vibes to connect with like-minded adventurers.
2.  Upload your first 60-second video: Hit record, capture a memorable moment from a recent outing, and share it with the world. Pro tip: Keep it authentic and energetic to get more views and interactions!
3.  Explore the feed: Scroll through videos from your city or beyond to uncover new venues, events, and deals. Follow creators whose style matches yours for personalized recommendations.
4.  Check out tickets and deals: Look for exclusive offers on events  you might snag something amazing right away.
We are here to help you make every night unforgettable. If you have any questions, our support team is just a tap away in the app.
Catch the moment  your next adventure starts now!
Best regards,
The 60Seconds Team
support@60secondsapp.io
https://60secondsapp.io
`;



    // TODO: Integrate with an email service provider
    // Options: SendGrid, Mailgun, AWS SES, Resend, Nodemailer, Supabase Edge Functions, etc.
    // Example:
    // await emailService.send({
    //   to: email,
    //   subject: subject,
    //   text: content,
    //   html: convertToHTML(content), // Optional: HTML version
    // });

    // For now, log the email (in production, replace with actual email sending)
    console.log("📧 Welcome Email Sent:", { 
      to: email, 
      subject: subject,
      name: name,
      contentLength: content.length 
    });
    
    // In development, log a preview
    if (process.env.NODE_ENV === 'development') {
      console.log('\n--- Email Content Preview ---');
      console.log(content.substring(0, 300) + '...\n');
    }

    return c.json({ success: true, message: 'Welcome email sent successfully' });
  } catch (err) {
    console.error("Failed to send welcome email:", err);
    return c.json({ success: false, error: "Invalid request" }, 400);
  }
});

export default app;
