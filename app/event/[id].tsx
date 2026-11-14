import { venueCoordinates } from '@/utils/venue-location';
import AvatarImage from '@/components/AvatarImage';
import { logger } from '@/lib/logger';
import EventTableManager from '@/features/event-tables/EventTableManager';
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Dimensions,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Heart,
  Share2,
  ShoppingBag,
  Navigation,
  BarChart,
  Users,
  UserPlus,
  UserCheck,
  Info,
  X,
  MoreVertical,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import { useVideoStore } from "@/store/video-store";

import VideoPlayer from "@/components/VideoPlayer";
import ProductsList from "@/components/ProductsList";
import ShareModal from "@/components/ShareModal";
import BusinessVouchersSection from "@/components/BusinessVouchersSection";
import { getCurrentLocation, calculateRoadDistance, formatDistance } from "@/utils/location";
import { useAuthStore } from "@/store/auth-store";
import { useContentModerationStore } from "@/store/content-moderation-store";
import { useProductStore } from "@/store/product-store";
import { useActionSheet } from "@expo/react-native-action-sheet";
import UserTagItem from "@/components/UserTagItem";
import AttendeesList from "@/components/AttendeesList";
import GuestListButton from "@/components/GuestListButton";
import AppThemeDialog from "@/components/AppThemeDialog";
import { AttendanceStatus } from "@/types";
import { TRANSACTION_FEE_PERCENTAGE } from "@/types/wallet";
import { getEventLifecycleStatus } from '@/utils/event-status';

const { width } = Dimensions.get("window");


