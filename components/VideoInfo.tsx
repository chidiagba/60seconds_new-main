import { venueCoordinates } from '@/utils/venue-location';
import AvatarImage from '@/components/AvatarImage';
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Linking,
} from "react-native";
import { Image } from "expo-image";
import {
  MapPin,
  Calendar,
  UserPlus,
  UserCheck,
  Users,
  UserCircle,
  Ticket,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import { Video, TaggedUser, AttendanceStatus } from "@/types";
import { useRouter } from "expo-router";
import {
  formatDistance,
  calculateDistance,
  calculateRoadDistance,
  getCurrentLocation,
  getCachedLocation,
  getCoordinatesFromAddress,
  subscribeToLocationUpdates,
} from "@/utils/location";
import { useAuthStore } from "@/store/auth-store";
import { useVideoStore } from "@/store/video-store";
import UserTagItem from "./UserTagItem";
import { LinearGradient } from "expo-linear-gradient";
import ProductsModal from "./ProductsModal";
import { formatRelativeUploadTime } from "@/utils/time";

interface VideoInfoProps {
  video: Video;
}

interface ResolvedTargetCoords {
  latitude: number;
  longitude: number;
}

const resolvedTargetCoordsCache = new Map<string, ResolvedTargetCoords | null>();

const parseCoordinate = (
  value: unknown,
  coordinateType: "latitude" | "longitude"
): number | null => {
  const rawValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").trim());

  if (!Number.isFinite(rawValue)) {
    return null;
  }

  const min = coordinateType === "latitude" ? -90 : -180;
  const max = coordinateType === "latitude" ? 90 : 180;

  if (rawValue < min || rawValue > max) {
    return null;
  }

  return rawValue;
};

const isFallbackZeroCoordinatePair = (
  latitude: number | null,
  longitude: number | null
): boolean => {
  if (latitude == null || longitude == null) {
    return false;
  }

  // Some backend mappings default missing coords to (0,0); treat this as unknown.
  return Math.abs(latitude) < 0.000001 && Math.abs(longitude) < 0.000001;
};

export default function VideoInfo({ video }: VideoInfoProps) {
  const router = useRouter();
  const {
    isFollowing,
    followUser,
    unfollowUser,
    user: currentUser,
  } = useAuthStore();
  const { isAttending, attendEvent, cancelAttendance } = useVideoStore();
  const [isFollowingState, setIsFollowingState] = React.useState(
    isFollowing(video.userId)
  );
  const [showAllTags, setShowAllTags] = React.useState(false);
  const [showDetails, setShowDetails] = React.useState(false);
  React.useEffect(() => {
    setShowDetails(false);
    setShowAllTags(false);
  }, [video.id]);
  const [attendanceStatus, setAttendanceStatus] =
    React.useState<AttendanceStatus | null>(isAttending(video.id));
  const [showTicketsModal, setShowTicketsModal] = React.useState(false);
  const uploadedTimeLabel = formatRelativeUploadTime(
    (video as any).createdAt || (video as any).created_at
  );

  const videoLatitude = video.location?.latitude;
  const videoLongitude = video.location?.longitude;
  const videoLocationName = video.location?.name ?? "";
  const videoLocationCity = video.location?.city ?? "";
  const videoLocationCountry = video.location?.country ?? "";
  const distanceLookupKey = `${video.id}|${videoLatitude}|${videoLongitude}|${videoLocationName}|${videoLocationCity}|${videoLocationCountry}`;
  const [userDistance, setUserDistance] = React.useState<string | null>(
    null
  );
  const [isDistanceLoading, setIsDistanceLoading] = React.useState(
    Platform.OS !== "web"
  );

  const computeDistanceFromLocation = React.useCallback(
    async (
      location: { coords: { latitude: number; longitude: number } },
      target: ResolvedTargetCoords
    ): Promise<string | null> => {
      const userLat = parseCoordinate(location.coords.latitude, "latitude");
      const userLon = parseCoordinate(location.coords.longitude, "longitude");

      if (userLat == null || userLon == null) {
        return null;
      }

      const distance = await calculateRoadDistance(
        userLat,
        userLon,
        target.latitude,
        target.longitude
      );
      const formatted = formatDistance(distance);
      return formatted && !/nan/i.test(formatted) ? formatted : null;
    },
    []
  );

  React.useEffect(() => {
    setUserDistance(null);
    setIsDistanceLoading(Platform.OS !== "web");
  }, [distanceLookupKey]);

  React.useEffect(() => {
    let isCancelled = false;
    let unsubscribe: (() => void) | null = null;

    if (Platform.OS === "web") {

      setUserDistance(null);
      setIsDistanceLoading(false);
      return;
    }

    let distanceRequest = 0;
    const applyDistance = async (
      location: { coords: { latitude: number; longitude: number } },
      target: ResolvedTargetCoords
    ) => {
      const requestId = ++distanceRequest;
      const formattedDistance = await computeDistanceFromLocation(location, target);
      if (isCancelled || requestId !== distanceRequest) return;

      if (!isCancelled) {
        setUserDistance(formattedDistance);
        setIsDistanceLoading(false);
      }
    };

    (async () => {
      try {
        // Resolve target coordinates once per video/location identity.
        let targetCoords = resolvedTargetCoordsCache.get(distanceLookupKey);

        if (targetCoords === undefined) {
          targetCoords = venueCoordinates({ latitude: videoLatitude, longitude: videoLongitude });
          resolvedTargetCoordsCache.set(distanceLookupKey, targetCoords);
        }

        if (isCancelled) {
          return;
        }

        if (!targetCoords) {

          if (!isCancelled) {
            setUserDistance(null);
            setIsDistanceLoading(false);
          }
          return;
        }

        // Use cached device location first for instant UI update.
        const cachedLocation = getCachedLocation();
        if (cachedLocation) {
          applyDistance(cachedLocation, targetCoords);
        }

        // One-shot location read for initial exact value.
        const location = await getCurrentLocation({
          requestPermission: true,
          maxCacheAgeMs: 15000,
        });

        if (isCancelled) {
          return;
        }

        if (location) {
          applyDistance(location, targetCoords);
        } else if (!cachedLocation) {

          setUserDistance(null);
          setIsDistanceLoading(false);
        }

        // Keep distance live as the user moves (single shared watcher in utils/location).
        unsubscribe = subscribeToLocationUpdates(
          (updatedLocation) => {
            if (isCancelled) return;
            applyDistance(updatedLocation, targetCoords);
          },
          {
            requestPermission: true,
            minUpdateDistanceMeters: 100,
            minUpdateIntervalMs: 15000,
          }
        );
      } catch {

        if (!isCancelled) {
          setUserDistance(null);
          setIsDistanceLoading(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [
    computeDistanceFromLocation,
    distanceLookupKey,
    videoLatitude,
    videoLongitude,
    videoLocationName,
    videoLocationCity,
    videoLocationCountry,
  ]);

  React.useEffect(() => {
    setIsFollowingState(isFollowing(video.userId));
  }, [isFollowing, video.userId]);

  React.useEffect(() => {
    setAttendanceStatus(isAttending(video.id));
  }, [isAttending, video.id, video.attendees]);

  const handleLocationPress = () => {
    const name = video.location?.name || video.eventName || "Event";
    let parsedLat = parseCoordinate(video.location?.latitude, "latitude");
    let parsedLng = parseCoordinate(video.location?.longitude, "longitude");

    if (isFallbackZeroCoordinatePair(parsedLat, parsedLng)) {
      parsedLat = null;
      parsedLng = null;
    }

    if (parsedLat !== null && parsedLng !== null) {
      // Precise pin using coordinates
      const label = encodeURIComponent(name);
      const latLng = `${parsedLat},${parsedLng}`;
      const url =
        Platform.OS === "ios"
          ? `maps://?q=${label}&ll=${latLng}`
          : `geo:${latLng}?q=${latLng}(${label})`;
      Linking.openURL(url).catch(() =>
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latLng}`)
      );
    } else if (name) {
      // Fallback: text search by location name
      const query = encodeURIComponent(name);
      const url =
        Platform.OS === "ios"
          ? `maps://?q=${query}`
          : `geo:0,0?q=${query}`;
      Linking.openURL(url).catch(() =>
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`)
      );
    }
  };

  const handleProfilePress = () => {
    if (!video.userId) {
      router.push('/profile');
      return;
    }

    if (currentUser?.id === video.userId) {
      router.push('/profile');
      return;
    }

    router.push({
      pathname: '/ProfileUserScreen' as any,
      params: { userId: video.userId },
    });
  };



  const handleEventPress = () => {
    router.push({
      pathname: "/event/[id]",
      params: { id: video.id, eventName: video.eventName },
    });
  };

  const handleFollowPress = () => {
    if (isFollowingState) {
      unfollowUser(video.userId);
      setIsFollowingState(false);
    } else {
      followUser(video.userId);
      setIsFollowingState(true);
    }
  };

  const handleTaggedUserPress = (userId: string) => {
    router.push({
      pathname: "/profile",
      params: { userId },
    });
  };

  const toggleShowAllTags = () => {
    setShowAllTags(!showAllTags);
  };

  const handleAttendancePress = () => {
    if (!currentUser) {
      router.push("/signin");
      return;
    }

    if (attendanceStatus === AttendanceStatus.GOING) {
      cancelAttendance(video.id);
      setAttendanceStatus(null);
    } else {
      attendEvent(video.id, AttendanceStatus.GOING);
      setAttendanceStatus(AttendanceStatus.GOING);
    }
  };

  // Don't show follow button if it's the current user's video
  const isOwnVideo = currentUser?.id === video.userId;

  // Limit the number of tags shown initially
  const hasTaggedUsers = video.taggedUsers && video.taggedUsers.length > 0;
  const maxTagsToShow = 2;
  const visibleTags =
    showAllTags || !hasTaggedUsers
      ? video.taggedUsers || []
      : video.taggedUsers?.slice(0, maxTagsToShow) || [];
  const hiddenTagsCount = hasTaggedUsers
    ? video.taggedUsers!.length - maxTagsToShow
    : 0;

  return (
    <View style={styles.container}>
      <View style={styles.userContainer}>
        <TouchableOpacity onPress={handleProfilePress} style={styles.userInfo}>
          <View style={styles.avatarContainer}>
            <AvatarImage
              uri={video.user.avatar}
              userId={video.userId}
              style={styles.avatar}
              contentFit="cover"
              transition={300}
            />
            {video.user.isBusinessAccount && (
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedBadgeText}>PRO</Text>
              </View>
            )}
          </View>
          <View style={styles.userTextContainer}>
            <Text style={styles.username}>@{video.user.username}</Text>
            {uploadedTimeLabel ? (
              <Text style={styles.uploadedTimeText}>Uploaded {uploadedTimeLabel}</Text>
            ) : null}
          </View>
        </TouchableOpacity>

        {!isOwnVideo && (
          <TouchableOpacity
            style={styles.followButtonContainer}
            onPress={handleFollowPress}
          >
            {isFollowingState ? (
              <View style={styles.followingButton}>
                <UserCheck size={16} color={Colors.dark.primary} />
              </View>
            ) : Platform.OS !== "web" ? (
              <LinearGradient
                colors={Colors.dark.gradients.primary as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.followButton}
              >
                <UserPlus size={16} color={Colors.dark.text} />
              </LinearGradient>
            ) : (
              <View
                style={[
                  styles.followButton,
                  { backgroundColor: Colors.dark.primary },
                ]}
              >
                <UserPlus size={16} color={Colors.dark.text} />
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={styles.detailsToggle}
        onPress={() => setShowDetails((visible) => !visible)}
        accessibilityRole="button"
        accessibilityLabel={showDetails ? "Hide video details" : "Show video details"}
        accessibilityState={{ expanded: showDetails }}
      >
        <Text style={styles.detailsToggleText}>
          {showDetails ? "Hide details" : "Show details"}
        </Text>
      </TouchableOpacity>

      {showDetails && (
        <ScrollView style={styles.detailsPanel} nestedScrollEnabled>
          {video.caption && <Text style={styles.caption}>{video.caption}</Text>}

          {/* Tagged Users Section */}
          {hasTaggedUsers && (
            <View style={styles.taggedUsersContainer}>
              <View style={styles.taggedUsersHeader}>
                <Users size={14} color={Colors.dark.primary} />
                <Text style={styles.taggedUsersTitle}>Tagged:</Text>
              </View>

              <View style={styles.tagsList}>
                {visibleTags.map((taggedUser: TaggedUser) => (
                  <UserTagItem
                    key={taggedUser.userId}
                    user={taggedUser.user}
                    onPress={() => handleTaggedUserPress(taggedUser.userId)}
                    showRemoveButton={false}
                  />
                ))}

                {hiddenTagsCount > 0 && !showAllTags && (
                  <TouchableOpacity
                    style={styles.moreTagsButton}
                    onPress={toggleShowAllTags}
                  >
                    <Text style={styles.moreTagsText}>+{hiddenTagsCount} more</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* Hashtags section - commented out for now
          {video.hashtags && video.hashtags.length > 0 && (
            <View style={styles.hashtagsContainer}>
              {video.hashtags.map((tag, index) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => handleHashtagPress(tag)}
                  style={styles.hashtagButton}
                >
                  <Hash size={14} color={Colors.dark.primary} />
                  <Text style={styles.hashtagText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          */}

          <View style={styles.eventContainer}>
            <TouchableOpacity onPress={handleEventPress} style={styles.eventInfo}>
              <View style={styles.iconContainer}>
                <Calendar size={16} color={Colors.dark.primary} />
              </View>
              <Text style={styles.eventName}>{video.eventName}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleLocationPress}
              style={styles.locationInfo}
            >
              <View style={styles.iconContainer}>
                <MapPin size={16} color={Colors.dark.primary} />
              </View>
              <View style={styles.locationTextContainer}>
                <Text style={styles.locationName}>{video.location.name}</Text>
                <View style={styles.distanceRow}>
                  <Text
                    style={[styles.distanceText, !userDistance && styles.distanceTextMuted]}
                    numberOfLines={1}
                  >
                    {isDistanceLoading
                      ? "Calculating distance..."
                      : userDistance
                        ? `${userDistance} driving`
                        : "Distance unavailable"}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

          </View>
        </ScrollView>
      )}

      <View style={styles.eventContainer}>
        {/* Attendance Button */}
        <TouchableOpacity
          style={styles.attendButtonContainer}
          onPress={handleAttendancePress}
        >
          {attendanceStatus === AttendanceStatus.GOING ? (
            <View style={styles.attendingButton}>
              <UserCircle size={16} color={Colors.dark.primary} />
              <Text style={styles.attendingButtonText}>Going</Text>
              {video.attendeeCount !== undefined && video.attendeeCount > 0 && (
                <View style={styles.attendeeCountBadge}>
                  <Text style={styles.attendeeCountText}>
                    {video.attendeeCount}
                  </Text>
                </View>
              )}
            </View>
          ) : Platform.OS !== "web" ? (
            <LinearGradient
              colors={["rgba(99, 102, 241, 0.2)", "rgba(99, 102, 241, 0.3)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.attendButton}
            >
              <UserCircle size={16} color={Colors.dark.text} />
              <Text style={styles.attendButtonText}>Attend</Text>
              {video.attendeeCount !== undefined && video.attendeeCount > 0 && (
                <View style={styles.attendeeCountBadge}>
                  <Text style={styles.attendeeCountText}>
                    {video.attendeeCount}
                  </Text>
                </View>
              )}
            </LinearGradient>
          ) : (
            <View
              style={[
                styles.attendButton,
                { backgroundColor: "rgba(99, 102, 241, 0.2)" },
              ]}
            >
              <UserCircle size={16} color={Colors.dark.text} />
              <Text style={styles.attendButtonText}>Attend</Text>
              {video.attendeeCount !== undefined && video.attendeeCount > 0 && (
                <View style={styles.attendeeCountBadge}>
                  <Text style={styles.attendeeCountText}>
                    {video.attendeeCount}
                  </Text>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>

        {/* Tickets Button */}
        {video.products && video.products.length > 0 && (
          <TouchableOpacity
            style={styles.ticketButtonContainer}
            onPress={() => setShowTicketsModal(true)}
          >
            {Platform.OS !== "web" ? (
              <LinearGradient
                colors={["rgba(255, 165, 0, 0.25)", "rgba(255, 140, 0, 0.35)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.ticketButton}
              >
                <Ticket size={16} color="#FFA500" />
                <Text style={styles.ticketButtonText}>Tickets</Text>
              </LinearGradient>
            ) : (
              <View style={[styles.ticketButton, { backgroundColor: "rgba(255,165,0,0.25)" }]}>
                <Ticket size={16} color="#FFA500" />
                <Text style={styles.ticketButtonText}>Tickets</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>

      <ProductsModal
        visible={showTicketsModal}
        onClose={() => setShowTicketsModal(false)}
        videoId={video.id}
        products={video.products}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 70,
    left: 16,
    right: 80,
    padding: 10,
    zIndex: 10,
  },
  userContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  avatarContainer: {
    position: "relative",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: Colors.dark.primary,
  },
  verifiedBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    backgroundColor: Colors.dark.secondary,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  verifiedBadgeText: {
    color: Colors.dark.text,
    fontSize: 8,
    fontWeight: "bold",
  },
  username: {
    color: Colors.dark.text,
    fontWeight: "bold",
    fontSize: 16,
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  userTextContainer: {
    marginLeft: 10,
  },
  uploadedTimeText: {
    color: Colors.dark.subtext,
    fontSize: 12,
    marginTop: 2,
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  followButtonContainer: {
    borderRadius: 20,
    overflow: "hidden",
  },
  followButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  followingButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  caption: {
    color: Colors.dark.text,
    marginBottom: 12,
    fontSize: 15,
    lineHeight: 22,
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  detailsToggle: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    marginBottom: 8,
  },
  detailsToggleText: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: "600",
  },
  detailsPanel: {
    maxHeight: 220,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  taggedUsersContainer: {
    marginBottom: 12,
  },
  taggedUsersHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  taggedUsersTitle: {
    color: Colors.dark.primary,
    marginLeft: 4,
    fontSize: 14,
    fontWeight: "500",
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  tagsList: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  moreTagsButton: {
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  moreTagsText: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: "500",
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  hashtagsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  hashtagButton: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 10,
    marginBottom: 6,
  },
  hashtagText: {
    color: Colors.dark.primary,
    marginLeft: 2,
    fontSize: 14,
    fontWeight: "500",
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  eventContainer: {
    marginTop: 5,
  },
  eventInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  eventName: {
    flex: 1,
    color: Colors.dark.text,
    fontWeight: "600",
    fontSize: 15,
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  locationInfo: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  locationTextContainer: {
    flex: 1,
  },
  distanceRow: {
    minHeight: 18,
    justifyContent: "center",
  },
  locationName: {
    color: Colors.dark.text,
    fontSize: 15,
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  distanceText: {
    color: Colors.dark.primary,
    fontSize: 13,
    marginTop: 2,
    lineHeight: 16,
    fontWeight: "500",
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  distanceTextMuted: {
    color: Colors.dark.subtext,
  },
  attendButtonContainer: {
    borderRadius: 16,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  attendButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  attendButtonText: {
    color: Colors.dark.text,
    marginLeft: 6,
    fontSize: 14,
    fontWeight: "500",
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  attendingButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  attendingButtonText: {
    color: Colors.dark.primary,
    marginLeft: 6,
    fontSize: 14,
    fontWeight: "600",
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  attendeeCountBadge: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 6,
  },
  attendeeCountText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: "bold",
  },
  ticketButtonContainer: {
    borderRadius: 16,
    overflow: "hidden",
    alignSelf: "flex-start",
    marginTop: 8,
  },
  ticketButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,165,0,0.4)",
  },
  ticketButtonText: {
    color: "#FFA500",
    marginLeft: 6,
    fontSize: 14,
    fontWeight: "600",
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
});
