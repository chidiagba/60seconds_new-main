import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import Colors from '@/constants/colors';
import { TimeAnalyticsData } from '@/types/analytics';

interface TimeAnalyticsProps {
  data: TimeAnalyticsData[];
  isPreview?: boolean;
  eventId?: string;
}

export default function TimeAnalytics({ data, isPreview = false, eventId }: TimeAnalyticsProps) {
  const [timeFrame, setTimeFrame] = useState('daily');
  
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };
  
  // Find the maximum value for scaling
  const maxValue = Math.max(...data.map(item => item.revenue));
  
  // Calculate bar heights based on the maximum value
  const calculateBarHeight = (value: number) => {
    const maxBarHeight = 150;
    return value > 0 ? (value / maxValue) * maxBarHeight : 0;
  };
  
  // Get appropriate data based on time frame
  const getFilteredData = () => {
    if (isPreview) {
      return data.slice(0, 7);
    }
    return data;
  };
  
  const filteredData = getFilteredData();
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Sales Over Time</Text>
        
        {!isPreview && (
          <View style={styles.timeFrameSelector}>
            <TouchableOpacity
              style={[styles.timeFrameButton, timeFrame === 'daily' && styles.activeTimeFrame]}
              onPress={() => setTimeFrame('daily')}
            >
              <Text style={[styles.timeFrameText, timeFrame === 'daily' && styles.activeTimeFrameText]}>
                Daily
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.timeFrameButton, timeFrame === 'weekly' && styles.activeTimeFrame]}
              onPress={() => setTimeFrame('weekly')}
            >
              <Text style={[styles.timeFrameText, timeFrame === 'weekly' && styles.activeTimeFrameText]}>
                Weekly
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.timeFrameButton, timeFrame === 'monthly' && styles.activeTimeFrame]}
              onPress={() => setTimeFrame('monthly')}
            >
              <Text style={[styles.timeFrameText, timeFrame === 'monthly' && styles.activeTimeFrameText]}>
                Monthly
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      
      {filteredData.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No time-based data available</Text>
        </View>
      ) : (
        <>
          <View style={styles.chartContainer}>
            {filteredData.map((item, index) => (
              <View key={index} style={styles.barContainer}>
                <View style={styles.barLabelContainer}>
                  <Text style={styles.barValue}>{formatCurrency(item.revenue)}</Text>
                </View>
                
                <View style={styles.barWrapper}>
                  <View 
                    style={[
                      styles.bar, 
                      { 
                        height: calculateBarHeight(item.revenue),
                        backgroundColor: item.revenue > (maxValue * 0.7) 
                          ? Colors.dark.primary 
                          : 'rgba(138, 43, 226, 0.6)'
                      }
                    ]} 
                  />
                </View>
                
                <Text style={styles.barLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          
          <View style={styles.summaryContainer}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Revenue</Text>
              <Text style={styles.summaryValue}>
                {formatCurrency(filteredData.reduce((sum, item) => sum + item.revenue, 0))}
              </Text>
            </View>
            
            <View style={styles.summaryDivider} />
            
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Orders</Text>
              <Text style={styles.summaryValue}>
                {filteredData.reduce((sum, item) => sum + item.orders, 0)}
              </Text>
            </View>
            
            <View style={styles.summaryDivider} />
            
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Avg. Order Value</Text>
              <Text style={styles.summaryValue}>
                {formatCurrency(
                  filteredData.reduce((sum, item) => sum + item.revenue, 0) / 
                  filteredData.reduce((sum, item) => sum + item.orders, 0) || 0
                )}
              </Text>
            </View>
          </View>
        </>
      )}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  timeFrameSelector: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.background,
    borderRadius: 20,
    padding: 2,
  },
  timeFrameButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 18,
  },
  activeTimeFrame: {
    backgroundColor: Colors.dark.primary,
  },
  timeFrameText: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  activeTimeFrameText: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 200,
    marginBottom: 16,
  },
  barContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barLabelContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  barValue: {
    fontSize: 10,
    color: Colors.dark.subtext,
    marginBottom: 4,
  },
  barWrapper: {
    width: '60%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: 150,
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  barLabel: {
    fontSize: 10,
    color: Colors.dark.subtext,
    marginTop: 8,
    textAlign: 'center',
  },
  summaryContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.background,
    borderRadius: 12,
    padding: 12,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: Colors.dark.divider,
    marginHorizontal: 8,
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    color: Colors.dark.subtext,
  },
});