export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const {
    likeVideo,
    videos,
    attendEvent,
    cancelAttendance,
    isAttending,
    getEventAttendees,
    removeVideo,
  } = useVideoStore();
  const { user } = useAuthStore();
  const { showActionSheetWithOptions } = useActionSheet();
  const { hideVideo } = useContentModerationStore();
  const { addToCart } = useProductStore();

  const [video, setVideo] = useState(
    videos.find((v) => v.id === id)
  );
  const [isLoadingVideo, setIsLoadingVideo] = useState(true);
  const [isVideoPaused, setIsVideoPaused] = useState(false);
  useEffect(() => {
    let active = true;
    setIsLoadingVideo(true);
    setIsVideoPaused(false);
    setVideo(useVideoStore.getState().videos.find(v => v.id === id));
    if (id) useVideoStore.getState().fetchVideoById(id).then(result => {
      if (active) setVideo(result || undefined);
    }).catch(() => { if (active) setVideo(undefined); })
      .finally(() => { if (active) setIsLoadingVideo(false); });
    else setIsLoadingVideo(false);
    return () => { active = false; };
  }, [id]);
  const [liked, setLiked] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [userDistance, setUserDistance] = useState<string | null>(null);
  const [isBusinessOwner, setIsBusinessOwner] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [attendanceStatus, setAttendanceStatus] =
    useState<AttendanceStatus | null>(null);
  const [showAttendeesList, setShowAttendeesList] = useState(false);
  const [attendees, setAttendees] = useState<any[]>([]);
  const [showFeeInfo, setShowFeeInfo] = useState(false);
  const [showNoEventDialog, setShowNoEventDialog] = useState(false);

  const [pendingDistanceCalc, setPendingDistanceCalc] = useState(false);

  const eventLifecycleStatus = useMemo(() => {
    if (!video) {
      return 'open' as const;
    }

    return getEventLifecycleStatus({
      status: video.eventStatus,
      startDate: video.eventStartDate || video.eventDate,
      endDate: video.eventEndDate,
      eventDate: video.eventDate,
    });
  }, [video?.eventDate, video?.eventEndDate, video?.eventStartDate, video?.eventStatus]);

  const isEventClosed = eventLifecycleStatus === 'closed';

  // Function to check if a video is liked
  const isVideoLiked = (videoId: string): boolean => {
    return liked;
  };

  useEffect(() => {
    if (id) {
      const foundVideo = videos.find((v) => v.id === id);
      setVideo(foundVideo);

      if (foundVideo) {
        setLiked(isVideoLiked(foundVideo.id));

        // Check if current user is the business owner
        if (user && user.id === foundVideo.userId && user.isBusinessAccount) {
          setIsBusinessOwner(true);
        } else {
          setIsBusinessOwner(false);
        }

        // Get attendance status
        setAttendanceStatus(isAttending(foundVideo.id));

        // Get attendees
        setAttendees(getEventAttendees(foundVideo.id));

        // Calculate distance using the shared permission flow.
        if (Platform.OS !== "web") {
          setPendingDistanceCalc(true);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, isAttending, videos]);

  useEffect(() => {
    if (!pendingDistanceCalc || !video || Platform.OS === "web") return;
    void requestPermissionAndCalculateDistance(video);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDistanceCalc, video?.id]);

  const requestPermissionAndCalculateDistance = async (targetVideo: any) => {
    try {
      const location = await getCurrentLocation();
      if (!location) {
        setUserDistance(null);
        return;
      }
      const { latitude, longitude } = location.coords;

      const target = venueCoordinates(targetVideo?.location);
      if (!target) {
        setUserDistance(null);
        return;
      }

      const distance = await calculateRoadDistance(
        latitude,
        longitude,
        target.latitude,
        target.longitude
      );

      const formattedDistance = formatDistance(distance);
      setUserDistance(formattedDistance || null);
    } catch (error) {
      logger.error("Error calculating distance:", error);
    } finally {
      setPendingDistanceCalc(false);
    }
  };

  const handleLike = () => {
    if (video) {
      likeVideo(video.id);
      setLiked(!liked);
    }
  };

  const handleShare = () => {
    setShowShareModal(true);
  };

  const handleContentMenu = () => {
    if (!video) return;
    const isOwner = user?.id === video.userId;
    const options = [
      ...(isOwner ? ["Remove" as const] : []),
      "Hide",
      "Report",
      "Cancel",
    ];
    const cancelButtonIndex = options.length - 1;

    showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
        destructiveButtonIndex: isOwner ? 0 : 1,
      },
      (buttonIndex) => {
        if (buttonIndex === undefined || buttonIndex === cancelButtonIndex) return;
        const action = options[buttonIndex];
        if (action === "Remove" && isOwner) {
          Alert.alert(
            "Remove Video",
            "Are you sure you want to remove this video? This cannot be undone.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Remove",
                style: "destructive",
                onPress: async () => {
                  try {
                    await removeVideo(video.id);
                    router.back();
                  } catch {
                    Alert.alert("Error", "Failed to remove video. Please try again.");
                  }
                },
              },
            ]
          );
        } else if (action === "Hide") {
          Alert.alert(
            "Hide Video",
            "This video will be hidden from your feed. You can change this in your preferences anytime.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Hide",
                style: "destructive",
                onPress: async () => {
                  try {
                    await hideVideo(video.id);
                    router.back();
                  } catch (e) {
                    Alert.alert("Error", "Failed to hide video. Please try again.");
                  }
                },
              },
            ]
          );
        } else if (action === "Report") {
          Alert.alert(
            "Report Content",
            "Thank you for helping keep our community safe. Your report has been submitted and will be reviewed.",
            [{ text: "OK" }]
          );
        }
      }
    );
  };

  const handleOpenLocation = () => {
    if (video) {
      router.push({
        pathname: "/location",
        params: {
          lat: video.location.latitude,
          lng: video.location.longitude,
          name: video.location.name,
          eventName: video.eventName,
        },
      });
    }
  };

  const handleViewAnalytics = () => {
    if (isBusinessOwner && video) {
      router.push({
        pathname: "/business/analytics",
        params: { eventId: video.id },
      });
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
    if (!user) {
      router.push("/signin");
      return;
    }

    if (isEventClosed) {
      Alert.alert("Event closed", "This event has already ended.");
      return;
    }

    if (attendanceStatus === AttendanceStatus.GOING) {
      cancelAttendance(video!.id);
      setAttendanceStatus(null);
    } else {
      attendEvent(video!.id, AttendanceStatus.GOING);
      setAttendanceStatus(AttendanceStatus.GOING);
    }
  };

  const handleCartPress = () => {
    if (!video) return;

    const availableProducts = (video.products || []).filter(
      (product) => Number(product?.available ?? 0) !== 0
    );

    if (!availableProducts.length) {
      setShowNoEventDialog(true);
      return;
    }

    const ticketProduct =
      availableProducts.find((product) => product.type === "ticket") ||
      availableProducts[0];

    addToCart(ticketProduct, 1);
    router.push("/cart");
  };

  const handleShowAttendees = () => {
    setShowAttendeesList(true);
  };

  const handleRemoveAttendee = (userId: string) => {
    Alert.alert(
      "Remove Attendee",
      "Are you sure you want to remove this attendee?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setAttendees(attendees.filter((a) => a.userId !== userId));
            Alert.alert("Attendee removed successfully");
          },
        },
      ]
    );
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "Date TBA";

    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (dateString?: string) => {
    if (!dateString) return "Time TBA";

    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const toggleFeeInfo = () => {
    setShowFeeInfo(!showFeeInfo);
  };

  // Tagged users
  const hasTaggedUsers = video?.taggedUsers && video.taggedUsers.length > 0;
  const maxTagsToShow = 3;
  const visibleTags =
    showAllTags || !hasTaggedUsers
      ? video?.taggedUsers || []
      : video?.taggedUsers?.slice(0, maxTagsToShow) || [];
  const hiddenTagsCount = hasTaggedUsers
    ? video!.taggedUsers!.length - maxTagsToShow
    : 0;

  if (!video && isLoadingVideo) {
    return <SafeAreaView style={styles.container}><ActivityIndicator accessibilityLabel="Loading video" /></SafeAreaView>;
  }
  if (!video) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.endedStateContainer}>
          <View style={styles.endedStateCard}>
            <View style={styles.endedStateIcon}>
              <Clock size={32} color={Colors.dark.text} />
            </View>
            <Text style={styles.endedStateKicker}>Video unavailable</Text>
            <Text style={styles.endedStateTitle}>Unable to load this video</Text>
            <Text style={styles.endedStateMessage}>
              Check your connection and try again. The video may have been removed by its owner.
            </Text>
            <TouchableOpacity style={styles.endedStateButton} onPress={() => router.back()}>
              <Text style={styles.endedStateButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {showAttendeesList ? (
        <View style={styles.attendeesListContainer}>
          <View style={styles.attendeesHeader}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setShowAttendeesList(false)}
            >
              <ArrowLeft size={24} color={Colors.dark.text} />
            </TouchableOpacity>
            <Text style={styles.attendeesTitle}>Event Attendees</Text>
            <View style={styles.headerSpacer} />
          </View>

          <AttendeesList
            attendees={attendees}
            isBusinessOwner={isBusinessOwner}
            onRemoveAttendee={isBusinessOwner ? handleRemoveAttendee : undefined}
          />
        </View>
      ) : (
        <ScrollView>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <ArrowLeft size={24} color={Colors.dark.text} />
            </TouchableOpacity>

            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleContentMenu}
              >
                <MoreVertical size={24} color={Colors.dark.text} />
              </TouchableOpacity>

              {isBusinessOwner && (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handleViewAnalytics}
                >
                  <BarChart size={24} color={Colors.dark.text} />
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
                <Heart
                  size={24}
                  color={liked ? "#FF5252" : Colors.dark.text}
                  fill={liked ? "#FF5252" : "none"}
                />
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
                <Share2 size={24} color={Colors.dark.text} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleCartPress}
              >
                <ShoppingBag size={24} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.videoContainer}>
            <VideoPlayer
              uri={video.url}
              creatorUsername={video.user?.username}
              paused={isVideoPaused}
              autoplay={true}
              onPress={() => setIsVideoPaused(value => !value)}
              taggedUsers={video.taggedUsers}
            />
          </View>

          <View style={styles.eventInfo}>
            {!!video.eventImageUrl && <Image source={{ uri: video.eventImageUrl }} style={{ width: '100%', height: 280, marginBottom: 16 }} contentFit="contain" accessibilityLabel="Event flyer" />}
            <Text style={styles.eventName}>{video.eventName}</Text>

            <TouchableOpacity
              style={styles.locationContainer}
              onPress={handleOpenLocation}
            >
              <MapPin size={16} color={Colors.dark.primary} />
              <View style={styles.locationTextContainer}>
                <Text style={styles.locationText}>{video.location.name}</Text>
                {userDistance && (
                  <Text style={styles.distanceText}>{userDistance} driving</Text>
                )}
              </View>
              <Navigation size={16} color={Colors.dark.primary} />
            </TouchableOpacity>

            <View style={styles.dateTimeContainer}>
              <View style={styles.dateContainer}>
                <Calendar size={16} color={Colors.dark.primary} />
                <Text style={styles.dateText}>{formatDate(video.eventDate)}</Text>
              </View>

              <View style={styles.timeContainer}>
                <Clock size={16} color={Colors.dark.primary} />
                <Text style={styles.timeText}>{formatTime(video.eventDate)}</Text>
              </View>
            </View>

            <View style={[styles.eventStatusBadge, isEventClosed ? styles.closedBadge : styles.openBadge]}>
              <Text style={styles.eventStatusText}>{isEventClosed ? 'Closed' : 'Open'}</Text>
            </View>

            <View style={styles.attendanceSection}>
              <TouchableOpacity
                style={[
                  styles.attendButton,
                  attendanceStatus === AttendanceStatus.GOING &&
                    styles.attendingButton,
                  isEventClosed && styles.disabledButton,
                ]}
                onPress={handleAttendancePress}
                disabled={isEventClosed}
              >
                {isEventClosed ? (
                  <X size={20} color={Colors.dark.text} />
                ) : attendanceStatus === AttendanceStatus.GOING ? (
                  <UserCheck size={20} color={Colors.dark.primary} />
                ) : (
                  <UserPlus size={20} color={Colors.dark.text} />
                )}
                <Text
                  style={[
                    styles.attendButtonText,
                    attendanceStatus === AttendanceStatus.GOING &&
                      styles.attendingButtonText,
                    isEventClosed && styles.disabledButtonText,
                  ]}
                >
                  {isEventClosed
                    ? "Event Closed"
                    : attendanceStatus === AttendanceStatus.GOING
                    ? "I'm Going"
                    : "Attend Event"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.viewAttendeesButton}
                onPress={handleShowAttendees}
              >
                <Users size={20} color={Colors.dark.text} />
                <Text style={styles.viewAttendeesText}>
                  View Attendees {video.attendeeCount ? `(${video.attendeeCount})` : ""}
                </Text>
              </TouchableOpacity>

              <GuestListButton eventId={video.id} isBusinessOwner={isBusinessOwner} />
            </View>

            {hasTaggedUsers && (
              <View style={styles.taggedUsersSection}>
                <View style={styles.sectionTitleContainer}>
                  <Users size={16} color={Colors.dark.primary} />
                  <Text style={styles.sectionTitle}>Tagged People</Text>
                </View>

                <View style={styles.taggedUsersContainer}>
                  {visibleTags.map((taggedUser) => (
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

            <TouchableOpacity
              style={styles.hostContainer}
              onPress={() =>
                router.push({
                  pathname: "/profile",
                  params: { userId: video.userId },
                })
              }
            >
              <AvatarImage
                uri={video.user.avatar} userId={video.user?.id}
                style={styles.hostImage}
                contentFit="cover"
                transition={300}
              />
              <View style={styles.hostInfo}>
                <Text style={styles.hostedByText}>Hosted by</Text>
                <Text style={styles.hostName}>{video.user.name}</Text>
              </View>
            </TouchableOpacity>

            {video.description && (
              <View style={styles.descriptionContainer}>
                <Text style={styles.descriptionTitle}>About this event</Text>
                <Text style={styles.descriptionText}>
                  {video.description ||
                    "Join us for an unforgettable night of music, dancing, and entertainment at this exclusive event. Don't miss out on the hottest party of the season!"}
                </Text>
              </View>
            )}

            <View style={styles.mapSection}>
              <Text style={styles.sectionTitle}>Location</Text>
              <View style={styles.mapContainer}>
                <Image
                  source={{
                    uri: "https://images.unsplash.com/photo-1569336415962-a4bd9f69c07b?q=80&w=2069&auto=format&fit=crop",
                  }}
                  style={styles.mapImage}
                  contentFit="cover"
                />
                <TouchableOpacity
                  style={styles.viewFullMapButton}
                  onPress={handleOpenLocation}
                >
                  <Text style={styles.viewFullMapText}>View Full Map</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.addressContainer}>
                <Text style={styles.addressText}>
                  {video.location.address}, {video.location.city},{" "}
                  {video.location.state}
                </Text>
                <Text style={styles.coordinatesText}>
                  {video.location.latitude.toFixed(6)},{" "}
                  {video.location.longitude.toFixed(6)}
                </Text>
              </View>
            </View>

            {video.eventId && <View style={{padding:16}}>
              <TouchableOpacity style={{backgroundColor:'#ed365b',padding:16,borderRadius:10}} onPress={() => router.push({pathname:'/web-event/[id]',params:{id:video.eventId!}})}>
                <Text style={{color:'#fff',fontWeight:'bold'}}>Tickets, products & table reservations</Text>
              </TouchableOpacity>
              {isBusinessOwner && <EventTableManager eventId={video.eventId} />}
            </View>}
            <BusinessVouchersSection businessId={video.userId} />

            <View style={styles.productsSection}>
              <View style={styles.productsSectionHeader}>
                <Text style={styles.sectionTitle}>Available Products</Text>
                <TouchableOpacity style={styles.feeInfoButton} onPress={toggleFeeInfo}>
                  <Info size={16} color={Colors.dark.subtext} />
                </TouchableOpacity>
              </View>

              {showFeeInfo && (
                <View style={styles.feeInfoContainer}>
                  <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
                  <Text style={styles.feeInfoText}>
                    A {(TRANSACTION_FEE_PERCENTAGE * 100).toFixed(0)}% platform
                    fee is applied to all transactions to support the 60Seconds
                    platform and its services. This fee helps us maintain and
                    improve the platform for all users.
                  </Text>
                </View>
              )}

              <ProductsList
                videoId={video.id}
                onClose={() => {}}
                products={video?.products}
                buyerEmail={user?.email}
                buyerId={user?.id}
              />
            </View>

            {isBusinessOwner && (
              <TouchableOpacity
                style={styles.analyticsButton}
                onPress={handleViewAnalytics}
              >
                <BarChart size={20} color={Colors.dark.text} />
                <Text style={styles.analyticsButtonText}>View Sales Analytics</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      )}

      <ShareModal
        visible={showShareModal}
        onClose={() => setShowShareModal(false)}
        video={video}
      />

      <AppThemeDialog
        visible={showNoEventDialog}
        title="Nothing to Add Yet"
        message="No ticket or purchasable event item is available for this event right now. Try attending the event first or check back when products are published."
        primaryLabel="Browse Events"
        onPrimaryPress={() => {
          setShowNoEventDialog(false);
          router.push("/");
        }}
        onClose={() => setShowNoEventDialog(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    marginTop: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerActions: {
    flexDirection: "row",
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  endedStateContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  endedStateCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "rgba(129,140,248,0.42)",
    alignItems: "center",
    shadowColor: Colors.dark.primary,
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  endedStateIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.dark.primary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  endedStateKicker: {
    color: Colors.dark.primaryLight,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  endedStateTitle: {
    color: Colors.dark.text,
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 10,
  },
  endedStateMessage: {
    color: Colors.dark.subtext,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 20,
  },
  endedStateButton: {
    width: "100%",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: Colors.dark.primary,
  },
  endedStateButtonText: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: "800",
  },
  videoContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  eventInfo: {
    padding: 16,
  },
  eventName: {
    fontSize: 24,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 12,
  },
  locationContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  locationTextContainer: {
    flex: 1,
    marginLeft: 8,
  },
  locationText: {
    fontSize: 16,
    color: Colors.dark.text,
  },
  distanceText: {
    fontSize: 12,
    color: Colors.dark.primary,
    marginTop: 2,
  },
  dateTimeContainer: {
    flexDirection: "row",
    marginBottom: 16,
  },
  dateContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 16,
  },
  dateText: {
    fontSize: 14,
    color: Colors.dark.text,
    marginLeft: 8,
  },
  timeContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeText: {
    fontSize: 14,
    color: Colors.dark.text,
    marginLeft: 8,
  },
  eventStatusBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  openBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.18)",
  },
  closedBadge: {
    backgroundColor: "rgba(107, 114, 128, 0.28)",
  },
  eventStatusText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  attendanceSection: {
    marginBottom: 20,
  },
  attendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 10,
  },
  attendingButton: {
    backgroundColor: "rgba(138, 43, 226, 0.1)",
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  disabledButton: {
    opacity: 0.65,
  },
  attendButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "500",
    marginLeft: 8,
  },
  attendingButtonText: {
    color: Colors.dark.primary,
  },
  disabledButtonText: {
    color: Colors.dark.subtext,
  },
  viewAttendeesButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  viewAttendeesText: {
    color: Colors.dark.text,
    fontSize: 16,
    marginLeft: 8,
  },
  taggedUsersSection: {
    marginBottom: 16,
  },
  sectionTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 12,
  },
  taggedUsersContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  moreTagsButton: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  moreTagsText: {
    color: Colors.dark.primary,
    fontSize: 14,
  },
  hostContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  hostImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  hostInfo: {
    marginLeft: 12,
  },
  hostedByText: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  hostName: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.dark.text,
  },
  descriptionContainer: {
    marginBottom: 20,
  },
  descriptionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 8,
  },
  descriptionText: {
    fontSize: 14,
    color: Colors.dark.text,
    lineHeight: 20,
  },
  mapSection: {
    marginBottom: 20,
  },
  mapContainer: {
    height: 200,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
    marginBottom: 8,
  },
  mapImage: {
    width: "100%",
    height: "100%",
  },
  viewFullMapButton: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: Colors.dark.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  viewFullMapText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: "bold",
  },
  addressContainer: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
  },
  addressText: {
    color: Colors.dark.text,
    fontSize: 14,
    marginBottom: 4,
  },
  coordinatesText: {
    color: Colors.dark.subtext,
    fontSize: 12,
  },
  productsSection: {
    marginBottom: 20,
  },
  productsSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  feeInfoButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },
  feeInfoContainer: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  feeInfoTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 8,
  },
  feeInfoText: {
    fontSize: 14,
    color: Colors.dark.text,
    lineHeight: 20,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    fontSize: 16,
    color: Colors.dark.text,
  },
  analyticsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4CAF50",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 16,
  },
  analyticsButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 8,
  },
  attendeesListContainer: {
    flex: 1,
  },
  attendeesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  attendeesTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  headerSpacer: {
    width: 40,
  },


});












