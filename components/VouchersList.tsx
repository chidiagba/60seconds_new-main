import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import { Tag, Clock, Trash2, Edit, ToggleLeft, ToggleRight, Share2 } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Voucher } from '@/types';
import { useVoucherStore } from '@/store/voucher-store';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

interface VouchersListProps {
  businessId?: string;
  isManagement?: boolean;
}

export default function VouchersList({ businessId, isManagement = false }: VouchersListProps) {
  const router = useRouter();
  const { vouchers, fetchVouchers, toggleVoucherStatus, deleteVoucher, isLoading } = useVoucherStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadVouchers();
  }, [businessId]);

  const loadVouchers = async () => {
    await fetchVouchers(businessId);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadVouchers();
    setRefreshing(false);
  };

  const handleToggleStatus = async (voucherId: string) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    const success = await toggleVoucherStatus(voucherId);
    if (success) {
      Alert.alert('Success', 'Voucher status updated successfully');
    }
  };

  const handleDeleteVoucher = (voucher: Voucher) => {
    Alert.alert(
      'Delete Voucher',
      `Are you sure you want to delete the voucher "${voucher.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
            
            const success = await deleteVoucher(voucher.id);
            if (success) {
              Alert.alert('Success', 'Voucher deleted successfully');
            }
          }
        }
      ]
    );
  };

  const handleEditVoucher = (voucher: Voucher) => {
    router.push({
      pathname: '/edit-voucher',
      params: { id: voucher.id }
    });
  };

  const handleShareVoucher = async (voucher: Voucher) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    await Clipboard.setStringAsync(voucher.code);
    
    Alert.alert(
      'Voucher Code Copied',
      `The voucher code "${voucher.code}" has been copied to your clipboard. You can now share it with your customers.`,
      [{ text: 'OK' }]
    );
  };

  const formatExpiryDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const renderVoucherItem = ({ item }: { item: Voucher }) => {
    const isExpired = new Date() > new Date(item.expiryDate);
    const isLimitReached = item.usageCount >= item.usageLimit;
    const isDisabled = isExpired || isLimitReached || !item.isActive;
    
    return (
      <View style={[
        styles.voucherCard,
        isDisabled && styles.disabledVoucher
      ]}>
        <View style={styles.voucherHeader}>
          <View style={styles.voucherTitleContainer}>
            <Text style={styles.voucherName}>{item.name}</Text>
            {isManagement && (
              <View style={[
                styles.statusBadge,
                item.isActive ? styles.activeBadge : styles.inactiveBadge
              ]}>
                <Text style={styles.statusText}>
                  {item.isActive ? 'Active' : 'Inactive'}
                </Text>
              </View>
            )}
          </View>
          
          <Text style={styles.voucherCode}>{item.code}</Text>
        </View>
        
        <View style={styles.voucherDetails}>
          <Text style={styles.voucherDescription}>{item.description}</Text>
          
          <View style={styles.voucherMeta}>
            <View style={styles.metaItem}>
              <Tag size={14} color={Colors.dark.primary} />
              <Text style={styles.metaText}>
                {item.discountType === 'percentage' 
                  ? `${item.discountValue}% off` 
                  : `$${item.discountValue.toFixed(2)} off`}
              </Text>
            </View>
            
            <View style={styles.metaItem}>
              <Clock size={14} color={Colors.dark.primary} />
              <Text style={[
                styles.metaText,
                isExpired && styles.expiredText
              ]}>
                {isExpired ? 'Expired' : `Expires: ${formatExpiryDate(item.expiryDate)}`}
              </Text>
            </View>
          </View>
          
          <View style={styles.usageContainer}>
            <Text style={styles.usageText}>
              Used {item.usageCount} of {item.usageLimit} times
            </Text>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill,
                  { width: `${(item.usageCount / item.usageLimit) * 100}%` }
                ]} 
              />
            </View>
          </View>
          
          {isManagement && (
            <View style={styles.actionButtons}>
              <TouchableOpacity 
                style={styles.actionButton}
                onPress={() => handleToggleStatus(item.id)}
              >
                {item.isActive ? (
                  <ToggleRight size={20} color={Colors.dark.primary} />
                ) : (
                  <ToggleLeft size={20} color={Colors.dark.inactive} />
                )}
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.actionButton}
                onPress={() => handleEditVoucher(item)}
              >
                <Edit size={20} color={Colors.dark.text} />
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.actionButton}
                onPress={() => handleShareVoucher(item)}
              >
                <Share2 size={20} color={Colors.dark.secondary} />
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.actionButton}
                onPress={() => handleDeleteVoucher(item)}
              >
                <Trash2 size={20} color="#FF5252" />
              </TouchableOpacity>
            </View>
          )}
          
          {!isManagement && (
            <TouchableOpacity 
              style={styles.shareButton}
              onPress={() => handleShareVoucher(item)}
            >
              <Share2 size={16} color={Colors.dark.text} />
              <Text style={styles.shareButtonText}>Share Voucher</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {isManagement && (
        <View style={styles.header}>
          <Text style={styles.title}>Your Vouchers</Text>
          <TouchableOpacity 
            style={styles.createButton}
            onPress={() => router.push('/create-voucher')}
          >
            <Text style={styles.createButtonText}>Create New</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {vouchers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Tag size={48} color={Colors.dark.subtext} />
          <Text style={styles.emptyText}>
            {isManagement 
              ? "You haven't created any vouchers yet" 
              : "No vouchers available"}
          </Text>
          {isManagement && (
            <TouchableOpacity 
              style={styles.emptyCreateButton}
              onPress={() => router.push('/create-voucher')}
            >
              <Text style={styles.emptyCreateButtonText}>Create Your First Voucher</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={vouchers}
          renderItem={renderVoucherItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.vouchersList}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  createButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  createButtonText: {
    color: Colors.dark.text,
    fontWeight: '500',
    fontSize: 14,
  },
  vouchersList: {
    padding: 16,
  },
  voucherCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    borderLeftWidth: 4,
    borderLeftColor: Colors.dark.primary,
  },
  disabledVoucher: {
    opacity: 0.7,
    borderLeftColor: Colors.dark.inactive,
  },
  voucherHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  voucherTitleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  voucherName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  activeBadge: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
  },
  inactiveBadge: {
    backgroundColor: 'rgba(158, 158, 158, 0.2)',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.dark.text,
  },
  voucherCode: {
    fontSize: 20,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: Colors.dark.primary,
    letterSpacing: 1,
  },
  voucherDetails: {
    padding: 16,
  },
  voucherDescription: {
    fontSize: 14,
    color: Colors.dark.text,
    marginBottom: 12,
  },
  voucherMeta: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  metaText: {
    fontSize: 13,
    color: Colors.dark.subtext,
    marginLeft: 4,
  },
  expiredText: {
    color: '#FF5252',
  },
  usageContainer: {
    marginBottom: 16,
  },
  usageText: {
    fontSize: 13,
    color: Colors.dark.subtext,
    marginBottom: 4,
  },
  progressBar: {
    height: 4,
    backgroundColor: Colors.dark.background,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.dark.primary,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
    paddingVertical: 10,
    borderRadius: 8,
  },
  shareButtonText: {
    color: Colors.dark.text,
    fontWeight: '500',
    marginLeft: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyCreateButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  emptyCreateButtonText: {
    color: Colors.dark.text,
    fontWeight: '600',
  },
});