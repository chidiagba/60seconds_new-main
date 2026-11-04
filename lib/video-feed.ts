import type { SupabaseClient } from '@supabase/supabase-js';

/** Keep a session's pagination order consistent if an older server lacks the RPC. */
export function createVideoFeedLoader(client: SupabaseClient) {
  let randomFeedUnavailable = false;
  let fallbackSeed: string | undefined;
  let fallbackIds: Promise<string[]> | undefined;
  const rank = (value: string) => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return hash >>> 0;
  };
  return async (limit: number, offset: number, seed?: string) => {
    if (seed && !randomFeedUnavailable) {
      const result = await client.rpc('random_video_feed', {
        feed_seed: seed, page_limit: limit, page_offset: offset,
      });
      if (result.error?.code !== 'PGRST202') return result;
      randomFeedUnavailable = true;
      console.warn('Random video feed RPC unavailable; using a session-ordered ID fallback.');
    }
    if (seed) {
      if (fallbackSeed !== seed || !fallbackIds) {
        fallbackSeed = seed;
        // ponytail: cache only IDs on older servers; install the RPC for large feeds.
        fallbackIds = (async () => {
          const ids: string[] = [];
          for (let start = 0; ; start += 1000) {
            const result = await client.from('videos').select('id').order('id').range(start, start + 999);
            if (result.error) throw result.error;
            ids.push(...(result.data || []).map(row => row.id));
            if ((result.data?.length || 0) < 1000) break;
          }
          return ids.sort((a, b) => rank(seed + a) - rank(seed + b) || a.localeCompare(b));
        })();
      }
      try {
        const ids = (await fallbackIds).slice(offset, offset + limit);
        if (!ids.length) return { data: [], error: null };
        const result = await client.from('videos').select('*').in('id', ids);
        if (result.data) result.data.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        return result;
      } catch (error) {
        fallbackIds = undefined;
        return { data: null, error };
      }
    }
    return client.from('videos').select('*')
      .order('upload_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }).order('id')
      .range(offset, offset + limit - 1);
  };
}