//////////////////       Before Disclouser //////////////////////////////////////////////////////



// import React, { useEffect, useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   ScrollView,
//   SafeAreaView,
//   Dimensions,
//   Platform,
//   Alert,
// } from "react-native";
// import { Image } from "expo-image";
// import { useLocalSearchParams, useRouter } from "expo-router";
// import {
//   ArrowLeft,
//   MapPin,
//   Calendar,
//   Clock,
//   Heart,
//   Share2,
//   ShoppingBag,
//   Navigation,
//   BarChart,
//   Users,
//   UserCircle,
//   UserPlus,
//   UserCheck,
//   UserMinus,
//   Info,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { useVideoStore } from "@/store/video-store";
//
// import VideoPlayer from "@/components/VideoPlayer";
// import ProductsList from "@/components/ProductsList";
// import ShareModal from "@/components/ShareModal";
// import BusinessVouchersSection from "@/components/BusinessVouchersSection";
// // import { formatDistance } from "@/utils/location";
// import { useAuthStore } from "@/store/auth-store";
// import UserTagItem from "@/components/UserTagItem";
// import AttendeesList from "@/components/AttendeesList";
// import GuestListButton from "@/components/GuestListButton";
// import { AttendanceStatus } from "@/types";
// import { TRANSACTION_FEE_PERCENTAGE } from "@/types/wallet";

