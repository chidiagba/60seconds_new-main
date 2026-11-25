/** Hash to fixed-length digests before comparing every byte. Never compare bearer secrets directly. */
export async function workerAuthorized(req: Request, secret: string | undefined): Promise<boolean> {
  if(!secret) return false;
  const encode=new TextEncoder();
  const [expected,supplied]=await Promise.all([
    crypto.subtle.digest('SHA-256',encode.encode(`Bearer ${secret}`)),
    crypto.subtle.digest('SHA-256',encode.encode(req.headers.get('authorization')||'')),
  ]);
  const a=new Uint8Array(expected),b=new Uint8Array(supplied);
  let mismatch=0;
  for(let i=0;i<a.length;i++) mismatch|=a[i]^b[i];
  return mismatch===0;
}
