import { createClient } from '@supabase/supabase-js';
import { requiredEnv } from './env';

// A server client must never silently downgrade to the public anon role.
export const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
