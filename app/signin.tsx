import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { useRouter, Link, useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Eye, EyeOff } from 'lucide-react-native';
import { Image } from 'expo-image';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';


export default function CleanSigninScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ allowSkip?: string; prompt?: string }>();
  const insets = useSafeAreaInsets();
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [signInError, setSignInError] = useState('');
  const allowSkip = useMemo(() => params.allowSkip === '1' || params.prompt === '1', [params.allowSkip, params.prompt]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (loading || !user) {
      return;
    }

    const isBusinessUser = (profile?.user_type || user.user_metadata?.user_type) === 'business';
    router.replace(isBusinessUser ? '/(tabsbusiness)' : '/(tabs)');
  }, [loading, profile?.user_type, router, user]);

  const handleSignin = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    setSignInError('');

    if (!normalizedEmail || !password) {
      setSignInError('Please fill in all fields.');
      return;
    }

    setIsLoading(true);
    let shouldStopLoading = true;

    try {
      const { data: verificationData, error: verificationError } = await supabase.functions.invoke('get-uid-by-email', {
        body: { email: normalizedEmail },
      });

      if (!verificationError && verificationData?.uid && verificationData?.otp_verified !== true) {
        let pinSent = false;
        const { data: otpData, error: otpSendError } = await supabase.functions.invoke('send-otp', {
          body: {
            email: normalizedEmail,
            type: 'signup',
            user_id: verificationData.uid,
          },
        });

        if (!otpSendError && otpData?.success) {
          pinSent = true;
        }

        if (!pinSent) {
          const { error: smtpOtpError } = await supabase.auth.signInWithOtp({
            email: normalizedEmail,
            options: {
              shouldCreateUser: false,
            },
          });
          if (!smtpOtpError) {
            pinSent = true;
          }
        }

        if (!pinSent) {
          const reason = (otpData as any)?.message || otpSendError?.message || 'Failed to send PIN code.';
          setSignInError(`${reason} Please use Resend on the verification screen.`);
        } else {
          setSignInError('A PIN code has been sent to your email. Please verify to continue.');
        }

        router.replace(`/verify-otp?email=${encodeURIComponent(normalizedEmail)}&user_id=${encodeURIComponent(verificationData.uid)}&pin_sent=${pinSent ? '1' : '0'}`);
        return;
      }

      // ── Step 1: Authenticate verified account ────────────────────────────
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (authError) {
        const msg = (authError.message || '').toLowerCase();
        if (msg.includes('email not confirmed') || msg.includes('email not verified') || msg.includes('not confirmed')) {
          setSignInError('Please complete PIN verification from your email before signing in.');
        } else {
          setSignInError(authError.message || 'Sign in failed.');
        }
        return;
      }

      if (!authData?.user) {
        setSignInError('No user data returned. Please try again.');
        return;
      }

      const signupOtpVerifiedAt = authData.user.app_metadata?.signup_otp_verified_at;
      if (!signupOtpVerifiedAt) {
        try {
          await supabase.auth.signOut();
        } catch (signOutError) {
          console.warn('Failed to clear incomplete-verification session after blocked sign-in:', signOutError);
        }

        setSignInError('Please complete PIN verification from your email before signing in.');
        router.replace(`/verify-otp?email=${encodeURIComponent(normalizedEmail)}&user_id=${encodeURIComponent(authData.user.id)}`);
        return;
      }

      // Wait for the auth provider to finish syncing session and profile state,
      // then the effect above will navigate to the correct feed.
      shouldStopLoading = false;
    } catch (error: any) {
      if (isMountedRef.current) {
        setSignInError(error?.message || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      if (shouldStopLoading && isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(40, insets.bottom + 20) }]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          {allowSkip && (
            <TouchableOpacity style={styles.signUpLink} onPress={() => router.back()}>
              <Text style={styles.signUpLinkText}>Skip</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.logoContainer}>
          <View style={styles.logoImageContainer}>
            <Image
              source={require('../assets/images/second.png')}
              style={styles.logoImage}
              contentFit="contain"
              transition={300}
            />
          </View>
          <Text style={styles.logoText}>60Seconds</Text>
        </View>

        <View style={styles.formContainer}>
          {signInError ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{signInError}</Text>
            </View>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email Address</Text>
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
            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
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

          <View style={styles.forgotPasswordContainer}>
            <Link href="/forgot-password" asChild>
              <TouchableOpacity>
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </TouchableOpacity>
            </Link>
          </View>

          <TouchableOpacity
            style={[styles.signinButton, isLoading && styles.signinButtonDisabled]}
            onPress={handleSignin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={Colors.dark.text} size="small" />
            ) : (
              <Text style={styles.signinButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>



          <View style={styles.signupContainer}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <Link href="/signup" asChild>
              <TouchableOpacity>
                <Text style={styles.signupLink}>Sign Up</Text>
              </TouchableOpacity>
            </Link>
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
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signUpLink: {
    padding: 8,
  },
  signUpLinkText: {
    color: Colors.dark.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  logoImageContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  logoText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  formContainer: {
    paddingHorizontal: 24,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  inputGroup: {
    marginBottom: 20,
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
  signinButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  signinButtonDisabled: {
    backgroundColor: Colors.dark.subtext,
  },
  signinButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '600',
  },
  forgotPasswordContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  forgotPasswordLink: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  signupContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  signupText: {
    color: Colors.dark.subtext,
    fontSize: 14,
  },
  signupLink: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  forgotPasswordText: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: '500',
  },
});




















// import React, { useState } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   TextInput,
//   TouchableOpacity,
//   ScrollView,
//   Alert,
//   Platform,
//   KeyboardAvoidingView,
// } from 'react-native';
// import { useRouter, Link } from 'expo-router';
// import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';
// import { Image } from 'expo-image';
// import Colors from '@/constants/colors';
// import { supabase } from '@/lib/supabase';
// import * as Location from 'expo-location';
// import AsyncStorage from '@react-native-async-storage/async-storage';

// export default function CleanSigninScreen() {
//   const router = useRouter();
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [isLoading, setIsLoading] = useState(false);
//   const [showPassword, setShowPassword] = useState(false);

//   const BG_DISCLOSURE_SHOWN_KEY = 'bg_location_disclosure_shown_v1';

//   const requestBackgroundLocationWithDisclosure = async () => {
//     try {
//       // If already granted, do nothing (prevents any dialog)
//       const existing = await Location.getBackgroundPermissionsAsync();
//       if (existing.status === 'granted') {
//         return true;
//       }

//       // Show disclosure only ONCE
//       const alreadyShown = await AsyncStorage.getItem(BG_DISCLOSURE_SHOWN_KEY);
//       if (!alreadyShown) {
//         const userAccepted = await new Promise<boolean>((resolve) => {
//           Alert.alert(
//             'Background Location Access',
//             'This app collects location data to enable location-based features even when the app is closed or not in use.\n\nDo you allow background location access?',
//             [
//               {
//                 text: 'No',
//                 style: 'cancel',
//                 onPress: () => resolve(false),
//               },
//               {
//                 text: 'Yes',
//                 onPress: () => resolve(true),
//               },
//             ],
//             { cancelable: false }
//           );
//         });

//         // Mark as shown (so it never appears again)
//         await AsyncStorage.setItem(BG_DISCLOSURE_SHOWN_KEY, '1');

//         // If user said NO, do not show the permission dialog
//         if (!userAccepted) return false;
//       }

//       // After disclosure (or if already shown), request permissions ONLY if not granted
//       const fg = await Location.getForegroundPermissionsAsync();
//       if (fg.status !== 'granted') {
//         const fgReq = await Location.requestForegroundPermissionsAsync();
//         if (fgReq.status !== 'granted') return false;
//       }

//       const bg = await Location.getBackgroundPermissionsAsync();
//       if (bg.status !== 'granted') {
//         const bgReq = await Location.requestBackgroundPermissionsAsync();
//         return bgReq.status === 'granted';
//       }

//       return true;
//     } catch (e) {
//       return false;
//     }
//   };

//   const handleSignin = async () => {
//     // Validation
//     if (!email || !password) {
//       Alert.alert('Error', 'Please fill in all fields');
//       return;
//     }

//     setIsLoading(true);

//     try {
//       // Sign in with Supabase
//       const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
//         email,
//         password,
//       });

//       if (authError) {
//         Alert.alert('Signin Failed', authError.message);
//         return;
//       }

//       if (!authData.user) {
//         Alert.alert('Signin Failed', 'No user data returned');
//         return;
//       }

//       if (!authData.user.email_confirmed_at) {
//         Alert.alert(
//           'Email Not Verified',
//           'Please verify your email address before signing in. Check your email for a verification link.',
//           [
//             {
//               text: 'Resend Verification',
//               onPress: () => {
//                 // Navigate to verification screen
//                 router.replace('/verify-email');
//               },
//             },
//             {
//               text: 'OK',
//               style: 'cancel',
//             },
//           ]
//         );
//         return;
//       }

//       // Fetch user profile
//       const { data: profile, error: profileError } = await supabase
//         .from('profiles')
//         .select('*')
//         .eq('id', authData.user.id)
//         .single();

//       if (profileError) {
//         Alert.alert('Profile Error', 'Could not load user profile');
//         return;
//       }

//       // Success - navigate to home
//       Alert.alert('Welcome Back!', `Hello ${profile.full_name}!`, [
//         {
//           text: 'OK',
//           onPress: async () => {
//             await requestBackgroundLocationWithDisclosure();
//             router.replace('/(tabs)');
//           },
//         },
//       ]);
//     } catch (error) {
//       Alert.alert('Signin Failed', 'An unexpected error occurred. Please try again.');
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   return (
//     <KeyboardAvoidingView
//       style={styles.container}
//       behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
//       keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
//     >
//       <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
//         {/* Header */}
//         <View style={styles.header}>
//           <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
//             <ArrowLeft size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//           <Link href="/signup" asChild>
//             <TouchableOpacity style={styles.signUpLink}>
//               <Text style={styles.signUpLinkText}>Sign Up</Text>
//             </TouchableOpacity>
//           </Link>
//         </View>

//         {/* Logo */}
//         <View style={styles.logoContainer}>
//           <View style={styles.logoImageContainer}>
//             <Image
//               source={require('../assets/images/second.png')}
//               style={styles.logoImage}
//               contentFit="contain"
//               transition={300}
//             />
//           </View>
//           <Text style={styles.logoText}>60Seconds</Text>
//         </View>

//         {/* Form */}
//         <View style={styles.formContainer}>
//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Email Address</Text>
//             <TextInput
//               style={styles.textInput}
//               value={email}
//               onChangeText={setEmail}
//               placeholder="Enter your email"
//               placeholderTextColor={Colors.dark.subtext}
//               keyboardType="email-address"
//               autoCapitalize="none"
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Password</Text>
//             <View style={styles.passwordContainer}>
//               <TextInput
//                 style={styles.passwordInput}
//                 value={password}
//                 onChangeText={setPassword}
//                 placeholder="Enter your password"
//                 placeholderTextColor={Colors.dark.subtext}
//                 secureTextEntry={!showPassword}
//               />
//               <TouchableOpacity
//                 onPress={() => setShowPassword(!showPassword)}
//                 style={styles.eyeButton}
//               >
//                 {showPassword ? (
//                   <EyeOff size={20} color={Colors.dark.subtext} />
//                 ) : (
//                   <Eye size={20} color={Colors.dark.subtext} />
//                 )}
//               </TouchableOpacity>
//             </View>
//           </View>

//           {/* Forgot Password Link */}
//           <View style={styles.forgotPasswordContainer}>
//             <Link href="/forgot-password" asChild>
//               <TouchableOpacity>
//                 <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
//               </TouchableOpacity>
//             </Link>
//           </View>

//           {/* Signin Button */}
//           <TouchableOpacity
//             style={[styles.signinButton, isLoading && styles.signinButtonDisabled]}
//             onPress={handleSignin}
//             disabled={isLoading}
//           >
//             <Text style={styles.signinButtonText}>{isLoading ? 'Signing In...' : 'Sign In'}</Text>
//           </TouchableOpacity>

//           {/* Forgot Password Link */}
//           <View style={styles.forgotPasswordContainer}>
//             <Link href="/forgot-password" asChild>
//               <TouchableOpacity>
//                 <Text style={styles.forgotPasswordLink}>Forgot Password?</Text>
//               </TouchableOpacity>
//             </Link>
//           </View>

//           {/* Signup Link */}
//           <View style={styles.signupContainer}>
//             <Text style={styles.signupText}>Don't have an account? </Text>
//             <Link href="/signup" asChild>
//               <TouchableOpacity>
//                 <Text style={styles.signupLink}>Sign Up</Text>
//               </TouchableOpacity>
//             </Link>
//           </View>
//         </View>
//       </ScrollView>
//     </KeyboardAvoidingView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   scrollContent: {
//     flexGrow: 1,
//     paddingBottom: 40,
//   },
//   header: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingHorizontal: 24,
//     paddingTop: 60,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   signUpLink: {
//     padding: 8,
//   },
//   signUpLinkText: {
//     color: Colors.dark.primary,
//     fontSize: 16,
//     fontWeight: '600',
//   },
//   logoContainer: {
//     alignItems: 'center',
//     marginTop: 20,
//     marginBottom: 40,
//   },
//   logoImageContainer: {
//     width: 120,
//     height: 120,
//     borderRadius: 60,
//     marginBottom: 16,
//     backgroundColor: 'transparent',
//   },
//   // logoImageContainer: {
//   //   width: 120,
//   //   height: 120,
//   //   borderRadius: 100,
//   //   overflow: 'hidden',
//   //   borderWidth: 2,
//   //   borderColor: Colors.dark.primary,
//   //   marginBottom: 16,
//   //   elevation: 8,
//   //   shadowColor: Colors.dark.primary,
//   //   shadowOffset: { width: 0, height: 4 },
//   //   shadowOpacity: 0.3,
//   //   shadowRadius: 8,
//   // },
//   logoImage: {
//     width: '100%',
//     height: '100%',
//   },
//   logoText: {
//     fontSize: 28,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//   },
//   formContainer: {
//     paddingHorizontal: 24,
//   },
//   inputGroup: {
//     marginBottom: 20,
//   },
//   inputLabel: {
//     fontSize: 14,
//     fontWeight: '500',
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   textInput: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   passwordContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   passwordInput: {
//     flex: 1,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//   },
//   eyeButton: {
//     padding: 12,
//   },
//   signinButton: {
//     backgroundColor: Colors.dark.primary,
//     borderRadius: 8,
//     paddingVertical: 16,
//     alignItems: 'center',
//     marginTop: 20,
//     marginBottom: 20,
//   },
//   signinButtonDisabled: {
//     backgroundColor: Colors.dark.subtext,
//   },
//   signinButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: '600',
//   },
//   forgotPasswordContainer: {
//     alignItems: 'center',
//     marginBottom: 20,
//   },
//   forgotPasswordLink: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: '500',
//   },
//   signupContainer: {
//     flexDirection: 'row',
//     justifyContent: 'center',
//     alignItems: 'center',
//     marginBottom: 40,
//   },
//   signupText: {
//     color: Colors.dark.subtext,
//     fontSize: 14,
//   },
//   signupLink: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: '600',
//   },
//   forgotPasswordText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: '500',
//   },
// });










// import React, { useState } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   TextInput,
//   TouchableOpacity,
//   ScrollView,
//   Alert,
//   Platform,
//   KeyboardAvoidingView,
// } from 'react-native';
// import { useRouter, Link } from 'expo-router';
// import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';
// import { Image } from 'expo-image';
// import Colors from '@/constants/colors';
// import { supabase } from '@/lib/supabase';
// import * as Location from 'expo-location';

// export default function CleanSigninScreen() {
//   const router = useRouter();
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [isLoading, setIsLoading] = useState(false);
//   const [showPassword, setShowPassword] = useState(false);

//   const requestBackgroundLocationWithDisclosure = async () => {
//     return new Promise<boolean>((resolve) => {
//       Alert.alert(
//         'Background Location Access',
//         'This app collects location data to enable location-based features even when the app is closed or not in use.\n\nDo you allow background location access?',
//         [
//           {
//             text: 'No',
//             style: 'cancel',
//             onPress: () => resolve(false),
//           },
//           {
//             text: 'Yes',
//             onPress: () => {
//               (async () => {
//                 try {
//                   // Foreground permission is required before background (especially on iOS)
//                   const fg = await Location.requestForegroundPermissionsAsync();
//                   if (fg.status !== 'granted') {
//                     resolve(false);
//                     return;
//                   }

//                   const bg = await Location.requestBackgroundPermissionsAsync();
//                   resolve(bg.status === 'granted');
//                 } catch (e) {
//                   resolve(false);
//                 }
//               })();
//             },
//           },
//         ],
//         { cancelable: false }
//       );
//     });
//   };

//   const handleSignin = async () => {
//     // Validation
//     if (!email || !password) {
//       Alert.alert('Error', 'Please fill in all fields');
//       return;
//     }

//     setIsLoading(true);

//     try {
//       // Sign in with Supabase
//       const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
//         email,
//         password,
//       });

//       if (authError) {
//         Alert.alert('Signin Failed', authError.message);
//         return;
//       }

//       if (!authData.user) {
//         Alert.alert('Signin Failed', 'No user data returned');
//         return;
//       }

//       if (!authData.user.email_confirmed_at) {
//         Alert.alert(
//           'Email Not Verified',
//           'Please verify your email address before signing in. Check your email for a verification link.',
//           [
//             {
//               text: 'Resend Verification',
//               onPress: () => {
//                 // Navigate to verification screen
//                 router.replace('/verify-email');
//               },
//             },
//             {
//               text: 'OK',
//               style: 'cancel',
//             },
//           ]
//         );
//         return;
//       }

//       // Fetch user profile
//       const { data: profile, error: profileError } = await supabase
//         .from('profiles')
//         .select('*')
//         .eq('id', authData.user.id)
//         .single();

//       if (profileError) {
//         Alert.alert('Profile Error', 'Could not load user profile');
//         return;
//       }

//       // Success - navigate to home
//       Alert.alert('Welcome Back!', `Hello ${profile.full_name}!`, [
//         {
//           text: 'OK',
//           onPress: async () => {
//             await requestBackgroundLocationWithDisclosure();
//             router.replace('/(tabs)');
//           },
//         },
//       ]);
//     } catch (error) {
//       Alert.alert('Signin Failed', 'An unexpected error occurred. Please try again.');
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   return (
//     <KeyboardAvoidingView
//       style={styles.container}
//       behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
//       keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
//     >
//       <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
//         {/* Header */}
//         <View style={styles.header}>
//           <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
//             <ArrowLeft size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//           <Link href="/signup" asChild>
//             <TouchableOpacity style={styles.signUpLink}>
//               <Text style={styles.signUpLinkText}>Sign Up</Text>
//             </TouchableOpacity>
//           </Link>
//         </View>

//         {/* Logo */}
//         <View style={styles.logoContainer}>
//           <View style={styles.logoImageContainer}>
//             <Image
//               source={require('../assets/images/second.png')}
//               style={styles.logoImage}
//               contentFit="contain"
//               transition={300}
//             />
//           </View>
//           <Text style={styles.logoText}>60Seconds</Text>
//         </View>

//         {/* Form */}
//         <View style={styles.formContainer}>
//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Email Address</Text>
//             <TextInput
//               style={styles.textInput}
//               value={email}
//               onChangeText={setEmail}
//               placeholder="Enter your email"
//               placeholderTextColor={Colors.dark.subtext}
//               keyboardType="email-address"
//               autoCapitalize="none"
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Password</Text>
//             <View style={styles.passwordContainer}>
//               <TextInput
//                 style={styles.passwordInput}
//                 value={password}
//                 onChangeText={setPassword}
//                 placeholder="Enter your password"
//                 placeholderTextColor={Colors.dark.subtext}
//                 secureTextEntry={!showPassword}
//               />
//               <TouchableOpacity
//                 onPress={() => setShowPassword(!showPassword)}
//                 style={styles.eyeButton}
//               >
//                 {showPassword ? (
//                   <EyeOff size={20} color={Colors.dark.subtext} />
//                 ) : (
//                   <Eye size={20} color={Colors.dark.subtext} />
//                 )}
//               </TouchableOpacity>
//             </View>
//           </View>

//           {/* Forgot Password Link */}
//           <View style={styles.forgotPasswordContainer}>
//             <Link href="/forgot-password" asChild>
//               <TouchableOpacity>
//                 <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
//               </TouchableOpacity>
//             </Link>
//           </View>

//           {/* Signin Button */}
//           <TouchableOpacity
//             style={[styles.signinButton, isLoading && styles.signinButtonDisabled]}
//             onPress={handleSignin}
//             disabled={isLoading}
//           >
//             <Text style={styles.signinButtonText}>{isLoading ? 'Signing In...' : 'Sign In'}</Text>
//           </TouchableOpacity>

//           {/* Forgot Password Link */}
//           <View style={styles.forgotPasswordContainer}>
//             <Link href="/forgot-password" asChild>
//               <TouchableOpacity>
//                 <Text style={styles.forgotPasswordLink}>Forgot Password?</Text>
//               </TouchableOpacity>
//             </Link>
//           </View>

//           {/* Signup Link */}
//           <View style={styles.signupContainer}>
//             <Text style={styles.signupText}>Don't have an account? </Text>
//             <Link href="/signup" asChild>
//               <TouchableOpacity>
//                 <Text style={styles.signupLink}>Sign Up</Text>
//               </TouchableOpacity>
//             </Link>
//           </View>
//         </View>
//       </ScrollView>
//     </KeyboardAvoidingView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   scrollContent: {
//     flexGrow: 1,
//     paddingBottom: 40,
//   },
//   header: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingHorizontal: 24,
//     paddingTop: 60,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   signUpLink: {
//     padding: 8,
//   },
//   signUpLinkText: {
//     color: Colors.dark.primary,
//     fontSize: 16,
//     fontWeight: '600',
//   },
//   logoContainer: {
//     alignItems: 'center',
//     marginTop: 20,
//     marginBottom: 40,
//   },
//   logoImageContainer: {
//     width: 120,
//     height: 120,
//     borderRadius: 60,
//     marginBottom: 16,
//     backgroundColor: 'transparent',
//   },
//   // logoImageContainer: {
//   //   width: 120,
//   //   height: 120,
//   //   borderRadius: 100,
//   //   overflow: 'hidden',
//   //   borderWidth: 2,
//   //   borderColor: Colors.dark.primary,
//   //   marginBottom: 16,
//   //   elevation: 8,
//   //   shadowColor: Colors.dark.primary,
//   //   shadowOffset: { width: 0, height: 4 },
//   //   shadowOpacity: 0.3,
//   //   shadowRadius: 8,
//   // },
//   logoImage: {
//     width: '100%',
//     height: '100%',
//   },
//   logoText: {
//     fontSize: 28,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//   },
//   formContainer: {
//     paddingHorizontal: 24,
//   },
//   inputGroup: {
//     marginBottom: 20,
//   },
//   inputLabel: {
//     fontSize: 14,
//     fontWeight: '500',
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   textInput: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   passwordContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   passwordInput: {
//     flex: 1,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//   },
//   eyeButton: {
//     padding: 12,
//   },
//   signinButton: {
//     backgroundColor: Colors.dark.primary,
//     borderRadius: 8,
//     paddingVertical: 16,
//     alignItems: 'center',
//     marginTop: 20,
//     marginBottom: 20,
//   },
//   signinButtonDisabled: {
//     backgroundColor: Colors.dark.subtext,
//   },
//   signinButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: '600',
//   },
//   forgotPasswordContainer: {
//     alignItems: 'center',
//     marginBottom: 20,
//   },
//   forgotPasswordLink: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: '500',
//   },
//   signupContainer: {
//     flexDirection: 'row',
//     justifyContent: 'center',
//     alignItems: 'center',
//     marginBottom: 40,
//   },
//   signupText: {
//     color: Colors.dark.subtext,
//     fontSize: 14,
//   },
//   signupLink: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: '600',
//   },
//   forgotPasswordText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: '500',
//   },
// });












// import React, { useState } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   TextInput,
//   TouchableOpacity,
//   ScrollView,
//   Alert,
//   Platform,
//   KeyboardAvoidingView,
// } from 'react-native';
// import { useRouter, Link } from 'expo-router';
// import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';
// import { Image } from 'expo-image';
// import Colors from '@/constants/colors';
// import { supabase } from '@/lib/supabase';

// export default function CleanSigninScreen() {
//   const router = useRouter();
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [isLoading, setIsLoading] = useState(false);
//   const [showPassword, setShowPassword] = useState(false);


//   const handleSignin = async () => {
//     // Validation
//     if (!email || !password) {
//       Alert.alert('Error', 'Please fill in all fields');
//       return;
//     }

//     setIsLoading(true);

//     try {
//       // Sign in with Supabase
//       const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
//         email,
//         password,
//       });

//       if (authError) {
//         Alert.alert('Signin Failed', authError.message);
//         return;
//       }

//       if (!authData.user) {
//         Alert.alert('Signin Failed', 'No user data returned');
//         return;
//       }

//       if (!authData.user.email_confirmed_at) {
//         Alert.alert(
//           'Email Not Verified',
//           'Please verify your email address before signing in. Check your email for a verification link.',
//           [
//             {
//               text: 'Resend Verification',
//               onPress: () => {
//                 // Navigate to verification screen
//                 router.replace('/verify-email');
//               },
//             },
//             {
//               text: 'OK',
//               style: 'cancel',
//             },
//           ]
//         );
//         return;
//       }

//       // Fetch user profile
//       const { data: profile, error: profileError } = await supabase
//         .from('profiles')
//         .select('*')
//         .eq('id', authData.user.id)
//         .single();

//       if (profileError) {
//         Alert.alert('Profile Error', 'Could not load user profile');
//         return;
//       }

//       // Success - navigate to home
//       Alert.alert(
//         'Welcome Back!',
//         `Hello ${profile.full_name}!`,
//         [
//           {
//             text: 'OK',
//             onPress: () => router.replace('/(tabs)'),
//           },
//         ]
//       );

//     } catch (error) {
//       Alert.alert('Signin Failed', 'An unexpected error occurred. Please try again.');
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   return (
//     <KeyboardAvoidingView
//       style={styles.container}
//       behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
//       keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
//     >
//       <ScrollView 
//         contentContainerStyle={styles.scrollContent}
//         keyboardShouldPersistTaps="handled"
//       >
//         {/* Header */}
//         <View style={styles.header}>
//           <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
//             <ArrowLeft size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//           <Link href="/signup" asChild>
//             <TouchableOpacity style={styles.signUpLink}>
//               <Text style={styles.signUpLinkText}>Sign Up</Text>
//             </TouchableOpacity>
//           </Link>
//         </View>
        
//         {/* Logo */}
//         <View style={styles.logoContainer}>
//           <View style={styles.logoImageContainer}>
//             <Image
//               source={require('../assets/images/second.png')}
//               style={styles.logoImage}
//               contentFit="contain"
//               transition={300}
//             />
//           </View>
//           <Text style={styles.logoText}>60Seconds</Text>
//         </View>

//         {/* Form */}
//         <View style={styles.formContainer}>
//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Email Address</Text>
//             <TextInput
//               style={styles.textInput}
//               value={email}
//               onChangeText={setEmail}
//               placeholder="Enter your email"
//               placeholderTextColor={Colors.dark.subtext}
//               keyboardType="email-address"
//               autoCapitalize="none"
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Password</Text>
//             <View style={styles.passwordContainer}>
//               <TextInput
//                 style={styles.passwordInput}
//                 value={password}
//                 onChangeText={setPassword}
//                 placeholder="Enter your password"
//                 placeholderTextColor={Colors.dark.subtext}
//                 secureTextEntry={!showPassword}
//               />
//               <TouchableOpacity
//                 onPress={() => setShowPassword(!showPassword)}
//                 style={styles.eyeButton}
//               >
//                 {showPassword ? (
//                   <EyeOff size={20} color={Colors.dark.subtext} />
//                 ) : (
//                   <Eye size={20} color={Colors.dark.subtext} />
//                 )}
//               </TouchableOpacity>
//             </View>
//           </View>

//           {/* Forgot Password Link */}
//           <View style={styles.forgotPasswordContainer}>
//             <Link href="/forgot-password" asChild>
//               <TouchableOpacity>
//                 <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
//               </TouchableOpacity>
//             </Link>
//           </View>

//           {/* Signin Button */}
//           <TouchableOpacity
//             style={[styles.signinButton, isLoading && styles.signinButtonDisabled]}
//             onPress={handleSignin}
//             disabled={isLoading}
//           >
//             <Text style={styles.signinButtonText}>
//               {isLoading ? 'Signing In...' : 'Sign In'}
//             </Text>
//           </TouchableOpacity>

//           {/* Forgot Password Link */}
//           <View style={styles.forgotPasswordContainer}>
//             <Link href="/forgot-password" asChild>
//               <TouchableOpacity>
//                 <Text style={styles.forgotPasswordLink}>Forgot Password?</Text>
//               </TouchableOpacity>
//             </Link>
//           </View>

//           {/* Signup Link */}
//           <View style={styles.signupContainer}>
//             <Text style={styles.signupText}>Don't have an account? </Text>
//             <Link href="/signup" asChild>
//               <TouchableOpacity>
//                 <Text style={styles.signupLink}>Sign Up</Text>
//               </TouchableOpacity>
//             </Link>
//           </View>
//         </View>
//       </ScrollView>
//     </KeyboardAvoidingView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   scrollContent: {
//     flexGrow: 1,
//     paddingBottom: 40,
//   },
//   header: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingHorizontal: 24,
//     paddingTop: 60,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   signUpLink: {
//     padding: 8,
//   },
//   signUpLinkText: {
//     color: Colors.dark.primary,
//     fontSize: 16,
//     fontWeight: '600',
//   },
//   logoContainer: {
//     alignItems: 'center',
//     marginTop: 20,
//     marginBottom: 40,
//   },
//   logoImageContainer: {
//     width: 120,
//     height: 120,
//     borderRadius: 60,
//     marginBottom: 16,
//     backgroundColor: 'transparent',
//   },
//   // logoImageContainer: {
//   //   width: 120,
//   //   height: 120,
//   //   borderRadius: 100,
//   //   overflow: 'hidden',
//   //   borderWidth: 2,
//   //   borderColor: Colors.dark.primary,
//   //   marginBottom: 16,
//   //   elevation: 8,
//   //   shadowColor: Colors.dark.primary,
//   //   shadowOffset: { width: 0, height: 4 },
//   //   shadowOpacity: 0.3,
//   //   shadowRadius: 8,
//   // },
//   logoImage: {
//     width: '100%',
//     height: '100%',
//   },
//   logoText: {
//     fontSize: 28,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//   },
//   formContainer: {
//     paddingHorizontal: 24,
//   },
//   inputGroup: {
//     marginBottom: 20,
//   },
//   inputLabel: {
//     fontSize: 14,
//     fontWeight: '500',
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   textInput: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   passwordContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   passwordInput: {
//     flex: 1,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//   },
//   eyeButton: {
//     padding: 12,
//   },
//   signinButton: {
//     backgroundColor: Colors.dark.primary,
//     borderRadius: 8,
//     paddingVertical: 16,
//     alignItems: 'center',
//     marginTop: 20,
//     marginBottom: 20,
//   },
//   signinButtonDisabled: {
//     backgroundColor: Colors.dark.subtext,
//   },
//   signinButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: '600',
//   },
//   forgotPasswordContainer: {
//     alignItems: 'center',
//     marginBottom: 20,
//   },
//   forgotPasswordLink: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: '500',
//   },
//   signupContainer: {
//     flexDirection: 'row',
//     justifyContent: 'center',
//     alignItems: 'center',
//     marginBottom: 40,
//   },
//   signupText: {
//     color: Colors.dark.subtext,
//     fontSize: 14,
//   },
//   signupLink: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: '600',
//   },
//   forgotPasswordText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//     fontWeight: '500',
//   },
// });
