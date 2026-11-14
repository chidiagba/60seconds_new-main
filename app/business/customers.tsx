import { logger } from '@/lib/logger';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Users, MessageCircle, Gift, Search, Filter, Plus, TrendingUp, DollarSign } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuthStore } from '@/store/auth-store';
import { useBusinessCustomerStore } from '@/store/business-customer-store';
import { CustomerFilters, InteractionType } from '@/types';
import BusinessCustomerList from '@/components/BusinessCustomerList';
import CustomerStatsCard from '@/components/CustomerStatsCard';
import CustomerFiltersModal from '@/components/CustomerFiltersModal';
import BulkActionModal from '@/components/BulkActionModal';

export default function BusinessCustomersScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { 
    customers, 
    stats, 
    isLoading, 
    error, 
    fetchCustomers, 
    fetchCustomerStats,
    sendMessageToMultipleCustomers,
    shareVoucherWithMultipleCustomers
  } = useBusinessCustomerStore();
  
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [showBulkActions, setShowBulkActions] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<CustomerFilters>({});
  const [refreshing, setRefreshing] = useState<boolean>(false);

  useEffect(() => {
    if (!user || !user.isBusinessAccount) {
      router.replace('/profile');
      return;
    }
    
    loadData();
  }, [user, router]);

  const loadData = async () => {
    try {
      await Promise.all([
        fetchCustomers(activeFilters),
        fetchCustomerStats()
      ]);
    } catch (error) {
      logger.error('Error loading customer data:', error);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    const filters: CustomerFilters = {
      ...activeFilters,
      search: query.trim() || undefined
    };
    await fetchCustomers(filters);
  };

  const handleApplyFilters = async (filters: CustomerFilters) => {
    setActiveFilters(filters);
    setShowFilters(false);
    await fetchCustomers(filters);
  };

  const handleClearFilters = async () => {
    setActiveFilters({});
    setSearchQuery('');
    await fetchCustomers();
  };

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomers(prev => {
      if (prev.includes(customerId)) {
        return prev.filter(id => id !== customerId);
      } else {
        return [...prev, customerId];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedCustomers.length === customers.length) {
      setSelectedCustomers([]);
    } else {
      setSelectedCustomers(customers.map(c => c.customerId));
    }
  };

  const handleBulkMessage = async (message: string) => {
    if (selectedCustomers.length === 0) return;
    
    const success = await sendMessageToMultipleCustomers(selectedCustomers, message);
    if (success) {
      Alert.alert('Success', `Message sent to ${selectedCustomers.length} customers`);
      setSelectedCustomers([]);
      setShowBulkActions(false);
    } else {
      Alert.alert('Error', 'Failed to send messages');
    }
  };

  const handleBulkVoucherShare = async (voucherId: string, message?: string) => {
    if (selectedCustomers.length === 0) return;
    
    const success = await shareVoucherWithMultipleCustomers(selectedCustomers, voucherId, message);
    if (success) {
      Alert.alert('Success', `Voucher shared with ${selectedCustomers.length} customers`);
      setSelectedCustomers([]);
      setShowBulkActions(false);
    } else {
      Alert.alert('Error', 'Failed to share vouchers');
    }
  };

  const getFilterCount = () => {
    let count = 0;
    if (activeFilters.interactionType) count++;
    if (activeFilters.dateRange) count++;
    if (activeFilters.minSpent !== undefined || activeFilters.maxSpent !== undefined) count++;
    if (activeFilters.tags && activeFilters.tags.length > 0) count++;
    return count;
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/profile');
  };

  if (!user || !user.isBusinessAccount) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Access denied. Business account required.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Customer Management</Text>
        <TouchableOpacity 
          style={styles.headerButton}
          onPress={() => router.push('/business/analytics')}
        >
          <TrendingUp size={24} color={Colors.dark.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.content}
      >
        {/* Stats Cards */}
        {stats && (
          <View style={styles.statsContainer}>
            <CustomerStatsCard stats={stats} />
          </View>
        )}

        {/* Search and Filters */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputContainer}>
            <Search size={20} color={Colors.dark.subtext} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search customers..."
              placeholderTextColor={Colors.dark.subtext}
              value={searchQuery}
              onChangeText={handleSearch}
            />
          </View>
          
          <TouchableOpacity 
            style={[styles.filterButton, getFilterCount() > 0 && styles.filterButtonActive]}
            onPress={() => setShowFilters(true)}
          >
            <Filter size={20} color={getFilterCount() > 0 ? Colors.dark.text : Colors.dark.subtext} />
            {getFilterCount() > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{getFilterCount()}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Selection Controls */}
        {customers.length > 0 && (
          <View style={styles.selectionContainer}>
            <TouchableOpacity style={styles.selectAllButton} onPress={handleSelectAll}>
              <Text style={styles.selectAllText}>
                {selectedCustomers.length === customers.length ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
            
            {selectedCustomers.length > 0 && (
              <TouchableOpacity 
                style={styles.bulkActionButton}
                onPress={() => setShowBulkActions(true)}
              >
                <MessageCircle size={16} color={Colors.dark.text} />
                <Text style={styles.bulkActionText}>
                  Actions ({selectedCustomers.length})
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Active Filters Display */}
        {getFilterCount() > 0 && (
          <View style={styles.activeFiltersContainer}>
            <Text style={styles.activeFiltersTitle}>Active Filters:</Text>
            <View style={styles.activeFiltersRow}>
              {activeFilters.interactionType && (
                <View style={styles.filterChip}>
                  <Text style={styles.filterChipText}>{activeFilters.interactionType}</Text>
                </View>
              )}
              {activeFilters.tags && activeFilters.tags.map(tag => (
                <View key={tag} style={styles.filterChip}>
                  <Text style={styles.filterChipText}>{tag}</Text>
                </View>
              ))}
              <TouchableOpacity style={styles.clearFiltersButton} onPress={handleClearFilters}>
                <Text style={styles.clearFiltersText}>Clear All</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Customer List */}
        {isLoading && customers.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.dark.primary} />
            <Text style={styles.loadingText}>Loading customers...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={loadData}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : customers.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Users size={60} color={Colors.dark.subtext} />
            <Text style={styles.emptyTitle}>No Customers Found</Text>
            <Text style={styles.emptyText}>
              {getFilterCount() > 0 
                ? 'No customers match your current filters. Try adjusting your search criteria.'
                : 'You don\'t have any customers yet. Start creating events to attract customers!'
              }
            </Text>
            {getFilterCount() > 0 && (
              <TouchableOpacity style={styles.clearFiltersButton} onPress={handleClearFilters}>
                <Text style={styles.clearFiltersButtonText}>Clear Filters</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <BusinessCustomerList
            customers={customers}
            selectedCustomers={selectedCustomers}
            onSelectCustomer={handleSelectCustomer}
            onCustomerPress={(customerId) => {
              logger.debug('Customer pressed:', customerId);
              Alert.alert('Customer Details', `Customer ID: ${customerId}`);
            }}
          />
        )}
      </ScrollView>

      {/* Modals */}
      <CustomerFiltersModal
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        onApplyFilters={handleApplyFilters}
        currentFilters={activeFilters}
      />

      <BulkActionModal
        visible={showBulkActions}
        onClose={() => setShowBulkActions(false)}
        selectedCount={selectedCustomers.length}
        onSendMessage={handleBulkMessage}
        onShareVoucher={handleBulkVoucherShare}
      />
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  statsContainer: {
    padding: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 16,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  filterButtonActive: {
    backgroundColor: Colors.dark.primary,
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FF5252',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  selectionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  selectAllButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.dark.card,
  },
  selectAllText: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  bulkActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.dark.primary,
    gap: 6,
  },
  bulkActionText: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '500',
  },
  activeFiltersContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  activeFiltersTitle: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  activeFiltersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  filterChipText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: '500',
  },
  clearFiltersButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  clearFiltersText: {
    color: Colors.dark.primary,
    fontSize: 12,
    fontWeight: '500',
  },
  clearFiltersButtonText: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: Colors.dark.text,
    fontSize: 16,
  },
  errorContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#FF5252',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
});