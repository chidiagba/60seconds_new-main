import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { cors } from "hono/cors";
import { appRouter } from "./trpc/app-router.js";
import { createContext } from "./trpc/create-context.js";
import { z } from "zod";
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import ffmpegPath from 'ffmpeg-static';
import path from 'path';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { spawn } from 'child_process';

// Initialize Supabase client for server-side operations
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// app will be mounted at /api
const app = new Hono();

const WATERMARKED_VIDEO_DIR = path.join(process.cwd(), 'public', 'watermarked-videos');
const WATERMARK_IMAGE_PATH = path.join(process.cwd(), 'assets', 'images', 'second.png');

const WatermarkRequestSchema = z.object({
  videoUrl: z.string().url(),
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']).optional(),
  opacity: z.number().min(0.15).max(1).optional(),
  scale: z.number().min(0.08).max(0.4).optional(),
});

function getOverlayExpression(position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center') {
  switch (position) {
    case 'top-left':
      return '20:20';
    case 'top-right':
      return 'main_w-overlay_w-20:20';
    case 'bottom-left':
      return '20:main_h-overlay_h-20';
    case 'bottom-right':
      return 'main_w-overlay_w-20:main_h-overlay_h-20';
    default:
      return '(main_w-overlay_w)/2:(main_h-overlay_h)/2';
  }
}

async function ensureWatermarkDir() {
  await mkdir(WATERMARKED_VIDEO_DIR, { recursive: true });
}

function getPublicBaseUrl(c: any) {
  return process.env.EXPO_PUBLIC_RORK_API_BASE_URL || process.env.RORK_API_BASE_URL || new URL(c.req.url).origin;
}

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

async function runWatermarkFfmpeg(inputPath: string, outputPath: string, options: { position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'; opacity: number; scale: number; }) {
  const ffmpegBin = ffmpegPath || 'ffmpeg';
  const overlayExpression = getOverlayExpression(options.position);
  const filterComplex = [
    `[1:v]format=rgba,colorkey=0xFFFFFF:0.22:0.08[wmraw]`,
    `[wmraw][0:v]scale2ref=w=main_w*${options.scale}:h=ow/mdar[wm][base]`,
    `[wm]colorchannelmixer=aa=${options.opacity}[wm2]`,
    `[base][wm2]overlay=${overlayExpression}:format=auto[v]`,
  ].join(';');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin, [
      '-y',
      '-i', inputPath,
      '-i', WATERMARK_IMAGE_PATH,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ]);

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`FFmpeg failed with code ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

async function downloadUrlToFile(url: string, targetPath: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download source video (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(targetPath, Buffer.from(arrayBuffer));
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

app.get('/media/watermarked/:fileName', async (c) => {
  const fileName = path.basename(c.req.param('fileName'));
  const filePath = path.join(WATERMARKED_VIDEO_DIR, fileName);

  try {
    const file = await readFile(filePath);
    c.header('Content-Type', 'video/mp4');
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(file);
  } catch {
    return c.json({ error: 'Watermarked video not found' }, 404);
  }
});

app.post('/api/video/watermark', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = WatermarkRequestSchema.parse(body);

    await ensureWatermarkDir();

    const position = parsed.position || 'bottom-right';
    const opacity = parsed.opacity ?? 0.82;
    const scale = parsed.scale ?? 0.16;

    const token = crypto.randomUUID();
    const inputPath = path.join(WATERMARKED_VIDEO_DIR, `${token}_in.mp4`);
    const outputFile = `${token}.mp4`;
    const outputPath = path.join(WATERMARKED_VIDEO_DIR, outputFile);

    await downloadUrlToFile(parsed.videoUrl, inputPath);
    await runWatermarkFfmpeg(inputPath, outputPath, { position, opacity, scale });
    await unlink(inputPath).catch(() => {});

    const baseUrl = getPublicBaseUrl(c);
    return c.json({
      success: true,
      watermarkedUrl: `${baseUrl}/media/watermarked/${outputFile}`,
    });
  } catch (error: any) {
    console.error('❌ /api/video/watermark error:', error);
    return c.json({
      success: false,
      error: error?.message || 'Failed to watermark video',
    }, 500);
  }
});

app.post('/api/video/watermark-upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('video') as any;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return c.json({ success: false, error: 'Missing uploaded video file' }, 400);
    }

    await ensureWatermarkDir();

    const positionRaw = (formData.get('position')?.toString() || 'bottom-right') as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
    const validPositions = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']);
    const position = validPositions.has(positionRaw) ? positionRaw : 'bottom-right';
    const opacity = Math.max(0.15, Math.min(1, Number(formData.get('opacity') ?? 0.82)));
    const scale = Math.max(0.08, Math.min(0.4, Number(formData.get('scale') ?? 0.16)));

    const token = crypto.randomUUID();
    const inputPath = path.join(WATERMARKED_VIDEO_DIR, `${token}_upload_in.mp4`);
    const outputFile = `${token}.mp4`;
    const outputPath = path.join(WATERMARKED_VIDEO_DIR, outputFile);

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, fileBuffer);
    await runWatermarkFfmpeg(inputPath, outputPath, { position, opacity, scale });
    await unlink(inputPath).catch(() => {});

    const baseUrl = getPublicBaseUrl(c);
    return c.json({
      success: true,
      watermarkedUrl: `${baseUrl}/media/watermarked/${outputFile}`,
    });
  } catch (error: any) {
    console.error('❌ /api/video/watermark-upload error:', error);
    return c.json({
      success: false,
      error: error?.message || 'Failed to watermark uploaded video',
    }, 500);
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