import AvatarImage from '@/components/AvatarImage';

// import React, { useEffect, useMemo, useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   ScrollView,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { useRouter, useLocalSearchParams } from "expo-router";
// import { Grid, Bookmark, Users, FileText, Edit, Settings } from "lucide-react-native";
// import { LinearGradient } from "expo-linear-gradient";

// import Colors from "@/constants/colors";
// import { useAuthStore } from "@/store/auth-store";
// import { useAuth } from "@/lib/auth";
// import { supabase } from "@/lib/supabase";
// import { mockVideos } from "@/mocks/videos";

// type ProfileRow = {
//   id: string;
//   full_name: string | null;
//   username: string | null;
//   avatar_url: string | null;
//   bio: string | null;
//   location_city: string | null;
//   user_type: string | null;
//   business_type: string | null;
//   followers_count: number | null;
//   following_count: number | null;
// };

// export default function ProfileUserScreen() {
//   const router = useRouter();
//   const params = useLocalSearchParams<{ userId?: string }>();
//   const userId = (params.userId || "").toString();

//   const { user: authUser, profile: authProfile, loading: authLoading } = useAuth();
//   const { isFollowing, followUser, unfollowUser } = useAuthStore();

//   const [activeTab, setActiveTab] = useState<"videos" | "saved" | "following" | "orders">("videos");
//   const [loading, setLoading] = useState(true);
//   const [profile, setProfile] = useState<ProfileRow | null>(null);
//   const [loadError, setLoadError] = useState<string | null>(null);

//   const isOwnProfile = !!authUser?.id && userId === authUser.id;

//   const displayProfile = useMemo<ProfileRow | null>(() => {
//     if (isOwnProfile && authProfile && authUser?.id) {
//       return {
//         id: authUser.id,
//         full_name: authProfile.full_name,
//         username: authProfile.username,
//         avatar_url: authProfile.avatar_url,
//         bio: authProfile.bio,
//         location_city: authProfile.location_city,
//         user_type: authProfile.user_type,
//         business_type: authProfile.business_type,
//         followers_count: authProfile.followers_count,
//         following_count: authProfile.following_count,
//       };
//     }
//     return profile;
//   }, [isOwnProfile, authProfile, authUser?.id, profile]);

//   useEffect(() => {
//     let mounted = true;

//     const run = async () => {
//       try {
//         setLoadError(null);

//         if (!userId) {
//           setLoadError("Missing user id");
//           return;
//         }
//         if (authLoading) return;

//         if (authUser?.id && userId === authUser.id) {
//           setLoading(false);
//           return;
//         }

//         setLoading(true);
//         const { data, error } = await supabase
//           .from("profiles")
//           .select(
//             "id, full_name, username, avatar_url, bio, location_city, user_type, business_type, followers_count, following_count"
//           )
//           .eq("id", userId)
//           .single();

//         if (!mounted) return;

//         if (error) {
//           setLoadError(error.message || "Failed to load profile");
//           setProfile(null);
//         } else {
//           setProfile(data as ProfileRow);
//         }
//       } catch (e: any) {
//         if (!mounted) return;
//         setLoadError(e?.message || "Something went wrong");
//       } finally {
//         if (!mounted) return;
//         setLoading(false);
//       }
//     };

//     run();
//     return () => {
//       mounted = false;
//     };
//   }, [userId, authUser?.id, authLoading]);

//   const userVideos = useMemo(() => {
//     if (!displayProfile?.id) return [];
//     return mockVideos.filter((v) => v.userId === displayProfile.id);
//   }, [displayProfile?.id]);

//   const handleFollowToggle = () => {
//     if (!authUser?.id) {
//       router.push("/signin");
//       return;
//     }
//     if (!displayProfile?.id) return;

//     if (isFollowing(displayProfile.id)) unfollowUser(displayProfile.id);
//     else followUser(displayProfile.id);
//   };

//   const handleMessageUser = () => {
//     if (!authUser?.id) {
//       router.push("/signin");
//       return;
//     }
//     if (!displayProfile?.id) return;

//     router.push({
//       pathname: "/chat/[chatId]" as any,
//       params: {
//         chatId: "new",
//         otherUserId: displayProfile.id, // ✅ THIS is what ChatScreen uses
//         full_name: displayProfile.full_name ?? "",
//         username: displayProfile.username ?? "",
//         avatar_url: displayProfile.avatar_url ?? "",
//       },
//     });
//   };

//   const handleEditProfile = () => router.push("/edit-profile");
//   const handleSettingsPress = () => router.push("/settings");

//   if (authLoading) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <ActivityIndicator size="large" color={Colors.dark.primary} />
//           <Text style={styles.loadingText}>Loading...</Text>
//         </View>
//       </View>
//     );
//   }

//   if (!authUser) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.notAuthenticatedContainer}>
//           <Text style={styles.notAuthenticatedTitle}>Not Signed In</Text>
//           <Text style={styles.notAuthenticatedText}>Please sign in to view profiles</Text>

//           <TouchableOpacity style={styles.actionButton} onPress={() => router.push("/signin")}>
//             {Platform.OS !== "web" ? (
//               <LinearGradient
//                 colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
//                 start={{ x: 0, y: 0 }}
//                 end={{ x: 1, y: 1 }}
//                 style={styles.gradientButton}
//               >
//                 <Text style={styles.actionButtonTextCenter}>Sign In</Text>
//               </LinearGradient>
//             ) : (
//               <View style={[styles.gradientButton, { backgroundColor: Colors.dark.primary }]}>
//                 <Text style={styles.actionButtonTextCenter}>Sign In</Text>
//               </View>
//             )}
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   }

//   if (loading) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <ActivityIndicator size="large" color={Colors.dark.primary} />
//           <Text style={styles.loadingText}>Loading profile...</Text>
//         </View>
//       </View>
//     );
//   }

//   if (!displayProfile) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <Text style={styles.errorText}>{loadError ? `Oops: ${loadError}` : "Profile not found"}</Text>
//           <TouchableOpacity style={styles.refreshButton} onPress={() => router.back()}>
//             <Text style={styles.refreshButtonText}>Go Back</Text>
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   }

//   const isBusiness = displayProfile.user_type === "business";
//   const avatarUri = displayProfile.avatar_url || "https://via.placeholder.com/150";
//   const fullName = displayProfile.full_name || "User";
//   const username = displayProfile.username ? `@${displayProfile.username}` : "@user";

//   return (
//     <ScrollView style={styles.container}>
//       <View style={styles.header}>
//         {isOwnProfile && (
//           <TouchableOpacity style={styles.settingsButton} onPress={handleSettingsPress}>
//             <Settings size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//         )}
//       </View>

//       <View style={styles.profileSection}>
//         <View style={styles.avatarContainer}>
//           <Image source={{ uri: avatarUri }} style={styles.profileImage} contentFit="cover" transition={300} />
//           {isBusiness && (
//             <View style={styles.businessIndicator}>
//               <Text style={styles.businessIndicatorText}>PRO</Text>
//             </View>
//           )}
//         </View>

//         <Text style={styles.displayName}>{fullName}</Text>
//         <Text style={styles.username}>{username}</Text>

//         {!!displayProfile.location_city && (
//           <Text style={styles.location}>📍 {displayProfile.location_city}</Text>
//         )}
//         {!!displayProfile.bio && <Text style={styles.bio}>{displayProfile.bio}</Text>}

//         <View style={styles.statsContainer}>
//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>{userVideos.length}</Text>
//             <Text style={styles.statLabel}>Videos</Text>
//           </View>
//           <View style={styles.statDivider} />
//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>{displayProfile.following_count ?? 0}</Text>
//             <Text style={styles.statLabel}>Following</Text>
//           </View>
//           <View style={styles.statDivider} />
//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>{displayProfile.followers_count ?? 0}</Text>
//             <Text style={styles.statLabel}>Followers</Text>
//           </View>
//         </View>

//         <View style={styles.buttonContainer}>
//           {isOwnProfile ? (
//             <TouchableOpacity style={styles.editProfileButton} onPress={handleEditProfile}>
//               <Edit size={16} color={Colors.dark.text} />
//               <Text style={styles.editProfileText}>Edit Profile</Text>
//             </TouchableOpacity>
//           ) : (
//             <>
//               <TouchableOpacity style={styles.actionButton} onPress={handleFollowToggle}>
//                 {isFollowing(displayProfile.id) ? (
//                   <View style={styles.unfollowButton}>
//                     <Text style={styles.unfollowButtonText}>Unfollow</Text>
//                   </View>
//                 ) : Platform.OS !== "web" ? (
//                   <LinearGradient
//                     colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
//                     start={{ x: 0, y: 0 }}
//                     end={{ x: 1, y: 1 }}
//                     style={[styles.gradientButton, styles.smallButton]}
//                   >
//                     <Text style={styles.actionButtonTextCenter}>Follow</Text>
//                   </LinearGradient>
//                 ) : (
//                   <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: Colors.dark.primary }]}>
//                     <Text style={styles.actionButtonTextCenter}>Follow</Text>
//                   </View>
//                 )}
//               </TouchableOpacity>

//               <TouchableOpacity style={styles.messageButton} onPress={handleMessageUser}>
//                 <Text style={styles.messageButtonText}>Message</Text>
//               </TouchableOpacity>
//             </>
//           )}
//         </View>

