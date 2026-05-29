import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrendingUp, TrendingDown, DollarSign, ShoppingBag, Users, Clock } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { SalesData } from '@/types/analytics';

interface SalesOverviewProps {
  data: SalesData;
  eventId?: string;
}

export default function SalesOverview({ data, eventId }: SalesOverviewProps) {
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };
  
  const formatPercentage = (value: number) => {
    const isPositive = value >= 0;
    return `${isPositive ? '+' : ''}${value.toFixed(1)}%`;
  };
  
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sales Overview</Text>
      
      <View style={styles.statsGrid}>
        {/* Total Revenue */}
        <View style={styles.statCard}>
          <View style={styles.statHeader}>
            <View style={[styles.iconContainer, { backgroundColor: 'rgba(138, 43, 226, 0.1)' }]}>
              <DollarSign size={18} color={Colors.dark.primary} />
            </View>
            {data.revenueChange !== 0 && (
              <View style={[
                styles.changeIndicator,
                data.revenueChange > 0 ? styles.positiveChange : styles.negativeChange
              ]}>
                {data.revenueChange > 0 ? (
                  <TrendingUp size={12} color="#4CAF50" />
                ) : (
                  <TrendingDown size={12} color="#F44336" />
                )}
                <Text style={[
                  styles.changeText,
                  data.revenueChange > 0 ? styles.positiveChangeText : styles.negativeChangeText
                ]}>
                  {formatPercentage(data.revenueChange)}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.statValue}>{formatCurrency(data.totalRevenue)}</Text>
          <Text style={styles.statLabel}>Total Revenue</Text>
        </View>
        
        {/* Total Orders */}
        <View style={styles.statCard}>
          <View style={styles.statHeader}>
            <View style={[styles.iconContainer, { backgroundColor: 'rgba(76, 175, 80, 0.1)' }]}>
              <ShoppingBag size={18} color="#4CAF50" />
            </View>
            {data.ordersChange !== 0 && (
              <View style={[
                styles.changeIndicator,
                data.ordersChange > 0 ? styles.positiveChange : styles.negativeChange
              ]}>
                {data.ordersChange > 0 ? (
                  <TrendingUp size={12} color="#4CAF50" />
                ) : (
                  <TrendingDown size={12} color="#F44336" />
                )}
                <Text style={[
                  styles.changeText,
                  data.ordersChange > 0 ? styles.positiveChangeText : styles.negativeChangeText
                ]}>
                  {formatPercentage(data.ordersChange)}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.statValue}>{data.totalOrders}</Text>
          <Text style={styles.statLabel}>Total Orders</Text>
        </View>
        
        {/* Average Order Value */}
        <View style={styles.statCard}>
          <View style={styles.statHeader}>
            <View style={[styles.iconContainer, { backgroundColor: 'rgba(33, 150, 243, 0.1)' }]}>
              <DollarSign size={18} color="#2196F3" />
            </View>
            {data.aovChange !== 0 && (
              <View style={[
                styles.changeIndicator,
                data.aovChange > 0 ? styles.positiveChange : styles.negativeChange
              ]}>
                {data.aovChange > 0 ? (
                  <TrendingUp size={12} color="#4CAF50" />
                ) : (
                  <TrendingDown size={12} color="#F44336" />
                )}
                <Text style={[
                  styles.changeText,
                  data.aovChange > 0 ? styles.positiveChangeText : styles.negativeChangeText
                ]}>
                  {formatPercentage(data.aovChange)}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.statValue}>{formatCurrency(data.averageOrderValue)}</Text>
          <Text style={styles.statLabel}>Avg. Order Value</Text>
        </View>
        
        {/* Unique Customers */}
        <View style={styles.statCard}>
          <View style={styles.statHeader}>
            <View style={[styles.iconContainer, { backgroundColor: 'rgba(255, 152, 0, 0.1)' }]}>
              <Users size={18} color="#FF9800" />
            </View>
            {data.customersChange !== 0 && (
              <View style={[
                styles.changeIndicator,
                data.customersChange > 0 ? styles.positiveChange : styles.negativeChange
              ]}>
                {data.customersChange > 0 ? (
                  <TrendingUp size={12} color="#4CAF50" />
                ) : (
                  <TrendingDown size={12} color="#F44336" />
                )}
                <Text style={[
                  styles.changeText,
                  data.customersChange > 0 ? styles.positiveChangeText : styles.negativeChangeText
                ]}>
                  {formatPercentage(data.customersChange)}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.statValue}>{data.uniqueCustomers}</Text>
          <Text style={styles.statLabel}>Unique Customers</Text>
        </View>
      </View>
      
      <View style={styles.summaryContainer}>
        <View style={styles.summaryItem}>
          <View style={styles.summaryIconContainer}>
            <Clock size={16} color={Colors.dark.text} />
          </View>
          <View>
            <Text style={styles.summaryLabel}>Best Selling Time</Text>
            <Text style={styles.summaryValue}>{data.bestSellingTime}</Text>
          </View>
        </View>
        
        <View style={styles.summaryDivider} />
        
        <View style={styles.summaryItem}>
          <View style={styles.summaryIconContainer}>
            <ShoppingBag size={16} color={Colors.dark.text} />
          </View>
          <View>
            <Text style={styles.summaryLabel}>Best Selling Product</Text>
            <Text style={styles.summaryValue}>{data.bestSellingProduct}</Text>
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
    padding: 16,
    marginBottom: 20,
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
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statCard: {
    width: '48%',
    backgroundColor: Colors.dark.background,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  statHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  changeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
  },
  positiveChange: {
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
  },
  negativeChange: {
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
  },
  changeText: {
    fontSize: 10,
    marginLeft: 2,
  },
  positiveChangeText: {
    color: '#4CAF50',
  },
  negativeChangeText: {
    color: '#F44336',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  summaryContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.background,
    borderRadius: 12,
    padding: 12,
  },
  summaryItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.dark.text,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: Colors.dark.divider,
    marginHorizontal: 12,
  },
});