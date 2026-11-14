import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyPaystackSignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!secret || !signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
