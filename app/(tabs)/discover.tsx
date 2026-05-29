import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  MapPin,
  Calendar,
  Star,
  UserPlus,
  UserCheck,
  Users,
  UserCircle,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import { mockVideos } from "@/mocks/videos";
import { useVideoStore } from "@/store/video-store";
import { useAuthStore } from "@/store/auth-store";
import { AttendanceStatus } from "@/types";

const videoMatchesCategory = (video: typeof mockVideos[0], categoryName: string) => {
  const name = categoryName.toLowerCase();
  const eventName = video.eventName.toLowerCase();
  const locationName = video.location.name.toLowerCase();
  const hashtags = video.hashtags?.map(h => h.toLowerCase()) || [];


  if (name === "nightclubs") {
    return eventName.includes("night") || locationName.includes("club") || hashtags.includes("nightlifevibes") || hashtags.includes("technonight");
  }
  if (name === "concerts") {
    return eventName.includes("tour") || locationName.includes("concert") || hashtags.includes("concertlife");
  }
  if (name === "festivals") {
    return eventName.includes("festival") || hashtags.includes("festival");
  }
  if (name === "bars") {
    return locationName.includes("bar") || locationName.includes("lounge") || hashtags.includes("rooftopbar");
  }
  if (name === "rooftops") {
    return locationName.includes("rooftop") || locationName.includes("skybar") || locationName.includes("sky lounge");
  }
  if (name === "live music") {
    return eventName.includes("live") || eventName.includes("jazz") || hashtags.includes("livemusic") || hashtags.includes("livejazz");
  }
  return true;
};

// Categories
const categories = [
  { id: "1", name: "Nightclubs" },
  { id: "2", name: "Concerts" },
  { id: "3", name: "Festivals" },
  { id: "4", name: "Bars" },
  { id: "5", name: "Rooftops" },
  { id: "6", name: "Live Music" },
];