// const { width } = Dimensions.get("window");

// export default function EventScreen() {
//   const { id } = useLocalSearchParams<{ id: string }>();
//   const router = useRouter();
//   const {
//     likeVideo,
//     videos,
//     attendEvent,
//     cancelAttendance,
//     isAttending,
//     getEventAttendees,
//   } = useVideoStore();
//   const { user } = useAuthStore();

//   const [video, setVideo] = useState(mockVideos.find((v) => v.id === id));
//   const [liked, setLiked] = useState(false);
//   const [showShareModal, setShowShareModal] = useState(false);
//   const [userDistance, setUserDistance] = useState<string | null>(null);
//   const [isBusinessOwner, setIsBusinessOwner] = useState(false);
//   const [showAllTags, setShowAllTags] = useState(false);
//   const [attendanceStatus, setAttendanceStatus] =
//     useState<AttendanceStatus | null>(null);
//   const [showAttendeesList, setShowAttendeesList] = useState(false);
//   const [attendees, setAttendees] = useState<any[]>([]);
//   const [showFeeInfo, setShowFeeInfo] = useState(false);

//   // Function to check if a video is liked
//   const isVideoLiked = (videoId: string): boolean => {
//     // This is a placeholder implementation
//     // In a real app, this would check against a list of liked videos in the store
//     return liked;
//   };

