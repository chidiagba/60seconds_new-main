import { logger } from '@/lib/logger';
import { ensureStripeInitialized } from "@/lib/stripe-initialization";
import { Platform, Alert, Linking } from 'react-native';
import Constants from 'expo-constants';

/**
 * Unified Stripe payment handler for iOS and Android
 * - Android: Uses native Stripe PaymentSheet
 * - iOS: Uses web-based Stripe payment (no native module required, no PassKit)
 */

export interface StripePaymentParams {
  amount: number; // in cents
  currency: string;
  description: string;
  userEmail?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

/**
 * Initialize payment on the current platform
 * Returns payment sheet functions or null if unavailable
 */
export async function initializeStripePayment(params: StripePaymentParams) {
  try {
    if (Platform.OS === 'android') {
      return await initializeNativeStripePayment(params);
    } else if (Platform.OS === 'ios') {
      return await initializeWebStripePayment(params);
    }
  } catch (error) {
    logger.error('Error initializing Stripe payment:', error);
    return null;
  }
}

/**
 * Android: Use native Stripe PaymentSheet
 */
async function initializeNativeStripePayment(params: StripePaymentParams) {
  try {
    const stripe = require('@stripe/stripe-react-native');
    await ensureStripeInitialized();

    const stripeKey =
      process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
      'pk_live_51SnDvXJTbyjuWarpewYMsveVy4MZcwQGtfcSfWa3qq390qr8Da0xFdcoA6Nya6UeUUNsApKVUnWbxw9tf2Mymscp00AbgC2cOa';

    // Initialize payment sheet with backend created payment intent
    const paymentIntentClientSecret = await createPaymentIntentOnBackend(params);

    if (!paymentIntentClientSecret) {
      throw new Error('Failed to create payment intent on backend');
    }

    const { error: initError } = await stripe.initPaymentSheet({
      paymentIntentClientSecret,
      merchantDisplayName: '60Seconds',
      googlePay: { enabled: true },
    });

    if (initError) {
      throw new Error(`Init error: ${initError.message}`);
    }

    return {
      presentPaymentSheet: stripe.presentPaymentSheet,
      initPaymentSheet: stripe.initPaymentSheet,
    };
  } catch (error) {
    logger.warn('Native Stripe initialization failed (Android):', error);
    return null;
  }
}

/**
 * iOS: Use web-based Stripe payment via backend
 * No native module loaded, so no PassKit framework is linked
 */
async function initializeWebStripePayment(params: StripePaymentParams) {
  try {
    // Create payment intent on backend
    const paymentIntentClientSecret = await createPaymentIntentOnBackend(params);

    if (!paymentIntentClientSecret) {
      throw new Error('Failed to create payment intent on backend');
    }

    // Return mock functions that will trigger web-based payment
    return {
      presentPaymentSheet: async () => {
        try {
          // Open Stripe Checkout via web (backend handles this)
          // Alternatively, navigate to a payment screen in your app
          const stripeCheckoutUrl = await getStripeCheckoutUrl(paymentIntentClientSecret);
          if (stripeCheckoutUrl) {
            await Linking.openURL(stripeCheckoutUrl);
            return { error: null };
          }
          return { error: { message: 'Could not open payment' } };
        } catch (error: any) {
          return { error: { message: error.message || 'Payment failed' } };
        }
      },
      initPaymentSheet: async (options: any) => {
        // For iOS, this is essentially a no-op since we handle it in presentPaymentSheet
        return { error: null };
      },
    };
  } catch (error) {
    logger.warn('Web Stripe initialization failed (iOS):', error);
    return null;
  }
}

/**
 * Create a payment intent on your backend
 * Your backend should receive this request and create a Stripe PaymentIntent
 */
async function createPaymentIntentOnBackend(
  params: StripePaymentParams
): Promise<string | null> {
  try {
    // TODO: Replace with your actual backend endpoint
    const response = await fetch('https://your-backend.com/api/stripe/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: params.amount,
        currency: params.currency,
        description: params.description,
        userEmail: params.userEmail,
        userId: params.userId,
        metadata: params.metadata,
      }),
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.clientSecret || null;
  } catch (error) {
    logger.error('Error creating payment intent on backend:', error);
    return null;
  }
}

/**
 * Get Stripe Checkout URL for web-based payment (iOS)
 */
async function getStripeCheckoutUrl(clientSecret: string): Promise<string | null> {
  try {
    // TODO: Replace with your actual backend endpoint
    const response = await fetch('https://your-backend.com/api/stripe/checkout-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientSecret }),
    });

    if (!response.ok) {
      throw new Error('Failed to get checkout URL');
    }

    const data = await response.json();
    return data.url || null;
  } catch (error) {
    logger.error('Error getting checkout URL:', error);
    return null;
  }
}

/**
 * Present payment sheet (platform-aware)
 */
export async function presentStripePaymentSheet(
  presentPaymentSheet: Function | null
): Promise<{ error: any }> {
  if (!presentPaymentSheet) {
    return { error: { message: 'Payment sheet not available' } };
  }

  try {
    return await presentPaymentSheet();
  } catch (error: any) {
    return { error: { message: error.message || 'Payment failed' } };
  }
}

/**
 * Initialize payment sheet (platform-aware)
 */
export async function initStripePaymentSheet(
  initPaymentSheet: Function | null,
  options: any
): Promise<{ error: any }> {
  if (!initPaymentSheet) {
    return { error: { message: 'Payment sheet not available' } };
  }

  try {
    return await initPaymentSheet(options);
  } catch (error: any) {
    return { error: { message: error.message || 'Initialization failed' } };
  }
}