//         {isBusiness && (
//           <View style={styles.businessBadge}>
//             <Text style={styles.businessBadgeText}>{displayProfile.business_type || "Business Account"}</Text>
//           </View>
//         )}
//       </View>

//       <View style={styles.tabsContainer}>
//         <TouchableOpacity style={[styles.tab, activeTab === "videos" && styles.activeTab]} onPress={() => setActiveTab("videos")}>
//           <Grid size={24} color={activeTab === "videos" ? Colors.dark.primary : Colors.dark.inactive} />
//         </TouchableOpacity>

//         <TouchableOpacity style={[styles.tab, activeTab === "saved" && styles.activeTab]} onPress={() => setActiveTab("saved")}>
//           <Bookmark size={24} color={activeTab === "saved" ? Colors.dark.primary : Colors.dark.inactive} />
//         </TouchableOpacity>

//         <TouchableOpacity style={[styles.tab, activeTab === "following" && styles.activeTab]} onPress={() => setActiveTab("following")}>
//           <Users size={24} color={activeTab === "following" ? Colors.dark.primary : Colors.dark.inactive} />
//         </TouchableOpacity>

//         {isOwnProfile && (
//           <TouchableOpacity style={[styles.tab, activeTab === "orders" && styles.activeTab]} onPress={() => setActiveTab("orders")}>
//             <FileText size={24} color={activeTab === "orders" ? Colors.dark.primary : Colors.dark.inactive} />
//           </TouchableOpacity>
//         )}
//       </View>

//       {activeTab === "videos" && (
//         <View style={styles.videosGrid}>
//           {userVideos.length > 0 ? (
//             userVideos.map((video) => (
//               <TouchableOpacity
//                 key={video.id}
//                 style={styles.videoThumbnail}
//                 onPress={() => router.push({ pathname: "/event/[id]" as any, params: { id: video.id } })}
//               >
//                 <Image source={{ uri: video.thumbnail }} style={styles.thumbnailImage} contentFit="cover" transition={300} />
//                 <View style={styles.videoStats}>
//                   <Text style={styles.videoStatsText}>{video.likes} likes</Text>
//                 </View>
//               </TouchableOpacity>
//             ))
//           ) : (
//             <View style={styles.emptyStateContainer}>
//               <Text style={styles.emptyStateText}>No videos yet</Text>
//               <Text style={styles.emptyStateSubtext}>
//                 {isOwnProfile ? "Your uploaded videos will appear here" : `${fullName} hasn't uploaded any videos yet`}
//               </Text>
//             </View>
//           )}
//         </View>
//       )}

//       {activeTab === "saved" && (
//         <View style={styles.emptyStateContainer}>
//           <Text style={styles.emptyStateText}>No saved videos</Text>
//           <Text style={styles.emptyStateSubtext}>Videos you save will appear here</Text>
//         </View>
//       )}

//       {activeTab === "following" && (
//         <View style={styles.emptyStateContainer}>
//           <Text style={styles.emptyStateText}>Following list</Text>
//           <Text style={styles.emptyStateSubtext}>
//             {isOwnProfile ? "Connect your following list here when ready" : "Following list is not available for other users yet"}
//           </Text>
//         </View>
//       )}

//       {activeTab === "orders" && isOwnProfile && (
//         <View style={styles.emptyStateContainer}>
//           <Text style={styles.emptyStateText}>Orders</Text>
//           <Text style={styles.emptyStateSubtext}>Integrate your orders component here (OrderPDFList)</Text>
//         </View>
//       )}
//     </ScrollView>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },

//   header: { flexDirection: "row", justifyContent: "flex-end", padding: 16, marginTop: 40 },
//   settingsButton: {
//     width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.dark.card,
//     justifyContent: "center", alignItems: "center",
//   },

//   profileSection: { alignItems: "center", paddingHorizontal: 20, marginBottom: 20 },
//   avatarContainer: { position: "relative", marginBottom: 16 },
//   profileImage: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: Colors.dark.primary },

//   businessIndicator: {
//     position: "absolute", bottom: 0, right: 0, backgroundColor: Colors.dark.secondary,
//     paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
//   },
//   businessIndicatorText: { color: Colors.dark.text, fontSize: 10, fontWeight: "bold" },

//   displayName: { fontSize: 24, fontWeight: "bold", color: Colors.dark.text, marginBottom: 4 },
//   username: { fontSize: 16, color: Colors.dark.subtext, marginBottom: 8 },
//   location: { fontSize: 14, color: Colors.dark.primary, marginBottom: 16, fontWeight: "500" },
//   bio: { fontSize: 15, color: Colors.dark.text, textAlign: "center", marginBottom: 20, paddingHorizontal: 20, lineHeight: 22 },

//   statsContainer: {
//     flexDirection: "row", justifyContent: "space-between", width: "80%",
//     marginBottom: 24, backgroundColor: Colors.dark.card, borderRadius: 16,
//     paddingVertical: 16, paddingHorizontal: 8,
//   },
//   statItem: { alignItems: "center", flex: 1 },
//   statValue: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text, marginBottom: 4 },
//   statLabel: { fontSize: 14, color: Colors.dark.subtext },
//   statDivider: { width: 1, height: "60%", backgroundColor: Colors.dark.divider, alignSelf: "center" },

//   buttonContainer: { flexDirection: "row", marginBottom: 20, flexWrap: "wrap", justifyContent: "center", gap: 12 },

//   editProfileButton: {
//     flexDirection: "row", alignItems: "center", backgroundColor: Colors.dark.card,
//     paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12,
//     borderWidth: 1, borderColor: Colors.dark.divider,
//   },
//   editProfileText: { color: Colors.dark.text, marginLeft: 8, fontWeight: "500" },

//   actionButton: {
//     borderRadius: 12, overflow: "hidden", elevation: 4,
//     shadowColor: Colors.dark.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8,
//   },
//   gradientButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, paddingHorizontal: 24 },
//   smallButton: { paddingVertical: 10, paddingHorizontal: 16 },
//   actionButtonTextCenter: { color: Colors.dark.text, fontWeight: "600", fontSize: 15 },

//   unfollowButton: {
//     alignItems: "center", justifyContent: "center",
//     paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1,
//     borderColor: Colors.dark.primary, borderRadius: 12,
//   },
//   unfollowButtonText: { color: Colors.dark.primary, fontWeight: "600", fontSize: 15 },

//   messageButton: { backgroundColor: Colors.dark.card, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: Colors.dark.divider },
//   messageButtonText: { color: Colors.dark.text, fontWeight: "500", fontSize: 15 },

//   businessBadge: {
//     backgroundColor: "rgba(16, 185, 129, 0.1)",
//     paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12,
//     marginBottom: 16, borderWidth: 1, borderColor: "rgba(16, 185, 129, 0.3)",
//   },
//   businessBadgeText: { color: Colors.dark.secondary, fontWeight: "600", fontSize: 13 },

//   tabsContainer: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Colors.dark.divider },
//   tab: { flex: 1, alignItems: "center", paddingVertical: 16 },
//   activeTab: { borderBottomWidth: 2, borderBottomColor: Colors.dark.primary },

//   videosGrid: { flexDirection: "row", flexWrap: "wrap", padding: 2 },
//   videoThumbnail: { width: "33.33%", aspectRatio: 1, padding: 2, position: "relative" },
//   thumbnailImage: { width: "100%", height: "100%", borderRadius: 8 },
//   videoStats: {
//     position: "absolute", bottom: 0, left: 0, right: 0,
//     backgroundColor: "rgba(0, 0, 0, 0.5)", padding: 6, alignItems: "center",
//     borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
//   },
//   videoStatsText: { color: Colors.dark.text, fontSize: 12, fontWeight: "500" },

//   emptyStateContainer: { width: "100%", padding: 40, alignItems: "center" },
//   emptyStateText: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   emptyStateSubtext: { fontSize: 15, color: Colors.dark.subtext, textAlign: "center", lineHeight: 22 },

//   loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, marginTop: 100 },
//   loadingText: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text, marginTop: 12 },

//   notAuthenticatedContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, marginTop: 100 },
//   notAuthenticatedTitle: { fontSize: 28, fontWeight: "bold", color: Colors.dark.text, marginBottom: 16 },
//   notAuthenticatedText: { fontSize: 16, color: Colors.dark.subtext, textAlign: "center", marginBottom: 32, lineHeight: 24 },

//   refreshButton: { backgroundColor: Colors.dark.primary, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, marginTop: 16 },
//   refreshButtonText: { color: Colors.dark.text, fontSize: 16, fontWeight: "600" },

//   errorText: { fontSize: 16, color: Colors.dark.text, textAlign: "center", marginTop: 40 },
// });












import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  Grid,
  Bookmark,
  Users,
  FileText,
  Edit,
  Settings,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";

import Colors from "@/constants/colors";
import { useAuthStore } from "@/store/auth-store";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { followService, videoService } from "@/lib/database";
import VideoFrameThumbnail from "@/components/VideoFrameThumbnail";

type ProfileRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  avatar_gender: 'male' | 'female' | null;
  bio: string | null;
  location_city: string | null;
  user_type: string | null; // 'business' | 'personal'
  business_type: string | null;
  followers_count: number | null;
  following_count: number | null;
};