//   useEffect(() => {
//     if (id) {
//       const foundVideo = mockVideos.find((v) => v.id === id);
//       setVideo(foundVideo);

//       if (foundVideo) {
//         setLiked(isVideoLiked(foundVideo.id));

//         // Check if current user is the business owner
//         if (user && user.id === foundVideo.userId && user.isBusinessAccount) {
//           setIsBusinessOwner(true);
//         } else {
//           setIsBusinessOwner(false);
//         }

//         // Get attendance status
//         setAttendanceStatus(isAttending(foundVideo.id));

//         // Get attendees
//         setAttendees(getEventAttendees(foundVideo.id));

//         // Calculate distance from user to event location
//         (async () => {
//           if (Platform.OS === "web") {
//             // Skip location calculation on web
//             return;
//           }

//           try {
//             const { status } =
//               await Location.requestForegroundPermissionsAsync();
//             if (status === "granted") {
//               const location = await Location.getCurrentPositionAsync({});
//               const { latitude, longitude } = location.coords;

//               const { calculateDistance } = require("@/utils/location");

//               const distance = calculateDistance(
//                 latitude,
//                 longitude,
//                 foundVideo.location.latitude,
//                 foundVideo.location.longitude
//               );

//               setUserDistance(formatDistance(distance));
//             }
//           } catch (error) {
//             logger.error("Error calculating distance:", error);
//           }
//         })();
//       }
//     }
//   }, [id, user, isAttending]);

//   const handleLike = () => {
//     if (video) {
//       likeVideo(video.id);
//       setLiked(!liked);
//     }
//   };

//   const handleShare = () => {
//     setShowShareModal(true);
//   };

//   const handleOpenLocation = () => {
//     if (video) {
//       router.push({
//         pathname: "/location",
//         params: {
//           lat: video.location.latitude,
//           lng: video.location.longitude,
//           name: video.location.name,
//           eventName: video.eventName,
//         },
//       });
//     }
//   };

//   const handleViewAnalytics = () => {
//     if (isBusinessOwner && video) {
//       router.push({
//         pathname: "/business/analytics",
//         params: { eventId: video.id },
//       });
//     }
//   };

//   const handleTaggedUserPress = (userId: string) => {
//     router.push({
//       pathname: "/profile",
//       params: { userId },
//     });
//   };

