import { workerAuthorized } from '../_shared/worker-auth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Invoke from a protected scheduler; never expose this credential in the app.
Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WORKER_SECRET');
  if (!await workerAuthorized(req,secret)) return new Response('Unauthorized', { status: 401 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: jobs, error } = await db.from('push_outbox').select('*').is('delivered_at', null).lt('attempts', 10).or(`claimed_until.is.null,claimed_until.lt.${new Date().toISOString()}`).order('created_at').limit(50);
  if (error) return new Response('Queue unavailable', { status: 500 });
  let delivered = 0;
  for (const job of jobs || []) {
    // Optimistic claim prevents simultaneous workers from delivering the same attempt.
    const { data: claimed } = await db.from('push_outbox').update({ attempts: job.attempts + 1, claimed_until: new Date(Date.now() + 120000).toISOString() }).eq('id', job.id).eq('attempts', job.attempts).select('id');
    if (!claimed?.length) continue;
    const { data: devices, error: deviceError } = await db.from('push_devices').select('token').eq('user_id', job.user_id);
    if (deviceError) continue;
    try {
      if (devices?.length) {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(Deno.env.get('EXPO_ACCESS_TOKEN') ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` } : {}) },
          body: JSON.stringify(devices.map(d => ({ to: d.token, title: job.title, body: job.body, data: job.data, sound: 'default' }))),
        });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.data)) throw new Error('Push rejected');
        let retry = false;
        for (let i = 0; i < result.data.length; i++) {
          const ticket = result.data[i];
          if (ticket.details?.error === 'DeviceNotRegistered') await db.from('push_devices').delete().eq('token', devices[i].token);
          else if (ticket.status !== 'ok') retry = true;
        }
        if (retry) continue;
      }
      await db.from('push_outbox').update({ delivered_at: new Date().toISOString() }).eq('id', job.id);
      delivered++;
    } catch { /* Retain failed jobs for the next scheduled attempt. */ }
  }
  return Response.json({ delivered });
});
