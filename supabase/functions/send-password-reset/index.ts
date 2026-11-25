import {corsForRequest} from '../_shared/cors.ts';
// Recovery is provided by Supabase Auth with its configured email and verification limits.
Deno.serve(req=>new Response(JSON.stringify({error:'Use Supabase Auth password recovery'}),{
 status:req.method==='OPTIONS'?200:410,headers:{...corsForRequest(req),'Content-Type':'application/json'},
}));