//   const toggleShowAllTags = () => {
//     setShowAllTags(!showAllTags);
//   };

//   const handleAttendancePress = () => {
//     if (!user) {
//       router.push("/signin");
//       return;
//     }

//     if (attendanceStatus === AttendanceStatus.GOING) {
//       cancelAttendance(video!.id);
//     } else {
//       attendEvent(video!.id, AttendanceStatus.GOING);
//     }
//   };

//   const handleShowAttendees = () => {
//     setShowAttendeesList(true);
//   };

//   const handleRemoveAttendee = (userId: string) => {
//     Alert.alert(
//       "Remove Attendee",
//       "Are you sure you want to remove this attendee?",
//       [
//         {
//           text: "Cancel",
//           style: "cancel",
//         },
//         {
//           text: "Remove",
//           style: "destructive",
//           onPress: () => {
//             // In a real app, this would call an API to remove the attendee
//             // For this example, we'll just update the local state
//             setAttendees(attendees.filter((a) => a.userId !== userId));
//             Alert.alert("Attendee removed successfully");
//           },
//         },
//       ]
//     );
//   };

//   const formatDate = (dateString?: string) => {
//     if (!dateString) return "Date TBA";

//     const date = new Date(dateString);
//     return date.toLocaleDateString("en-US", {
//       weekday: "short",
//       month: "short",
//       day: "numeric",
//     });
//   };

//   const formatTime = (dateString?: string) => {
//     if (!dateString) return "Time TBA";

//     const date = new Date(dateString);
//     return date.toLocaleTimeString("en-US", {
//       hour: "numeric",
//       minute: "2-digit",
//       hour12: true,
//     });
//   };

//   const toggleFeeInfo = () => {
//     setShowFeeInfo(!showFeeInfo);
//   };

//   // Determine if we have tagged users and how many to show
//   const hasTaggedUsers = video?.taggedUsers && video.taggedUsers.length > 0;
//   const maxTagsToShow = 3;
//   const visibleTags =
//     showAllTags || !hasTaggedUsers
//       ? video?.taggedUsers || []
//       : video?.taggedUsers?.slice(0, maxTagsToShow) || [];
//   const hiddenTagsCount = hasTaggedUsers
//     ? video!.taggedUsers!.length - maxTagsToShow
//     : 0;

//   if (!video) {
//     return (
//       <SafeAreaView style={styles.container}>
//         <View style={styles.header}>
//           <TouchableOpacity
//             style={styles.backButton}
//             onPress={() => router.back()}
//           >
//             <ArrowLeft size={24} color={Colors.dark.text} />
//           </TouchableOpacity>
//         </View>
//         <View style={styles.errorContainer}>
//           <Text style={styles.errorText}>This event has ended</Text>
//         </View>
//       </SafeAreaView>
//     );
//   }

//   return (
//     <SafeAreaView style={styles.container}>
//       {showAttendeesList ? (
//         // Attendees list view
//         <View style={styles.attendeesListContainer}>
//           <View style={styles.attendeesHeader}>
//             <TouchableOpacity
//               style={styles.backButton}
//               onPress={() => setShowAttendeesList(false)}
//             >
//               <ArrowLeft size={24} color={Colors.dark.text} />
//             </TouchableOpacity>
//             <Text style={styles.attendeesTitle}>Event Attendees</Text>
//             <View style={styles.headerSpacer} />
//           </View>

//           <AttendeesList
//             attendees={attendees}
//             isBusinessOwner={isBusinessOwner}
//             onRemoveAttendee={
//               isBusinessOwner ? handleRemoveAttendee : undefined
//             }
//           />
//         </View>
//       ) : (
//         // Event details view
//         <ScrollView>
//           <View style={styles.header}>
//             <TouchableOpacity
//               style={styles.backButton}
//               onPress={() => router.back()}
//             >
//               <ArrowLeft size={24} color={Colors.dark.text} />
//             </TouchableOpacity>

//             <View style={styles.headerActions}>
//               {isBusinessOwner && (
//                 <TouchableOpacity
//                   style={styles.actionButton}
//                   onPress={handleViewAnalytics}
//                 >
//                   <BarChart size={24} color={Colors.dark.text} />
//                 </TouchableOpacity>
//               )}

//               <TouchableOpacity
//                 style={styles.actionButton}
//                 onPress={handleLike}
//               >
//                 <Heart
//                   size={24}
//                   color={liked ? "#FF5252" : Colors.dark.text}
//                   fill={liked ? "#FF5252" : "none"}
//                 />
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={styles.actionButton}
//                 onPress={handleShare}
//               >
//                 <Share2 size={24} color={Colors.dark.text} />
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={styles.actionButton}
//                 onPress={() => router.push("/cart")}
//               >
//                 <ShoppingBag size={24} color={Colors.dark.text} />
//               </TouchableOpacity>
//             </View>
//           </View>

//           <View style={styles.videoContainer}>
//             <VideoPlayer
//               uri={video.url}
//               paused={true}
//               autoplay={false}
//               taggedUsers={video.taggedUsers}
//             />
//           </View>

//           <View style={styles.eventInfo}>
//             <Text style={styles.eventName}>{video.eventName}</Text>

//             <TouchableOpacity
//               style={styles.locationContainer}
//               onPress={handleOpenLocation}
//             >
//               <MapPin size={16} color={Colors.dark.primary} />
//               <View style={styles.locationTextContainer}>
//                 <Text style={styles.locationText}>{video.location.name}</Text>
//                 {userDistance && (
//                   <Text style={styles.distanceText}>{userDistance} driving</Text>
//                 )}
//               </View>
//               <Navigation size={16} color={Colors.dark.primary} />
//             </TouchableOpacity>

