import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { MapPin, Calendar, Users, Hash, Clock } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface SearchResultItemProps {
  type: 'event' | 'video' | 'user';
  data: any;
  onPress: (id: string, type: string, data: any) => void;
}

export default function SearchResultItem({ type, data, onPress }: SearchResultItemProps) {
  const handlePress = () => {
    onPress(data.id, type, data);
  };

  const renderEventItem = () => (
    <TouchableOpacity style={styles.resultItem} onPress={handlePress}>
      <View style={styles.eventImageContainer}>
        {data.image_url ? (
          <ExpoImage
            source={{ uri: data.image_url }}
            style={styles.eventImage}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.eventImage, styles.placeholderImage]}>
            <Calendar size={24} color={Colors.dark.subtext} />
          </View>
        )}
      </View>
      
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {data.event_name}
        </Text>
        
        <View style={styles.resultMeta}>
          <View style={styles.metaItem}>
            <Calendar size={14} color={Colors.dark.primary} />
            <Text style={styles.metaText}>
              {new Date(data.start_date).toLocaleDateString()}
            </Text>
          </View>
          
          {data.location_city && (
            <View style={styles.metaItem}>
              <MapPin size={14} color={Colors.dark.primary} />
              <Text style={styles.metaText} numberOfLines={1}>
                {data.location_city}
              </Text>
            </View>
          )}
        </View>
        
        {data.description && (
          <Text style={styles.resultDescription} numberOfLines={2}>
            {data.description}
          </Text>
        )}
        
        {data.profiles && (
          <View style={styles.creatorInfo}>
            <Text style={styles.creatorText}>
              by {data.profiles.username || data.profiles.full_name}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderVideoItem = () => (
    <TouchableOpacity style={styles.resultItem} onPress={handlePress}>
      <View style={styles.videoThumbnailContainer}>
        {data.thumbnail_url ? (
          <ExpoImage
            source={{ uri: data.thumbnail_url }}
            style={styles.videoThumbnail}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.videoThumbnail, styles.placeholderImage]}>
            <Calendar size={24} color={Colors.dark.subtext} />
          </View>
        )}
      </View>
      
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {data.title || data.event_name}
        </Text>
        
        <View style={styles.resultMeta}>
          <View style={styles.metaItem}>
            <Clock size={14} color={Colors.dark.primary} />
            <Text style={styles.metaText}>
              {new Date(data.created_at).toLocaleDateString()}
            </Text>
          </View>
          
          {data.location_city && (
            <View style={styles.metaItem}>
              <MapPin size={14} color={Colors.dark.primary} />
              <Text style={styles.metaText} numberOfLines={1}>
                {data.location_city}
              </Text>
            </View>
          )}
        </View>
        
        {data.description && (
          <Text style={styles.resultDescription} numberOfLines={2}>
            {data.description}
          </Text>
        )}
        
        {data.hashtags && data.hashtags.length > 0 && (
          <View style={styles.hashtagsContainer}>
            {data.hashtags.slice(0, 2).map((tag: string, index: number) => (
              <Text key={index} style={styles.hashtag}>
                #{tag}
              </Text>
            ))}
            {data.hashtags.length > 2 && (
              <Text style={styles.hashtag}>+{data.hashtags.length - 2}</Text>
            )}
          </View>
        )}
        
        {data.profiles && (
          <View style={styles.creatorInfo}>
            <Text style={styles.creatorText}>
              by {data.profiles.username || data.profiles.full_name}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderUserItem = () => (
    // Prefer uploaded avatar URL, then gender avatar, then default placeholder.
    <TouchableOpacity style={styles.userItem} onPress={handlePress}>
      <View style={styles.userAvatarContainer}>
        {data.avatar_url ? (
          <ExpoImage
            source={{ uri: data.avatar_url }}
            style={styles.userAvatar}
            contentFit="cover"
          />
        ) : data.avatar_gender ? (
          <View style={[styles.userAvatar, styles.genderAvatar, data.avatar_gender === 'male' ? styles.genderAvatarMale : styles.genderAvatarFemale]}>
            <Text style={styles.genderAvatarText}>{data.avatar_gender === 'male' ? '👨' : '👩'}</Text>
          </View>
        ) : (
          <View style={[styles.userAvatar, styles.placeholderAvatar]}>
            <Users size={20} color={Colors.dark.subtext} />
          </View>
        )}
      </View>
      
      <View style={styles.userInfo}>
        <Text style={styles.userName} numberOfLines={1}>
          {data.full_name || data.username}
        </Text>
        
        <Text style={styles.userUsername} numberOfLines={1}>
          @{data.username}
        </Text>
        
        {data.business_name && (
          <Text style={styles.businessName} numberOfLines={1}>
            {data.business_name}
          </Text>
        )}
        
        {data.bio && (
          <Text style={styles.userBio} numberOfLines={2}>
            {data.bio}
          </Text>
        )}
        
        <View style={styles.userStats}>
          <Text style={styles.statText}>
            {data.followers_count || 0} followers
          </Text>
          <Text style={styles.statText}>
            {data.following_count || 0} following
          </Text>
        </View>
      </View>
      
      <View style={styles.userTypeBadge}>
        <Text style={styles.userTypeText}>
          {data.user_type === 'business' ? 'Business' : 'Personal'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  switch (type) {
    case 'event':
      return renderEventItem();
    case 'video':
      return renderVideoItem();
    case 'user':
      return renderUserItem();
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  resultItem: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    overflow: 'hidden',
  },
  userItem: {
    flexDirection: 'row',
    marginBottom: 12,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  
  // Event styles
  eventImageContainer: {
    width: 100,
    height: 100,
  },
  eventImage: {
    width: '100%',
    height: '100%',
  },
  
  // Video styles
  videoThumbnailContainer: {
    width: 100,
    height: 100,
  },
  videoThumbnail: {
    width: '100%',
    height: '100%',
  },
  
  // User styles
  userAvatarContainer: {
    marginRight: 12,
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  placeholderAvatar: {
    backgroundColor: Colors.dark.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  genderAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  genderAvatarMale: {
    backgroundColor: '#3B82F6',
  },
  genderAvatarFemale: {
    backgroundColor: '#EC4899',
  },
  genderAvatarText: {
    fontSize: 24,
  },
  
  // Common styles
  placeholderImage: {
    backgroundColor: Colors.dark.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  resultInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
  },
  
  resultTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 6,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 2,
  },
  userUsername: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 2,
  },
  businessName: {
    fontSize: 14,
    color: Colors.dark.primary,
    marginBottom: 4,
  },
  
  resultMeta: {
    marginBottom: 6,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  metaText: {
    color: Colors.dark.subtext,
    marginLeft: 4,
    fontSize: 12,
  },
  
  resultDescription: {
    color: Colors.dark.subtext,
    fontSize: 14,
    marginBottom: 6,
  },
  userBio: {
    color: Colors.dark.subtext,
    fontSize: 14,
    marginBottom: 6,
  },
  
  hashtagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  hashtag: {
    color: Colors.dark.primary,
    marginRight: 8,
    fontSize: 12,
  },
  
  creatorInfo: {
    marginTop: 4,
  },
  creatorText: {
    color: Colors.dark.subtext,
    fontSize: 12,
  },
  
  userStats: {
    flexDirection: 'row',
    marginTop: 4,
  },
  statText: {
    color: Colors.dark.subtext,
    fontSize: 12,
    marginRight: 12,
  },
  
  userTypeBadge: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  userTypeText: {
    color: Colors.dark.text,
    fontSize: 10,
    fontWeight: 'bold',
  },
});
