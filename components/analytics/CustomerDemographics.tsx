import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '@/constants/colors';
import { CustomerData } from '@/types/analytics';

interface CustomerDemographicsProps {
  data: CustomerData;
  eventId?: string;
  attendees?: any[];
}

export default function CustomerDemographics({ data, eventId, attendees }: CustomerDemographicsProps) {
  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`;
  };
  
  // Calculate total for each category
  const totalAge = data.ageGroups.reduce((sum, group) => sum + group.value, 0);
  const totalGender = data.genderDistribution.reduce((sum, group) => sum + group.value, 0);
  const totalLocation = data.locationDistribution.reduce((sum, location) => sum + location.value, 0);
  
  // Calculate percentages
  const agePercentages = data.ageGroups.map(group => ({
    ...group,
    percentage: (group.value / totalAge) * 100
  }));
  
  const genderPercentages = data.genderDistribution.map(group => ({
    ...group,
    percentage: (group.value / totalGender) * 100
  }));
  
  const locationPercentages = data.locationDistribution
    .map(location => ({
      ...location,
      percentage: (location.value / totalLocation) * 100
    }))
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 5); // Top 5 locations
  
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Customer Demographics</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Age Distribution</Text>
        <View style={styles.barChartContainer}>
          {agePercentages.map((group, index) => (
            <View key={index} style={styles.barGroup}>
              <View style={styles.barLabelContainer}>
                <Text style={styles.barLabel}>{group.label}</Text>
                <Text style={styles.barValue}>{formatPercentage(group.percentage)}</Text>
              </View>
              <View style={styles.barBackground}>
                <View 
                  style={[
                    styles.bar, 
                    { 
                      width: `${group.percentage}%`,
                      backgroundColor: group.percentage > 30 
                        ? Colors.dark.primary 
                        : 'rgba(138, 43, 226, 0.6)'
                    }
                  ]} 
                />
              </View>
            </View>
          ))}
        </View>
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Gender Distribution</Text>
        <View style={styles.pieChartContainer}>
          <View style={styles.pieChart}>
            {genderPercentages.map((gender, index) => {
              // Calculate the rotation and skew for the pie segments
              const startAngle = index === 0 ? 0 : 
                genderPercentages
                  .slice(0, index)
                  .reduce((sum, g) => sum + (g.percentage * 3.6), 0);
              
              const endAngle = startAngle + (gender.percentage * 3.6);
              
              return (
                <View 
                  key={index}
                  style={[
                    styles.pieSegment,
                    {
                      backgroundColor: gender.color,
                      transform: [
                        { rotate: `${startAngle}deg` },
                        { skewY: `${gender.percentage * 3.6}deg` }
                      ]
                    }
                  ]}
                />
              );
            })}
          </View>
          
          <View style={styles.pieLegend}>
            {genderPercentages.map((gender, index) => (
              <View key={index} style={styles.legendItem}>
                <View style={[styles.legendColor, { backgroundColor: gender.color }]} />
                <Text style={styles.legendLabel}>{gender.label}</Text>
                <Text style={styles.legendValue}>{formatPercentage(gender.percentage)}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top Locations</Text>
        <View style={styles.barChartContainer}>
          {locationPercentages.map((location, index) => (
            <View key={index} style={styles.barGroup}>
              <View style={styles.barLabelContainer}>
                <Text style={styles.barLabel}>{location.label}</Text>
                <Text style={styles.barValue}>{formatPercentage(location.percentage)}</Text>
              </View>
              <View style={styles.barBackground}>
                <View 
                  style={[
                    styles.bar, 
                    { 
                      width: `${location.percentage}%`,
                      backgroundColor: index === 0 
                        ? Colors.dark.primary 
                        : `rgba(138, 43, 226, ${0.8 - (index * 0.15)})`
                    }
                  ]} 
                />
              </View>
            </View>
          ))}
        </View>
      </View>
      
      <View style={styles.summaryContainer}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Total Customers</Text>
          <Text style={styles.summaryValue}>{data.totalCustomers}</Text>
        </View>
        
        <View style={styles.summaryDivider} />
        
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Repeat Customers</Text>
          <Text style={styles.summaryValue}>{formatPercentage(data.repeatCustomerRate)}</Text>
        </View>
        
        <View style={styles.summaryDivider} />
        
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Avg. Spend</Text>
          <Text style={styles.summaryValue}>${data.averageCustomerSpend.toFixed(2)}</Text>
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
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  barChartContainer: {
    marginTop: 8,
  },
  barGroup: {
    marginBottom: 12,
  },
  barLabelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  barLabel: {
    fontSize: 12,
    color: Colors.dark.text,
  },
  barValue: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  barBackground: {
    height: 8,
    backgroundColor: Colors.dark.background,
    borderRadius: 4,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 4,
  },
  pieChartContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  pieChart: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.dark.background,
    overflow: 'hidden',
    position: 'relative',
  },
  pieSegment: {
    position: 'absolute',
    width: '50%',
    height: '50%',
    top: 0,
    left: '50%',
    transformOrigin: '0% 100%',
  },
  pieLegend: {
    flex: 1,
    marginLeft: 24,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  legendLabel: {
    fontSize: 12,
    color: Colors.dark.text,
    flex: 1,
  },
  legendValue: {
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
});