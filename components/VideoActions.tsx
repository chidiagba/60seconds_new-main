import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
} from "react-native";
import {
  Heart,
  MessageCircle,
  Share2,
  Star,
  ShoppingBag,
  Hash,
  MoreVertical,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import { Video, RatingValue, AttendanceStatus } from "@/types";
import { useVideoStore } from "@/store/video-store";
import { useProductStore } from "@/store/product-store";
import { useAuthStore } from "@/store/auth-store";
import { useAuth } from "@/lib/auth";
import { useContentModerationStore } from "@/store/content-moderation-store";
import { useActionSheet } from "@expo/react-native-action-sheet";
import RatingModal from "./RatingModal";
import ProductsModal from "./ProductsModal";
import ShareModal from "./ShareModal";
import CartButton from "./CartButton";
import AppThemeDialog from "./AppThemeDialog";
import { LinearGradient } from "expo-linear-gradient";

interface VideoActionsProps {
  video: Video;
  showCartButton?: boolean;
}

export default function VideoActions({ video, showCartButton = false }: VideoActionsProps) {
  const router = useRouter();
  const { user } = useAuthStore();
  const { showActionSheetWithOptions } = useActionSheet();
  const { hideVideo, blockUser } = useContentModerationStore();
  const { removeVideo } = useVideoStore();
  const { user: authUser } = useAuth();
  const [liked, setLiked] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [showProductsModal, setShowProductsModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const {
    likeVideo,
    unlikeVideo,
    rateVideo,
    isAttending,
    attendEvent,
    cancelAttendance,
    isVideoLiked,
    loadUserLikes,
  } = useVideoStore();
  const { addToCart } = useProductStore();
  const [attendanceStatus, setAttendanceStatus] =
    useState<AttendanceStatus | null>(isAttending(video.id));
  const [showNoEventDialog, setShowNoEventDialog] = useState(false);

  // Load user likes on mount and check if this video is liked
  useEffect(() => {
    const initializeLikes = async () => {
      if (authUser?.id) {
        await loadUserLikes(authUser.id);
        setLiked(isVideoLiked(video.id));
      }
    };
    initializeLikes();
  }, [authUser?.id, loadUserLikes, video.id]);

  useEffect(() => {
    setAttendanceStatus(isAttending(video.id));
  }, [isAttending, video.id]);

  const handleLike = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    if (liked) {
      await unlikeVideo(video.id);
      setLiked(false);
    } else {
      await likeVideo(video.id);
      setLiked(true);
    }
  };

  const handleComment = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push({
      pathname: "/comments",
      params: { videoId: video.id },
    });
  };

  const handleShare = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setShowShareModal(true);
  };

  const handleRating = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setShowRatingModal(true);
  };

  const handleHashtagPress = (hashtag: string) => {
    router.push({
      pathname: "/search",
      // params: { query: hashtag, filter: 'hashtag' }
    });
  };

  const handleProducts = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setShowProductsModal(true);
  };

  const handleCartPress = () => {
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

  const handleAttendance = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    if (!user) {
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

  const submitRating = async (rating: RatingValue) => {
    await rateVideo(video.id, rating);
    setShowRatingModal(false);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleContentMenu = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const currentUserId = authUser?.id || user?.id;
    const isOwner = currentUserId === video.userId;
    const options = [
      ...(isOwner ? ["Remove" as const] : []),
      // allow blocking of other users
      ...(!isOwner ? ["Block User" as const] : []),
      "Hide",
      "Report",
      "Cancel",
    ];
    const cancelButtonIndex = options.length - 1;
    // if owner, destructive is Remove, otherwise hide (or Block User?)
    const destructiveButtonIndex = isOwner ? 0 : options.indexOf("Hide");

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
                    if (Platform.OS !== "web") {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }
                  } catch (e) {
                    Alert.alert("Error", "Failed to remove video. Please try again.");
                  }
                },
              },
            ]
          );
        } else if (action === "Block User") {
          // hide this video and persist block so future videos by the user are filtered
          hideVideo(video.id);
          if (video.userId) {
            blockUser(video.userId);
          }
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          Alert.alert("Blocked", "This user has been blocked and their content will no longer appear.");
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
                    if (Platform.OS !== "web") {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }
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

  // Show products button when event has products (regardless of account type)
  const showProductsButton = video.products && video.products.length > 0;

  return (
    <View style={styles.container}>
      {showCartButton && (
        <View style={styles.actionButton}>
          <CartButton onPress={handleCartPress} variant="stacked" />
          <Text style={styles.actionText}>Cart</Text>
        </View>
      )}

      <TouchableOpacity style={styles.actionButton} onPress={handleContentMenu}>
        <View style={styles.iconBackground}>
          <MoreVertical size={24} color={Colors.dark.text} />
        </View>
        <Text style={styles.actionText}>More</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
        <View
          style={[styles.iconBackground, liked && styles.likedIconBackground]}
        >
          <Heart
            size={24}
            color={liked ? Colors.dark.accent : Colors.dark.text}
            fill={liked ? Colors.dark.accent : "transparent"}
          />
        </View>
        <Text style={styles.actionText}>{video.likes}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.actionButton} onPress={handleComment}>
        <View style={styles.iconBackground}>
          <MessageCircle size={24} color={Colors.dark.text} />
        </View>
        <Text style={styles.actionText}>{video.comments}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
        <View style={styles.iconBackground}>
          <Share2 size={24} color={Colors.dark.text} />
        </View>
        <Text style={styles.actionText}>{video.shares}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.actionButton} onPress={handleRating}>
        <View style={styles.iconBackground}>
          <Star size={24} color={Colors.dark.text} />
        </View>
        <Text style={styles.actionText}>{video.rating}</Text>
      </TouchableOpacity>

      {showProductsButton && (
        <TouchableOpacity style={styles.actionButton} onPress={handleProducts}>
          {Platform.OS !== "web" ? (
            <LinearGradient
              colors={Colors.dark.gradients.secondary as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.shopButton}
            >
              <ShoppingBag size={24} color={Colors.dark.text} />
            </LinearGradient>
          ) : (
            <View
              style={[
                styles.shopButton,
                { backgroundColor: Colors.dark.secondary },
              ]}
            >
              <ShoppingBag size={24} color={Colors.dark.text} />
            </View>
          )}
          <Text style={[styles.actionText, styles.shopText]}>Shop</Text>
        </TouchableOpacity>
      )}

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

      <RatingModal
        visible={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        onSubmit={submitRating}
        currentRating={video.rating}
      />

      <ProductsModal
        visible={showProductsModal}
        onClose={() => setShowProductsModal(false)}
        videoId={video.id}
        products={video.products}
        buyerEmail={user?.email}
        buyerId={user?.id}
      />

      <ShareModal
        visible={showShareModal}
        onClose={() => setShowShareModal(false)}
        video={video}
      />

      <AppThemeDialog
        visible={showNoEventDialog}
        title="No Event Item Available"
        message="This event does not have any purchasable ticket or product right now, so nothing was added to your cart."
        primaryLabel="Continue Browsing"
        onPrimaryPress={() => setShowNoEventDialog(false)}
        onClose={() => setShowNoEventDialog(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 16,
    bottom: 100,
    alignItems: "flex-end",
    zIndex: 10,
  },
  actionButton: {
    alignItems: "center",
    marginBottom: 20,
  },
  iconBackground: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
  },
  likedIconBackground: {
    backgroundColor: "rgba(244, 63, 94, 0.2)",
  },
  attendingIconBackground: {
    backgroundColor: "rgba(99, 102, 241, 0.2)",
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  shopButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
  },
  actionText: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: "500",
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  shopText: {
    color: Colors.dark.secondary,
    fontWeight: "bold",
  },
  attendingText: {
    color: Colors.dark.primary,
    fontWeight: "bold",
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
  hashtagsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 12,
    width: '48%',
  },
});