//             <View style={styles.dateTimeContainer}>
//               <View style={styles.dateContainer}>
//                 <Calendar size={16} color={Colors.dark.primary} />
//                 <Text style={styles.dateText}>
//                   {formatDate(video.eventDate)}
//                 </Text>
//               </View>

//               <View style={styles.timeContainer}>
//                 <Clock size={16} color={Colors.dark.primary} />
//                 <Text style={styles.timeText}>
//                   {formatTime(video.eventDate)}
//                 </Text>
//               </View>
//             </View>

//             {/* Attendance Section */}
//             <View style={styles.attendanceSection}>
//               <TouchableOpacity
//                 style={[
//                   styles.attendButton,
//                   attendanceStatus === AttendanceStatus.GOING &&
//                     styles.attendingButton,
//                 ]}
//                 onPress={handleAttendancePress}
//               >
//                 {attendanceStatus === AttendanceStatus.GOING ? (
//                   <UserCheck size={20} color={Colors.dark.primary} />
//                 ) : (
//                   <UserPlus size={20} color={Colors.dark.text} />
//                 )}
//                 <Text
//                   style={[
//                     styles.attendButtonText,
//                     attendanceStatus === AttendanceStatus.GOING &&
//                       styles.attendingButtonText,
//                   ]}
//                 >
//                   {attendanceStatus === AttendanceStatus.GOING
//                     ? "I'm Going"
//                     : "Attend Event"}
//                 </Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={styles.viewAttendeesButton}
//                 onPress={handleShowAttendees}
//               >
//                 <Users size={20} color={Colors.dark.text} />
//                 <Text style={styles.viewAttendeesText}>
//                   View Attendees{" "}
//                   {video.attendeeCount ? `(${video.attendeeCount})` : ""}
//                 </Text>
//               </TouchableOpacity>

//               <GuestListButton
//                 eventId={video.id}
//                 isBusinessOwner={isBusinessOwner}
//               />
//             </View>

//             {/* Tagged Users Section */}
//             {hasTaggedUsers && (
//               <View style={styles.taggedUsersSection}>
//                 <View style={styles.sectionTitleContainer}>
//                   <Users size={16} color={Colors.dark.primary} />
//                   <Text style={styles.sectionTitle}>Tagged People</Text>
//                 </View>

//                 <View style={styles.taggedUsersContainer}>
//                   {visibleTags.map((taggedUser) => (
//                     <UserTagItem
//                       key={taggedUser.userId}
//                       user={taggedUser.user}
//                       onPress={() => handleTaggedUserPress(taggedUser.userId)}
//                       showRemoveButton={false}
//                     />
//                   ))}

//                   {hiddenTagsCount > 0 && !showAllTags && (
//                     <TouchableOpacity
//                       style={styles.moreTagsButton}
//                       onPress={toggleShowAllTags}
//                     >
//                       <Text style={styles.moreTagsText}>
//                         +{hiddenTagsCount} more
//                       </Text>
//                     </TouchableOpacity>
//                   )}
//                 </View>
//               </View>
//             )}

//             <TouchableOpacity
//               style={styles.hostContainer}
//               onPress={() =>
//                 router.push({
//                   pathname: "/profile",
//                   params: { userId: video.userId },
//                 })
//               }
//             >
//               <Image
//                 source={{ uri: video.user.avatar }}
//                 style={styles.hostImage}
//                 contentFit="cover"
//                 transition={300}
//               />
//               <View style={styles.hostInfo}>
//                 <Text style={styles.hostedByText}>Hosted by</Text>
//                 <Text style={styles.hostName}>{video.user.name}</Text>
//               </View>
//             </TouchableOpacity>

//             {video.description && (
//               <View style={styles.descriptionContainer}>
//                 <Text style={styles.descriptionTitle}>About this event</Text>
//                 <Text style={styles.descriptionText}>
//                   {video.description ||
//                     "Join us for an unforgettable night of music, dancing, and entertainment at this exclusive event. Don't miss out on the hottest party of the season!"}
//                 </Text>
//               </View>
//             )}

//             <View style={styles.mapSection}>
//               <Text style={styles.sectionTitle}>Location</Text>
//               <View style={styles.mapContainer}>
//                 <Image
//                   source={{
//                     uri: "https://images.unsplash.com/photo-1569336415962-a4bd9f69c07b?q=80&w=2069&auto=format&fit=crop",
//                   }}
//                   style={styles.mapImage}
//                   contentFit="cover"
//                 />
//                 <TouchableOpacity
//                   style={styles.viewFullMapButton}
//                   onPress={handleOpenLocation}
//                 >
//                   <Text style={styles.viewFullMapText}>View Full Map</Text>
//                 </TouchableOpacity>
//               </View>

//               <View style={styles.addressContainer}>
//                 <Text style={styles.addressText}>
//                   {video.location.address}, {video.location.city},{" "}
//                   {video.location.state}
//                 </Text>
//                 <Text style={styles.coordinatesText}>
//                   {video.location.latitude.toFixed(6)},{" "}
//                   {video.location.longitude.toFixed(6)}
//                 </Text>
//               </View>
//             </View>

//             <BusinessVouchersSection businessId={video.userId} />

//             <View style={styles.productsSection}>
//               <View style={styles.productsSectionHeader}>
//                 <Text style={styles.sectionTitle}>Available Products</Text>
//                 <TouchableOpacity
//                   style={styles.feeInfoButton}
//                   onPress={toggleFeeInfo}
//                 >
//                   <Info size={16} color={Colors.dark.subtext} />
//                 </TouchableOpacity>
//               </View>