export default function ProfileUserScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string; id?: string }>();
  const userId = (params.userId || params.id || "").toString();

  const { user: authUser, profile: authProfile, loading: authLoading } = useAuth();
  const { isFollowing, followUser, unfollowUser, followVersion, avatarVersion } = useAuthStore();

  const [activeTab, setActiveTab] = useState<
    "videos" | "saved" | "following" | "orders"
  >("videos");

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [userVideos, setUserVideos] = useState<any[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);

  const isOwnProfile = !!authUser?.id && userId === authUser.id;

  const displayProfile = useMemo<ProfileRow | null>(() => {
    if (isOwnProfile && authProfile && authUser?.id) {
      return {
        id: authUser.id,
        full_name: authProfile.full_name,
        username: authProfile.username,
        avatar_url: authProfile.avatar_url,
        avatar_gender: (authProfile as any).avatar_gender ?? null,
        bio: authProfile.bio,
        location_city: authProfile.location_city,
        user_type: authProfile.user_type,
        business_type: authProfile.business_type,
        followers_count: authProfile.followers_count,
        following_count: authProfile.following_count,
      };
    }
    return profile;
  }, [isOwnProfile, authProfile, authUser?.id, profile]);

  // Load other user's profile from Supabase
  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        setLoadError(null);

        if (!userId) {
          setLoadError("Missing user id");
          return;
        }

        if (authLoading) return;

        // own profile: no need to fetch
        if (authUser?.id && userId === authUser.id) {
          setLoading(false);
          return;
        }

        setLoading(true);

        let { data, error } = await supabase
          .from("profiles")
          .select(
            "id, full_name, username, avatar_url, avatar_gender, bio, location_city, user_type, business_type, followers_count, following_count"
          )
          .eq("id", userId)
          .single();

        if (error && (error.code === '42703' || String(error.message || '').includes('avatar_gender'))) {
          const legacyResult = await supabase
            .from("profiles")
            .select(
              "id, full_name, username, avatar_url, bio, location_city, user_type, business_type, followers_count, following_count"
            )
            .eq("id", userId)
            .single();

          if (!legacyResult.error && legacyResult.data) {
            data = {
              ...legacyResult.data,
              avatar_gender: null,
            } as any;
            error = null as any;
          }
        }

        if (!mounted) return;

        if (error) {
          setLoadError(error.message || "Failed to load profile");
          setProfile(null);
        } else {
          setProfile(data as ProfileRow);
        }
      } catch (e: any) {
        if (!mounted) return;
        setLoadError(e?.message || "Something went wrong");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [userId, authUser?.id, authLoading, avatarVersion]);

  useEffect(() => {
    let cancelled = false;

    const loadUserVideos = async () => {
      if (!displayProfile?.id) {
        setUserVideos([]);
        return;
      }

      setVideosLoading(true);
      try {
        let videos = await videoService.getUserVideos(displayProfile.id);

        // Fallback for existing accounts where direct per-user fetch may return no rows.
        if (!videos || videos.length === 0) {
          const publicVideos = await videoService.getVideos(300, 0);
          videos = (publicVideos || []).filter((row: any) => {
            const profile = Array.isArray(row?.profiles) ? row.profiles[0] : row?.profiles;
            return row?.user_id === displayProfile.id || profile?.id === displayProfile.id;
          });
        }

        if (!cancelled) {
          setUserVideos(videos || []);
        }
      } catch (error) {
        console.error("Error loading profile videos:", error);
        if (!cancelled) {
          setUserVideos([]);
        }
      } finally {
        if (!cancelled) {
          setVideosLoading(false);
        }
      }
    };

    loadUserVideos();

    return () => {
      cancelled = true;
    };
  }, [displayProfile?.id]);

  const refreshFollowCounts = async (targetUserId: string) => {
    try {
      const counts = await followService.getFollowCounts(targetUserId);
      setFollowCounts({
        followers: counts.followersCount,
        following: counts.followingCount,
      });
    } catch (error) {
      console.error('Error refreshing follow counts:', error);
    }
  };

  useEffect(() => {
    if (displayProfile?.id) {
      setFollowCounts({
        followers: displayProfile.followers_count || 0,
        following: displayProfile.following_count || 0,
      });
      refreshFollowCounts(displayProfile.id);
    }
  }, [displayProfile?.id, followVersion]);

  const handleFollowToggle = async () => {
    if (!authUser?.id) {
      router.push("/signin");
      return;
    }
    if (!displayProfile?.id) return;

    const currentlyFollowing = isFollowing(displayProfile.id);

    setFollowCounts((prev) => ({
      followers: Math.max(0, prev.followers + (currentlyFollowing ? -1 : 1)),
      following: prev.following,
    }));

    if (currentlyFollowing) {
      await unfollowUser(displayProfile.id);
    } else {
      await followUser(displayProfile.id);
    }

    await refreshFollowCounts(displayProfile.id);
  };

  /**
   * ✅ FIX: Always pass receiver id clearly.
   */
  const handleMessageUser = () => {
    if (!authUser?.id) {
      router.push("/signin");
      return;
    }
    if (!displayProfile?.id) return;

    router.push({
      pathname: "/chat/[chatId]" as any,
      params: {
        chatId: "new",
        // keep both names for compatibility
        userId: displayProfile.id,
        otherUserId: displayProfile.id,

        full_name: displayProfile.full_name ?? "",
        username: displayProfile.username ?? "",
        avatar_url: displayProfile.avatar_url ?? "",
      },
    });
  };

  const handleEditProfile = () => router.push("/edit-profile");
  const handleSettingsPress = () => router.push("/settings");

  if (authLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (!authUser) {
    return (
      <View style={styles.container}>
        <View style={styles.notAuthenticatedContainer}>
          <Text style={styles.notAuthenticatedTitle}>Not Signed In</Text>
          <Text style={styles.notAuthenticatedText}>
            Please sign in to view profiles
          </Text>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push("/signin")}
          >
            {Platform.OS !== "web" ? (
              <LinearGradient
                colors={
                  Colors.dark.gradients.primary as [string, string, ...string[]]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradientButton}
              >
                <Text style={styles.actionButtonTextCenter}>Sign In</Text>
              </LinearGradient>
            ) : (
              <View
                style={[
                  styles.gradientButton,
                  { backgroundColor: Colors.dark.primary },
                ]}
              >
                <Text style={styles.actionButtonTextCenter}>Sign In</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.primary} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </View>
    );
  }

  if (loadError || !displayProfile) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>
            {loadError ? `Oops: ${loadError}` : "Profile not found"}
          </Text>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={() => router.back()}
          >
            <Text style={styles.refreshButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isBusiness = displayProfile.user_type === "business";
  const fullName = displayProfile.full_name || "User";
  const username = displayProfile.username
    ? `@${displayProfile.username}`
    : "@user";
  const homeRoute = authProfile?.user_type === "business" ? "/(tabsbusiness)" : "/(tabs)";

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        {isOwnProfile && (
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={handleSettingsPress}
          >
            <Settings size={24} color={Colors.dark.text} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.profileSection}>
        <View style={styles.avatarContainer}>
          {displayProfile.avatar_url ? (
            <AvatarImage
              uri={displayProfile.avatar_url}
              style={styles.profileImage}
              contentFit="cover"
              transition={300}
            />
          ) : displayProfile.avatar_gender ? (
            <View style={[
              styles.profileImage,
              {
                backgroundColor: displayProfile.avatar_gender === 'male' ? '#3B82F6' : '#EC4899',
                justifyContent: 'center',
                alignItems: 'center',
              }
            ]}>
              <Text style={{ fontSize: 52 }}>
                {displayProfile.avatar_gender === 'male' ? '👨' : '👩'}
              </Text>
            </View>
          ) : (
            <Image
              source={require("@/assets/images/avatar-placeholder.png")}
              style={styles.profileImage}
              contentFit="cover"
              transition={300}
            />
          )}
          {isBusiness && (
            <View style={styles.businessIndicator}>
              <Text style={styles.businessIndicatorText}>PRO</Text>
            </View>
          )}
        </View>

        <Text style={styles.displayName}>{fullName}</Text>
        <Text style={styles.username}>{username}</Text>

        {!!displayProfile.location_city && (
          <Text style={styles.location}>📍 {displayProfile.location_city}</Text>
        )}

        {!!displayProfile.bio && (
          <Text style={styles.bio}>{displayProfile.bio}</Text>
        )}

        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{userVideos.length}</Text>
            <Text style={styles.statLabel}>Videos</Text>
          </View>

          <View style={styles.statDivider} />

          <TouchableOpacity
            style={styles.statItem}
            onPress={() => router.push({ pathname: '/following', params: { userId: displayProfile.id } })}
          >
            <Text style={styles.statValue}>{followCounts.following}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </TouchableOpacity>

          <View style={styles.statDivider} />

          <TouchableOpacity
            style={styles.statItem}
            onPress={() => router.push({ pathname: '/followers', params: { userId: displayProfile.id } })}
          >
            <Text style={styles.statValue}>{followCounts.followers}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonContainer}>
          {isOwnProfile ? (
            <TouchableOpacity
              style={styles.editProfileButton}
              onPress={handleEditProfile}
            >
              <Edit size={16} color={Colors.dark.text} />
              <Text style={styles.editProfileText}>Edit Profile</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleFollowToggle}
              >
                {isFollowing(displayProfile.id) ? (
                  <View style={styles.unfollowButton}>
                    <Text style={styles.unfollowButtonText}>Unfollow</Text>
                  </View>
                ) : Platform.OS !== "web" ? (
                  <LinearGradient
                    colors={
                      Colors.dark.gradients.primary as [string, string, ...string[]]
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.gradientButton, styles.smallButton]}
                  >
                    <Text style={styles.actionButtonTextCenter}>Follow</Text>
                  </LinearGradient>
                ) : (
                  <View
                    style={[
                      styles.gradientButton,
                      styles.smallButton,
                      { backgroundColor: Colors.dark.primary },
                    ]}
                  >
                    <Text style={styles.actionButtonTextCenter}>Follow</Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.messageButton}
                onPress={handleMessageUser}
              >
                <Text style={styles.messageButtonText}>Message</Text>
              </TouchableOpacity>
            </>
          )}
        </View>


        {isBusiness && <TouchableOpacity accessibilityRole="button" style={[styles.messageButton, {marginVertical:12}]} onPress={() => router.push({pathname:'/tables/venue',params:{venueId:displayProfile.id,venueName:displayProfile.full_name || displayProfile.username || ''}})}><Text style={styles.messageButtonText}>Book a table</Text></TouchableOpacity>}
        {isBusiness && (
          <View style={styles.businessBadge}>
            <Text style={styles.businessBadgeText}>
              {displayProfile.business_type || "Business Account"}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "videos" && styles.activeTab]}
          onPress={() => setActiveTab("videos")}
        >
          <Grid
            size={24}
            color={
              activeTab === "videos" ? Colors.dark.primary : Colors.dark.inactive
            }
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === "saved" && styles.activeTab]}
          onPress={() => setActiveTab("saved")}
        >
          <Bookmark
            size={24}
            color={
              activeTab === "saved" ? Colors.dark.primary : Colors.dark.inactive
            }
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === "following" && styles.activeTab]}
          onPress={() => setActiveTab("following")}
        >
          <Users
            size={24}
            color={
              activeTab === "following"
                ? Colors.dark.primary
                : Colors.dark.inactive
            }
          />
        </TouchableOpacity>

        {isOwnProfile && (
          <TouchableOpacity
            style={[styles.tab, activeTab === "orders" && styles.activeTab]}
            onPress={() => setActiveTab("orders")}
          >
            <FileText
              size={24}
              color={
                activeTab === "orders"
                  ? Colors.dark.primary
                  : Colors.dark.inactive
              }
            />
          </TouchableOpacity>
        )}
      </View>

      {activeTab === "videos" && (
        <View style={styles.videosGrid}>
          {videosLoading ? (
            <View style={styles.emptyStateContainer}>
              <ActivityIndicator size="large" color={Colors.dark.primary} />
              <Text style={styles.emptyStateSubtext}>Loading videos...</Text>
            </View>
          ) : userVideos.length > 0 ? (
            userVideos.map((video) => (
              <TouchableOpacity
                key={video.id}
                style={styles.videoThumbnail}
                onPress={() =>
                  router.push({
                    pathname: '/event/[id]',
                    params: { id: String(video.id) },
                  })
                }
              >
                <VideoFrameThumbnail
                  videoUri={video.video_url || video.url || undefined}
                  fallbackUri={
                    video.thumbnail_url ||
                    video.thumbnail ||
                    "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80"
                  }
                  style={styles.thumbnailImage}
                />
                <View style={styles.videoStats}>
                  <Text style={styles.videoStatsText}>{video.likes_count ?? video.likes ?? 0} likes</Text>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyStateContainer}>
              <Text style={styles.emptyStateText}>No videos yet</Text>
              <Text style={styles.emptyStateSubtext}>
                {isOwnProfile
                  ? "Your uploaded videos will appear here"
                  : `${fullName} hasn't uploaded any videos yet`}
              </Text>
            </View>
          )}
        </View>
      )}

      {activeTab === "saved" && (
        <View style={styles.emptyStateContainer}>
          <Text style={styles.emptyStateText}>No saved videos</Text>
          <Text style={styles.emptyStateSubtext}>
            Videos you save will appear here
          </Text>
        </View>
      )}

      {activeTab === "following" && (
        <View style={styles.emptyStateContainer}>
          <Text style={styles.emptyStateText}>Following list</Text>
          <Text style={styles.emptyStateSubtext}>
            {isOwnProfile
              ? "Connect your following list here when ready"
              : "Following list is not available for other users yet"}
          </Text>
        </View>
      )}

      {activeTab === "orders" && isOwnProfile && (
        <View style={styles.emptyStateContainer}>
          <Text style={styles.emptyStateText}>Orders</Text>
          <Text style={styles.emptyStateSubtext}>
            Integrate your orders component here (OrderPDFList)
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },

  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: 16,
    marginTop: 40,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },

  profileSection: {
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  avatarContainer: { position: "relative", marginBottom: 16 },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: Colors.dark.primary,
  },

  businessIndicator: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: Colors.dark.secondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  businessIndicatorText: {
    color: Colors.dark.text,
    fontSize: 10,
    fontWeight: "bold",
  },

  displayName: {
    fontSize: 24,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 4,
  },
  username: { fontSize: 16, color: Colors.dark.subtext, marginBottom: 8 },
  location: {
    fontSize: 14,
    color: Colors.dark.primary,
    marginBottom: 16,
    fontWeight: "500",
  },
  bio: {
    fontSize: 15,
    color: Colors.dark.text,
    textAlign: "center",
    marginBottom: 20,
    paddingHorizontal: 20,
    lineHeight: 22,
  },

  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "80%",
    marginBottom: 24,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  statItem: { alignItems: "center", flex: 1 },
  statValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 4,
  },
  statLabel: { fontSize: 14, color: Colors.dark.subtext },
  statDivider: {
    width: 1,
    height: "60%",
    backgroundColor: Colors.dark.divider,
    alignSelf: "center",
  },

  buttonContainer: {
    flexDirection: "row",
    marginBottom: 20,
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
  },

  editProfileButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  editProfileText: { color: Colors.dark.text, marginLeft: 8, fontWeight: "500" },

  actionButton: {
    borderRadius: 12,
    overflow: "hidden",
    elevation: 4,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  gradientButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  smallButton: { paddingVertical: 10, paddingHorizontal: 16 },
  actionButtonTextCenter: {
    color: Colors.dark.text,
    fontWeight: "600",
    fontSize: 15,
  },

  unfollowButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    borderRadius: 12,
  },
  unfollowButtonText: {
    color: Colors.dark.primary,
    fontWeight: "600",
    fontSize: 15,
  },

  messageButton: {
    backgroundColor: Colors.dark.card,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  messageButtonText: { color: Colors.dark.text, fontWeight: "500", fontSize: 15 },

  businessBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  businessBadgeText: {
    color: Colors.dark.secondary,
    fontWeight: "600",
    fontSize: 13,
  },

  tabsContainer: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 16 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: Colors.dark.primary },

  videosGrid: { flexDirection: "row", flexWrap: "wrap", padding: 2 },
  videoThumbnail: {
    width: "33.33%",
    aspectRatio: 1,
    padding: 2,
    position: "relative",
    overflow: "hidden",
  },
  thumbnailImage: { width: "100%", height: "100%", borderRadius: 8 },
  videoStats: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    padding: 6,
    alignItems: "center",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  videoStatsText: { color: Colors.dark.text, fontSize: 12, fontWeight: "500" },

  emptyStateContainer: { width: "100%", padding: 40, alignItems: "center" },
  emptyStateText: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 15,
    color: Colors.dark.subtext,
    textAlign: "center",
    lineHeight: 22,
  },

  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    marginTop: 100,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginTop: 12,
  },

  notAuthenticatedContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    marginTop: 100,
  },
  notAuthenticatedTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 16,
  },
  notAuthenticatedText: {
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 24,
  },

  refreshButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 16,
  },
  refreshButtonText: { color: Colors.dark.text, fontSize: 16, fontWeight: "600" },

  errorText: {
    fontSize: 16,
    color: Colors.dark.text,
    textAlign: "center",
    marginTop: 40,
  },
});









