import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import * as Linking from 'expo-linking';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { profileService, Profile } from './database';
import { useAuthStore } from '@/store/auth-store';
import type { User as AppUser } from '@/types';
import { resolveAvatarUrl } from '@/utils/avatar';
import { resolveCurrencyFromCountry } from '@/utils/country-currency';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, profileData?: {
    full_name: string;
    username: string;
    user_type: 'business' | 'private';
    business_name?: string;
    business_type?: string;
    country?: string;
    country_code?: string;
    currency?: string;
  }, options?: { emailRedirectTo?: string }) => Promise<{ error: any; needsVerification?: boolean; userId?: string }>;
  signInWithMagicLink: (email: string) => Promise<{ error: any }>;
  signOut: () => Promise<{ error: any }>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: any }>;
  resendVerificationEmail: (email: string) => Promise<{ error: any }>;
  resetPassword: (email: string, options?: { redirectTo?: string }) => Promise<{
    error: any;
    access_token?: string;
    refresh_token?: string;
  }>;
  updatePassword: (newPassword: string) => Promise<{ error: any }>;
  checkEmailVerification: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const authRequestIdRef = useRef(0);
  const latestProfileRef = useRef<Profile | null>(null);

  const mergeStableAvatarFields = (nextProfile: Profile, previousProfile: Profile | null): Profile => {
    if (!previousProfile || previousProfile.id !== nextProfile.id) {
      return nextProfile;
    }

    const nextAvatarUrl = String((nextProfile as any)?.avatar_url || '').trim();
    const previousAvatarUrl = String((previousProfile as any)?.avatar_url || '').trim();
    const nextAvatarGender = (nextProfile as any)?.avatar_gender;
    const previousAvatarGender = (previousProfile as any)?.avatar_gender;

    return {
      ...(nextProfile as any),
      avatar_url: nextAvatarUrl || previousAvatarUrl || null,
      avatar_gender:
        nextAvatarGender === 'male' || nextAvatarGender === 'female'
          ? nextAvatarGender
          : previousAvatarGender ?? null,
    } as Profile;
  };

  const resolveProfileAvatar = (currentProfile: Profile | null, currentUser: User): string => {
    return resolveAvatarUrl({
      avatarUrl: currentProfile?.avatar_url || currentUser.user_metadata?.avatar_url,
      avatarGender: (currentProfile as any)?.avatar_gender,
      fallbackUrl: '',
    });
  };

  const syncStoreUser = (currentUser: User | null, currentProfile: Profile | null) => {
    const { syncUser } = useAuthStore.getState();

    if (!currentUser) {
      syncUser(null);
      return;
    }

    const emailPrefix = currentUser.email?.split('@')[0] || 'user';
    const storeUser: AppUser = {
      id: currentUser.id,
      name: currentProfile?.full_name || currentUser.user_metadata?.full_name || emailPrefix,
      displayName: currentProfile?.full_name || currentUser.user_metadata?.full_name || emailPrefix,
      username: currentProfile?.username || currentUser.user_metadata?.username || emailPrefix,
      email: currentProfile?.email || currentUser.email || undefined,
      avatar: resolveProfileAvatar(currentProfile, currentUser),
      bio: currentProfile?.bio || undefined,
      followers: currentProfile?.followers_count || 0,
      following: currentProfile?.following_count || 0,
      isBusinessAccount:
        (currentProfile?.user_type || currentUser.user_metadata?.user_type || 'private') === 'business',
      businessName: currentProfile?.business_name || currentUser.user_metadata?.business_name || undefined,
      businessType: currentProfile?.business_type || currentUser.user_metadata?.business_type || undefined,
      createdAt: currentProfile?.created_at || currentUser.created_at,
    };

    syncUser(storeUser);
  };

  const buildFallbackProfile = (currentUser: User, previousProfile: Profile | null): Profile => {
    const emailPrefix = currentUser.email?.split('@')[0] || 'user';
    return {
      id: currentUser.id,
      email: currentUser.email || `${emailPrefix}@example.com`,
      full_name: currentUser.user_metadata?.full_name || emailPrefix,
      username: currentUser.user_metadata?.username || emailPrefix,
      user_type: (currentUser.user_metadata?.user_type as 'business' | 'private') || 'private',
      followers_count: 0,
      following_count: 0,
      avatar_url: previousProfile?.avatar_url || currentUser.user_metadata?.avatar_url || undefined,
      ...(previousProfile && (previousProfile as any).avatar_gender !== undefined
        ? { avatar_gender: (previousProfile as any).avatar_gender }
        : {}),
      bio: undefined,
      location_city: undefined,
      business_name: currentUser.user_metadata?.business_name || undefined,
      business_type: currentUser.user_metadata?.business_type || undefined,
      country: currentUser.user_metadata?.country || undefined,
      country_code: currentUser.user_metadata?.country_code || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  const resolveUserProfile = async (currentUser: User, previousProfile: Profile | null): Promise<Profile> => {
    const fallbackProfile = buildFallbackProfile(currentUser, previousProfile);

    // Race profile resolution against a 10-second timeout so the auth
    // listener never hangs indefinitely when Supabase is slow.
    const profileTimeout = new Promise<Profile>((_, reject) =>
      setTimeout(() => reject(new Error('Profile resolution timeout')), 10000)
    );

    try {
      const result = await Promise.race([
        (async () => {
          try {
            const existingProfile = await profileService.getProfile(currentUser.id);
            if (existingProfile) return existingProfile;
          } catch {
            return fallbackProfile;
          }
          try {
            const createdProfile = await profileService.createProfile(fallbackProfile);
            return createdProfile;
          } catch {
            return fallbackProfile;
          }
        })(),
        profileTimeout,
      ]);
      return result;
    } catch {
      return fallbackProfile;
    }
  };

  useEffect(() => {
    let isActive = true;

    const applySessionState = async (nextSession: Session | null) => {
      const requestId = ++authRequestIdRef.current;

      // Never allow a partially verified user session to propagate in app state.
      const appMetadata =
        (nextSession?.user?.app_metadata as Record<string, unknown> | undefined) || {};
      const userMetadata =
        (nextSession?.user?.user_metadata as Record<string, unknown> | undefined) || {};
      const signupOtpVerifiedAt = appMetadata.signup_otp_verified_at;
      const hasCompletedOtpStep = typeof signupOtpVerifiedAt === 'string' && signupOtpVerifiedAt.length > 0;
      const userType =
        (typeof userMetadata.user_type === 'string' && userMetadata.user_type) ||
        (typeof appMetadata.user_type === 'string' && appMetadata.user_type) ||
        'private';
      const requiresOtpVerification = userType === 'business';

      if (nextSession?.user && requiresOtpVerification && !hasCompletedOtpStep) {
        if (!isActive || requestId !== authRequestIdRef.current) {
          return;
        }

        setSession(null);
        setUser(null);
        setProfile(null);
        latestProfileRef.current = null;
        syncStoreUser(null, null);

        // Keep the transient session alive so verify-otp finalization can use the access token.
        // App state is still cleared until signup PIN verification is complete.

        if (!isActive || requestId !== authRequestIdRef.current) {
          return;
        }

        setSession(null);
        setUser(null);
        setProfile(null);
        latestProfileRef.current = null;
        syncStoreUser(null, null);
        setLoading(false);
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        if (!isActive || requestId !== authRequestIdRef.current) {
          return;
        }

        setProfile(null);
        latestProfileRef.current = null;
        syncStoreUser(null, null);
        setLoading(false);
        return;
      }

      try {
        const previousProfile = latestProfileRef.current;
        const userProfile = await resolveUserProfile(nextSession.user, previousProfile);
        const mergedProfile = mergeStableAvatarFields(userProfile, previousProfile);

        if (!isActive || requestId !== authRequestIdRef.current) {
          return;
        }

        setProfile(mergedProfile);
        latestProfileRef.current = mergedProfile;
        syncStoreUser(nextSession.user, mergedProfile);
      } catch (error) {
        const previousProfile = latestProfileRef.current;
        const fallbackProfile = buildFallbackProfile(nextSession.user, previousProfile);
        const mergedFallbackProfile = mergeStableAvatarFields(fallbackProfile, previousProfile);

        if (!isActive || requestId !== authRequestIdRef.current) {
          return;
        }

        setProfile(mergedFallbackProfile);
        latestProfileRef.current = mergedFallbackProfile;
        syncStoreUser(nextSession.user, mergedFallbackProfile);
      } finally {
        if (isActive && requestId === authRequestIdRef.current) {
          setLoading(false);
        }
      }
    };

    // Add timeout to prevent infinite loading (increased for Android simulator)
    const timeoutId = setTimeout(() => {
      console.warn('Auth initialization timeout - proceeding without auth');
      setLoading(false);
    }, 10000); // 10 second timeout

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isActive) {
        return;
      }

      clearTimeout(timeoutId);

      await applySessionState(session);
    }).catch((error) => {
      clearTimeout(timeoutId);

      if (isActive) {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setTimeout(() => {
        if (!isActive) {
          return;
        }

        void applySessionState(nextSession);
      }, 0);
    });

    return () => {
      isActive = false;
      authRequestIdRef.current += 1;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, profileData?: {
    full_name: string;
    username: string;
    user_type: 'business' | 'private';
    business_name?: string;
    business_type?: string;
    country?: string;
    country_code?: string;
    currency?: string;
  }, _options?: { emailRedirectTo?: string }) => {
    try {
      console.log('🚀 Starting Supabase signup process...');
      console.log('Email:', email);
      console.log('Profile data:', profileData);

      useAuthStore.getState().logout();
      setSession(null);
      setUser(null);
      setProfile(null);

      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        console.warn('Pre-signup sign out failed:', signOutError);
      }

      const normalizedEmail = email.trim().toLowerCase();
      const resolvedSignupCurrency = resolveCurrencyFromCountry({
        country: profileData?.country,
        countryCode: profileData?.country_code,
        fallbackCurrency: 'USD',
      });
      const { data, error } = await supabase.functions.invoke('create-signup-user', {
        body: {
          email: normalizedEmail,
          password,
          profileData: {
            full_name: profileData?.full_name,
            username: profileData?.username,
            user_type: profileData?.user_type,
            business_name: profileData?.business_name,
            business_type: profileData?.business_type,
            country: profileData?.country,
            country_code: profileData?.country_code,
            currency: resolvedSignupCurrency,
          },
        },
      });

      if (error || !data?.success) {
        if ((data as any)?.code === 'existing_user' && (data as any)?.user_id) {
          console.log('ℹ️ Existing signup user detected, continuing with PIN verification flow:', (data as any)?.user_id);
          return {
            error: null,
            needsVerification: true,
            userId: (data as any).user_id,
          };
        }

        try {
          const { data: existingUserData } = await supabase.functions.invoke('get-uid-by-email', {
            body: { email: normalizedEmail },
          });

          if (existingUserData?.uid) {
            const alreadyOtpVerified = existingUserData.otp_verified === true;

            if (!alreadyOtpVerified) {
              console.log('ℹ️ Existing account found after signup failure, continuing with PIN verification flow:', existingUserData.uid);
              return {
                error: null,
                needsVerification: true,
                userId: existingUserData.uid,
              };
            }

            return {
              error: new Error('This email is already registered. Please sign in with your password.'),
            };
          }
        } catch (lookupErr) {
          console.warn('Existing user recovery lookup failed:', lookupErr);
        }

        const remoteError = (data as any)?.error || error?.message || 'Signup failed';
        console.error('❌ Supabase auth signup error:', remoteError);
        return { error: new Error(remoteError) };
      }

      console.log('✅ Supabase auth signup successful:', data?.user_id);

      // Keep users fully signed-out until signup PIN verification is complete.
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        console.warn('Failed to clear signup session:', signOutError);
      }

      useAuthStore.getState().logout();
      setSession(null);
      setUser(null);
      setProfile(null);

      return {
        error: null,
        needsVerification: profileData?.user_type === 'business',
        userId: data?.user_id,
      };
    } catch (err) {
      console.error('❌ Signup error:', err);
      return { error: err };
    }
  };

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: undefined, // Will use the current URL
      },
    });
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      useAuthStore.getState().syncUser(null);
    }
    return { error };
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) {
      return { error: new Error('No authenticated user') };
    }
    
    try {
      const updatedProfile = await profileService.updateProfile(user.id, updates);
      const resolvedAvatarGender =
        (updatedProfile as any).avatar_gender ??
        ((updates as any).avatar_gender !== undefined ? (updates as any).avatar_gender : undefined);
      const mergedProfile =
        resolvedAvatarGender !== undefined
          ? ({ ...(updatedProfile as any), avatar_gender: resolvedAvatarGender } as Profile)
          : updatedProfile;

      setProfile(mergedProfile);
      latestProfileRef.current = mergedProfile;
      syncStoreUser(user, mergedProfile);
      
      // Broadcast avatar changes to all screens
      if ('avatar_url' in updates || 'avatar_gender' in updates) {
        const { updateAvatarInfo } = useAuthStore.getState();
        updateAvatarInfo({
          avatar: mergedProfile.avatar_url || undefined,
          avatarGender: (mergedProfile as any).avatar_gender as any,
        });
      }
      
      return { error: null };
    } catch (error: any) {
      const code = error?.code || error?.details?.code;
      const message = String(error?.message || '');

      // Backward compatibility for deployments where `avatar_gender` is not yet migrated.
      if ((code === 'PGRST204' || message.includes('avatar_gender')) && 'avatar_gender' in (updates as any)) {
        const { avatar_gender, ...fallbackUpdates } = updates as any;
        try {
          const updatedProfile = await profileService.updateProfile(user.id, fallbackUpdates);
          const resolvedAvatarGender =
            (updatedProfile as any).avatar_gender ??
            ((updates as any).avatar_gender !== undefined ? (updates as any).avatar_gender : undefined);
          const mergedProfile =
            resolvedAvatarGender !== undefined
              ? ({ ...(updatedProfile as any), avatar_gender: resolvedAvatarGender } as Profile)
              : updatedProfile;

          setProfile(mergedProfile);
          latestProfileRef.current = mergedProfile;
          syncStoreUser(user, mergedProfile);
          
          // Broadcast avatar changes to all screens
          if ('avatar_url' in fallbackUpdates || 'avatar_gender' in updates) {
            const { updateAvatarInfo } = useAuthStore.getState();
            updateAvatarInfo({
              avatar: mergedProfile.avatar_url || undefined,
              avatarGender: (mergedProfile as any).avatar_gender as any,
            });
          }
          
          return { error: null };
        } catch (fallbackError) {
          console.error('Error updating profile (fallback):', fallbackError);
          return { error: fallbackError };
        }
      }

      console.error('Error updating profile:', error);
      return { error };
    }
  };

  const resendVerificationEmail = async (email: string) => {
    try {
      const redirectTo =
        process.env.EXPO_PUBLIC_EMAIL_CONFIRM_REDIRECT_URL?.trim() ??
        'myapp://email-confirmed';

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: redirectTo,
        },
      });
      return { error };
    } catch (error) {
      console.error('Error resending verification email:', error);
      return { error };
    }
  };

  const checkEmailVerification = () => {
    return user?.email_confirmed_at != null;
  };


  const resetPassword = async (email: string, options?: { redirectTo?: string }) => {
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const { data, error } = await supabase.functions.invoke("send-otp", {
        body: {
          email: normalizedEmail,
          type: "recovery",
        },
      });
  
      if (error || !data?.success) {
        console.error("Password reset OTP error:", error || data);
        return { error: new Error(data?.message || error?.message || "Failed to send reset code.") };
      }

      return { error: null };
    } catch (err) {
      console.error("Error during password reset request:", err);
      return { error: err instanceof Error ? err : new Error("An unexpected error occurred.") };
    }
  };
  
  
  



  // const resetPassword = async (email: string, options?: { redirectTo?: string }) => {
  //   const normalizedEmail = email.trim().toLowerCase();
  //   try {
  //     const body: { email: string; redirect_to?: string } = { email: normalizedEmail };
  //     if (options?.redirectTo?.trim()) body.redirect_to = options.redirectTo.trim();
  //     const { data, error } = await supabase.functions.invoke("send-password-reset", {
  //       body,
  //     });

  //     if (!data?.success) {
  //       const fnMessage = typeof data?.message === "string" ? data.message : null;
  //       if (error) {
  //         console.error("Password reset Edge Function error:", error);
  //         const msg =
  //           error.message?.includes("504") || error.message?.includes("Gateway Timeout")
  //             ? "Request timed out. The reset email may still be sent—check your inbox."
  //             : fnMessage || error.message || "Failed to send reset email.";
  //         return { error: new Error(msg) };
  //       }
  //       return { error: new Error(fnMessage || "Failed to send password reset email.") };
  //     }

  //     const hashedToken = typeof data.hashed_token === "string" ? data.hashed_token : null;
  //     if (!hashedToken) {
  //       return {
  //         error: new Error(
  //           "Reset email sent, but in-app reset is unavailable. Please use the link in your email.",
  //         ),
  //       };
  //     }

  //     const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
  //       type: "recovery",
  //       token_hash: hashedToken,
  //     });

  //     if (otpError || !otpData?.session) {
  //       console.error("verifyOtp error:", otpError);
  //       return {
  //         error: new Error(
  //           otpError?.message || "Could not verify reset token. Please use the link in your email.",
  //         ),
  //       };
  //     }

  //     const access_token = otpData.session.access_token;
  //     const refresh_token = otpData.session.refresh_token ?? "";
  //     return { error: null, access_token, refresh_token };
  //   } catch (err) {
  //     console.error("Error during password reset request:", err);
  //     return {
  //       error: err instanceof Error ? err : new Error("An unexpected error occurred."),
  //     };
  //   }
  // };
  
  
  

  // const resetPassword = async (email: string) => {
  //   try {
  //     // Use Postmark Edge Function for fast email delivery (instead of slow Supabase email service)
  //     const startTime = Date.now();
      
  //     console.log('📧 Sending password reset email via Postmark...');
      
  //     // Call our custom Edge Function that uses Postmark
  //     const { data, error } = await supabase.functions.invoke('send-password-reset', {
  //       body: {
  //         email: email.trim().toLowerCase(),
  //       },
  //     });
      
  //     const duration = Date.now() - startTime;
  //     const seconds = (duration / 1000).toFixed(1);
  //     console.log(`⏱️ Password reset request completed in ${seconds}s`);
      
  //     if (error) {
  //       console.error('❌ Password reset error:', error);
        
  //       // Extract actual error message from function response
  //       let actualError = error.message || 'Unknown error';
  //       let errorStatus = 0;
        
  //       // Try to get detailed error from context
  //       if (error.context) {
  //         try {
  //           // Get status code
  //           if (error.context.status) {
  //             errorStatus = error.context.status;
  //             console.error(`❌ Edge Function returned status: ${errorStatus}`);
  //           }
            
  //           // Try to read response body
  //           if (error.context.body) {
  //             let body;
  //             if (typeof error.context.body === 'string') {
  //               try {
  //                 body = JSON.parse(error.context.body);
  //               } catch {
  //                 body = { message: error.context.body };
  //               }
  //             } else {
  //               body = error.context.body;
  //             }
              
  //             if (body.message) {
  //               actualError = body.message;
  //               console.error('❌ Error message from function:', actualError);
  //             } else if (body.error) {
  //               actualError = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
  //             }
  //           }
  //         } catch (e) {
  //           console.error('Failed to parse error context:', e);
  //         }
  //       }
        
  //       console.error('❌ Actual error from function:', actualError);
  //       console.error('❌ Full error object:', JSON.stringify({
  //         message: error.message,
  //         name: error.name,
  //         status: errorStatus,
  //         context: error.context,
  //       }, null, 2));
        
  //       // Check if function is not deployed (404)
  //       if (errorStatus === 404 || error.message?.includes('Function not found') || error.message?.includes('404')) {
  //         console.warn('⚠️ Password reset function not deployed. Falling back to Supabase email service...');
  //         return await resetPasswordFallback(email);
  //       }
        
  //       // Check for missing secrets (500 error usually means this)
  //       if (actualError.includes('Server configuration error') || actualError.includes('Missing Supabase credentials')) {
  //         return {
  //           error: {
  //             message: 'Server configuration error. Please ensure SUPABASE_SERVICE_ROLE_KEY secret is set in Supabase Dashboard → Edge Functions → Secrets'
  //           }
  //         };
  //       }
        
  //       // Check for Postmark errors
  //       if (actualError.includes('Email service not configured') || actualError.includes('POSTMARK_API_KEY')) {
  //         return {
  //           error: {
  //             message: 'Email service not configured. Please ensure POSTMARK_API_KEY secret is set in Supabase Dashboard → Edge Functions → Secrets'
  //           }
  //         };
  //       }
        
  //       return { 
  //         error: {
  //           message: actualError || 'Failed to send password reset email. Please check Supabase function logs for details.'
  //         }
  //       };
  //     }
      
  //     if (data?.success) {
  //       console.log('✅ Password reset email sent successfully via Postmark');
  //       return { error: null };
  //     } else {
  //       return {
  //         error: {
  //           message: data?.message || 'Failed to send password reset email'
  //         }
  //       };
  //     }
  //   } catch (error: any) {
  //     console.error('❌ Password reset exception:', error);
      
  //     // Fallback to Supabase's built-in email service if Edge Function fails
  //     console.warn('⚠️ Edge Function failed. Falling back to Supabase email service...');
  //     return await resetPasswordFallback(email);
  //   }
  // };
  const updatePassword = async (newPassword: string) => {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });
      return { error };
    } catch (error) {
      console.error('Error updating password:', error);
      return { error };
    }
  };

  const value = {
    session,
    user,
    profile,
    loading,
    signIn,
    signUp,
    signInWithMagicLink,
    signOut,
    updateProfile,
    resendVerificationEmail,
    resetPassword,
    updatePassword,
    checkEmailVerification,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}