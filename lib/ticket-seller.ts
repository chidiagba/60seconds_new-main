export type TicketSeller = {name:string;username?:string;address?:string;phone?:string;website?:string};
/** Only public business fields are carried into tickets, never profile email. */
export function ticketSeller(profile:any):TicketSeller {
 return {name:profile.business_name?.trim() || profile.username || 'Business details unavailable',
 username:profile.username || undefined,address:profile.business_address || profile.location_city || undefined,
 phone:profile.business_phone || undefined,website:profile.business_website || undefined};
}
export async function loadTicketSellers(db:any,ids:string[]):Promise<Map<string,TicketSeller>> {
 const unique=[...new Set(ids.filter(Boolean))];
 if(!unique.length)return new Map();
 let result=await db.from('profiles').select('id,business_name,username,location_city,business_address,business_phone,business_website').in('id',unique);
 // Older profile schemas lack optional business contact fields.
 if(result.error?.code==='42703'||result.error?.code==='PGRST204')result=await db.from('profiles').select('id,business_name,username,location_city').in('id',unique);
 if(result.error)throw new Error('Unable to load ticket seller details. Please try again.');
 return new Map((result.data||[]).map((p:any)=>[p.id,ticketSeller(p)]));
}
