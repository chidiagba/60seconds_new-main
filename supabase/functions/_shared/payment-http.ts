/** Keep transport status consistent with a payment operation's explicit failure. */
export function paymentHttpStatus(body: unknown): number {
  if(!body || typeof body!=='object') return 200;
  const value=body as Record<string,unknown>;
  if(value.success!==false && value.verified!==false && !value.error) return 200;
  const message=String(value.error||value.verificationReason||'');
  if(/unauthorized|bearer token|authentication required/i.test(message)) return 401;
  return 422;
}
