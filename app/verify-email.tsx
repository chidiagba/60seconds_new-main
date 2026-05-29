import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mail, ArrowLeft, RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth';

export default function VerifyEmailScreen() {
  const router = useRouter();
    const insets = useSafeAreaInsets();
  const { resendVerificationEmail, checkEmailVerification, user } = useAuth();
  const [isResending, setIsResending] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    // Get the user's email from the auth context
    if (user?.email) {
      setUserEmail(user.email);
    }
  }, [user]);

  const handleResendVerification = async () => {
    if (!userEmail) {
      Alert.alert('Error', 'No email address found. Please try signing up again.');
      return;
    }

    setIsResending(true);
    try {
      const result = await resendVerificationEmail(userEmail);
      if (result.error) {
        Alert.alert('Error', 'Failed to resend verification email. Please try again.');
      } else {
        Alert.alert(
          'Verification Email Sent!',
          'Please check your email and click the verification link to activate your account.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  const handleCheckVerification = () => {
    const isVerified = checkEmailVerification();
    if (isVerified) {
      Alert.alert(
        'Email Verified!',
        'Your email has been verified successfully. You can now sign in.',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/signin'),
          },
        ]
      );
    } else {
      Alert.alert(
        'Not Verified Yet',
        'Please check your email and click the verification link. If you haven\'t received the email, try resending it.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleGoBack = () => {
    router.replace('/signin');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(20, insets.bottom + 20) },
        ]}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Verify Your Email</Text>
        </View>

        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Mail size={80} color={Colors.dark.primary} />
          </View>

          <Text style={styles.mainTitle}>Check Your Email</Text>
          <Text style={styles.subtitle}>
            We've sent a verification link to:
          </Text>
          <Text style={styles.emailText}>{userEmail}</Text>

          <Text style={styles.description}>
            Please check your email and click the verification link to activate your account. 
            The link will redirect you back to the app.
          </Text>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.primaryButton, isResending && styles.disabledButton]}
              onPress={handleResendVerification}
              disabled={isResending}
            >
              {isResending ? (
                <ActivityIndicator color={Colors.dark.background} size="small" />
              ) : (
                <>
                  <RefreshCw size={20} color={Colors.dark.background} />
                  <Text style={styles.primaryButtonText}>Resend Verification Email</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleCheckVerification}
            >
              <Text style={styles.secondaryButtonText}>I've Verified My Email</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.helpSection}>
            <Text style={styles.helpTitle}>Didn't receive the email?</Text>
            <Text style={styles.helpText}>
              • Check your spam/junk folder{'\n'}
              • Make sure you entered the correct email address{'\n'}
              • Wait a few minutes and try resending{'\n'}
              • Contact support if the problem persists
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 30,
    padding: 20,
    backgroundColor: Colors.dark.card,
    borderRadius: 50,
  },
  mainTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: Colors.dark.subtext,
    marginBottom: 8,
    textAlign: 'center',
  },
  emailText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.dark.primary,
    marginBottom: 24,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 40,
    paddingHorizontal: 10,
  },
  buttonContainer: {
    width: '100%',
    marginBottom: 40,
  },
  primaryButton: {
    backgroundColor: Colors.dark.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginBottom: 16,
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: Colors.dark.background,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: Colors.dark.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: Colors.dark.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  helpSection: {
    width: '100%',
    backgroundColor: Colors.dark.card,
    padding: 20,
    borderRadius: 12,
  },
  helpTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  helpText: {
    fontSize: 14,
    color: Colors.dark.subtext,
    lineHeight: 20,
  },
});