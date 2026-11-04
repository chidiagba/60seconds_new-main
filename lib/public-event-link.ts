import type { SupabaseClient } from '@supabase/supabase-js';

/** Resolve legacy video shares without guessing event IDs or exposing private events. */
export async function findPublicEventForVideo(client: SupabaseClient, videoId: string): Promise<string | null> {
  const { data, error } = await client.from('events').select('id')
    .eq('video_id', videoId).eq('is_public', true)
    .in('status', ['published', 'open', 'completed', 'closed'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data?.id || null;
}