//               {showFeeInfo && (
//                 <View style={styles.feeInfoContainer}>
//                   <Text style={styles.feeInfoTitle}>About Platform Fees</Text>
//                   <Text style={styles.feeInfoText}>
//                     A {(TRANSACTION_FEE_PERCENTAGE * 100).toFixed(0)}% platform
//                     fee is applied to all transactions to support the 60Seconds
//                     platform and its services. This fee helps us maintain and
//                     improve the platform for all users.
//                   </Text>
//                 </View>
//               )}

//               <ProductsList videoId={video.id} onClose={() => {}} />
//             </View>

//             {isBusinessOwner && (
//               <TouchableOpacity
//                 style={styles.analyticsButton}
//                 onPress={handleViewAnalytics}
//               >
//                 <BarChart size={20} color={Colors.dark.text} />
//                 <Text style={styles.analyticsButtonText}>
//                   View Sales Analytics
//                 </Text>
//               </TouchableOpacity>
//             )}
//           </View>
//         </ScrollView>
//       )}

//       <ShareModal
//         visible={showShareModal}
//         onClose={() => setShowShareModal(false)}
//         video={video}
//       />
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//     marginTop: 40,
//   },
//   header: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     padding: 16,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: "rgba(0, 0, 0, 0.5)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   headerActions: {
//     flexDirection: "row",
//   },
//   actionButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: "rgba(0, 0, 0, 0.5)",
//     justifyContent: "center",
//     alignItems: "center",
//     marginLeft: 8,
//   },
//   videoContainer: {
//     width: "100%",
//     aspectRatio: 16 / 9,
//   },
//   eventInfo: {
//     padding: 16,
//   },
//   eventName: {
//     fontSize: 24,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   locationContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//     marginBottom: 12,
//   },
//   locationTextContainer: {
//     flex: 1,
//     marginLeft: 8,
//   },
//   locationText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//   },
//   distanceText: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     marginTop: 2,
//   },
//   dateTimeContainer: {
//     flexDirection: "row",
//     marginBottom: 16,
//   },
//   dateContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     marginRight: 16,
//   },
//   dateText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//     marginLeft: 8,
//   },
//   timeContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   timeText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//     marginLeft: 8,
//   },
//   attendanceSection: {
//     marginBottom: 20,
//   },
//   attendButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: Colors.dark.card,
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//     borderRadius: 8,
//     marginBottom: 10,
//   },
//   attendingButton: {
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   attendButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: "500",
//     marginLeft: 8,
//   },
//   attendingButtonText: {
//     color: Colors.dark.primary,
//   },
//   viewAttendeesButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: "rgba(255, 255, 255, 0.05)",
//     paddingVertical: 12,
//     paddingHorizontal: 16,
//     borderRadius: 8,
//   },
//   viewAttendeesText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     marginLeft: 8,
//   },
//   taggedUsersSection: {
//     marginBottom: 16,
//   },
//   sectionTitleContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     marginBottom: 8,
//   },
//   taggedUsersContainer: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//   },
//   moreTagsButton: {
//     backgroundColor: "rgba(255, 255, 255, 0.1)",
//     borderRadius: 20,
//     paddingVertical: 6,
//     paddingHorizontal: 10,
//     marginRight: 8,
//     marginBottom: 8,
//   },
//   moreTagsText: {
//     color: Colors.dark.primary,
//     fontSize: 14,
//   },
//   hostContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 12,
//     marginBottom: 20,
//   },
//   hostImage: {
//     width: 50,
//     height: 50,
//     borderRadius: 25,
//   },
//   hostInfo: {
//     marginLeft: 12,
//   },
//   hostedByText: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//   },
//   hostName: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//   },
//   descriptionContainer: {
//     marginBottom: 20,
//   },
//   descriptionTitle: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   descriptionText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//     lineHeight: 20,
//   },
//   mapSection: {
//     marginBottom: 20,
//   },
//   sectionTitle: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   mapContainer: {
//     height: 200,
//     borderRadius: 12,
//     overflow: "hidden",
//     position: "relative",
//     marginBottom: 8,
//   },
//   map: {
//     ...StyleSheet.absoluteFillObject,
//   },
//   mapImage: {
//     width: "100%",
//     height: "100%",
//   },
//   viewFullMapButton: {
//     position: "absolute",
//     bottom: 10,
//     right: 10,
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     borderRadius: 20,
//   },
//   viewFullMapText: {
//     color: Colors.dark.text,
//     fontSize: 12,
//     fontWeight: "bold",
//   },
//   addressContainer: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//   },
//   addressText: {
//     color: Colors.dark.text,
//     fontSize: 14,
//     marginBottom: 4,
//   },
//   coordinatesText: {
//     color: Colors.dark.subtext,
//     fontSize: 12,
//   },
//   productsSection: {
//     marginBottom: 20,
//   },
//   productsSectionHeader: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     marginBottom: 12,
//   },
//   feeInfoButton: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   feeInfoContainer: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//     marginBottom: 16,
//   },
//   feeInfoTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   feeInfoText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//     lineHeight: 20,
//   },
//   errorContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   errorText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//   },
//   analyticsButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: "#4CAF50",
//     paddingVertical: 12,
//     paddingHorizontal: 20,
//     borderRadius: 12,
//     marginTop: 8,
//     marginBottom: 16,
//   },
//   analyticsButtonText: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     fontWeight: "bold",
//     marginLeft: 8,
//   },
//   attendeesListContainer: {
//     flex: 1,
//   },
//   attendeesHeader: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   attendeesTitle: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   headerSpacer: {
//     width: 40,
//   },
// });
