import { Platform } from 'react-native';

export const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
  || '';

let initialization: Promise<void> | null = null;

/** Android's Stripe initializer creates Compose views; run it only at checkout. */
export function ensureStripeInitialized(): Promise<void> {
  if(!STRIPE_PUBLISHABLE_KEY) return Promise.reject(new Error('Missing public Stripe configuration'));
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!initialization) {
    initialization = Promise.resolve().then(async () => {
      const { initStripe } = require('@stripe/stripe-react-native');
      await initStripe({ publishableKey: STRIPE_PUBLISHABLE_KEY, urlScheme: 'myapp' });
    }).catch(error => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}
