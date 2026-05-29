import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { profileService, Profile } from './database';
import { config } from './config';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (email: string, password: string, profileData?: {
    full_name: string;
    username: string;
    user_type: 'business' | 'private';
    business_name?: string;
    business_type?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  signInWithMagicLink: (email: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<{ success: boolean; error?: string }>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  resendVerificationEmail: (email: string) => Promise<{ success: boolean; error?: string }>;
  checkEmailVerification: () => boolean;
  clearError: () => void;
  refreshSession: () => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Simple error handler
const handleSupabaseError = (error: any, context: string) => {
  console.error(`Error in ${context}:`, error);
  return {
    message: error?.message || error?.toString() || 'An unexpected error occurred'
  };
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize auth state
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        console.log('🚀 Initializing auth state...');
        
        // Get initial session
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('❌ Error getting session:', error);
          if (mounted) {
            setError(error.message);
          }
        } else {
          console.log('✅ Session retrieved:', session?.user?.id || 'No session');
          if (mounted) {
            setSession(session);
            setUser(session?.user ?? null);
          }
        }

        // Set up auth state listener
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event, session) => {
            console.log('🔄 Auth state changed:', event, session?.user?.id || 'No user');
            
            if (mounted) {
              setSession(session);
              setUser(session?.user ?? null);
              
              // Load profile if user is authenticated
              if (session?.user) {
                try {
                  const profile = await profileService.getProfile(session.user.id);
                  setProfile(profile);
                } catch (error) {
                  console.error('❌ Error loading profile:', error);
                  setProfile(null);
                }
              } else {
                setProfile(null);
              }
            }
          }
        );

        return () => {
          subscription.unsubscribe();
        };
      } catch (error) {
        console.error('❌ Auth initialization error:', error);
        if (mounted) {
          setError('Failed to initialize authentication');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    const cleanup = initializeAuth();

    return () => {
      mounted = false;
      cleanup.then(cleanupFn => cleanupFn?.());
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      setLoading(true);
      setError(null);

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        throw error;
      }

      return { success: true };
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'signIn').message;
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, profileData?: {
    full_name: string;
    username: string;
    user_type: 'business' | 'private';
    business_name?: string;
    business_type?: string;
  }) => {
    try {
      setLoading(true);
      setError(null);

      console.log('🚀 Starting Supabase signup process...');
      console.log('Email:', email);
      console.log('Profile data:', profileData);

      // Step 1: Create user in Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            full_name: profileData?.full_name,
            username: profileData?.username,
            user_type: profileData?.user_type,
            business_name: profileData?.business_name,
            business_type: profileData?.business_type,
          }
        }
      });
      
      if (error) {
        console.error('❌ Supabase auth signup error:', error);
        throw error;
      }
      
      console.log('✅ Supabase auth signup successful:', data.user?.id);
      
      // Step 2: Create profile in profiles table (if user was created and profile data provided)
      if (data.user && profileData) {
        console.log('📝 Creating profile for user:', data.user.id);
        
        try {
          const { data: profileResult, error: profileError } = await supabase
            .from('profiles')
            .insert({
              id: data.user.id,
              email: data.user.email,
              full_name: profileData.full_name,
              username: profileData.username,
              user_type: profileData.user_type,
              followers_count: 0,
              following_count: 0,
              business_name: profileData.business_name,
              business_type: profileData.business_type,
            })
            .select()
            .single();
          
          if (profileError) {
            console.error('❌ Profile creation failed:', profileError);
            // Don't throw error, just log it and continue
            console.log('⚠️ Continuing without profile creation - trigger may have created it');
          } else {
            console.log('✅ Profile created successfully:', profileResult);
          }
        } catch (error) {
          console.error('❌ Profile creation error:', error);
          console.log('⚠️ Continuing without profile creation - trigger may have created it');
        }
      }
      
      console.log('✅ Signup process completed successfully');
      return { success: true };
    } catch (err) {
      console.error('❌ Signup error:', err);
      const errorMessage = handleSupabaseError(err, 'signUp').message;
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const signInWithMagicLink = async (email: string) => {
    try {
      setLoading(true);
      setError(null);

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: `${config.app.name}://auth/callback`,
        },
      });

      if (error) {
        throw error;
      }

      return { success: true };
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'signInWithMagicLink').message;
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      setError(null);

      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      setUser(null);
      setSession(null);
      setProfile(null);

      return { success: true };
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'signOut').message;
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) {
      const errorMessage = 'No authenticated user';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
    
    try {
      setLoading(true);
      setError(null);

      const updatedProfile = await profileService.updateProfile(user.id, updates);
      setProfile(updatedProfile);
      return { success: true };
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'updateProfile').message;
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    try {
      setLoading(true);
      setError(null);

      const normalizedEmail = email.trim().toLowerCase();
      const { data, error } = await supabase.functions.invoke('send-otp', {
        body: {
          email: normalizedEmail,
          type: 'recovery',
        },
      });

      if (error || !data?.success) {
        const message = data?.message || error?.message || 'Failed to send password reset code. Please try again.';
        throw new Error(message);
      }

      return { success: true };
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'resetPassword').message;
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const refreshSession = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase.auth.refreshSession();

      if (error) {
        throw error;
      }

      return { success: true };
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'refreshSession').message;
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const resendVerificationEmail = async (email: string) => {
    try {
      setLoading(true);
      setError(null);

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: typeof window !== 'undefined' 
            ? `${window.location.origin}/verify-email` 
            : 'http://localhost:3000/verify-email',
        },
      });

      if (error) {
        throw error;
      }

      return { success: true };
    } catch (err) {
      const errorMessage = handleSupabaseError(err, 'resendVerificationEmail').message;
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const checkEmailVerification = () => {
    return user?.email_confirmed_at != null;
  };

  const clearError = () => {
    setError(null);
  };

  const value = {
    session,
    user,
    profile,
    loading,
    error,
    signIn,
    signUp,
    signInWithMagicLink,
    signOut,
    updateProfile,
    resetPassword,
    resendVerificationEmail,
    checkEmailVerification,
    clearError,
    refreshSession,
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
