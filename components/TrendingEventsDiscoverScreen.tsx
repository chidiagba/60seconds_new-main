import AvatarImage from '@/components/AvatarImage';
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  GestureResponderEvent,
  ViewToken,
} from "react-native";
import { Image } from "expo-image";
import { Video as ExpoVideo, ResizeMode } from "expo-av";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import {
  MapPin,
  Star,
  UserPlus,
  UserCheck,
  Users,
  UserCircle,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import { isEventClosed } from "@/utils/event-status";
import { useVideoStore } from "@/store/video-store";
import { useAuthStore } from "@/store/auth-store";
import { AttendanceStatus } from "@/types";
import { EventListItem, EventQueries } from "@/lib/event-queries";
import { supabase } from "@/lib/supabase";
import { DEFAULT_AVATAR_URL, resolveAvatarUrl } from "@/utils/avatar";

const categories = [
  { id: "deals", name: "Deals" },
  { id: "1", name: "Nightclubs" },
  { id: "2", name: "Concerts" },
  { id: "3", name: "Festivals" },
  { id: "4", name: "Bars" },
  { id: "5", name: "Rooftops" },
  { id: "6", name: "Live Music" },
];

type Props = {
  homePath: "/(tabs)" | "/(tabsbusiness)";
};

const FALLBACK_EVENT_IMAGE =
  "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=600&q=80";

const getStorageUrl = (value?: string | null, bucket = "images") => {
  const trimmedValue = String(value || "").trim();
  if (!trimmedValue) return "";
  if (/^(https?:|file:)/i.test(trimmedValue)) return trimmedValue;
  return supabase.storage.from(bucket).getPublicUrl(trimmedValue).data.publicUrl;
};

const getCreatorId = (event: EventListItem) => event.creator?.id || event.creator_id || event.user_id;

const getCreatorUsername = (event: EventListItem) =>
  event.creator?.username || event.creator?.full_name || "Unknown";

const getCreatorAvatar = (event: EventListItem) =>
  resolveAvatarUrl({
    avatarUrl: event.creator?.avatar_url,
    fallbackUrl: DEFAULT_AVATAR_URL,
  });

const getEventVideoId = (event: EventListItem) => {
  const rawVideoId = event.video_id || event.video?.id;
  return rawVideoId ? String(rawVideoId) : "";
};

const getEventPreviewVideoUrl = (event: EventListItem) => {
  const rawVideoUrl = event.video?.video_url;
  if (!rawVideoUrl) return "";
  return getStorageUrl(rawVideoUrl, "videos");
};

const eventMatchesCategory = (event: EventListItem, categoryName: string) => {
  const name = categoryName.toLowerCase();
  if (name === "deals") return event.has_products && event.product_count > 0 && ["open", "published"].includes(event.status) && !isEventClosed({ status: event.status, startDate: event.start_date, endDate: event.end_date });
  const eventName = String(event.event_name || "").toLowerCase();
  const locationName = String(event.location_name || "").toLowerCase();
  const category = String(event.category || "").toLowerCase();
  const hashtags = (event.hashtags || []).map((hashtag) =>
    String(hashtag).replace(/^#/, "").toLowerCase()
  );

  if (category.includes(name.toLowerCase())) return true;

  if (name === "nightclubs") {
    return (
      eventName.includes("night") ||
      locationName.includes("club") ||
      category.includes("club") ||
      hashtags.includes("nightlifevibes") ||
      hashtags.includes("technonight")
    );
  }
  if (name === "concerts") {
    return eventName.includes("tour") || category.includes("concert") || hashtags.includes("concertlife");
  }
  if (name === "festivals") {
    return eventName.includes("festival") || category.includes("festival") || hashtags.includes("festival");
  }
  if (name === "bars") {
    return locationName.includes("bar") || locationName.includes("lounge") || category.includes("bar") || hashtags.includes("rooftopbar");
  }
  if (name === "rooftops") {
    return locationName.includes("rooftop") || locationName.includes("skybar") || locationName.includes("sky lounge") || category.includes("rooftop");
  }
  if (name === "live music") {
    return eventName.includes("live") || eventName.includes("jazz") || category.includes("live") || hashtags.includes("livemusic") || hashtags.includes("livejazz");
  }
  return true;
};

export default function TrendingEventsDiscoverScreen({ homePath }: Props) {
  const router = useRouter();
  const isScreenFocused = useIsFocused();
  const { setCurrentVideoIndex, isAttending, attendEvent, cancelAttendance } =
    useVideoStore();
  const {
    isFollowing,
    followUser,
    unfollowUser,
    user: currentUser,
  } = useAuthStore();
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedPreviewVideoIds, setFailedPreviewVideoIds] = useState<Set<string>>(new Set());
  const [visiblePreviewVideoIds, setVisiblePreviewVideoIds] = useState<Set<string>>(new Set());

  const loadLatestEvents = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    if (selectedCategoryId === 'deals') {
      const result = await EventQueries.getDealsEvents();
      setEvents(result.events || []);
      setErrorMessage(result.error || null);
      setIsLoading(false);
      return;
    }
    const latestResult = await EventQueries.getLatestEvents();

    if (latestResult.success && (latestResult.events?.length || 0) > 0) {
      setEvents(latestResult.events || []);
      setIsLoading(false);
      return;
    }

    const fallbackTrendingResult = await EventQueries.getTrendingEvents();
    if (fallbackTrendingResult.success) {
      setEvents(fallbackTrendingResult.events || []);
      if ((fallbackTrendingResult.events?.length || 0) === 0 && latestResult.error) {
        setErrorMessage(latestResult.error);
      }
    } else {
      setErrorMessage(
        latestResult.error || fallbackTrendingResult.error || "Failed to load events"
      );
    }
    setIsLoading(false);
  }, [selectedCategoryId]);

  useFocusEffect(
    useCallback(() => {
      loadLatestEvents();
    }, [loadLatestEvents])
  );

  React.useEffect(() => {
    const intervalId = setInterval(loadLatestEvents, 60000);
    return () => clearInterval(intervalId);
  }, [loadLatestEvents]);

  const filteredEvents = useMemo(() => {
    if (!selectedCategoryId) return events;
    const category = categories.find((item) => item.id === selectedCategoryId);
    if (!category) return events;
    return events.filter((event) => eventMatchesCategory(event, category.name));
  }, [events, selectedCategoryId]);

  const handleVideoPress = (event: EventListItem) => {
    const eventVideoId = getEventVideoId(event);
    if (!eventVideoId || selectedCategoryId === 'deals') {
      router.push({ pathname: '/[id]', params: { id: event.id } });
      return;
    }
    setCurrentVideoIndex(0);
    router.push({
      pathname: homePath,
      params: { selectedVideoId: eventVideoId },
    });
  };

  const handleUserPress = (userId: string) => {
    if (userId === currentUser?.id) return;
    router.push({
      pathname: "/profile",
      params: { userId },
    });
  };

  const handleFollowPress = (userId: string, event: GestureResponderEvent) => {
    event.stopPropagation();
    if (isFollowing(userId)) {
      unfollowUser(userId);
    } else {
      followUser(userId);
    }
  };

  const handleAttendPress = (videoId: string, event: GestureResponderEvent) => {
    event.stopPropagation();
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

  const renderCategory = ({ item }: { item: (typeof categories)[0] }) => {
    const isSelected = item.id === selectedCategoryId;
    return (
      <TouchableOpacity
        style={[styles.categoryButton, isSelected && styles.selectedCategoryButton]}
        onPress={() => setSelectedCategoryId(isSelected ? null : item.id)}
      >
        <Text style={[styles.categoryText, isSelected && styles.selectedCategoryText]}>
          {item.name}
        </Text>
      </TouchableOpacity>
    );
  };

  const markPreviewFailed = useCallback((eventId: string) => {
    if (!eventId) return;
    setFailedPreviewVideoIds((currentIds) => {
      if (currentIds.has(eventId)) return currentIds;
      const nextIds = new Set(currentIds);
      nextIds.add(eventId);
      return nextIds;
    });
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
      const nextIds = new Set<string>();
      viewableItems.forEach((viewableItem) => {
        if (!viewableItem.isViewable) return;
        const eventId = String((viewableItem.item as EventListItem | undefined)?.id || "");
        if (eventId) nextIds.add(eventId);
      });
      setVisiblePreviewVideoIds(nextIds);
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 45,
    minimumViewTime: 120,
  }).current;

  const renderTrendingEvent = ({ item }: { item: EventListItem }) => {
    const creatorId = getCreatorId(item);
    const isFollowingUser = isFollowing(creatorId);
    const isOwnVideo = currentUser?.id === creatorId;
    const eventVideoId = getEventVideoId(item);
    const isAttendingEvent = eventVideoId
      ? isAttending(eventVideoId) === AttendanceStatus.GOING
      : false;
    const attendeeCount = item.current_attendees || 0;
    const imageUrl =
      getStorageUrl(item.image_url) ||
      getStorageUrl(item.video?.thumbnail_url) ||
      FALLBACK_EVENT_IMAGE;
    const previewVideoUrl = getEventPreviewVideoUrl(item);
    const isPreviewFailed = failedPreviewVideoIds.has(item.id);
    const shouldShowVideoPreview =
      isScreenFocused &&
      visiblePreviewVideoIds.has(String(item.id)) &&
      !!previewVideoUrl &&
      !isPreviewFailed;

    return (
      <TouchableOpacity
        style={styles.eventCard}
        onPress={() => handleVideoPress(item)}
      >
        {shouldShowVideoPreview ? (
          <ExpoVideo
            key={`latest-preview-${item.id}-${previewVideoUrl}`}
            source={{ uri: previewVideoUrl }}
            style={styles.eventImage}
            resizeMode={ResizeMode.COVER}
            shouldPlay
            isLooping
            isMuted
            useNativeControls={false}
            onError={() => markPreviewFailed(item.id)}
          />
        ) : (
          <Image
            source={{ uri: imageUrl }}
            style={styles.eventImage}
            contentFit="cover"
            transition={300}
          />
        )}
        <View style={styles.eventOverlay}>
          <Text style={styles.eventName}>{item.event_name}</Text>
          <View style={styles.eventDetails}>
            <View style={styles.eventDetail}>
              <MapPin size={14} color={Colors.dark.primary} />
              <Text style={styles.eventDetailText}>
                {item.location_name || item.location_city || "Location TBA"}
              </Text>
            </View>
            <View style={styles.eventDetail}>
              <Star size={14} color={Colors.dark.primary} />
              <Text style={styles.eventDetailText}>Trending</Text>
            </View>
            {attendeeCount > 0 && (
              <View style={styles.eventDetail}>
                <Users size={14} color={Colors.dark.primary} />
                <Text style={styles.eventDetailText}>{attendeeCount} going</Text>
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.userInfoButton}
          onPress={() => handleUserPress(creatorId)}
        >
          <AvatarImage
            uri={getCreatorAvatar(item)} userId={getCreatorId(item)}
            style={styles.userAvatar}
            contentFit="cover"
            transition={300}
          />
          <Text style={styles.userName}>@{getCreatorUsername(item)}</Text>
        </TouchableOpacity>

        {!isOwnVideo && (
          <TouchableOpacity
            style={[
              styles.followButton,
              isFollowingUser ? styles.followingButton : null,
            ]}
            onPress={(pressEvent) => handleFollowPress(creatorId, pressEvent)}
          >
            {isFollowingUser ? (
              <UserCheck size={16} color={Colors.dark.primary} />
            ) : (
              <UserPlus size={16} color={Colors.dark.text} />
            )}
          </TouchableOpacity>
        )}

        {eventVideoId && (
          <TouchableOpacity
            style={[
              styles.attendButton,
              isAttendingEvent ? styles.attendingButton : null,
            ]}
            onPress={(pressEvent) => handleAttendPress(eventVideoId, pressEvent)}
          >
            {isAttendingEvent ? (
              <UserCheck size={16} color={Colors.dark.primary} />
            ) : (
              <UserCircle size={16} color={Colors.dark.text} />
            )}
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderEventItem = useCallback(
    ({ item }: { item: EventListItem }) => renderTrendingEvent({ item }),
    [
      visiblePreviewVideoIds,
      failedPreviewVideoIds,
      isScreenFocused,
      isFollowing,
      isAttending,
      currentUser?.id,
    ]
  );

  const listHeader = (
    <>
      <Text style={styles.sectionTitle}>Categories</Text>
      <FlatList
        data={categories}
        renderItem={renderCategory}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoriesContainer}
      />
      <Text style={styles.sectionTitle}>Latest Events</Text>
    </>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredEvents}
        renderItem={renderEventItem}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.eventRow}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          !isLoading ? (
            <Text style={styles.noEventsText}>{errorMessage || "No events found"}</Text>
          ) : null
        }
        ListFooterComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={Colors.dark.primary} />
            </View>
          ) : null
        }
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={styles.contentContainer}
      />
    </View>
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
  eventRow: {
    justifyContent: "space-between",
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
  loadingContainer: {
    minHeight: 180,
    justifyContent: "center",
    alignItems: "center",
  },
  noEventsText: {
    fontSize: 16,
    color: Colors.dark.text,
    textAlign: "center",
    marginTop: 20,
  },
});
