import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/auth';

// This is a redirect file to handle profile routes
export default function ProfileRedirect() {
  const { userId } = useLocalSearchParams();
  const { user, profile } = useAuth();
  const userType = profile?.user_type || user?.user_metadata?.user_type;
  const profilePath = userType === 'business' ? '/(tabsbusiness)/profile' : '/(tabs)/profile';
  
  // If userId is provided, redirect to the profile with that ID
  if (userId) {
    return <Redirect href={{ pathname: profilePath, params: { userId } }} />;
  }
  
  // Otherwise, redirect to the current user's profile
  return <Redirect href={profilePath} />;
}