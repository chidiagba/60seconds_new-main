import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Send } from "lucide-react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import Colors from "@/constants/colors";
import { useVideoStore } from "@/store/video-store";
import { useAuth } from "@/lib/auth";
import CommentItem from "@/components/CommentItem";
import { User } from "@/types";

const FALLBACK_AVATAR =
  '';

export default function CommentsScreen() {
  const { videoId } = useLocalSearchParams<{ videoId: string }>();
  const { comments, fetchComments, addComment, isLoading, refreshVideoEngagement } = useVideoStore();
  const { user, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (videoId) {
      fetchComments(videoId);
      refreshVideoEngagement(videoId);
    }
  }, [videoId, fetchComments, refreshVideoEngagement]);

  const videoComments = useMemo(
    () => comments.filter((comment) => comment.videoId === videoId),
    [comments, videoId]
  );

  const topLevelComments = useMemo(
    () => videoComments.filter((comment) => !comment.parentId),
    [videoComments]
  );

  const currentCommentUser = useMemo<User | null>(() => {
    if (!user) {
      return null;
    }

    const emailPrefix = user.email?.split("@")[0] || "user";
    const resolvedAvatar = profile?.avatar_url || '';

    return {
      id: user.id,
      name: profile?.full_name || user.user_metadata?.full_name || emailPrefix,
      username: profile?.username || user.user_metadata?.username || emailPrefix,
      email: user.email,
      avatar: resolvedAvatar,
      followers: profile?.followers_count || 0,
      following: profile?.following_count || 0,
      isBusinessAccount: (profile?.user_type || user.user_metadata?.user_type) === "business",
      businessName: profile?.business_name || user.user_metadata?.business_name,
      businessType: profile?.business_type || user.user_metadata?.business_type,
    };
  }, [profile, user]);

  const handleSubmitComment = useCallback(async () => {
    const trimmed = newComment.trim();
    if (!trimmed || !videoId || submitting) {
      return;
    }

    if (!currentCommentUser) {
      return;
    }

    setSubmitting(true);
    try {
      await addComment(videoId, trimmed, currentCommentUser);
      setNewComment("");
    } finally {
      setSubmitting(false);
    }
  }, [addComment, currentCommentUser, newComment, submitting, videoId]);

  const inputBottomPadding = Math.max(insets.bottom, 12);

  return (
    <>
      <Stack.Screen 
        options={{ 
          headerTitle: () => (
            <Text style={{ 
              color: Colors.dark.text, 
              fontWeight: "bold", 
              fontSize: 18,
              paddingLeft: 20,
            }}>
              Comments
            </Text>
          ),
        }} 
      />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight + insets.top : 0}
      >
        <FlatList
          data={topLevelComments}
          renderItem={({ item }) => <CommentItem comment={item} />}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.commentsList, { paddingBottom: 16 + 56 + inputBottomPadding }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          ListEmptyComponent={
            isLoading ? (
              <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator color={Colors.dark.primary} />
              </View>
            ) : (
              <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <Text style={styles.emptyText}>
                  No comments yet. Be the first to comment!
                </Text>
              </View>
            )
          }
        />
        <SafeAreaView edges={["bottom"]} style={styles.inputSafeArea}>
          <View style={[styles.inputContainer, { paddingBottom: inputBottomPadding }]}>
            <TextInput
              style={styles.input}
              placeholder="Add a comment..."
              placeholderTextColor={Colors.dark.subtext}
              value={newComment}
              onChangeText={setNewComment}
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!newComment.trim() || submitting) && styles.sendButtonDisabled,
              ]}
              onPress={handleSubmitComment}
              disabled={!newComment.trim() || submitting}
            >
              {submitting ? (
                <View style={styles.sendingWrap}>
                  <ActivityIndicator size="small" color={Colors.dark.text} />
                  <Text style={styles.sendingText}>Posting...</Text>
                </View>
              ) : (
                <Send size={20} color={Colors.dark.text} />
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  inputSafeArea: {
    backgroundColor: Colors.dark.card,
  },
  commentsList: {
    flexGrow: 1,
    paddingBottom: 16,
    marginTop: 40,
  },
  emptyText: {
    textAlign: "center",
    color: Colors.dark.subtext,
    padding: 20,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    backgroundColor: Colors.dark.card,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: Colors.dark.text,
    maxHeight: 100,
  },
  sendButton: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.primary,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: Colors.dark.inactive,
  },
  sendingWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  sendingText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
  },
  closeButton: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "transparent",
    padding: 8,
    zIndex: 10, // Ensure the close button stays on top
  },
});














