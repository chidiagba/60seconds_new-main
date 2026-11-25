import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
export function createServiceClient(url: string, key: string) {
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export type ServiceDatabase = ReturnType<typeof createServiceClient>;
