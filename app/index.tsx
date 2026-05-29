import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useAuth } from '@/lib/auth';
import Colors from '@/constants/colors';

export default function IndexScreen() {
  const { loading, user, profile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      const userType = profile?.user_type || user?.user_metadata?.user_type;
      const href = userType === 'business' ? '/(tabsbusiness)' : '/(tabs)';
      
      // Use replace so the user cannot go back to this screen
      router.replace(href as any);
    }
  }, [loading, user, profile, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <ActivityIndicator size="large" color={Colors.dark.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.background,
  },
});
