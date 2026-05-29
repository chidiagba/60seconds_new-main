import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth';

type AppBackButtonProps = {
  variant?: 'header' | 'floating';
  tintColor?: string;
};

const FLOATING_BACK_ROUTES = new Set([
  'location',
  'profile',
  'ProfileUserScreen',
  'cart',
  'event',
  'signin',
  'signup',
  'verify-email',
  'forgot-password',
  'reset-password',
  'reset-password-simple',
  'reset-password-test',
  'transactions',
  'bank-accounts',
  'payment-methods',
  'add-payment-method',
  'edit-profile',
  'receive-money',
  'scan-qr',
  'test-auth',
  'vouchers',
]);

const resolveFallbackRoute = (isBusinessAccount: boolean, isSignedIn: boolean) => {
  if (!isSignedIn) {
    return '/signin';
  }

  return isBusinessAccount ? '/(tabsbusiness)' : '/(tabs)';
};

export function AppBackButton({ variant = 'header', tintColor }: AppBackButtonProps) {
  const router = useRouter();
  const { user, profile } = useAuth();

  const iconColor = tintColor || Colors.dark.text;
  const isBusinessAccount = profile?.user_type === 'business';

  const handlePress = React.useCallback(() => {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(resolveFallbackRoute(isBusinessAccount, !!user) as any);
  }, [isBusinessAccount, router, user]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={12}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.baseButton,
        variant === 'floating' ? styles.floatingButton : styles.headerButton,
        pressed && styles.buttonPressed,
      ]}
    >
      <ChevronLeft color={iconColor} size={22} strokeWidth={2.4} />
    </Pressable>
  );
}

export function AppFloatingBackButton() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();

  const firstSegment = segments[0];
  const isMainTabRoute = firstSegment === '(tabs)' || firstSegment === '(tabsbusiness)';
  const shouldShow = !!firstSegment && !isMainTabRoute && FLOATING_BACK_ROUTES.has(firstSegment);

  if (!shouldShow) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={[styles.floatingContainer, { top: Math.max(insets.top + 8, 16) }]}>
        <AppBackButton variant="floating" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  baseButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(22,22,31,0.88)',
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginLeft: 2,
  },
  floatingButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  floatingContainer: {
    position: 'absolute',
    left: 16,
    zIndex: 1000,
  },
  buttonPressed: {
    opacity: 0.78,
  },
});