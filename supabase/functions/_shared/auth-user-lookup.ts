import type {ServiceDatabase} from './service-client.ts';
export async function lookupAuthUser(db: ServiceDatabase, email: string): Promise<{id:string;email:string}|null> {
  const {data,error}=await db.rpc('lookup_auth_user_by_email',{p_email:email});
  if(error) throw error;
  return data;
}
