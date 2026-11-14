import AvatarImage from '@/components/AvatarImage';
import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { CheckCircle, Circle, MessageCircle, Gift, Eye, Heart, MessageSquare, Share, ShoppingCart } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { BusinessCustomer, InteractionType } from '@/types';

interface BusinessCustomerListProps {
  customers: BusinessCustomer[];
  selectedCustomers: string[];
  onSelectCustomer: (customerId: string) => void;
  onCustomerPress: (customerId: string) => void;
}

export default function BusinessCustomerList({
  customers,
  selectedCustomers,
  onSelectCustomer,
  onCustomerPress
}: BusinessCustomerListProps) {
  
  const getInteractionIcon = (type: InteractionType) => {
    switch (type) {
      case 'view':
        return <Eye size={12} color={Colors.dark.subtext} />;
      case 'like':
        return <Heart size={12} color="#FF5252" />;
      case 'comment':
        return <MessageSquare size={12} color={Colors.dark.primary} />;
      case 'share':
        return <Share size={12} color="#4CAF50" />;
      case 'purchase':
        return <ShoppingCart size={12} color="#FFA500" />;
      default:
        return null;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 24) {
      return `${diffInHours}h ago`;
    } else if (diffInHours < 168) { // 7 days
      return `${Math.floor(diffInHours / 24)}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const renderCustomerItem = ({ item }: { item: BusinessCustomer }) => {
    const isSelected = selectedCustomers.includes(item.customerId);
    
    return (
      <TouchableOpacity 
        style={[styles.customerItem, isSelected && styles.selectedCustomerItem]}
        onPress={() => onCustomerPress(item.customerId)}
        activeOpacity={0.7}
      >
        <TouchableOpacity 
          style={styles.selectionButton}
          onPress={() => onSelectCustomer(item.customerId)}
        >
          {isSelected ? (
            <CheckCircle size={24} color={Colors.dark.primary} />
          ) : (
            <Circle size={24} color={Colors.dark.subtext} />
          )}
        </TouchableOpacity>
        
        <AvatarImage
          uri={item.customer.avatar} userId={item.customer?.id}
          style={styles.avatar}
          contentFit="cover"
          transition={300}
        />
        
        <View style={styles.customerInfo}>
          <View style={styles.customerHeader}>
            <Text style={styles.customerName}>
              {item.customer.displayName || item.customer.name}
            </Text>
            <Text style={styles.lastInteraction}>
              {formatDate(item.lastInteractionDate)}
            </Text>
          </View>
          
          <Text style={styles.customerUsername}>@{item.customer.username}</Text>
          
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{item.totalInteractions}</Text>
              <Text style={styles.statLabel}>interactions</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>${item.totalSpent.toFixed(0)}</Text>
              <Text style={styles.statLabel}>spent</Text>
            </View>
          </View>
          
          <View style={styles.interactionTypes}>
            {item.interactionTypes.map((type, index) => (
              <View key={type} style={styles.interactionType}>
                {getInteractionIcon(type)}
              </View>
            ))}
          </View>
          
          {item.tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {item.tags.map(tag => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
          
          {item.notes && (
            <Text style={styles.notes} numberOfLines={2}>
              {item.notes}
            </Text>
          )}
        </View>
        
        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={(e) => {
              e.stopPropagation();
              // Handle message action
            }}
          >
            <MessageCircle size={20} color={Colors.dark.primary} />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={(e) => {
              e.stopPropagation();
              // Handle voucher action
            }}
          >
            <Gift size={20} color={Colors.dark.primary} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <FlatList
      data={customers}
      renderItem={renderCustomerItem}
      keyExtractor={(item) => item.id}
      style={styles.list}
      showsVerticalScrollIndicator={false}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  customerItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: Colors.dark.background,
  },
  selectedCustomerItem: {
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
  },
  selectionButton: {
    marginRight: 12,
    marginTop: 4,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  customerInfo: {
    flex: 1,
  },
  customerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  lastInteraction: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  customerUsername: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    marginBottom: 8,
    gap: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  interactionTypes: {
    flexDirection: 'row',
    marginBottom: 8,
    gap: 8,
  },
  interactionType: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
    gap: 6,
  },
  tag: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  tagText: {
    fontSize: 10,
    color: Colors.dark.text,
    fontWeight: '500',
  },
  notes: {
    fontSize: 12,
    color: Colors.dark.subtext,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  actionButtons: {
    flexDirection: 'column',
    gap: 8,
    marginLeft: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  separator: {
    height: 1,
    backgroundColor: Colors.dark.divider,
    marginHorizontal: 16,
  },
});