// import React, { useEffect, useMemo, useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   ScrollView,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { useRouter, useLocalSearchParams } from "expo-router";
// import {
//   Grid,
//   Bookmark,
//   Users,
//   FileText,
//   Edit,
//   Settings,
// } from "lucide-react-native";
// import { LinearGradient } from "expo-linear-gradient";

// import Colors from "@/constants/colors";
// import { useAuthStore } from "@/store/auth-store";
// import { useAuth } from "@/lib/auth";
// import { supabase } from "@/lib/supabase";
// import { mockVideos } from "@/mocks/videos";

// type ProfileRow = {
//   id: string;
//   full_name: string | null;
//   username: string | null;
//   avatar_url: string | null;
//   bio: string | null;
//   location_city: string | null;
//   user_type: string | null; // 'business' | 'personal'
//   business_type: string | null;
//   followers_count: number | null;
//   following_count: number | null;
// };

// export default function ProfileUserScreen() {
//   const router = useRouter();
//   const params = useLocalSearchParams<{ userId?: string }>();
//   const userId = (params.userId || "").toString();

//   const { user: authUser, profile: authProfile, loading: authLoading } =
//     useAuth();

//   const { isFollowing, followUser, unfollowUser } = useAuthStore();

//   const [activeTab, setActiveTab] = useState<
//     "videos" | "saved" | "following" | "orders"
//   >("videos");
//   const [loading, setLoading] = useState(true);
//   const [profile, setProfile] = useState<ProfileRow | null>(null);
//   const [loadError, setLoadError] = useState<string | null>(null);

