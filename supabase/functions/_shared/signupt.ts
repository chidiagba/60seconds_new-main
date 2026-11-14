export type SignupTOutcome = 'reported' | 'failed' | 'unknown';

export function buildSignupTRegistrationUrl(referralCode: string, apiKey: string): URL {
  const url = new URL('https://signupt.com/api/public/register');
  url.searchParams.set('ref', referralCode);
  url.searchParams.set('key', apiKey);
  return url;
}

export function classifySignupTResponse(status: number, payload: unknown): SignupTOutcome {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  if (status >= 200 && status < 300 && value?.success === true) return 'reported';
  if (status >= 400 && status < 500) return 'failed';
  return 'unknown';
}