// import React, { useCallback, useEffect, useMemo, useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   FlatList,
//   TextInput,
//   TouchableOpacity,
//   KeyboardAvoidingView,
//   Platform,
//   ActivityIndicator,
// } from "react-native";
// import { useLocalSearchParams } from "expo-router";
// import { Send } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { useVideoStore } from "@/store/video-store";
// import { useAuthStore } from "@/store/auth-store";
// import CommentItem from "@/components/CommentItem";

// const FALLBACK_AVATAR =
//   '';

// export default function CommentsScreen() {
//   const { videoId } = useLocalSearchParams<{ videoId: string }>();
//   const { comments, fetchComments, addComment, isLoading } = useVideoStore();
//   const { user } = useAuthStore();

//   const [newComment, setNewComment] = useState("");
//   const [submitting, setSubmitting] = useState(false);

//   useEffect(() => {
//     if (videoId) {
//       fetchComments(videoId);
//     }
//   }, [videoId, fetchComments]);

//   const videoComments = useMemo(
//     () => comments.filter((comment) => comment.videoId === videoId),
//     [comments, videoId]
//   );

//   const topLevelComments = useMemo(
//     () => videoComments.filter((comment) => !comment.parentId),
//     [videoComments]
//   );

//   const addGuestComment = useCallback(
//     (text: string) => {
//       if (!videoId) return;

//       const guestId = `guest-${Date.now()}`;
//       const guestUser = {
//         id: guestId,
//         name: "Guest",
//         username: `guest_${guestId}`,
//         avatar: FALLBACK_AVATAR,
//         followers: 0,
//         following: 0,
//         isBusinessAccount: false,
//       };

//       const guestComment = {
//         id: guestId,
//         videoId,
//         userId: guestUser.id,
//         user: guestUser,
//         text,
//         likes: 0,
//         createdAt: new Date().toISOString(),
//       };

//       useVideoStore.setState((state) => ({
//         comments: [guestComment, ...state.comments],
//         videos: state.videos.map((video) =>
//           video.id === videoId
//             ? { ...video, comments: (video.comments || 0) + 1 }
//             : video
//         ),
//       }));
//     },
//     [videoId]
//   );

//   const handleSubmitComment = useCallback(() => {
//     const trimmed = newComment.trim();
//     if (!trimmed || !videoId || submitting) {
//       return;
//     }

//     setSubmitting(true);

//     if (user) {
//       addComment(videoId, trimmed);
//     } else {
//       addGuestComment(trimmed);
//     }

//     setNewComment("");
//     setSubmitting(false);
//   }, [addComment, addGuestComment, newComment, submitting, user, videoId]);

//   return (
//     <>
//       <KeyboardAvoidingView
//         style={styles.container}
//         behavior={Platform.OS === "ios" ? "padding" : undefined}
//         keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
//       >
//         <FlatList
//           data={topLevelComments}
//           renderItem={({ item }) => <CommentItem comment={item} />}
//           keyExtractor={(item) => item.id}
//           contentContainerStyle={styles.commentsList}
//           keyboardShouldPersistTaps="handled"
//           ListEmptyComponent={
//             isLoading ? (
//               <ActivityIndicator color={Colors.dark.primary} />
//             ) : (
//               <Text style={styles.emptyText}>
//                 No comments yet. Be the first to comment!
//               </Text>
//             )
//           }
//         />
//       </KeyboardAvoidingView>
//       <View style={styles.inputContainer}>
//         <TextInput
//           style={styles.input}
//           placeholder="Add a comment..."
//           placeholderTextColor={Colors.dark.subtext}
//           value={newComment}
//           onChangeText={setNewComment}
//           multiline
//         />
//         <TouchableOpacity
//           style={[
//             styles.sendButton,
//             (!newComment.trim() || submitting) && styles.sendButtonDisabled,
//           ]}
//           onPress={handleSubmitComment}
//           disabled={!newComment.trim() || submitting}
//         >
//           <Send size={20} color={Colors.dark.text} />
//         </TouchableOpacity>
//       </View>
//     </>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   commentsList: {
//     paddingBottom: 16,
//     marginTop: 40,
//   },
//   emptyText: {
//     textAlign: "center",
//     color: Colors.dark.subtext,
//     padding: 20,
//   },
//   inputContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     padding: 12,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     backgroundColor: Colors.dark.card,
//     paddingBottom: 30,
//   },
//   input: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//     borderRadius: 20,
//     paddingHorizontal: 16,
//     paddingVertical: 10,
//     color: Colors.dark.text,
//     maxHeight: 100,
//   },
//   sendButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.primary,
//     justifyContent: "center",
//     alignItems: "center",
//     marginLeft: 8,
//   },
//   sendButtonDisabled: {
//     backgroundColor: Colors.dark.inactive,
//   },
// });