//   const isOwnProfile = !!authUser?.id && userId === authUser.id;

//   const displayProfile = useMemo<ProfileRow | null>(() => {
//     if (isOwnProfile && authProfile && authUser?.id) {
//       return {
//         id: authUser.id,
//         full_name: authProfile.full_name,
//         username: authProfile.username,
//         avatar_url: authProfile.avatar_url,
//         bio: authProfile.bio,
//         location_city: authProfile.location_city,
//         user_type: authProfile.user_type,
//         business_type: authProfile.business_type,
//         followers_count: authProfile.followers_count,
//         following_count: authProfile.following_count,
//       };
//     }
//     return profile;
//   }, [isOwnProfile, authProfile, authUser?.id, profile]);

//   // Load other user's profile from Supabase
//   useEffect(() => {
//     let mounted = true;

//     const run = async () => {
//       try {
//         setLoadError(null);

//         if (!userId) {
//           setLoadError("Missing user id");
//           return;
//         }

//         if (authLoading) return;

//         // own profile: no need to fetch
//         if (authUser?.id && userId === authUser.id) {
//           setLoading(false);
//           return;
//         }

//         setLoading(true);

//         const { data, error } = await supabase
//           .from("profiles")
//           .select(
//             "id, full_name, username, avatar_url, bio, location_city, user_type, business_type, followers_count, following_count"
//           )
//           .eq("id", userId)
//           .single();

//         if (!mounted) return;

//         if (error) {
//           setLoadError(error.message || "Failed to load profile");
//           setProfile(null);
//         } else {
//           setProfile(data as ProfileRow);
//         }
//       } catch (e: any) {
//         if (!mounted) return;
//         setLoadError(e?.message || "Something went wrong");
//       } finally {
//         if (!mounted) return;
//         setLoading(false);
//       }
//     };

//     run();
//     return () => {
//       mounted = false;
//     };
//   }, [userId, authUser?.id, authLoading]);

//   const userVideos = useMemo(() => {
//     if (!displayProfile?.id) return [];
//     return mockVideos.filter((v) => v.userId === displayProfile.id);
//   }, [displayProfile?.id]);

//   const handleFollowToggle = () => {
//     if (!authUser?.id) {
//       router.push("/signin");
//       return;
//     }
//     if (!displayProfile?.id) return;

//     if (isFollowing(displayProfile.id)) {
//       unfollowUser(displayProfile.id);
//     } else {
//       followUser(displayProfile.id);
//     }
//   };

//   /**
//    * ✅ FIX:
//    * Pass searched user full_name + avatar_url into chat screen params
//    * AND use chatId="new" so /chat/[chatId] route still works.
//    * Chat screen will create/find the real chat in background.
//    */
//   const handleMessageUser = () => {
//     if (!authUser?.id) {
//       router.push("/signin");
//       return;
//     }
//     if (!displayProfile?.id) return;

//     router.push({
//       pathname: "/chat/[chatId]" as any,
//       params: {
//         chatId: "new", // sentinel
//         userId: displayProfile.id, // other user id
//         full_name: displayProfile.full_name ?? "",
//         username: displayProfile.username ?? "",
//         avatar_url: displayProfile.avatar_url ?? "",
//       },
//     });
//   };

//   const handleEditProfile = () => router.push("/edit-profile");
//   const handleSettingsPress = () => router.push("/settings");

//   if (authLoading) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <ActivityIndicator size="large" color={Colors.dark.primary} />
//           <Text style={styles.loadingText}>Loading...</Text>
//         </View>
//       </View>
//     );
//   }

//   if (!authUser) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.notAuthenticatedContainer}>
//           <Text style={styles.notAuthenticatedTitle}>Not Signed In</Text>
//           <Text style={styles.notAuthenticatedText}>
//             Please sign in to view profiles
//           </Text>
//           <TouchableOpacity
//             style={styles.actionButton}
//             onPress={() => router.push("/signin")}
//           >
//             {Platform.OS !== "web" ? (
//               <LinearGradient
//                 colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
//                 start={{ x: 0, y: 0 }}
//                 end={{ x: 1, y: 1 }}
//                 style={styles.gradientButton}
//               >
//                 <Text style={styles.actionButtonTextCenter}>Sign In</Text>
//               </LinearGradient>
//             ) : (
//               <View
//                 style={[
//                   styles.gradientButton,
//                   { backgroundColor: Colors.dark.primary },
//                 ]}
//               >
//                 <Text style={styles.actionButtonTextCenter}>Sign In</Text>
//               </View>
//             )}
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   }

//   if (loading) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <ActivityIndicator size="large" color={Colors.dark.primary} />
//           <Text style={styles.loadingText}>Loading profile...</Text>
//         </View>
//       </View>
//     );
//   }

//   if (loadError || !displayProfile) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <Text style={styles.errorText}>
//             {loadError ? `Oops: ${loadError}` : "Profile not found"}
//           </Text>
//           <TouchableOpacity
//             style={styles.refreshButton}
//             onPress={() => router.back()}
//           >
//             <Text style={styles.refreshButtonText}>Go Back</Text>
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   }

//   const isBusiness = displayProfile.user_type === "business";
//   const avatarUri = displayProfile.avatar_url || "https://via.placeholder.com/150";
//   const fullName = displayProfile.full_name || "User";
//   const username = displayProfile.username ? `@${displayProfile.username}` : "@user";

//   return (
//     <ScrollView style={styles.container}>
//       <View style={styles.header}>
//         {isOwnProfile && (
//           <TouchableOpacity
//             style={styles.settingsButton}
//             onPress={handleSettingsPress}
//           >
//             <Settings size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//         )}
//       </View>

//       <View style={styles.profileSection}>
//         <View style={styles.avatarContainer}>
//           <Image
//             source={{ uri: avatarUri }}
//             style={styles.profileImage}
//             contentFit="cover"
//             transition={300}
//           />
//           {isBusiness && (
//             <View style={styles.businessIndicator}>
//               <Text style={styles.businessIndicatorText}>PRO</Text>
//             </View>
//           )}
//         </View>

//         <Text style={styles.displayName}>{fullName}</Text>
//         <Text style={styles.username}>{username}</Text>

//         {!!displayProfile.location_city && (
//           <Text style={styles.location}>📍 {displayProfile.location_city}</Text>
//         )}

//         {!!displayProfile.bio && <Text style={styles.bio}>{displayProfile.bio}</Text>}

//         <View style={styles.statsContainer}>
//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>{userVideos.length}</Text>
//             <Text style={styles.statLabel}>Videos</Text>
//           </View>

//           <View style={styles.statDivider} />

//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>
//               {displayProfile.following_count ?? 0}
//             </Text>
//             <Text style={styles.statLabel}>Following</Text>
//           </View>

//           <View style={styles.statDivider} />

//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>
//               {displayProfile.followers_count ?? 0}
//             </Text>
//             <Text style={styles.statLabel}>Followers</Text>
//           </View>
//         </View>

//         <View style={styles.buttonContainer}>
//           {isOwnProfile ? (
//             <TouchableOpacity
//               style={styles.editProfileButton}
//               onPress={handleEditProfile}
//             >
//               <Edit size={16} color={Colors.dark.text} />
//               <Text style={styles.editProfileText}>Edit Profile</Text>
//             </TouchableOpacity>
//           ) : (
//             <>
//               <TouchableOpacity
//                 style={styles.actionButton}
//                 onPress={handleFollowToggle}
//               >
//                 {isFollowing(displayProfile.id) ? (
//                   <View style={styles.unfollowButton}>
//                     <Text style={styles.unfollowButtonText}>Unfollow</Text>
//                   </View>
//                 ) : Platform.OS !== "web" ? (
//                   <LinearGradient
//                     colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
//                     start={{ x: 0, y: 0 }}
//                     end={{ x: 1, y: 1 }}
//                     style={[styles.gradientButton, styles.smallButton]}
//                   >
//                     <Text style={styles.actionButtonTextCenter}>Follow</Text>
//                   </LinearGradient>
//                 ) : (
//                   <View
//                     style={[
//                       styles.gradientButton,
//                       styles.smallButton,
//                       { backgroundColor: Colors.dark.primary },
//                     ]}
//                   >
//                     <Text style={styles.actionButtonTextCenter}>Follow</Text>
//                   </View>
//                 )}
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={styles.messageButton}
//                 onPress={handleMessageUser}
//               >
//                 <Text style={styles.messageButtonText}>Message</Text>
//               </TouchableOpacity>
//             </>
//           )}
//         </View>

