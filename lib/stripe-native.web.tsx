import React from 'react';
// Native PaymentSheet is unavailable in a browser. Shared events use hosted Checkout.
const unavailable = async () => ({ error: { code: 'Unavailable', message: 'Use the event web checkout to pay in your browser.' } });
export const initPaymentSheet = unavailable;
export const presentPaymentSheet = unavailable;
export const useStripe = () => ({ initPaymentSheet, presentPaymentSheet });
export function StripeProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }
