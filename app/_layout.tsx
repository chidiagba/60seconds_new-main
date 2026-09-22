import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { Stack, useRouter, useSegments } from "expo-router";
import React, { useEffect } from "react";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import Colors from "@/constants/colors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/lib/trpc";
import { AppRegistry, Platform, AppState } from "react-native";
import { AuthProvider } from "@/lib/auth";
import * as Linking from "expo-linking";
import { AppBackButton, AppFloatingBackButton } from "@/components/AppBackButton";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

let StripeProviderComponent: React.ComponentType<any> | null = null;
const isExpoGo =
  (Constants as any)?.appOwnership === "expo" ||
  (Constants as any)?.executionEnvironment === "storeClient";

if (!isExpoGo && Platform.OS !== "web") {
  try {
    const stripeModule = require("@stripe/stripe-react-native");
    StripeProviderComponent = stripeModule?.StripeProvider || null;
  } catch (error) {
    console.warn("Stripe native module not available in this build:", error);
  }
} else {
  console.log("Stripe native module skipped in Expo Go/web.");
}

// Register Stripe's Android headless task at app load so it exists before the native
// payment sheet starts it. Prevents "No task registered for key StripeKeepJsAwakeTask" and app crash.
if (Platform.OS === "android") {
  AppRegistry.registerHeadlessTask("StripeKeepJsAwakeTask", () => {
    return async () => {
      // No-op task registration: keep task finite so it cannot pin JS forever.
    };
  });
}

import { ActionSheetProvider } from "@expo/react-native-action-sheet";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
// import { AuthProvider, useAuth } from "@/lib/auth-provider"; // EMERGENCY: Disabled
import { EmailVerificationGuard } from "@/components/EmailVerificationGuard";
import MessageNotificationBridge from '@/components/chat/MessageNotificationBridge';
import { PaystackProvider } from 'react-native-paystack-webview';
import { settleExternalOrderPayment } from '@/lib/external-payment-settlement';

// Reserve control of the native launch screen before React mounts. Calling
// hideAsync without this can race iOS splash registration on a cold start.
SplashScreen.preventAutoHideAsync().catch(() => {
  // A previous fast refresh may already own the splash screen.
});

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

// Create a client for React Query
const queryClient = new QueryClient();


export default function RootLayout() {
  const [, error] = useFonts({
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) {
      console.warn("FontAwesome failed to load; continuing with system fallbacks:", error);
    }
  }, [error]);

  useEffect(() => {
    // Release after React has committed its first frame. The short fallback
    // avoids an iOS cold-start race while keeping fonts, auth and network work
    // from ever blocking application startup.
    const frame = requestAnimationFrame(() => {
      SplashScreen.hideAsync().catch((splashError) => {
        console.warn("Failed to hide the native splash screen:", splashError);
      });
    });
    const fallback = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 1500);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
    };
  }, []);

  // Render the application immediately and let Expo auto-hide the native launch
  // screen after the first React frame. Waiting for a JS timer or font promise here
  // can leave Android's splash activity unresponsive and can strand iOS on its
  // launch screen when startup initialization fails. FontAwesome safely updates
  // after loading; an icon fallback is preferable to blocking app startup.
  return <RootLayoutNav />;
}