//         {isBusiness && (
//           <View style={styles.businessBadge}>
//             <Text style={styles.businessBadgeText}>
//               {displayProfile.business_type || "Business Account"}
//             </Text>
//           </View>
//         )}
//       </View>

//       <View style={styles.tabsContainer}>
//         <TouchableOpacity
//           style={[styles.tab, activeTab === "videos" && styles.activeTab]}
//           onPress={() => setActiveTab("videos")}
//         >
//           <Grid
//             size={24}
//             color={
//               activeTab === "videos" ? Colors.dark.primary : Colors.dark.inactive
//             }
//           />
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={[styles.tab, activeTab === "saved" && styles.activeTab]}
//           onPress={() => setActiveTab("saved")}
//         >
//           <Bookmark
//             size={24}
//             color={
//               activeTab === "saved" ? Colors.dark.primary : Colors.dark.inactive
//             }
//           />
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={[styles.tab, activeTab === "following" && styles.activeTab]}
//           onPress={() => setActiveTab("following")}
//         >
//           <Users
//             size={24}
//             color={
//               activeTab === "following"
//                 ? Colors.dark.primary
//                 : Colors.dark.inactive
//             }
//           />
//         </TouchableOpacity>

//         {isOwnProfile && (
//           <TouchableOpacity
//             style={[styles.tab, activeTab === "orders" && styles.activeTab]}
//             onPress={() => setActiveTab("orders")}
//           >
//             <FileText
//               size={24}
//               color={
//                 activeTab === "orders"
//                   ? Colors.dark.primary
//                   : Colors.dark.inactive
//               }
//             />
//           </TouchableOpacity>
//         )}
//       </View>

//       {activeTab === "videos" && (
//         <View style={styles.videosGrid}>
//           {userVideos.length > 0 ? (
//             userVideos.map((video) => (
//               <TouchableOpacity
//                 key={video.id}
//                 style={styles.videoThumbnail}
//                 onPress={() =>
//                   router.push({
//                     pathname: "/event/[id]" as any,
//                     params: { id: video.id },
//                   })
//                 }
//               >
//                 <Image
//                   source={{ uri: video.thumbnail }}
//                   style={styles.thumbnailImage}
//                   contentFit="cover"
//                   transition={300}
//                 />
//                 <View style={styles.videoStats}>
//                   <Text style={styles.videoStatsText}>{video.likes} likes</Text>
//                 </View>
//               </TouchableOpacity>
//             ))
//           ) : (
//             <View style={styles.emptyStateContainer}>
//               <Text style={styles.emptyStateText}>No videos yet</Text>
//               <Text style={styles.emptyStateSubtext}>
//                 {isOwnProfile
//                   ? "Your uploaded videos will appear here"
//                   : `${fullName} hasn't uploaded any videos yet`}
//               </Text>
//             </View>
//           )}
//         </View>
//       )}

//       {activeTab === "saved" && (
//         <View style={styles.emptyStateContainer}>
//           <Text style={styles.emptyStateText}>No saved videos</Text>
//           <Text style={styles.emptyStateSubtext}>
//             Videos you save will appear here
//           </Text>
//         </View>
//       )}

//       {activeTab === "following" && (
//         <View style={styles.emptyStateContainer}>
//           <Text style={styles.emptyStateText}>Following list</Text>
//           <Text style={styles.emptyStateSubtext}>
//             {isOwnProfile
//               ? "Connect your following list here when ready"
//               : "Following list is not available for other users yet"}
//           </Text>
//         </View>
//       )}

//       {activeTab === "orders" && isOwnProfile && (
//         <View style={styles.emptyStateContainer}>
//           <Text style={styles.emptyStateText}>Orders</Text>
//           <Text style={styles.emptyStateSubtext}>
//             Integrate your orders component here (OrderPDFList)
//           </Text>
//         </View>
//       )}
//     </ScrollView>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },

//   header: {
//     flexDirection: "row",
//     justifyContent: "flex-end",
//     padding: 16,
//     marginTop: 40,
//   },
//   settingsButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   profileSection: {
//     alignItems: "center",
//     paddingHorizontal: 20,
//     marginBottom: 20,
//   },
//   avatarContainer: { position: "relative", marginBottom: 16 },
//   profileImage: {
//     width: 100,
//     height: 100,
//     borderRadius: 50,
//     borderWidth: 3,
//     borderColor: Colors.dark.primary,
//   },

//   businessIndicator: {
//     position: "absolute",
//     bottom: 0,
//     right: 0,
//     backgroundColor: Colors.dark.secondary,
//     paddingHorizontal: 8,
//     paddingVertical: 4,
//     borderRadius: 10,
//   },
//   businessIndicatorText: {
//     color: Colors.dark.text,
//     fontSize: 10,
//     fontWeight: "bold",
//   },

//   displayName: {
//     fontSize: 24,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   username: { fontSize: 16, color: Colors.dark.subtext, marginBottom: 8 },
//   location: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//     marginBottom: 16,
//     fontWeight: "500",
//   },
//   bio: {
//     fontSize: 15,
//     color: Colors.dark.text,
//     textAlign: "center",
//     marginBottom: 20,
//     paddingHorizontal: 20,
//     lineHeight: 22,
//   },

//   statsContainer: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     width: "80%",
//     marginBottom: 24,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 16,
//     paddingVertical: 16,
//     paddingHorizontal: 8,
//   },
//   statItem: { alignItems: "center", flex: 1 },
//   statValue: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   statLabel: { fontSize: 14, color: Colors.dark.subtext },
//   statDivider: {
//     width: 1,
//     height: "60%",
//     backgroundColor: Colors.dark.divider,
//     alignSelf: "center",
//   },

//   buttonContainer: {
//     flexDirection: "row",
//     marginBottom: 20,
//     flexWrap: "wrap",
//     justifyContent: "center",
//     gap: 12,
//   },

//   editProfileButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//     borderRadius: 12,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   editProfileText: { color: Colors.dark.text, marginLeft: 8, fontWeight: "500" },

//   actionButton: {
//     borderRadius: 12,
//     overflow: "hidden",
//     elevation: 4,
//     shadowColor: Colors.dark.primary,
//     shadowOffset: { width: 0, height: 4 },
//     shadowOpacity: 0.2,
//     shadowRadius: 8,
//   },
//   gradientButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     paddingVertical: 14,
//     paddingHorizontal: 24,
//   },
//   smallButton: { paddingVertical: 10, paddingHorizontal: 16 },
//   actionButtonTextCenter: {
//     color: Colors.dark.text,
//     fontWeight: "600",
//     fontSize: 15,
//   },

//   unfollowButton: {
//     alignItems: "center",
//     justifyContent: "center",
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//     borderRadius: 12,
//   },
//   unfollowButtonText: {
//     color: Colors.dark.primary,
//     fontWeight: "600",
//     fontSize: 15,
//   },

//   messageButton: {
//     backgroundColor: Colors.dark.card,
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//     borderRadius: 12,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   messageButtonText: { color: Colors.dark.text, fontWeight: "500", fontSize: 15 },

//   businessBadge: {
//     backgroundColor: "rgba(16, 185, 129, 0.1)",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     borderRadius: 12,
//     marginBottom: 16,
//     borderWidth: 1,
//     borderColor: "rgba(16, 185, 129, 0.3)",
//   },
//   businessBadgeText: {
//     color: Colors.dark.secondary,
//     fontWeight: "600",
//     fontSize: 13,
//   },

//   tabsContainer: {
//     flexDirection: "row",
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   tab: { flex: 1, alignItems: "center", paddingVertical: 16 },
//   activeTab: { borderBottomWidth: 2, borderBottomColor: Colors.dark.primary },

//   videosGrid: { flexDirection: "row", flexWrap: "wrap", padding: 2 },
//   videoThumbnail: {
//     width: "33.33%",
//     aspectRatio: 1,
//     padding: 2,
//     position: "relative",
//   },
//   thumbnailImage: { width: "100%", height: "100%", borderRadius: 8 },
//   videoStats: {
//     position: "absolute",
//     bottom: 0,
//     left: 0,
//     right: 0,
//     backgroundColor: "rgba(0, 0, 0, 0.5)",
//     padding: 6,
//     alignItems: "center",
//     borderBottomLeftRadius: 8,
//     borderBottomRightRadius: 8,
//   },
//   videoStatsText: { color: Colors.dark.text, fontSize: 12, fontWeight: "500" },

//   emptyStateContainer: { width: "100%", padding: 40, alignItems: "center" },
//   emptyStateText: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   emptyStateSubtext: {
//     fontSize: 15,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//     lineHeight: 22,
//   },

//   loadingContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//     marginTop: 100,
//   },
//   loadingText: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginTop: 12,
//   },

//   notAuthenticatedContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//     marginTop: 100,
//   },
//   notAuthenticatedTitle: {
//     fontSize: 28,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 16,
//   },
//   notAuthenticatedText: {
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//     marginBottom: 32,
//     lineHeight: 24,
//   },

//   refreshButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 8,
//     marginTop: 16,
//   },
//   refreshButtonText: { color: Colors.dark.text, fontSize: 16, fontWeight: "600" },

//   errorText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     textAlign: "center",
//     marginTop: 40,
//   },
// });











