import {voucherExpiryInstant} from '@/utils/voucher-expiry';
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Tag, ChevronRight } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useVoucherStore } from '@/store/voucher-store';
import { Voucher } from '@/types';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/lib/supabase';

interface BusinessVouchersSectionProps {
  businessId: string;
}

export default function BusinessVouchersSection({ businessId }: BusinessVouchersSectionProps) {
  const router = useRouter();
  const { vouchers, fetchVouchers, isLoading } = useVoucherStore();
  
  useFocusEffect(React.useCallback(() => {
    const refresh=()=>{void fetchVouchers(businessId);};
    refresh();
    const channel=supabase.channel(`business-vouchers-${businessId}`).on('postgres_changes',{event:'*',schema:'public',table:'vouchers',filter:`business_id=eq.${businessId}`},refresh).subscribe();
    return ()=>{void supabase.removeChannel(channel);};
  }, [businessId,fetchVouchers]));
  
  const activeVouchers = vouchers.filter(voucher => 
    voucher.isActive && 
    voucherExpiryInstant(voucher.expiryDate) > Date.now() &&
    (voucher.usageLimit == null || voucher.usageCount < voucher.usageLimit)
  );
  
  if (activeVouchers.length === 0) {
    return null;
  }
  
  const formatExpiryDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
  };
  
  const renderVoucherItem = (voucher: Voucher) => {
    return (
      <View key={voucher.id} style={styles.voucherCard}>
        <View style={styles.voucherHeader}>
          <Text style={styles.voucherCode}>{voucher.code}</Text>
          <Text style={styles.expiryDate}>{voucher.expiryDate ? `Expires ${formatExpiryDate(voucher.expiryDate)}` : 'No expiry'}</Text>
        </View>
        
        <Text style={styles.voucherName}>{voucher.name}</Text>
        <Text style={styles.discountValue}>
          {voucher.discountType === 'percentage' 
            ? `${voucher.discountValue}% off` 
            : `${voucher.currency || ''} ${voucher.discountValue.toFixed(2)} off`}
        </Text>
        
        {voucher.minPurchaseAmount && (
          <Text style={styles.minPurchase}>
            Min. purchase: ${voucher.minPurchaseAmount.toFixed(2)}
          </Text>
        )}
      </View>
    );
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Tag size={18} color={Colors.dark.primary} />
          <Text style={styles.title}>Available Vouchers</Text>
        </View>
        
        <TouchableOpacity 
          style={styles.viewAllButton}
          onPress={() => router.push({
            pathname: '/business-vouchers',
            params: { businessId }
          })}
        >
          <Text style={styles.viewAllText}>View All</Text>
          <ChevronRight size={16} color={Colors.dark.primary} />
        </TouchableOpacity>
      </View>
      
      <ScrollView 
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.vouchersContainer}
      >
        {activeVouchers.slice(0, 5).map(renderVoucherItem)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginLeft: 8,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewAllText: {
    fontSize: 14,
    color: Colors.dark.primary,
    marginRight: 4,
  },
  vouchersContainer: {
    paddingHorizontal: 12,
  },
  voucherCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    width: 200,
    borderLeftWidth: 4,
    borderLeftColor: Colors.dark.primary,
  },
  voucherHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  voucherCode: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.dark.primary,
    letterSpacing: 1,
  },
  expiryDate: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  voucherName: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  discountValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  minPurchase: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
});