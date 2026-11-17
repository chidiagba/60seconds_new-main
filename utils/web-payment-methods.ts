import type { CheckoutPaymentOption, CheckoutPaymentMethodId } from './checkout-payment-methods';
export type WebBuyerRegion = 'NG' | 'OTHER';
export function webPaymentOptions(region: WebBuyerRegion, currency: string): CheckoutPaymentOption[] {
  if (region === 'NG' && currency.toUpperCase() === 'NGN') return [
    { id: 'paystack_card', provider: 'paystack', channel: 'card', label: 'Card · Paystack' },
    { id: 'paystack_transfer', provider: 'paystack', channel: 'bank_transfer', label: 'Bank transfer · Paystack' },
  ];
  return [{ id: 'stripe_card', provider: 'stripe', label: 'Card · Stripe' }];
}
export function webPaymentRoute(region: unknown, currency: string, method: unknown) {
  if (region !== 'NG' && region !== 'OTHER') throw new Error('Choose where you are paying from.');
  const route = webPaymentOptions(region, currency).find(option => option.id === method);
  if (!route) throw new Error('Choose an available payment method.');
  return route;
}
export function validWebAttempt(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function webCheckoutItems(value: unknown, max: number) {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid basket.');
  const quantities = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)
      || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 500) throw new Error('Invalid basket.');
    const id = item.id.toLowerCase();
    quantities.set(id, (quantities.get(id) || 0) + item.quantity);
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([id, quantity]) => ({ id, quantity }));
}
export type WebMethod = CheckoutPaymentMethodId;
