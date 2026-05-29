import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, User, Building2, Eye, EyeOff } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [accountType, setAccountType] = useState<'personal' | 'business'>('personal');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSignup = async () => {
    // Validation
    if (!email || !password || !fullName || !username) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (accountType === 'business' && (!businessName || !businessType)) {
      Alert.alert('Error', 'Please fill in business information');
      return;
    }

    setIsLoading(true);

    try {
      console.log('🚀 Starting signup process...');
      console.log('Email:', email);
      console.log('Account Type:', accountType);
      console.log('Full Name:', fullName);
      console.log('Username:', username);

      // Step 1: Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) {
        console.error('❌ Auth signup failed:', authError.message);
        Alert.alert('Signup Failed', authError.message);
        return;
      }

      if (!authData.user) {
        Alert.alert('Signup Failed', 'No user data returned');
        return;
      }

      console.log('✅ Auth user created:', authData.user.id);

      // Step 2: Create profile
      const profileData = {
        id: authData.user.id,
        email: email,
        full_name: fullName,
        username: username,
        user_type: accountType,
        followers_count: 0,
        following_count: 0,
        ...(accountType === 'business' && {
          business_name: businessName,
          business_type: businessType,
        }),
      };

      console.log('📝 Creating profile with data:', profileData);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .insert(profileData)
        .select()
        .single();

      if (profileError) {
        console.error('❌ Profile creation failed:', profileError.message);
        Alert.alert('Profile Creation Failed', profileError.message);
        return;
      }

      console.log('✅ Profile created successfully:', profile.id);

      // Success
      Alert.alert(
        'Signup Successful!',
        'Your account has been created successfully. Please check your email to verify your account.',
        [
          {
            text: 'OK',
            onPress: () => router.push('/signin'),
          },
        ]
      );

    } catch (error) {
      console.error('❌ Signup error:', error);
      Alert.alert('Signup Failed', 'An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Create Account</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Form */}
        <View style={styles.form}>
          {/* Account Type Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account Type</Text>
            <View style={styles.accountTypeContainer}>
              <TouchableOpacity
                style={[
                  styles.accountTypeOption,
                  accountType === 'personal' && styles.selectedAccountType,
                ]}
                onPress={() => setAccountType('personal')}
              >
                <User
                  size={32}
                  color={accountType === 'personal' ? Colors.dark.primary : Colors.dark.subtext}
                />
                <Text
                  style={[
                    styles.accountTypeText,
                    accountType === 'personal' && styles.selectedAccountTypeText,
                  ]}
                >
                  Personal Account
                </Text>
                <Text style={styles.accountTypeDescription}>
                  For individuals and content creators
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.accountTypeOption,
                  accountType === 'business' && styles.selectedAccountType,
                ]}
                onPress={() => setAccountType('business')}
              >
                <Building2
                  size={32}
                  color={accountType === 'business' ? Colors.dark.primary : Colors.dark.subtext}
                />
                <Text
                  style={[
                    styles.accountTypeText,
                    accountType === 'business' && styles.selectedAccountTypeText,
                  ]}
                >
                  Business Account
                </Text>
                <Text style={styles.accountTypeDescription}>
                  For businesses, venues, and event organizers
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Basic Information */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Basic Information</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name *</Text>
              <TextInput
                style={styles.textInput}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Enter your full name"
                placeholderTextColor={Colors.dark.subtext}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Username *</Text>
              <TextInput
                style={styles.textInput}
                value={username}
                onChangeText={setUsername}
                placeholder="Choose a username"
                placeholderTextColor={Colors.dark.subtext}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email Address *</Text>
              <TextInput
                style={styles.textInput}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor={Colors.dark.subtext}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password *</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Create a password"
                  placeholderTextColor={Colors.dark.subtext}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                >
                  {showPassword ? (
                    <EyeOff size={20} color={Colors.dark.subtext} />
                  ) : (
                    <Eye size={20} color={Colors.dark.subtext} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Confirm Password *</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm your password"
                  placeholderTextColor={Colors.dark.subtext}
                  secureTextEntry={!showConfirmPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.eyeButton}
                >
                  {showConfirmPassword ? (
                    <EyeOff size={20} color={Colors.dark.subtext} />
                  ) : (
                    <Eye size={20} color={Colors.dark.subtext} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Business Information - Only show for business accounts */}
          {accountType === 'business' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Business Information</Text>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Business Name *</Text>
                <TextInput
                  style={styles.textInput}
                  value={businessName}
                  onChangeText={setBusinessName}
                  placeholder="Enter your business name"
                  placeholderTextColor={Colors.dark.subtext}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Business Type *</Text>
                <TextInput
                  style={styles.textInput}
                  value={businessType}
                  onChangeText={setBusinessType}
                  placeholder="e.g., Restaurant, Event Venue, etc."
                  placeholderTextColor={Colors.dark.subtext}
                />
              </View>
            </View>
          )}

          {/* Signup Button */}
          <TouchableOpacity
            style={[styles.signupButton, isLoading && styles.signupButtonDisabled]}
            onPress={handleSignup}
            disabled={isLoading}
          >
            <Text style={styles.signupButtonText}>
              {isLoading ? 'Creating Account...' : 'Create Account'}
            </Text>
          </TouchableOpacity>

          {/* Sign In Link */}
          <View style={styles.signInContainer}>
            <Text style={styles.signInText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/signin')}>
              <Text style={styles.signInLink}>Sign In</Text>
            </TouchableOpacity>
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  placeholder: {
    width: 40,
  },
  form: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.dark.text,
    marginBottom: 16,
  },
  accountTypeContainer: {
    gap: 16,
  },
  accountTypeOption: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedAccountType: {
    borderColor: Colors.dark.primary,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
  },
  accountTypeText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
    marginTop: 8,
    marginBottom: 4,
  },
  selectedAccountTypeText: {
    color: Colors.dark.primary,
  },
  accountTypeDescription: {
    fontSize: 14,
    color: Colors.dark.subtext,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  passwordInput: {
    flex: 1,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
  },
  eyeButton: {
    padding: 12,
  },
  signupButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  signupButtonDisabled: {
    backgroundColor: Colors.dark.subtext,
  },
  signupButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '600',
  },
  signInContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  signInText: {
    color: Colors.dark.subtext,
    fontSize: 14,
  },
  signInLink: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: '600',
  },
});






















