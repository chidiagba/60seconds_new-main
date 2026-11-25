import { workerAuthorized } from '../_shared/worker-auth.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSignupTRegistrationUrl, classifySignupTResponse } from '../_shared/signupt.ts';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  const workerSecret = Deno.env.get('INFLUENCER_OUTBOX_WORKER_SECRET');
  if (!await workerAuthorized(req,workerSecret)) {
    return response({ error: 'Unauthorized' }, 401);
  }
  if (Deno.env.get('SIGNUPT_API_CONTRACT_VERIFIED') !== 'true') {
    return response({ error: 'SignupT contract has not been verified' }, 503);
  }
  const apiKey = Deno.env.get('SIGNUPT_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!apiKey || !supabaseUrl || !serviceKey) return response({ error: 'Server configuration unavailable' }, 503);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: batch, error: claimError } = await admin.rpc('claim_influencer_reporting_batch', { p_limit: 25 });
  if (claimError) {
    console.error('Influencer reporting claim failed:', claimError.code || 'database_error');
    return response({ error: 'Unable to claim reporting events' }, 500);
  }

  const outcomes: Array<{ event_id: string; state: string }> = [];
  for (const item of batch || []) {
    let state: 'reported' | 'failed' | 'unknown' = 'unknown';
    let errorCategory: string | null = null;
    let reportedAt: string | null = null;
    try {
      const url = buildSignupTRegistrationUrl(item.referral_code, apiKey);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      let result: Response;
      try {
        result = await fetch(url, { method: 'GET', redirect: 'error', signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      // Deliberately strict: HTTP success alone is not a provider success.
      let payload: Record<string, unknown> | null = null;
      try { payload = await result.json(); } catch { payload = null; }
      state = classifySignupTResponse(result.status, payload);
      if (state === 'reported') {
        reportedAt = new Date().toISOString();
      } else if (state === 'failed') {
        errorCategory = `http_${result.status}`;
      } else {
        // Timeouts, redirects, malformed bodies and server errors may have been processed.
        // Never replay an ambiguous request without a provider idempotency contract.
        errorCategory = result.ok ? 'unrecognized_response' : `http_${result.status}`;
      }
    } catch (error) {
      state = 'unknown';
      errorCategory = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network_error';
    }

    const now = new Date().toISOString();
    const { error: outboxError } = await admin.from('influencer_reporting_outbox').update({
      status: state,
      last_error_category: errorCategory,
      next_attempt_at: state === 'failed' ? new Date(Date.now() + Math.min(86_400_000, 60_000 * 2 ** Math.min(item.attempts, 10))).toISOString() : now,
      updated_at: now,
    }).eq('id', item.outbox_id);
    const { error: attributionError } = await admin.from('influencer_attributions').update({
      external_status: state,
      external_reported_at: reportedAt,
      last_error_category: errorCategory,
      retry_count: Math.max(0, Number(item.attempts) - 1),
      updated_at: now,
    }).eq('id', item.attribution_id);
    if (outboxError || attributionError) {
      console.error('Influencer reporting state update failed:', outboxError?.code || attributionError?.code || 'database_error');
      outcomes.push({ event_id: item.outbox_id, state: 'state_update_failed' });
    } else {
      outcomes.push({ event_id: item.outbox_id, state });
    }
  }

  return response({ processed: outcomes.length, outcomes });
});
