import type { SupabaseClient } from '@supabase/supabase-js';
type RecoveryClient = Pick<SupabaseClient, 'auth'>;

export async function verifyRecoveryCode(client: RecoveryClient, email: string, code: string): Promise<boolean> {
  const { data, error } = await client.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'recovery' });
  return !error && Boolean(data.session);
}

export async function updateRecoveredPassword(client: RecoveryClient, password: string): Promise<void> {
  const { data, error: sessionError } = await client.auth.getSession();
  if (sessionError || !data.session) throw new Error('Reset session expired');
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error('Password update failed');
  await client.auth.signOut();
}
