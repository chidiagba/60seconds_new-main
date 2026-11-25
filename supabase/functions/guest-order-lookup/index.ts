import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsForRequest} from '../_shared/cors.ts';
import {allowRequest} from '../_shared/rate-limit.ts';
import {lookupGuestOrder,validGuestTrackingCode} from '../_shared/guest-order-lookup.ts';
Deno.serve(async req=>{
 const headers={...corsForRequest(req),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
  if(Number(req.headers.get('content-length'))>4096)return reply({error:'Request too large'},413);
  const raw=await req.text();if(raw.length>4096)return reply({error:'Request too large'},413);
  let input;try{input=JSON.parse(raw);}catch{return reply({error:'Invalid JSON request'},400);}
  if(!input || typeof input!=='object' || Array.isArray(input))return reply({error:'Invalid request'},400);
  if(!validGuestTrackingCode(input.trackingCode) || typeof input.email!=='string' || input.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || !['status','ticket-pdf'].includes(input.action || 'status'))return reply({error:'Enter the tracking code from your confirmation and the email used at checkout.'},400);
  const url=Deno.env.get('SUPABASE_URL')!;
  const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if(!await allowRequest(db,req,'guest-order-lookup',input.trackingCode.trim().toLowerCase(),20))return reply({error:'Too many attempts. Try again later.'},429);
  const result=await lookupGuestOrder(db,input,url);return reply(result.body,result.status);
 }catch{return reply({error:'Unable to look up the order. Please try again.'},500);}
});
