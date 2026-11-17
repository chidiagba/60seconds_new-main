export type CheckoutPaymentMethodId = 'paystack_card' | 'paystack_transfer' | 'stripe_card';
export type CheckoutPaymentOption = {
  id: CheckoutPaymentMethodId;
  label: string;
  provider: 'paystack' | 'stripe';
  channel?: 'card' | 'bank_transfer';
};
export function checkoutPaymentOptions(currency: string): CheckoutPaymentOption[] {
  const stripe: CheckoutPaymentOption = { id: 'stripe_card', label: 'Card · Stripe', provider: 'stripe' };
  return currency.toUpperCase() === 'NGN' ? [
    { id: 'paystack_card', label: 'Card · Paystack', provider: 'paystack', channel: 'card' },
    { id: 'paystack_transfer', label: 'Bank transfer · Paystack', provider: 'paystack', channel: 'bank_transfer' },
    stripe,
  ] : [stripe];
}
export function checkoutPaymentRoute(method: CheckoutPaymentMethodId, currency: string): CheckoutPaymentOption {
  const option = checkoutPaymentOptions(currency).find(option => option.id === method);
  if (!option) throw new Error('This payment method is unavailable for the cart currency.');
  return option;
}