function AppContent() {
  // EMERGENCY: Completely bypass auth loading check
  const router = useRouter();
  const segments = useSegments();

  const applyPlaybackAudioMode = React.useCallback(() => {
    // Force playback to device speaker when not actively recording.
    // This prevents audio from sticking to the call earpiece after media capture flows.
    return Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      playThroughEarpieceAndroid: false,
    });
  }, []);

  useEffect(() => {
    applyPlaybackAudioMode().catch((audioModeError) => {
      console.warn('Failed to configure global audio mode:', audioModeError);
    });

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        applyPlaybackAudioMode().catch(() => {
          // Ignore here; foreground resume can race native transitions.
        });
      }
    });

    return () => {
      appStateSubscription.remove();
    };
  }, [applyPlaybackAudioMode]);

  useEffect(() => {
    applyPlaybackAudioMode().catch((audioModeError) => {
      console.warn('Failed to refresh audio mode on route change:', audioModeError);
    });
  }, [segments, applyPlaybackAudioMode]);

  // Handle deep links for password reset
  useEffect(() => {
    // Handle initial URL (when app is opened via deep link)
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink(url);
      }
    }).catch((error) => {
      console.warn('Failed to get initial URL:', error);
    });

    // Handle deep links when app is already running
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const handleDeepLink = async (url: string) => {
    console.log('🔗 Deep link received:', url);
    
    try {
      const parsed = Linking.parse(url);
      console.log('📋 Parsed deep link:', parsed);

      if (parsed.scheme === 'myapp' && parsed.hostname === 'paystack' && parsed.path === 'callback') {
        const reference = String(parsed.queryParams?.reference || '').trim();
        const orderId = String(parsed.queryParams?.orderId || '').trim();
        console.log(JSON.stringify({ event: 'paystack_callback_received', orderId, reference }));
        if (reference && orderId) {
          const result = await settleExternalOrderPayment({ orderId, provider: 'paystack', paymentReference: reference });
          router.push({ pathname: '/order/[id]', params: { id: orderId, payment: result.success ? 'confirmed' : 'confirming' } });
        } else {
          router.push('/orders');
        }
        return;
      }

      // Handle password reset deep link (myapp://reset-password)
      if (parsed.scheme === 'myapp' && parsed.hostname === 'reset-password') {
        console.log('🔗 Password reset deep link detected');
        
        // Extract tokens from query params or hash fragment
        // Supabase passes tokens in hash fragment: myapp://reset-password#access_token=...&refresh_token=...
        let accessToken = parsed.queryParams?.access_token as string;
        let refreshToken = parsed.queryParams?.refresh_token as string;
        let type = parsed.queryParams?.type as string;

        // If not in query params, try to extract from hash fragment
        if (!accessToken && url.includes('#')) {
          const hashPart = url.split('#')[1];
          const hashParams = new URLSearchParams(hashPart);
          accessToken = hashParams.get('access_token') || '';
          refreshToken = hashParams.get('refresh_token') || '';
          type = hashParams.get('type') || '';
        }

        console.log('🔑 Password reset tokens found:', {
          hasAccessToken: !!accessToken,
          hasRefreshToken: !!refreshToken,
          type,
          url,
        });

        if (accessToken && refreshToken) {
          // Navigate to reset password screen with tokens (type is optional)
          console.log('✅ Navigating to reset password screen with tokens');
          router.push({
            pathname: '/reset-password',
            params: {
              access_token: accessToken,
              refresh_token: refreshToken,
            },
          });
        } else {
          console.log('⚠️ Deep link received but no tokens found - user may need to click email link again');
          // Still navigate to reset password screen - it will show a message to request new link
          router.push({
            pathname: '/reset-password',
          });
        }
      }
      
      // Handle Supabase verify URLs (https://project.supabase.co/auth/v1/verify)
      // These are password reset links from email that need to be processed
      if (url.includes('supabase.co/auth/v1/verify') || url.includes('/auth/v1/verify')) {
        console.log('🔗 Supabase verify URL detected');
        
        try {
          const urlObj = new URL(url);
          const token = urlObj.searchParams.get('token') || '';
          const type = urlObj.searchParams.get('type') || '';
          const redirectTo = urlObj.searchParams.get('redirect_to') || '';
          
          console.log('📋 Verify URL params:', { hasToken: !!token, type, redirectTo });
          
          // If it's a recovery type and has redirect_to, Supabase will handle the redirect
          // But we can also extract the token and manually navigate
          if (token && type === 'recovery') {
            // The verify URL will redirect to redirect_to with tokens
            // But if the app opened this URL directly, we need to handle it
            // For now, let Supabase handle the redirect to myapp://reset-password
            console.log('✅ Password reset verify URL detected - will redirect to:', redirectTo);
          }
        } catch (e) {
          console.error('❌ Error parsing verify URL:', e);
        }
      }
      
      // Handle Supabase callback URLs (https://project.supabase.co/auth/v1/callback)
      // These URLs contain tokens in the hash fragment after Supabase processes verify
      if (url.includes('supabase.co/auth/v1/callback') || url.includes('/auth/v1/callback')) {
        console.log('🔗 Supabase callback URL detected');
        
        // Extract tokens from hash fragment
        if (url.includes('#')) {
          const hashPart = url.split('#')[1];
          const hashParams = new URLSearchParams(hashPart);
          const accessToken = hashParams.get('access_token') || '';
          const refreshToken = hashParams.get('refresh_token') || '';
          const type = hashParams.get('type') || '';
          
          // Check if redirect_to parameter exists to determine if it's a password reset
          const urlObj = new URL(url);
          const redirectTo = urlObj.searchParams.get('redirect_to') || '';
          
          if (accessToken && refreshToken && (type === 'recovery' || redirectTo.includes('reset-password'))) {
            console.log('🔑 Password reset tokens found in callback URL');
            router.push({
              pathname: '/reset-password',
              params: {
                access_token: accessToken,
                refresh_token: refreshToken,
              },
            });
          }
        }
      }
    } catch (error) {
      console.error('❌ Error handling deep link:', error);
    }
  };
  
  return (
    <ActionSheetProvider>
      <>
                <MessageNotificationBridge />
                <Stack
                  screenOptions={{
                    headerStyle: {
                      backgroundColor: Colors.dark.background,
                    },
                    headerTintColor: Colors.dark.text,
                    headerTitleStyle: {
                      fontWeight: "600",
                      fontSize: 18,
                    },
                    headerBackTitleVisible: false,
                    headerBackButtonDisplayMode: "minimal",
                    headerLeft: ({ tintColor }) => (
                      <AppBackButton tintColor={tintColor} variant="header" />
                    ),
                    contentStyle: {
                      backgroundColor: Colors.dark.background,
                    },
                    headerShadowVisible: false,
                    animation: "slide_from_right",
                  }}
                >
                <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "" }} />
                <Stack.Screen name="(tabsbusiness)" options={{ headerShown: false, title: "" }} />
                <Stack.Screen
                  name="comments"
                  options={{
                    title: "Comments",
                    animation: "slide_from_bottom",
                    headerShown: true,
                    headerStyle: {
                      backgroundColor: Colors.dark.surface,
                    },
                  }}
                />
                <Stack.Screen
                  name="location"
                  options={{
                    title: "Event Location",
                    animation: "slide_from_right",
                    headerShown: false,
                    headerStyle: {
                      backgroundColor: Colors.dark.surface,
                    },
                  }}
                />
                <Stack.Screen
                  name="profile"
                  options={{
                    title: "Profile",
                    animation: "slide_from_right",
                    headerShown: false,
                    headerStyle: {
                      backgroundColor: Colors.dark.surface,
                    },
                  }}
                />
                <Stack.Screen
                  name="ProfileUserScreen"
                  options={{
                    title: "",
                    animation: "slide_from_right",
                    headerShown: false,
                    headerStyle: {
                      backgroundColor: Colors.dark.surface,
                    },
                  }}
                />
                <Stack.Screen
                  name="cart"
                  options={{
                    title: "Shopping Cart",
                    animation: "slide_from_bottom",
                    headerShown: false,
                    headerStyle: {
                      backgroundColor: Colors.dark.surface,
                    },
                  }}
                />
                <Stack.Screen
                  name="event/[id]"
                  options={{
                    title: "Event",
                    animation: "slide_from_right",
                    headerShown: false,
                    headerStyle: {
                      backgroundColor: Colors.dark.surface,
                    },
                  }}
                />
                <Stack.Screen
                  name="signin"
                  options={{
                    title: "Sign In",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                <Stack.Screen
                  name="signup"
                  options={{
                    title: "Sign Up",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                <Stack.Screen
                  name="verify-email"
                  options={{
                    title: "Verify Email",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                <Stack.Screen
                  name="forgot-password"
                  options={{
                    title: "Forgot Password",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                <Stack.Screen
                  name="reset-password"
                  options={{
                    title: "Reset Password",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                <Stack.Screen
                  name="reset-password-simple"
                  options={{
                    title: "Reset Password",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
        <Stack.Screen
          name="reset-password-test"
          options={{
            title: "Reset Password Test",
            headerShown: false,
            animation: "fade",
          }}
        />

                <Stack.Screen
                  name="transactions"
                  options={{
                    title: "Transactions",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                <Stack.Screen
                  name="transaction-details"
                  options={{
                    title: "Transaction Details",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                 <Stack.Screen
                  name="bank-accounts"
                  options={{
                    title: "Bank Accounts",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                  <Stack.Screen
                  name="payment-methods"
                  options={{
                    title: "Payment Methods",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                   <Stack.Screen
                  name="add-payment-method"
                  options={{
                    title: "Add Payment Method",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                 <Stack.Screen
                  name="edit-profile"
                  options={{
                    title: "Edit Profile",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                 <Stack.Screen
                  name="receive-money"
                  options={{
                    title: "Receive Money",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                <Stack.Screen
                  name="scan-qr"
                  options={{
                    title: "Scan Qr",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                <Stack.Screen
                  name="orders"
                  options={{ title: "Orders", headerShown: false, animation: "slide_from_right" }}
                />
                <Stack.Screen
                  name="order/[id]"
                  options={{ title: "Order Details", headerShown: false, animation: "slide_from_right" }}
                />
                <Stack.Screen
                  name="test-auth"
                  options={{
                    title: "Test Auth",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                <Stack.Screen
                  name="vouchers"
                  options={{
                    title: "vouchers",
                    headerShown: false,
                    animation: "fade",
                  }}
                />
                </Stack>
                <AppFloatingBackButton />
      </>
    </ActionSheetProvider>
  );
}

function RootLayoutNav() {
  // Use publishable key from env/config if available, otherwise fall back to the provided key.
  const stripeKey =
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    // Fallback publishable key (set by developer for testing). Replace with env var in production.
    "pk_live_51SnDvXJTbyjuWarpewYMsveVy4MZcwQGtfcSfWa3qq390qr8Da0xFdcoA6Nya6UeUUNsApKVUnWbxw9tf2Mymscp00AbgC2cOa";

  // Read Apple Pay merchant identifier from env or expo config extras. This must match the Merchant ID
  // configured in your Apple Developer account and the Xcode project entitlements.
  const appleMerchantId =
    process.env.EXPO_APPLE_MERCHANT_IDENTIFIER ||
    (Constants?.expoConfig?.extra && (Constants.expoConfig.extra as any).EXPO_APPLE_MERCHANT_IDENTIFIER) ||
    (Constants?.manifest?.extra && (Constants.manifest.extra as any).EXPO_APPLE_MERCHANT_IDENTIFIER) ||
    // Fallback to the merchant id you provided (ensure this matches your Apple Developer Merchant ID)
    "merchant.app.sixtyseconds.nightlife";

  if (!stripeKey) {
    console.warn("Stripe publishable key is not set (EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY). Stripe payments will be disabled.");
    return (
      <>
        <StatusBar style="light" />
        <AuthProvider>
          <trpc.Provider client={trpcClient} queryClient={queryClient}>
            <QueryClientProvider client={queryClient}>
              <AppErrorBoundary>
                <AppContent />
              </AppErrorBoundary>
            </QueryClientProvider>
          </trpc.Provider>
        </AuthProvider>
      </>
    );
  }

  // Wrap children with StripeProvider for both iOS and Android
  // iOS includes Apple Pay + PassKit with proper merchant configuration
  // Android includes Google Pay via Stripe PaymentSheet
  const paystackPublicKey =
    process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY ||
    'pk_test_your_public_key_here';

  const content = (
    <PaystackProvider
      publicKey={paystackPublicKey}
      currency="NGN"
      defaultChannels={['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer']}
      debug={false}
    >
      <AuthProvider>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <AppErrorBoundary>
              <AppContent />
            </AppErrorBoundary>
          </QueryClientProvider>
        </trpc.Provider>
      </AuthProvider>
    </PaystackProvider>
  );

  return (
    <>
      <StatusBar style="light" />
      {StripeProviderComponent ? (
        <StripeProviderComponent
          publishableKey={stripeKey}
          urlScheme="myapp"
          merchantIdentifier={appleMerchantId || undefined}
        >
          {content}
        </StripeProviderComponent>
      ) : (
        content
      )}
    </>
  );
}
