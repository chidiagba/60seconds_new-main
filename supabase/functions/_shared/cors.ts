export function corsForRequest(request: Request): Record<string, string> {
  const allowed = new Set((Deno.env.get('ALLOWED_ORIGINS') || 'https://60secondsapp.io,https://www.60secondsapp.io').split(',').map(value => value.trim()));
  const origin = request.headers.get('origin') || '';
  return {
    ...(allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-paystack-signature, stripe-signature',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };
}
