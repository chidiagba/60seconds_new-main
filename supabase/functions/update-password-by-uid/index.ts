import { corsForRequest } from '../_shared/cors.ts';
// Deploy this tombstone before deleting the retired function from the project.
Deno.serve((req) => new Response(req.method === 'OPTIONS' ? null : JSON.stringify({ error: 'Endpoint retired' }), {
  status: req.method === 'OPTIONS' ? 204 : 410,
  headers: { ...corsForRequest(req), 'Content-Type': 'application/json' },
}));
