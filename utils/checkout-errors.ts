// Only reviewed messages may cross the payment/database boundary into an alert.
const messages: Record<string, string> = {
  'Product unavailable': 'An item is no longer available. Remove it from your cart before checking out.',
  'Event is unavailable': 'This event is no longer available for purchases. Choose an active event.',
  'Insufficient product availability': 'There are not enough items available. Reduce the quantity and try again.',
  'A payment is already pending with another provider. Check its payment status in Orders before changing methods.': 'A payment is already pending with another provider. Check its payment status in Orders before changing methods.',
  'The previous checkout uses a different payment method. Return to that method or check its status in Orders.': 'The previous checkout uses a different payment method. Return to that method or check its status in Orders.',
  'Sign in before checkout': 'Please sign in to complete your purchase.',
  'Voucher usage limit reached': 'This voucher has been fully used. Please choose another voucher.',
  'The previous payment was cancelled. Tap Checkout to start a new attempt.': 'The previous payment was cancelled. Tap Checkout to start a new attempt.',
  'An existing checkout uses different voucher terms. Check its payment status in Orders before changing it.': 'An earlier checkout is still pending. Check its payment status in Orders before changing your voucher.',
  'Stored checkout needs recovery. Check your orders before paying again.': 'Check your orders before trying another payment.',
};

export function checkoutErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,24}$/.test(code) ? code : 'CHECKOUT_FAILED';
}

export function checkoutErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && Object.prototype.hasOwnProperty.call(messages, message)
    ? messages[message]
    : 'Checkout is temporarily unavailable. Please try again later. If you already attempted payment, check your orders before paying again.';
}
