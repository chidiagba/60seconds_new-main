import { Platform } from 'react-native';

export const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
  || 'pk_live_51SnDvXJTbyjuWarpewYMsveVy4MZcwQGtfcSfWa3qq390qr8Da0xFdcoA6Nya6UeUUNsApKVUnWbxw9tf2Mymscp00AbgC2cOa';

let initialization: Promise<void> | null = null;

/** Android's Stripe initializer creates Compose views; run it only at checkout. */
export function ensureStripeInitialized(): Promise<void> {
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
