import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';

export default function EmailConfirmedScreen() {
  const router = useRouter();

  useEffect(() => {
    const clearSession = async () => {
      try {
        await supabase.auth.signOut();
      } catch (error) {
        console.warn('Failed to clear session after email confirmation:', error);
      }
    };

    void clearSession();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome, Email Confirmed</Text>
      <Text style={styles.subtitle}>
        Your email is confirmed. You can now login in the app with your email and password.
      </Text>

      <TouchableOpacity style={styles.button} onPress={() => router.replace('/signin')}>
        <Text style={styles.buttonText}>Go To Sign In</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    color: Colors.dark.text,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 14,
  },
  subtitle: {
    color: Colors.dark.subtext,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  button: {
    alignSelf: 'center',
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 10,
  },
  buttonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
