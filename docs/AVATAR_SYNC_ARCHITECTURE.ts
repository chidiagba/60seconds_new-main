/**
 * AVATAR GLOBAL SYNC SYSTEM
 * 
 * This file documents the architecture for syncing avatar changes across all app screens.
 * 
 * ============================================================================
 * FLOW DIAGRAM
 * ============================================================================
 * 
 * User selects/uploads avatar on:
 *   profile.tsx (handleGenderAvatarSelect, pickAndUploadAvatar)
 *   edit-profile.tsx (handleSave, uploadImage)
 *   ↓
 * updateProfile() called in lib/auth.tsx
 *   ↓
 * profile is updated in Supabase
 *   ↓
 * Profile state updated locally:
 *   - setProfile(updatedProfile)
 *   - syncStoreUser(user, updatedProfile) → updates useAuthStore
 *   ↓
 * NEW: updateAvatarInfo() called:
 *   - Updates user.avatar in useAuthStore
 *   - Increments avatarVersion
 *   ↓
 * All effects depending on avatarVersion trigger:
 *   ✓ ProfileUserScreen refetches other users' profiles
 *   ✓ useAvatarSync hooks in other screens trigger callbacks
 *   ✓ Video feed cache synced via syncUserProfile()
 *   ↓
 * Screens re-render with updated avatar:
 *   • Home screen (profile.tsx)
 *   • Edit profile (edit-profile.tsx)
 *   • Other user profiles (ProfileUserScreen)
 *   • Video feed/comments (video-store.ts)
 *   • Follow/follower lists
 *   • Chat screens (via route params)
 * 
 * ============================================================================
 * KEY COMPONENTS
 * ============================================================================
 * 
 * 1. BROADCAST (useAuthStore)
 *    - avatarVersion: number
 *    - updateAvatarInfo(avatarData): increments version
 * 
 * 2. RECEIVERS
 *    - ProfileUserScreen: watches avatarVersion → refetches
 *    - profile.tsx: calls syncUserProfile after changes
 *    - edit-profile.tsx: calls syncUserProfile after changes
 *    - useAvatarSync hook: custom listener for avatar changes
 * 
 * 3. CACHE UPDATES
 *    - useVideoStore.syncUserProfile(): updates video metadata cache
 *    - sync in comments as well
 * 
 * ============================================================================
 * INTEGRATION POINTS
 * ============================================================================
 * 
 * For NEW screens that display user avatars:
 * 
 * Option 1 - Simple refetch on avatar change:
 *   import { useAvatarVersion } from '@/hooks/useAvatarSync';
 *   const avatarVersion = useAvatarVersion();
 *   useEffect(() => {
 *     fetchUsers();
 *   }, [avatarVersion, otherDeps]);
 * 
 * Option 2 - Custom callback:
 *   import { useAvatarSync } from '@/hooks/useAvatarSync';
 *   useAvatarSync(async () => {
 *     await refetchUserProfiles();
 *   }, isScreenVisible);
 * 
 * ============================================================================
 * IMPLEMENTATION CHECKLIST
 * ============================================================================
 * 
 * ✅ useAuthStore:
 *    - Added avatarVersion state
 *    - Added updateAvatarInfo method
 *    - Increments on avatar change
 * 
 * ✅ lib/auth.tsx updateProfile():
 *    - Calls updateAvatarInfo when avatar changes
 *    - Works with both normal and fallback update paths
 * 
 * ✅ profile.tsx:
 *    - pickAndUploadAvatar calls syncUserProfile
 *    - handleGenderAvatarSelect calls syncUserProfile
 * 
 * ✅ edit-profile.tsx:
 *    - uploadImage calls syncUserProfile
 *    - handleSave calls syncUserProfile
 * 
 * ✅ ProfileUserScreen:
 *    - Added avatarVersion to dependencies
 *    - Profile fetch effect includes avatarVersion
 *    - Refetches other users' profiles when avatar changes
 * 
 * ✅ hooks/useAvatarSync.ts:
 *    - useAvatarSync hook for listening to avatar changes
 *    - useAvatarVersion hook for getting current version
 * 
 * ============================================================================
 * TESTING STRATEGY
 * ============================================================================
 * 
 * Test 1: Avatar Selection on Home Screen
 *   1. Open app and go to profile tab
 *   2. Click male/female avatar button
 *   3. Verify avatar shows on home screen
 *   4. Navigate to video feed - verify avatar appears
 *   5. Go back to profile - verify avatar still selected
 * 
 * Test 2: Avatar Upload
 *   1. On profile tab, click upload photo
 *   2. Select image from library
 *   3. Verify photo appears and gender avatar clears
 *   4. Go to edit-profile - verify photo shows
 *   5. Navigate away and back - verify photo persists
 * 
 * Test 3: Avatar Change Broadcast
 *   1. Select avatar A on profile screen
 *   2. Open ProfileUserScreen for another user (if viewing self, it updates)
 *   3. Change back to avatar B
 *   4. Switch to different user profile - avatar should be B
 *   5. Go to video feed - avatar should show as B
 * 
 * Test 4: Edit Profile Avatar
 *   1. Go to edit-profile screen
 *   2. Change avatar or upload photo
 *   3. Click Save
 *   4. Verify avatar appears on home profile
 *   5. Check video feed - avatar should be updated
 * 
 * Test 5: Gender Avatar Toggle
 *   1. Select male avatar
 *   2. Go to edit-profile
 *   3. Change to female avatar
 *   4. Save
 *   5. Go to home - female avatar should show
 *   6. Click female button to toggle off
 *   7. Verify avatar clears
 * 
 * ============================================================================
 */

// This is documentation only - no code execution