// import React, { useEffect, useMemo, useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   ScrollView,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { Image } from "expo-image";
// import { useRouter, useLocalSearchParams } from "expo-router";
// import { Grid, Bookmark, Users, FileText, Edit, Settings } from "lucide-react-native";
// import { LinearGradient } from "expo-linear-gradient";

// import Colors from "@/constants/colors";
// import { useAuthStore } from "@/store/auth-store";
// import { useAuth } from "@/lib/auth";

// // ✅ IMPORTANT: adjust this import to your actual supabase client path if different
// import { supabase } from "@/lib/supabase";

// // If you use mockVideos for now, keep it; later replace with real query
// import { mockVideos } from "@/mocks/videos";

// type ProfileRow = {
//   id: string;
//   full_name: string | null;
//   username: string | null;
//   avatar_url: string | null;
//   bio: string | null;
//   location_city: string | null;
//   user_type: string | null; // 'business' | 'personal'
//   business_type: string | null;
//   followers_count: number | null;
//   following_count: number | null;
// };

// export default function ProfileUserScreen() {
//   const router = useRouter();
//   const params = useLocalSearchParams<{ userId?: string }>();
//   const userId = (params.userId || "").toString();

//   const { user: authUser, profile: authProfile, loading: authLoading } = useAuth();

//   const {
//     isFollowing,
//     followUser,
//     unfollowUser,
//   } = useAuthStore();

//   const [activeTab, setActiveTab] = useState<"videos" | "saved" | "following" | "orders">("videos");
//   const [loading, setLoading] = useState(true);
//   const [profile, setProfile] = useState<ProfileRow | null>(null);
//   const [loadError, setLoadError] = useState<string | null>(null);

//   const isOwnProfile = !!authUser?.id && userId === authUser.id;

//   const displayProfile = useMemo<ProfileRow | null>(() => {
//     // own profile: use authProfile if available
//     if (isOwnProfile && authProfile) {
//       return {
//         id: authUser!.id,
//         full_name: authProfile.full_name,
//         username: authProfile.username,
//         avatar_url: authProfile.avatar_url,
//         bio: authProfile.bio,
//         location_city: authProfile.location_city,
//         user_type: authProfile.user_type,
//         business_type: authProfile.business_type,
//         followers_count: authProfile.followers_count,
//         following_count: authProfile.following_count,
//       };
//     }
//     return profile;
//   }, [isOwnProfile, authProfile, authUser, profile]);

//   // Load other user's profile from Supabase
//   useEffect(() => {
//     let mounted = true;

//     const run = async () => {
//       try {
//         setLoadError(null);

//         if (!userId) {
//           setLoadError("Missing user id");
//           return;
//         }

//         // wait auth to settle a bit (optional)
//         if (authLoading) return;

//         // own profile: no need to fetch
//         if (authUser?.id && userId === authUser.id) {
//           setLoading(false);
//           return;
//         }

//         setLoading(true);

//         const { data, error } = await supabase
//           .from("profiles")
//           .select(
//             "id, full_name, username, avatar_url, bio, location_city, user_type, business_type, followers_count, following_count"
//           )
//           .eq("id", userId)
//           .single();

//         if (!mounted) return;

//         if (error) {
//           setLoadError(error.message || "Failed to load profile");
//           setProfile(null);
//         } else {
//           setProfile(data as ProfileRow);
//         }
//       } catch (e: any) {
//         if (!mounted) return;
//         setLoadError(e?.message || "Something went wrong");
//       } finally {
//         if (!mounted) return;
//         setLoading(false);
//       }
//     };

//     run();
//     return () => {
//       mounted = false;
//     };
//   }, [userId, authUser?.id, authLoading]);

//   const userVideos = useMemo(() => {
//     if (!displayProfile?.id) return [];
//     return mockVideos.filter((v) => v.userId === displayProfile.id);
//   }, [displayProfile?.id]);

//   const handleFollowToggle = () => {
//     if (!authUser?.id) {
//       router.push("/signin");
//       return;
//     }
//     if (!displayProfile?.id) return;

//     if (isFollowing(displayProfile.id)) {
//       unfollowUser(displayProfile.id);
//     } else {
//       followUser(displayProfile.id);
//     }
//   };

//   const handleMessageUser = () => {
//     if (!authUser?.id) {
//       router.push("/signin");
//       return;
//     }
//     if (!displayProfile?.id) return;

//     router.push({
//       pathname: "/chat/[chatId]" as any,
//       params: { chatId: displayProfile.id },
//     });
//   };

//   const handleEditProfile = () => router.push("/edit-profile");
//   const handleSettingsPress = () => router.push("/settings");

//   if (authLoading) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <ActivityIndicator size="large" color={Colors.dark.primary} />
//           <Text style={styles.loadingText}>Loading...</Text>
//         </View>
//       </View>
//     );
//   }

//   if (!authUser) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.notAuthenticatedContainer}>
//           <Text style={styles.notAuthenticatedTitle}>Not Signed In</Text>
//           <Text style={styles.notAuthenticatedText}>
//             Please sign in to view profiles
//           </Text>
//           <TouchableOpacity style={styles.actionButton} onPress={() => router.push("/signin")}>
//             {Platform.OS !== "web" ? (
//               <LinearGradient
//                 colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
//                 start={{ x: 0, y: 0 }}
//                 end={{ x: 1, y: 1 }}
//                 style={styles.gradientButton}
//               >
//                 <Text style={styles.actionButtonTextCenter}>Sign In</Text>
//               </LinearGradient>
//             ) : (
//               <View style={[styles.gradientButton, { backgroundColor: Colors.dark.primary }]}>
//                 <Text style={styles.actionButtonTextCenter}>Sign In</Text>
//               </View>
//             )}
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   }

//   if (loading) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <ActivityIndicator size="large" color={Colors.dark.primary} />
//           <Text style={styles.loadingText}>Loading profile...</Text>
//         </View>
//       </View>
//     );
//   }

//   if (loadError || !displayProfile) {
//     return (
//       <View style={styles.container}>
//         <View style={styles.loadingContainer}>
//           <Text style={styles.errorText}>
//             {loadError ? `Oops: ${loadError}` : "Profile not found"}
//           </Text>
//           <TouchableOpacity style={styles.refreshButton} onPress={() => router.back()}>
//             <Text style={styles.refreshButtonText}>Go Back</Text>
//           </TouchableOpacity>
//         </View>
//       </View>
//     );
//   }

//   const isBusiness = displayProfile.user_type === "business";
//   const avatarUri = displayProfile.avatar_url || "https://via.placeholder.com/150";
//   const fullName = displayProfile.full_name || "User";
//   const username = displayProfile.username ? `@${displayProfile.username}` : "@user";

//   return (
//     <ScrollView style={styles.container}>
//       <View style={styles.header}>
//         {isOwnProfile && (
//           <TouchableOpacity style={styles.settingsButton} onPress={handleSettingsPress}>
//             <Settings size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//         )}
//       </View>

//       <View style={styles.profileSection}>
//         <View style={styles.avatarContainer}>
//           <Image source={{ uri: avatarUri }} style={styles.profileImage} contentFit="cover" transition={300} />
//           {isBusiness && (
//             <View style={styles.businessIndicator}>
//               <Text style={styles.businessIndicatorText}>PRO</Text>
//             </View>
//           )}
//         </View>

//         <Text style={styles.displayName}>{fullName}</Text>
//         <Text style={styles.username}>{username}</Text>

//         {!!displayProfile.location_city && (
//           <Text style={styles.location}>📍 {displayProfile.location_city}</Text>
//         )}

//         {!!displayProfile.bio && <Text style={styles.bio}>{displayProfile.bio}</Text>}

//         <View style={styles.statsContainer}>
//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>{userVideos.length}</Text>
//             <Text style={styles.statLabel}>Videos</Text>
//           </View>

//           <View style={styles.statDivider} />

//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>{displayProfile.following_count ?? 0}</Text>
//             <Text style={styles.statLabel}>Following</Text>
//           </View>

//           <View style={styles.statDivider} />

//           <View style={styles.statItem}>
//             <Text style={styles.statValue}>{displayProfile.followers_count ?? 0}</Text>
//             <Text style={styles.statLabel}>Followers</Text>
//           </View>
//         </View>

//         <View style={styles.buttonContainer}>
//           {isOwnProfile ? (
//             <TouchableOpacity style={styles.editProfileButton} onPress={handleEditProfile}>
//               <Edit size={16} color={Colors.dark.text} />
//               <Text style={styles.editProfileText}>Edit Profile</Text>
//             </TouchableOpacity>
//           ) : (
//             <>
//               <TouchableOpacity style={styles.actionButton} onPress={handleFollowToggle}>
//                 {isFollowing(displayProfile.id) ? (
//                   <View style={styles.unfollowButton}>
//                     <Text style={styles.unfollowButtonText}>Unfollow</Text>
//                   </View>
//                 ) : Platform.OS !== "web" ? (
//                   <LinearGradient
//                     colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
//                     start={{ x: 0, y: 0 }}
//                     end={{ x: 1, y: 1 }}
//                     style={[styles.gradientButton, styles.smallButton]}
//                   >
//                     <Text style={styles.actionButtonTextCenter}>Follow</Text>
//                   </LinearGradient>
//                 ) : (
//                   <View style={[styles.gradientButton, styles.smallButton, { backgroundColor: Colors.dark.primary }]}>
//                     <Text style={styles.actionButtonTextCenter}>Follow</Text>
//                   </View>
//                 )}
//               </TouchableOpacity>

