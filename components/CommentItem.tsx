import AvatarImage from '@/components/AvatarImage';
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Heart, MessageCircle, ChevronDown, ChevronUp, Send } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Comment } from '@/types';
import { useVideoStore } from '@/store/video-store';
import { useAuth } from '@/lib/auth';
import { User } from '@/types';

interface CommentItemProps {
  comment: Comment;
  onLike?: () => void;
  level?: number;
}

export default function CommentItem({ comment, onLike, level = 0 }: CommentItemProps) {
  const { user, profile } = useAuth();
  const { addReply } = useVideoStore();
  const [showReplies, setShowReplies] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isClicked, setIsClicked] = useState(false);
  
  const replyAuthor: User | null = user
    ? {
        id: user.id,
        name: profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        username: profile?.username || user.user_metadata?.username || user.email?.split('@')[0] || 'user',
        email: user.email,
        avatar: profile?.avatar_url || '',
        followers: profile?.followers_count || 0,
        following: profile?.following_count || 0,
        isBusinessAccount: (profile?.user_type || user.user_metadata?.user_type) === 'business',
        businessName: profile?.business_name || user.user_metadata?.business_name,
        businessType: profile?.business_type || user.user_metadata?.business_type,
      }
    : null;

  // Format the date to show how long ago the comment was posted
  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) {
      return `${diffInSeconds}s ago`;
    } else if (diffInSeconds < 3600) {
      return `${Math.floor(diffInSeconds / 60)}m ago`;
    } else if (diffInSeconds < 86400) {
      return `${Math.floor(diffInSeconds / 3600)}h ago`;
    } else {
      return `${Math.floor(diffInSeconds / 86400)}d ago`;
    }
  };

  const handleReply = async () => {
    if (replyText.trim() && replyAuthor) {
      await addReply(comment.videoId, comment.id, replyText.trim(), replyAuthor);
      setReplyText('');
      setIsReplying(false);
      setShowReplies(true); // Show replies after adding a new one
    }
  };

  const hasReplies = comment.replies && comment.replies.length > 0;
  const replyCount = hasReplies ? comment.replies!.length : 0;


  return (
    <View style={[styles.container, level > 0 && styles.replyContainer]}>
      <AvatarImage uri={comment.user.avatar} userId={comment.userId} style={styles.avatar} contentFit="cover" />
      
      <View style={styles.contentContainer}>
        <Text style={styles.username}>{comment.user.name || comment.user.username}</Text>
        <Text style={styles.commentText}>{comment.text}</Text>
        <View style={styles.metaContainer}>
          <Text style={styles.timestamp}>{formatTimeAgo(comment.createdAt)}</Text>
          {/* <TouchableOpacity style={styles.likeButton} onPress={onLike}> */}
          <TouchableOpacity style={styles.likeButton} onPress={() => setIsClicked(!isClicked)}>
            <Heart size={14} color={isClicked ? "red" : Colors.dark.subtext} />
            <Text style={styles.likeCount}>{comment.likes}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.replyButton} 
            onPress={() => setIsReplying(!isReplying)}
          >
            <MessageCircle size={14} color={Colors.dark.subtext} />
            <Text style={styles.replyText}>Reply</Text>
          </TouchableOpacity>
        </View>
        
        {isReplying && (
          <View style={styles.replyInputContainer}>
            <TextInput
              style={styles.replyInput}
              placeholder="Write a reply..."
              placeholderTextColor={Colors.dark.subtext}
              value={replyText}
              onChangeText={setReplyText}
              multiline
              autoFocus
            />
            <TouchableOpacity 
              style={[styles.sendButton, !replyText.trim() && styles.sendButtonDisabled]} 
              onPress={handleReply}
              disabled={!replyText.trim()}
            >
              <Send size={16} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
        )}
        
        {hasReplies && (
          <TouchableOpacity 
            style={styles.viewRepliesButton}
            onPress={() => setShowReplies(!showReplies)}
          >
            {showReplies ? (
              <View style={styles.viewRepliesContainer}>
                <ChevronUp size={16} color={Colors.dark.primary} />
                <Text style={styles.viewRepliesText}>Hide replies</Text>
              </View>
            ) : (
              <View style={styles.viewRepliesContainer}>
                <ChevronDown size={16} color={Colors.dark.primary} />
                <Text style={styles.viewRepliesText}>
                  View {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}
        
        {showReplies && hasReplies && (
          <View style={styles.repliesContainer}>
            {comment.replies!.map((reply) => (
              <CommentItem 
                key={reply.id} 
                comment={reply} 
                level={level + 1}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  replyContainer: {
    marginLeft: 20,
    paddingLeft: 0,
    borderLeftWidth: 1,
    borderLeftColor: Colors.dark.divider,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  avatarFallback: {
    backgroundColor: Colors.dark.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmojiBackground: {
    backgroundColor: 'rgba(59,130,246,0.18)',
  },
  avatarFallbackText: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: '700',
  },
  contentContainer: {
    flex: 1,
  },
  username: {
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 2,
  },
  commentText: {
    color: Colors.dark.text,
    fontSize: 14,
    marginBottom: 4,
  },
  metaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timestamp: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginRight: 12,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  likeCount: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginLeft: 4,
  },
  replyButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  replyText: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginLeft: 4,
  },
  replyInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  replyInput: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 14,
    maxHeight: 80,
  },
  sendButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: Colors.dark.inactive,
  },
  viewRepliesButton: {
    marginTop: 8,
  },
  viewRepliesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewRepliesText: {
    fontSize: 13,
    color: Colors.dark.primary,
    marginLeft: 4,
  },
  repliesContainer: {
    marginTop: 4,
  },
});