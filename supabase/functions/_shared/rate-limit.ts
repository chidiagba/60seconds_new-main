import type {ServiceDatabase} from './service-client.ts';
export async function allowRequest(db: ServiceDatabase,req:Request,scope:string,identity:string,limit=5,includeIP=true): Promise<boolean> {
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
  for(const value of [...(includeIP?[`${scope}:ip:${ip}`]:[]),`${scope}:id:${identity}`]) {
    const {data,error}=await db.rpc('allow_service_request',{p_bucket:await digest(value),p_limit:limit,p_seconds:600});
    if(error) throw error;
    if(!data) return false;
  }
  return true;
}