//               <TouchableOpacity style={styles.messageButton} onPress={handleMessageUser}>
//                 <Text style={styles.messageButtonText}>Message</Text>
//               </TouchableOpacity>
//             </>
//           )}
//         </View>

//         {isBusiness && (
//           <View style={styles.businessBadge}>
//             <Text style={styles.businessBadgeText}>
//               {displayProfile.business_type || "Business Account"}
//             </Text>
//           </View>
//         )}
//       </View>

//       <View style={styles.tabsContainer}>
//         <TouchableOpacity
//           style={[styles.tab, activeTab === "videos" && styles.activeTab]}
//           onPress={() => setActiveTab("videos")}
//         >
//           <Grid size={24} color={activeTab === "videos" ? Colors.dark.primary : Colors.dark.inactive} />
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={[styles.tab, activeTab === "saved" && styles.activeTab]}
//           onPress={() => setActiveTab("saved")}
//         >
//           <Bookmark size={24} color={activeTab === "saved" ? Colors.dark.primary : Colors.dark.inactive} />
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={[styles.tab, activeTab === "following" && styles.activeTab]}
//           onPress={() => setActiveTab("following")}
//         >
//           <Users size={24} color={activeTab === "following" ? Colors.dark.primary : Colors.dark.inactive} />
//         </TouchableOpacity>

//         {isOwnProfile && (
//           <TouchableOpacity
//             style={[styles.tab, activeTab === "orders" && styles.activeTab]}
//             onPress={() => setActiveTab("orders")}
//           >
//             <FileText size={24} color={activeTab === "orders" ? Colors.dark.primary : Colors.dark.inactive} />
//           </TouchableOpacity>
//         )}
//       </View>

//       {activeTab === "videos" && (
//         <View style={styles.videosGrid}>
//           {userVideos.length > 0 ? (
//             userVideos.map((video) => (
//               <TouchableOpacity
//                 key={video.id}
//                 style={styles.videoThumbnail}
//                 onPress={() =>
//                   router.push({
//                     pathname: "/event/[id]" as any,
//                     params: { id: video.id },
//                   })
//                 }
//               >
//                 <Image source={{ uri: video.thumbnail }} style={styles.thumbnailImage} contentFit="cover" transition={300} />
//                 <View style={styles.videoStats}>
//                   <Text style={styles.videoStatsText}>{video.likes} likes</Text>
//                 </View>
//               </TouchableOpacity>
//             ))
//           ) : (
//             <View style={styles.emptyStateContainer}>
//               <Text style={styles.emptyStateText}>No videos yet</Text>
//               <Text style={styles.emptyStateSubtext}>
//                 {isOwnProfile ? "Your uploaded videos will appear here" : `${fullName} hasn't uploaded any videos yet`}
//               </Text>
//             </View>
//           )}
//         </View>
//       )}

//       {activeTab === "saved" && (
//         <View style={styles.emptyStateContainer}>
//           <Text style={styles.emptyStateText}>No saved videos</Text>
//           <Text style={styles.emptyStateSubtext}>Videos you save will appear here</Text>
//         </View>
//       )}

//       {activeTab === "following" && (
//         <View style={styles.emptyStateContainer}>
//           <Text style={styles.emptyStateText}>Following list</Text>
//           <Text style={styles.emptyStateSubtext}>
//             {isOwnProfile
//               ? "Connect your following list here when ready"
//               : "Following list is not available for other users yet"}
//           </Text>
//         </View>
//       )}

//       {activeTab === "orders" && isOwnProfile && (
//         <View style={styles.emptyStateContainer}>
//           <Text style={styles.emptyStateText}>Orders</Text>
//           <Text style={styles.emptyStateSubtext}>Integrate your orders component here (OrderPDFList)</Text>
//         </View>
//       )}
//     </ScrollView>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: Colors.dark.background },

//   header: { flexDirection: "row", justifyContent: "flex-end", padding: 16, marginTop: 40 },
//   settingsButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },

//   profileSection: { alignItems: "center", paddingHorizontal: 20, marginBottom: 20 },
//   avatarContainer: { position: "relative", marginBottom: 16 },
//   profileImage: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: Colors.dark.primary },

//   businessIndicator: {
//     position: "absolute",
//     bottom: 0,
//     right: 0,
//     backgroundColor: Colors.dark.secondary,
//     paddingHorizontal: 8,
//     paddingVertical: 4,
//     borderRadius: 10,
//   },
//   businessIndicatorText: { color: Colors.dark.text, fontSize: 10, fontWeight: "bold" },

//   displayName: { fontSize: 24, fontWeight: "bold", color: Colors.dark.text, marginBottom: 4 },
//   username: { fontSize: 16, color: Colors.dark.subtext, marginBottom: 8 },
//   location: { fontSize: 14, color: Colors.dark.primary, marginBottom: 16, fontWeight: "500" },
//   bio: { fontSize: 15, color: Colors.dark.text, textAlign: "center", marginBottom: 20, paddingHorizontal: 20, lineHeight: 22 },

//   statsContainer: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     width: "80%",
//     marginBottom: 24,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 16,
//     paddingVertical: 16,
//     paddingHorizontal: 8,
//   },
//   statItem: { alignItems: "center", flex: 1 },
//   statValue: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text, marginBottom: 4 },
//   statLabel: { fontSize: 14, color: Colors.dark.subtext },
//   statDivider: { width: 1, height: "60%", backgroundColor: Colors.dark.divider, alignSelf: "center" },

//   buttonContainer: { flexDirection: "row", marginBottom: 20, flexWrap: "wrap", justifyContent: "center", gap: 12 },

//   editProfileButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//     borderRadius: 12,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   editProfileText: { color: Colors.dark.text, marginLeft: 8, fontWeight: "500" },

//   actionButton: {
//     borderRadius: 12,
//     overflow: "hidden",
//     elevation: 4,
//     shadowColor: Colors.dark.primary,
//     shadowOffset: { width: 0, height: 4 },
//     shadowOpacity: 0.2,
//     shadowRadius: 8,
//   },
//   gradientButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, paddingHorizontal: 24 },
//   smallButton: { paddingVertical: 10, paddingHorizontal: 16 },
//   actionButtonTextCenter: { color: Colors.dark.text, fontWeight: "600", fontSize: 15 },

//   unfollowButton: {
//     alignItems: "center",
//     justifyContent: "center",
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//     borderRadius: 12,
//   },
//   unfollowButtonText: { color: Colors.dark.primary, fontWeight: "600", fontSize: 15 },

//   messageButton: {
//     backgroundColor: Colors.dark.card,
//     paddingVertical: 10,
//     paddingHorizontal: 16,
//     borderRadius: 12,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   messageButtonText: { color: Colors.dark.text, fontWeight: "500", fontSize: 15 },

//   businessBadge: {
//     backgroundColor: "rgba(16, 185, 129, 0.1)",
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     borderRadius: 12,
//     marginBottom: 16,
//     borderWidth: 1,
//     borderColor: "rgba(16, 185, 129, 0.3)",
//   },
//   businessBadgeText: { color: Colors.dark.secondary, fontWeight: "600", fontSize: 13 },

//   tabsContainer: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Colors.dark.divider },
//   tab: { flex: 1, alignItems: "center", paddingVertical: 16 },
//   activeTab: { borderBottomWidth: 2, borderBottomColor: Colors.dark.primary },

//   videosGrid: { flexDirection: "row", flexWrap: "wrap", padding: 2 },
//   videoThumbnail: { width: "33.33%", aspectRatio: 1, padding: 2, position: "relative" },
//   thumbnailImage: { width: "100%", height: "100%", borderRadius: 8 },
//   videoStats: {
//     position: "absolute",
//     bottom: 0,
//     left: 0,
//     right: 0,
//     backgroundColor: "rgba(0, 0, 0, 0.5)",
//     padding: 6,
//     alignItems: "center",
//     borderBottomLeftRadius: 8,
//     borderBottomRightRadius: 8,
//   },
//   videoStatsText: { color: Colors.dark.text, fontSize: 12, fontWeight: "500" },

//   emptyStateContainer: { width: "100%", padding: 40, alignItems: "center" },
//   emptyStateText: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
//   emptyStateSubtext: { fontSize: 15, color: Colors.dark.subtext, textAlign: "center", lineHeight: 22 },

//   loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, marginTop: 100 },
//   loadingText: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text, marginTop: 12 },

//   notAuthenticatedContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, marginTop: 100 },
//   notAuthenticatedTitle: { fontSize: 28, fontWeight: "bold", color: Colors.dark.text, marginBottom: 16 },
//   notAuthenticatedText: { fontSize: 16, color: Colors.dark.subtext, textAlign: "center", marginBottom: 32, lineHeight: 24 },

//   refreshButton: { backgroundColor: Colors.dark.primary, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, marginTop: 16 },
//   refreshButtonText: { color: Colors.dark.text, fontSize: 16, fontWeight: "600" },

//   errorText: { fontSize: 16, color: Colors.dark.text, textAlign: "center", marginTop: 40 },
// });
