import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import WorldlinePaymentTest from '@/components/WorldlinePaymentTest';

export default function TestWorldlinePage() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Worldline Payment Test</Text>
        <Text style={styles.headerSubtitle}>
          Test your Worldline payment integration
        </Text>
      </View>
      
      <WorldlinePaymentTest />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#2196F3',
    padding: 20,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 5,
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'white',
    opacity: 0.9,
  },
});