export default function DiscoverScreen() {
  const router = useRouter();
  const { setCurrentVideoIndex, isAttending, attendEvent, cancelAttendance } =
    useVideoStore();
  const {
    isFollowing,
    followUser,
    unfollowUser,
    user: currentUser,
  } = useAuthStore();

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const filteredVideos = useMemo(() => {
    if (!selectedCategoryId) return mockVideos;
    const category = categories.find((c) => c.id === selectedCategoryId);
    if (!category) return mockVideos;
    return mockVideos.filter((video) => videoMatchesCategory(video, category.name));
  }, [selectedCategoryId]);

  // Handle Video Press
  const handleVideoPress = (index: number) => {
    setCurrentVideoIndex(index);
    router.push("/");
  };

  // Handle User Profile Press
  const handleUserPress = (userId: string) => {
    if (userId === currentUser?.id) return; // Don't navigate to own profile
    router.push({
      pathname: "/profile",
      params: { userId },
    });
  };

  // Handle Follow Press
  const handleFollowPress = (userId: string, event: any) => {
    event.stopPropagation(); // Stop event propagation to prevent navigating to the video
    if (isFollowing(userId)) {
      unfollowUser(userId);
    } else {
      followUser(userId);
    }
  };

  // Handle Attend Event Press
  const handleAttendPress = (videoId: string, event: any) => {
    event.stopPropagation(); // Stop event propagation to prevent navigating to the video
    if (!currentUser) {
      router.push("/signin");
      return;
    }

    const status = isAttending(videoId);

    if (status === AttendanceStatus.GOING) {
      cancelAttendance(videoId);
    } else {
      attendEvent(videoId, AttendanceStatus.GOING);
    }
  };

  // Render Category Button
  const renderCategory = ({ item }: { item: (typeof categories)[0] }) => {
    const isSelected = item.id === selectedCategoryId;
    return (
      <TouchableOpacity
        style={[styles.categoryButton, isSelected && styles.selectedCategoryButton]}
        onPress={() => setSelectedCategoryId(isSelected ? null : item.id)}
      >
        <Text style={[styles.categoryText, isSelected && styles.selectedCategoryText]}>{item.name}</Text>
      </TouchableOpacity>
    );
  };

  // Render Trending Event Card
  const renderTrendingEvent = ({
    item,
    index,
  }: {
    item: (typeof mockVideos)[0];
    index: number;
  }) => {
    const isFollowingUser = isFollowing(item.userId);
    const isOwnVideo = currentUser?.id === item.userId;
    const isAttendingEvent = isAttending(item.id) === AttendanceStatus.GOING;

    return (
      <TouchableOpacity
        style={styles.eventCard}
        onPress={() => handleVideoPress(index)}
      >
        <Image
          source={{ uri: item.thumbnail }}
          style={styles.eventImage}
          contentFit="cover"
          transition={300}
        />
        <View style={styles.eventOverlay}>
          <Text style={styles.eventName}>{item.eventName}</Text>
          <View style={styles.eventDetails}>
            <View style={styles.eventDetail}>
              <MapPin size={14} color={Colors.dark.primary} />
              <Text style={styles.eventDetailText}>{item.location.name}</Text>
            </View>
            <View style={styles.eventDetail}>
              <Star size={14} color={Colors.dark.primary} />
              <Text style={styles.eventDetailText}>
                {item.rating} ({item.ratingCount})
              </Text>
            </View>
            {item.attendeeCount !== undefined && item.attendeeCount > 0 && (
              <View style={styles.eventDetail}>
                <Users size={14} color={Colors.dark.primary} />
                <Text style={styles.eventDetailText}>
                  {item.attendeeCount} going
                </Text>
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.userInfoButton}
          onPress={() => handleUserPress(item.userId)}
        >
          <Image
            source={{ uri: item.user.avatar }}
            style={styles.userAvatar}
            contentFit="cover"
            transition={300}
          />
          <Text style={styles.userName}>@{item.user.username}</Text>
        </TouchableOpacity>

        {!isOwnVideo && (
          <TouchableOpacity
            style={[
              styles.followButton,
              isFollowingUser ? styles.followingButton : null,
            ]}
            onPress={(e) => handleFollowPress(item.userId, e)}
          >
            {isFollowingUser ? (
              <UserCheck size={16} color={Colors.dark.primary} />
            ) : (
              <UserPlus size={16} color={Colors.dark.text} />
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            styles.attendButton,
            isAttendingEvent ? styles.attendingButton : null,
          ]}
          onPress={(e) => handleAttendPress(item.id, e)}
        >
          {isAttendingEvent ? (
            <UserCheck size={16} color={Colors.dark.primary} />
          ) : (
            <UserCircle size={16} color={Colors.dark.text} />
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      <Text style={styles.sectionTitle}>Categories</Text>
      <FlatList
        data={categories}
        renderItem={renderCategory}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoriesContainer}
      />

      <Text style={styles.sectionTitle}>Trending Events</Text>
      <View style={styles.eventsGrid}>
        {filteredVideos.length > 0 ? (
          filteredVideos.map((video, index) => {
            const isFollowingUser = isFollowing(video.userId);
            const isOwnVideo = currentUser?.id === video.userId;
            const isAttendingEvent =
              isAttending(video.id) === AttendanceStatus.GOING;

            return (
              <TouchableOpacity
                key={video.id}
                style={styles.eventCard}
                onPress={() => handleVideoPress(index)}
              >
                <Image
                  source={{ uri: video.thumbnail }}
                  style={styles.eventImage}
                  contentFit="cover"
                  transition={300}
                />
                <View style={styles.eventOverlay}>
                  <Text style={styles.eventName}>{video.eventName}</Text>
                  <View style={styles.eventDetails}>
                    <View style={styles.eventDetail}>
                      <MapPin size={14} color={Colors.dark.primary} />
                      <Text style={styles.eventDetailText}>
                        {video.location.name}
                      </Text>
                    </View>
                    <View style={styles.eventDetail}>
                      <Star size={14} color={Colors.dark.primary} />
                      <Text style={styles.eventDetailText}>
                        {video.rating} ({video.ratingCount})
                      </Text>
                    </View>
                    {video.attendeeCount !== undefined &&
                      video.attendeeCount > 0 && (
                        <View style={styles.eventDetail}>
                          <Users size={14} color={Colors.dark.primary} />
                          <Text style={styles.eventDetailText}>
                            {video.attendeeCount} going
                          </Text>
                        </View>
                      )}
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.userInfoButton}
                  onPress={() => handleUserPress(video.userId)}
                >
                  <Image
                    source={{ uri: video.user.avatar }}
                    style={styles.userAvatar}
                    contentFit="cover"
                    transition={300}
                  />
                  <Text style={styles.userName}>@{video.user.username}</Text>
                </TouchableOpacity>

                {!isOwnVideo && (
                  <TouchableOpacity
                    style={[
                      styles.followButton,
                      isFollowingUser ? styles.followingButton : null,
                    ]}
                    onPress={(e) => handleFollowPress(video.userId, e)}
                  >
                    {isFollowingUser ? (
                      <UserCheck size={16} color={Colors.dark.primary} />
                    ) : (
                      <UserPlus size={16} color={Colors.dark.text} />
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.attendButton,
                    isAttendingEvent ? styles.attendingButton : null,
                  ]}
                  onPress={(e) => handleAttendPress(video.id, e)}
                >
                  {isAttendingEvent ? (
                    <UserCheck size={16} color={Colors.dark.primary} />
                  ) : (
                    <UserCircle size={16} color={Colors.dark.text} />
                  )}
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        ) : (
          <Text style={styles.noEventsText}>No events found</Text>
        )}
      </View>

      <FlatList
        data={mockVideos}
        renderItem={renderTrendingEvent}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.venuesContainer}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  contentContainer: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 12,
    marginTop: 40,
  },
  categoriesContainer: {
    paddingVertical: 8,
  },
  categoryButton: {
    backgroundColor: Colors.dark.card,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  categoryText: {
    color: Colors.dark.text,
    fontWeight: "500",
  },
  selectedCategoryButton: {
    backgroundColor: Colors.dark.primary,
    borderColor: Colors.dark.primary,
  },
  selectedCategoryText: {
    color: Colors.dark.background,
    fontWeight: "600",
  },
  eventsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  eventCard: {
    width: "48%",
    height: 180,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 16,
    position: "relative",
  },
  eventImage: {
    width: "100%",
    height: "100%",
  },
  eventOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  eventName: {
    color: Colors.dark.text,
    fontWeight: "bold",
    fontSize: 14,
    marginBottom: 4,
  },
  eventDetails: {
    flexDirection: "column",
  },
  eventDetail: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  eventDetailText: {
    color: Colors.dark.text,
    fontSize: 12,
    marginLeft: 4,
  },
  venuesContainer: {
    paddingVertical: 8,
  },
  userInfoButton: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 16,
  },
  userAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 6,
  },
  userName: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: "500",
  },
  followButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.dark.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  followingButton: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  attendButton: {
    position: "absolute",
    top: 10,
    right: 50,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  attendingButton: {
    backgroundColor: "rgba(138, 43, 226, 0.2)",
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  noEventsText: {
    fontSize: 16,
    color: Colors.dark.text,
    textAlign: "center",
    marginTop: 20,
  },
});

















////////////////////////////////      before    31    jan     2026      ////////////



// import React from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   ScrollView,
//   TouchableOpacity,
//   FlatList,
// } from "react-native";
// import { Image } from "expo-image";
// import { useRouter } from "expo-router";
// import {
//   MapPin,
//   Calendar,
//   Star,
//   UserPlus,
//   UserCheck,
//   Users,
//   UserCircle,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { mockVideos } from "@/mocks/videos";
// import { useVideoStore } from "@/store/video-store";
// import { useAuthStore } from "@/store/auth-store";
// import { AttendanceStatus } from "@/types";

// const categories = [
//   { id: "1", name: "Nightclubs" },
//   { id: "2", name: "Concerts" },
//   { id: "3", name: "Festivals" },
//   { id: "4", name: "Bars" },
//   { id: "5", name: "Rooftops" },
//   { id: "6", name: "Live Music" },
// ];

// export default function DiscoverScreen() {
//   const router = useRouter();
//   const { setCurrentVideoIndex, isAttending, attendEvent, cancelAttendance } =
//     useVideoStore();
//   const {
//     isFollowing,
//     followUser,
//     unfollowUser,
//     user: currentUser,
//   } = useAuthStore();

//   const handleVideoPress = (index: number) => {
//     setCurrentVideoIndex(index);
//     router.push("/");
//   };

//   const handleUserPress = (userId: string) => {
//     if (userId === currentUser?.id) return; // Don't navigate to own profile
//     router.push({
//       pathname: "/profile",
//       params: { userId },
//     });
//   };

//   const handleFollowPress = (userId: string, event: any) => {
//     // Stop event propagation to prevent navigating to the video
//     event.stopPropagation();

//     if (isFollowing(userId)) {
//       unfollowUser(userId);
//     } else {
//       followUser(userId);
//     }
//   };

//   const handleAttendPress = (videoId: string, event: any) => {
//     // Stop event propagation to prevent navigating to the video
//     event.stopPropagation();

//     if (!currentUser) {
//       router.push("/signin");
//       return;
//     }

//     const status = isAttending(videoId);

//     if (status === AttendanceStatus.GOING) {
//       cancelAttendance(videoId);
//     } else {
//       attendEvent(videoId, AttendanceStatus.GOING);
//     }
//   };

//   const renderCategory = ({ item }: { item: (typeof categories)[0] }) => (
//     <TouchableOpacity style={styles.categoryButton}>
//       <Text style={styles.categoryText}>{item.name}</Text>
//     </TouchableOpacity>
//   );

//   const renderTrendingEvent = ({
//     item,
//     index,
//   }: {
//     item: (typeof mockVideos)[0];
//     index: number;
//   }) => {
//     const isFollowingUser = isFollowing(item.userId);
//     const isOwnVideo = currentUser?.id === item.userId;
//     const isAttendingEvent = isAttending(item.id) === AttendanceStatus.GOING;

//     return (
//       <TouchableOpacity
//         style={styles.eventCard}
//         onPress={() => handleVideoPress(index)}
//       >
//         <Image
//           source={{ uri: item.thumbnail }}
//           style={styles.eventImage}
//           contentFit="cover"
//           transition={300}
//         />
//         <View style={styles.eventOverlay}>
//           <Text style={styles.eventName}>{item.eventName}</Text>
//           <View style={styles.eventDetails}>
//             <View style={styles.eventDetail}>
//               <MapPin size={14} color={Colors.dark.primary} />
//               <Text style={styles.eventDetailText}>{item.location.name}</Text>
//             </View>
//             <View style={styles.eventDetail}>
//               <Star size={14} color={Colors.dark.primary} />
//               <Text style={styles.eventDetailText}>
//                 {item.rating} ({item.ratingCount})
//               </Text>
//             </View>
//             {item.attendeeCount !== undefined && item.attendeeCount > 0 && (
//               <View style={styles.eventDetail}>
//                 <Users size={14} color={Colors.dark.primary} />
//                 <Text style={styles.eventDetailText}>
//                   {item.attendeeCount} going
//                 </Text>
//               </View>
//             )}
//           </View>
//         </View>

//         <TouchableOpacity
//           style={styles.userInfoButton}
//           onPress={() => handleUserPress(item.userId)}
//         >
//           <Image
//             source={{ uri: item.user.avatar }}
//             style={styles.userAvatar}
//             contentFit="cover"
//             transition={300}
//           />
//           <Text style={styles.userName}>@{item.user.username}</Text>
//         </TouchableOpacity>

//         {!isOwnVideo && (
//           <TouchableOpacity
//             style={[
//               styles.followButton,
//               isFollowingUser ? styles.followingButton : null,
//             ]}
//             onPress={(e) => handleFollowPress(item.userId, e)}
//           >
//             {isFollowingUser ? (
//               <UserCheck size={16} color={Colors.dark.primary} />
//             ) : (
//               <UserPlus size={16} color={Colors.dark.text} />
//             )}
//           </TouchableOpacity>
//         )}

//         <TouchableOpacity
//           style={[
//             styles.attendButton,
//             isAttendingEvent ? styles.attendingButton : null,
//           ]}
//           onPress={(e) => handleAttendPress(item.id, e)}
//         >
//           {isAttendingEvent ? (
//             <UserCheck size={16} color={Colors.dark.primary} />
//           ) : (
//             <UserCircle size={16} color={Colors.dark.text} />
//           )}
//         </TouchableOpacity>
//       </TouchableOpacity>
//     );
//   };

//   return (
//     <ScrollView
//       style={styles.container}
//       contentContainerStyle={styles.contentContainer}
//     >
//       <Text style={styles.sectionTitle}>Categories</Text>
//       <FlatList
//         data={categories}
//         renderItem={renderCategory}
//         keyExtractor={(item) => item.id}
//         horizontal
//         showsHorizontalScrollIndicator={false}
//         contentContainerStyle={styles.categoriesContainer}
//       />

//       <Text style={styles.sectionTitle}>Trending Events</Text>
//       <View style={styles.eventsGrid}>
//         {mockVideos.map((video, index) => {
//           const isFollowingUser = isFollowing(video.userId);
//           const isOwnVideo = currentUser?.id === video.userId;
//           const isAttendingEvent =
//             isAttending(video.id) === AttendanceStatus.GOING;

//           return (
//             <TouchableOpacity
//               key={video.id}
//               style={styles.eventCard}
//               onPress={() => handleVideoPress(index)}
//             >
//               <Image
//                 source={{ uri: video.thumbnail }}
//                 style={styles.eventImage}
//                 contentFit="cover"
//                 transition={300}
//               />
//               <View style={styles.eventOverlay}>
//                 <Text style={styles.eventName}>{video.eventName}</Text>
//                 <View style={styles.eventDetails}>
//                   <View style={styles.eventDetail}>
//                     <MapPin size={14} color={Colors.dark.primary} />
//                     <Text style={styles.eventDetailText}>
//                       {video.location.name}
//                     </Text>
//                   </View>
//                   <View style={styles.eventDetail}>
//                     <Star size={14} color={Colors.dark.primary} />
//                     <Text style={styles.eventDetailText}>
//                       {video.rating} ({video.ratingCount})
//                     </Text>
//                   </View>
//                   {video.attendeeCount !== undefined &&
//                     video.attendeeCount > 0 && (
//                       <View style={styles.eventDetail}>
//                         <Users size={14} color={Colors.dark.primary} />
//                         <Text style={styles.eventDetailText}>
//                           {video.attendeeCount} going
//                         </Text>
//                       </View>
//                     )}
//                 </View>
//               </View>

//               <TouchableOpacity
//                 style={styles.userInfoButton}
//                 onPress={() => handleUserPress(video.userId)}
//               >
//                 <Image
//                   source={{ uri: video.user.avatar }}
//                   style={styles.userAvatar}
//                   contentFit="cover"
//                   transition={300}
//                 />
//                 <Text style={styles.userName}>@{video.user.username}</Text>
//               </TouchableOpacity>

//               {!isOwnVideo && (
//                 <TouchableOpacity
//                   style={[
//                     styles.followButton,
//                     isFollowingUser ? styles.followingButton : null,
//                   ]}
//                   onPress={(e) => handleFollowPress(video.userId, e)}
//                 >
//                   {isFollowingUser ? (
//                     <UserCheck size={16} color={Colors.dark.primary} />
//                   ) : (
//                     <UserPlus size={16} color={Colors.dark.text} />
//                   )}
//                 </TouchableOpacity>
//               )}

//               <TouchableOpacity
//                 style={[
//                   styles.attendButton,
//                   isAttendingEvent ? styles.attendingButton : null,
//                 ]}
//                 onPress={(e) => handleAttendPress(video.id, e)}
//               >
//                 {isAttendingEvent ? (
//                   <UserCheck size={16} color={Colors.dark.primary} />
//                 ) : (
//                   <UserCircle size={16} color={Colors.dark.text} />
//                 )}
//               </TouchableOpacity>
//             </TouchableOpacity>
//           );
//         })}
//       </View>

//       {/* {mockVideos?.length > 0 && (
//         <Text style={styles.sectionTitle}>Popular Venues</Text>
//       )} */}
//       <FlatList
//         data={mockVideos}
//         renderItem={renderTrendingEvent}
//         keyExtractor={(item) => item.id}
//         horizontal
//         showsHorizontalScrollIndicator={false}
//         contentContainerStyle={styles.venuesContainer}
//       />
//     </ScrollView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   contentContainer: {
//     padding: 16,
//   },
//   sectionTitle: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 12,
//     marginTop: 40,
//   },
//   categoriesContainer: {
//     paddingVertical: 8,
//   },
//   categoryButton: {
//     backgroundColor: Colors.dark.card,
//     paddingHorizontal: 16,
//     paddingVertical: 8,
//     borderRadius: 20,
//     marginRight: 10,
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   categoryText: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//   },
//   eventsGrid: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "space-between",
//     marginBottom: 16,
//   },
//   eventCard: {
//     width: "48%",
//     height: 180,
//     borderRadius: 12,
//     overflow: "hidden",
//     marginBottom: 16,
//     position: "relative",
//   },
//   eventImage: {
//     width: "100%",
//     height: "100%",
//   },
//   eventOverlay: {
//     position: "absolute",
//     bottom: 0,
//     left: 0,
//     right: 0,
//     padding: 10,
//     backgroundColor: "rgba(0, 0, 0, 0.6)",
//   },
//   eventName: {
//     color: Colors.dark.text,
//     fontWeight: "bold",
//     fontSize: 14,
//     marginBottom: 4,
//   },
//   eventDetails: {
//     flexDirection: "column",
//   },
//   eventDetail: {
//     flexDirection: "row",
//     alignItems: "center",
//     marginTop: 2,
//   },
//   eventDetailText: {
//     color: Colors.dark.text,
//     fontSize: 12,
//     marginLeft: 4,
//   },
//   venuesContainer: {
//     paddingVertical: 8,
//   },
//   userInfoButton: {
//     position: "absolute",
//     top: 10,
//     left: 10,
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: "rgba(0, 0, 0, 0.6)",
//     paddingVertical: 4,
//     paddingHorizontal: 8,
//     borderRadius: 16,
//   },
//   userAvatar: {
//     width: 24,
//     height: 24,
//     borderRadius: 12,
//     marginRight: 6,
//   },
//   userName: {
//     color: Colors.dark.text,
//     fontSize: 12,
//     fontWeight: "500",
//   },
//   followButton: {
//     position: "absolute",
//     top: 10,
//     right: 10,
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     backgroundColor: Colors.dark.primary,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   followingButton: {
//     backgroundColor: "rgba(0, 0, 0, 0.6)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   attendButton: {
//     position: "absolute",
//     top: 10,
//     right: 50,
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     backgroundColor: "rgba(0, 0, 0, 0.6)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   attendingButton: {
//     backgroundColor: "rgba(138, 43, 226, 0.2)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
// });
