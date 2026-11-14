import { logger } from '@/lib/logger';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useAuth } from '@/lib/auth-provider';
import { 
  videoService, 
  orderService, 
  eventService, 
  voucherService,
  Video,
  Order,
  Event,
  Voucher
} from '@/lib/database';
import Colors from '@/constants/colors';
import { User, LogOut, Database, Video as VideoIcon, Calendar, Ticket } from 'lucide-react-native';

export default function SupabaseExample() {
  const { user, profile, signOut } = useAuth();
  const [userVideos, setUserVideos] = useState<Video[]>([]);
  const [userOrders, setUserOrders] = useState<Order[]>([]);
  const [userEvents, setUserEvents] = useState<Event[]>([]);
  const [businessVouchers, setBusinessVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(false);

  const loadUserData = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Load user's videos
      const videos = await videoService.getUserVideos(user.id);
      setUserVideos(videos);

      // Load user's orders
      const orders = await orderService.getUserOrders(user.id);
      setUserOrders(orders);

      // Load user's events
      const events = await eventService.getUserEvents(user.id);
      setUserEvents(events);

      // Load business vouchers if user is a business
      if (profile?.user_type === 'business') {
        const vouchers = await voucherService.getBusinessVouchers(user.id);
        setBusinessVouchers(vouchers);
      }
    } catch (error) {
      logger.error('Error loading user data:', error);
      Alert.alert('Error', 'Failed to load user data');
    } finally {
      setLoading(false);
    }
  }, [user, profile]);

  useEffect(() => {
    if (user && profile) {
      loadUserData();
    }
  }, [user, profile, loadUserData]);



  const createSampleVideo = async () => {
    if (!user) return;

    setLoading(true);
    try {
      await videoService.uploadVideo({
        user_id: user.id,
        video_url: 'https://example.com/sample-video.mp4',
        title: 'Sample Video',
        description: 'This is a sample video created from the app',
        location_name: 'Sample Location',
        location_city: 'New York',
        location_state: 'NY',
        location_country: 'USA',
        event_name: 'Sample Event',
        hashtags: ['sample', 'test', 'demo']
      });
      
      Alert.alert('Success', 'Sample video created!');
      loadUserData();
    } catch (error) {
      Alert.alert('Error', 'Failed to create video');
      logger.error('Error creating video:', error);
    } finally {
      setLoading(false);
    }
  };

  const createSampleEvent = async () => {
    if (!user) return;

    setLoading(true);
    try {
      await eventService.createEvent({
        user_id: user.id,
        event_name: 'Sample Event',
        description: 'This is a sample event',
        start_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        location_name: 'Sample Venue',
        location_city: 'New York',
        location_state: 'NY',
        location_country: 'USA',
        max_attendees: 100,
        ticket_price: 25.00,
        currency: 'USD',
        category: 'Entertainment',
        tags: ['music', 'party', 'fun']
      });
      
      Alert.alert('Success', 'Sample event created!');
      loadUserData();
    } catch (error) {
      Alert.alert('Error', 'Failed to create event');
      logger.error('Error creating event:', error);
    } finally {
      setLoading(false);
    }
  };

  const createSampleVoucher = async () => {
    if (!user || profile?.user_type !== 'business') {
      Alert.alert('Error', 'Only business accounts can create vouchers');
      return;
    }

    setLoading(true);
    try {
      await voucherService.createVoucher({
        business_id: user.id,
        code: 'SAMPLE20',
        name: '20% Off Sample Voucher',
        description: 'Get 20% off your next purchase',
        discount_type: 'percentage',
        discount_amount: 20,
        min_purchase_amount: 50,
        usage_limit: 100,
        expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
      
      Alert.alert('Success', 'Sample voucher created!');
      loadUserData();
    } catch (error) {
      Alert.alert('Error', 'Failed to create voucher');
      logger.error('Error creating voucher:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      Alert.alert('Error', String(error));
    }
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Not authenticated</Text>
        <Text style={styles.subtitle}>Please sign in to use Supabase features</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <User size={24} color={Colors.dark.primary} />
        <Text style={styles.title}>Supabase Database Demo</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>User Profile</Text>
        <View style={styles.infoCard}>
          <Text style={styles.label}>Name:</Text>
          <Text style={styles.value}>{profile?.full_name || 'Not set'}</Text>
          <Text style={styles.label}>Username:</Text>
          <Text style={styles.value}>{profile?.username || 'Not set'}</Text>
          <Text style={styles.label}>Account Type:</Text>
          <Text style={styles.value}>{profile?.user_type || 'Unknown'}</Text>
          <Text style={styles.label}>Email:</Text>
          <Text style={styles.value}>{user.email}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sample Data Creation</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={createSampleVideo}
          disabled={loading}
        >
          <VideoIcon size={16} color={Colors.dark.text} />
          <Text style={styles.buttonText}>
            {loading ? 'Creating...' : 'Create Sample Video'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.button}
          onPress={createSampleEvent}
          disabled={loading}
        >
          <Calendar size={16} color={Colors.dark.text} />
          <Text style={styles.buttonText}>
            {loading ? 'Creating...' : 'Create Sample Event'}
          </Text>
        </TouchableOpacity>
        
        {profile?.user_type === 'business' && (
          <TouchableOpacity
            style={styles.button}
            onPress={createSampleVoucher}
            disabled={loading}
          >
            <Ticket size={16} color={Colors.dark.text} />
            <Text style={styles.buttonText}>
              {loading ? 'Creating...' : 'Create Sample Voucher'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Videos ({userVideos.length})</Text>
        {userVideos.length > 0 ? (
          userVideos.slice(0, 3).map((video) => (
            <View key={video.id} style={styles.itemCard}>
              <Text style={styles.itemTitle}>{video.title}</Text>
              <Text style={styles.itemSubtitle}>{video.description}</Text>
              <Text style={styles.itemStats}>
                👍 {video.likes_count} | 💬 {video.comments_count} | 📤 {video.shares_count}
              </Text>
            </View>
          ))
        ) : (
          <View style={styles.infoCard}>
            <Text style={styles.noData}>No videos yet. Create a sample video to get started!</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Events ({userEvents.length})</Text>
        {userEvents.length > 0 ? (
          userEvents.slice(0, 3).map((event) => (
            <View key={event.id} style={styles.itemCard}>
              <Text style={styles.itemTitle}>{event.event_name}</Text>
              <Text style={styles.itemSubtitle}>{event.description}</Text>
              <Text style={styles.itemStats}>
                📅 {new Date(event.start_date).toLocaleDateString()}
              </Text>
              <Text style={styles.itemStats}>
                👥 {event.current_attendees}/{event.max_attendees || '∞'} attendees
              </Text>
            </View>
          ))
        ) : (
          <View style={styles.infoCard}>
            <Text style={styles.noData}>No events yet. Create a sample event to get started!</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Orders ({userOrders.length})</Text>
        {userOrders.length > 0 ? (
          userOrders.slice(0, 3).map((order) => (
            <View key={order.id} style={styles.itemCard}>
              <Text style={styles.itemTitle}>Order #{order.id.slice(0, 8)}</Text>
              <Text style={styles.itemSubtitle}>
                Status: {order.status} | Payment: {order.payment_status}
              </Text>
              <Text style={styles.itemStats}>
                💰 {order.currency} {order.total_amount}
              </Text>
            </View>
          ))
        ) : (
          <View style={styles.infoCard}>
            <Text style={styles.noData}>No orders yet.</Text>
          </View>
        )}
      </View>

      {profile?.user_type === 'business' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Vouchers ({businessVouchers.length})</Text>
          {businessVouchers.length > 0 ? (
            businessVouchers.slice(0, 3).map((voucher) => (
              <View key={voucher.id} style={styles.itemCard}>
                <Text style={styles.itemTitle}>{voucher.name}</Text>
                <Text style={styles.itemSubtitle}>Code: {voucher.code}</Text>
                <Text style={styles.itemStats}>
                  💸 {voucher.discount_amount}{voucher.discount_type === 'percentage' ? '%' : ' USD'} off
                </Text>
                <Text style={styles.itemStats}>
                  📊 Used: {voucher.usage_count}/{voucher.usage_limit || '∞'}
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.infoCard}>
              <Text style={styles.noData}>No vouchers yet. Create a sample voucher to get started!</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Actions</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={loadUserData}
          disabled={loading}
        >
          <Database size={16} color={Colors.dark.text} />
          <Text style={styles.buttonText}>
            {loading ? 'Loading...' : 'Refresh Data'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, styles.signOutButton]}
          onPress={handleSignOut}
        >
          <LogOut size={16} color={Colors.dark.text} />
          <Text style={styles.buttonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginLeft: 12,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: 'center',
    marginTop: 8,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  infoCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  label: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 4,
    marginTop: 8,
  },
  value: {
    fontSize: 16,
    color: Colors.dark.text,
    fontWeight: '500',
  },
  noData: {
    fontSize: 14,
    color: Colors.dark.subtext,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  itemCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  itemSubtitle: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 4,
  },
  itemStats: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginTop: 2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  signOutButton: {
    backgroundColor: Colors.dark.error,
  },
  buttonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },

});