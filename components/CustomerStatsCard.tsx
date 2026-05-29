import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Users, TrendingUp, DollarSign, Repeat } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { CustomerStats } from '@/types';

interface CustomerStatsCardProps {
  stats: CustomerStats;
}

export default function CustomerStatsCard({ stats }: CustomerStatsCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const getInteractionTypeLabel = (type: string) => {
    switch (type) {
      case 'view':
        return 'Views';
      case 'like':
        return 'Likes';
      case 'comment':
        return 'Comments';
      case 'share':
        return 'Shares';
      case 'purchase':
        return 'Purchases';
      default:
        return type;
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Customer Overview</Text>
      
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <View style={styles.statIconContainer}>
            <Users size={24} color={Colors.dark.primary} />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statValue}>{stats.totalCustomers}</Text>
            <Text style={styles.statLabel}>Total Customers</Text>
            <Text style={styles.statSubtext}>
              +{stats.newCustomersThisMonth} this month
            </Text>
          </View>
        </View>

        <View style={styles.statCard}>
          <View style={styles.statIconContainer}>
            <DollarSign size={24} color="#4CAF50" />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statValue}>{formatCurrency(stats.totalRevenue)}</Text>
            <Text style={styles.statLabel}>Total Revenue</Text>
            <Text style={styles.statSubtext}>
              {formatCurrency(stats.averageSpentPerCustomer)} avg per customer
            </Text>
          </View>
        </View>

        <View style={styles.statCard}>
          <View style={styles.statIconContainer}>
            <TrendingUp size={24} color="#FFA500" />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statValue}>{getInteractionTypeLabel(stats.topInteractionType)}</Text>
            <Text style={styles.statLabel}>Top Interaction</Text>
            <Text style={styles.statSubtext}>Most common activity</Text>
          </View>
        </View>

        <View style={styles.statCard}>
          <View style={styles.statIconContainer}>
            <Repeat size={24} color="#2196F3" />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statValue}>{formatPercentage(stats.repeatCustomerRate)}</Text>
            <Text style={styles.statLabel}>Repeat Rate</Text>
            <Text style={styles.statSubtext}>Customer retention</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  statIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  statContent: {
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginBottom: 2,
  },
  statSubtext: {
    fontSize: 10,
    color: Colors.dark.subtext,
    opacity: 0.8,
  },
});