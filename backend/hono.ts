import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { cors } from "hono/cors";
import { appRouter } from "./trpc/app-router.js";
import { createContext } from "./trpc/create-context.js";

import { supabase } from './lib/supabase';
import { requiredEnv } from './lib/env';
import { verifyPaystackSignature } from './lib/paystack-signature';
const paystackSecret = requiredEnv('PAYSTACK_SECRET_KEY');
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
  mutation: () => PromiseLike<{ error: { code?: string; message?: string } | null }>
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

// Enable CORS for all routes
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://60secondsapp.io,https://www.60secondsapp.io').split(',').map(value => value.trim()).filter(Boolean));
app.use('*', cors({ origin: origin => allowedOrigins.has(origin) ? origin : '', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'] }));
app.onError((error, c) => {
  console.error('API request failed', error);
  return c.json({ success: false, error: 'Request could not be completed' }, 500);
});

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
      return c.json({ success: false, error: 'Request could not be completed' }, 500);
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
      return c.json({ success: false, error: 'Failed to delete video.' }, 500);
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
    return c.json({ success: false, error: 'Failed to delete video.' }, 500);
  }
});

// One settlement implementation: forward the exact signed bytes to the Edge Function.
app.post('/api/paystack/webhook', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-paystack-signature');
  if (!verifyPaystackSignature(rawBody, signature, paystackSecret)) return c.json({ error: 'Invalid webhook signature' }, 401);
  try { JSON.parse(rawBody); } catch { return c.json({ error: 'Invalid request' }, 400); }
  const response = await fetch(`${requiredEnv('SUPABASE_URL')}/functions/v1/paystack-webhook-settlement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature! },
    body: rawBody,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) return c.json({ error: 'Settlement failed; retry delivery' }, 502);
  return c.json({ success: true });
});

// Retired provider: do not accept or settle Worldline callbacks.
app.post('/api/worldline/webhook', c => c.json({ error: 'Payment provider is disabled' }, 410));

export default app;
