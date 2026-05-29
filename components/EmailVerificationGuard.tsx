import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';

interface EmailVerificationGuardProps {
  children: React.ReactNode;
}

export function EmailVerificationGuard({ children }: EmailVerificationGuardProps) {
  const { user, checkEmailVerification, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Don't redirect if still loading
    if (loading) return;

    // If user is signed in but email is not verified, redirect to verification page
    if (user && !checkEmailVerification()) {
      console.log('User email not verified, redirecting to verification page');
      router.replace({ pathname: '/verify-email', params: { email: user.email || '' } });
    }
  }, [user, loading, checkEmailVerification, router]);

  // Don't render children if user is not verified
  if (loading) {
    return null; // Or a loading spinner
  }

  if (user && !checkEmailVerification()) {
    return null; // Will redirect in useEffect
  }

  return <>{children}</>;
}