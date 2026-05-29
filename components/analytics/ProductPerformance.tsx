import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { ChevronRight, TrendingUp, TrendingDown } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { ProductPerformanceData } from '@/types/analytics';

interface ProductPerformanceProps {
  data: ProductPerformanceData[];
  isPreview?: boolean;
  eventId?: string;
}

export default function ProductPerformance({ data, isPreview = false, eventId }: ProductPerformanceProps) {
  const router = useRouter();
  
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };
  
  const formatPercentage = (value: number) => {
    const isPositive = value >= 0;
    return `${isPositive ? '+' : ''}${value.toFixed(1)}%`;
  };
  
  const handleViewAllProducts = () => {
    router.push('/business/analytics?tab=products');
  };
  
  const handleProductPress = (productId: string) => {
    // Navigate to product details
    router.push(`/product/${productId}`);
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Product Performance</Text>
        {isPreview && (
          <TouchableOpacity style={styles.viewAllButton} onPress={handleViewAllProducts}>
            <Text style={styles.viewAllText}>View All</Text>
            <ChevronRight size={16} color={Colors.dark.primary} />
          </TouchableOpacity>
        )}
      </View>
      
      {data.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No product data available</Text>
        </View>
      ) : (
        <>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, { flex: 2 }]}>Product</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'center' }]}>Sold</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Revenue</Text>
          </View>
          
          <ScrollView>
            {data.map((product, index) => (
              <TouchableOpacity 
                key={product.id}
                style={[
                  styles.productRow,
                  index === data.length - 1 && styles.lastProductRow
                ]}
                onPress={() => handleProductPress(product.id)}
              >
                <View style={[styles.productInfo, { flex: 2 }]}>
                  <Image
                    source={{ uri: product.image }}
                    style={styles.productImage}
                    contentFit="cover"
                    transition={300}
                  />
                  <View>
                    <Text style={styles.productName} numberOfLines={1}>{product.name}</Text>
                    <Text style={styles.productType}>{product.type}</Text>
                  </View>
                </View>
                
                <View style={[styles.soldInfo, { flex: 1 }]}>
                  <Text style={styles.soldCount}>{product.sold}</Text>
                  <View style={[
                    styles.changeIndicator,
                    product.soldChange > 0 ? styles.positiveChange : styles.negativeChange
                  ]}>
                    {product.soldChange > 0 ? (
                      <TrendingUp size={10} color="#4CAF50" />
                    ) : (
                      <TrendingDown size={10} color="#F44336" />
                    )}
                    <Text style={[
                      styles.changeText,
                      product.soldChange > 0 ? styles.positiveChangeText : styles.negativeChangeText
                    ]}>
                      {formatPercentage(product.soldChange)}
                    </Text>
                  </View>
                </View>
                
                <View style={[styles.revenueInfo, { flex: 1 }]}>
                  <Text style={styles.revenueAmount}>{formatCurrency(product.revenue)}</Text>
                  <View style={[
                    styles.changeIndicator,
                    product.revenueChange > 0 ? styles.positiveChange : styles.negativeChange
                  ]}>
                    {product.revenueChange > 0 ? (
                      <TrendingUp size={10} color="#4CAF50" />
                    ) : (
                      <TrendingDown size={10} color="#F44336" />
                    )}
                    <Text style={[
                      styles.changeText,
                      product.revenueChange > 0 ? styles.positiveChangeText : styles.negativeChangeText
                    ]}>
                      {formatPercentage(product.revenueChange)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
          
          <View style={styles.summaryContainer}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Products</Text>
              <Text style={styles.summaryValue}>{data.length}</Text>
            </View>
            
            <View style={styles.summaryDivider} />
            
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Sold</Text>
              <Text style={styles.summaryValue}>
                {data.reduce((sum, product) => sum + product.sold, 0)}
              </Text>
            </View>
            
            <View style={styles.summaryDivider} />
            
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Revenue</Text>
              <Text style={styles.summaryValue}>
                {formatCurrency(data.reduce((sum, product) => sum + product.revenue, 0))}
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
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewAllText: {
    fontSize: 14,
    color: Colors.dark.primary,
    marginRight: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
    marginBottom: 8,
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.dark.subtext,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  lastProductRow: {
    borderBottomWidth: 0,
  },
  productInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  productImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 12,
  },
  productName: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 2,
    width: 100, // Limit width to prevent overflow
  },
  productType: {
    fontSize: 12,
    color: Colors.dark.subtext,
    textTransform: 'capitalize',
  },
  soldInfo: {
    alignItems: 'center',
  },
  soldCount: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 2,
  },
  revenueInfo: {
    alignItems: 'flex-end',
  },
  revenueAmount: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 2,
  },
  changeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 8,
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
  summaryContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.background,
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
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