import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import WorldlineService from '@/lib/worldline';

interface TestResult {
  test: string;
  status: 'pending' | 'success' | 'error';
  message: string;
  data?: any;
}

export default function WorldlinePaymentTest() {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const addTestResult = (test: string, status: 'pending' | 'success' | 'error', message: string, data?: any) => {
    setTestResults(prev => [...prev, { test, status, message, data }]);
  };

  const runTests = async () => {
    setIsRunning(true);
    setTestResults([]);
    
    try {
      const worldline = WorldlineService.getInstance();
      
      // Test 1: Configuration Status
      addTestResult('Configuration', 'pending', 'Checking configuration...');
      const configStatus = worldline.getConfigStatus();
      
      if (configStatus.isConfigured) {
        addTestResult('Configuration', 'success', 'Real API keys detected', configStatus);
      } else {
        addTestResult('Configuration', 'success', 'Mock mode (no real keys)', configStatus);
      }
      
      // Test 2: Create Session
      addTestResult('Session Creation', 'pending', 'Creating session...');
      const session = await worldline.createSession({
        paymentContext: {
          amountOfMoney: {
            amount: 100.00,
            currencyCode: 'USD'
          },
          countryCode: 'US',
          locale: 'en_US',
          isRecurring: false
        }
      });
      
      if (session.success) {
        addTestResult('Session Creation', 'success', 'Session created successfully', {
          clientSessionId: session.data.clientSessionId,
          isMock: session.data.isMock
        });
      } else {
        addTestResult('Session Creation', 'error', session.message);
      }
      
      // Test 3: Direct Card Payment
      addTestResult('Direct Payment', 'pending', 'Processing test payment...');
      const payment = await worldline.processDirectCardPayment({
        email: 'test@example.com',
        amount: 100.00,
        currency: 'USD',
        reference: `test_ref_${Date.now()}`,
        cardNumber: '4111111111111111', // Test Visa card
        expiryMonth: '12',
        expiryYear: '2025',
        cvv: '123',
        cardholderName: 'Test User',
        userId: 'test_user_123',
        paymentType: 'order_payment'
      });
      
      if (payment.success) {
        addTestResult('Direct Payment', 'success', 'Payment processed successfully', {
          reference: payment.data.reference,
          status: payment.data.status,
          amount: payment.data.amount
        });
      } else {
        addTestResult('Direct Payment', 'error', payment.message);
      }
      
      // Test 4: Payment Methods
      addTestResult('Payment Methods', 'pending', 'Getting payment methods...');
      const paymentMethods = await worldline.getPaymentMethods('test_user_123');
      
      if (paymentMethods.success) {
        addTestResult('Payment Methods', 'success', `Found ${paymentMethods.data.length} payment methods`);
      } else {
        addTestResult('Payment Methods', 'error', paymentMethods.message);
      }
      
      // Test 5: Payment History
      addTestResult('Payment History', 'pending', 'Getting payment history...');
      const history = await worldline.getPaymentHistory('test_user_123', 10, 0);
      
      if (history.success) {
        addTestResult('Payment History', 'success', `Found ${history.data.total} total payments`);
      } else {
        addTestResult('Payment History', 'error', history.message);
      }
      
      // Show success alert
      Alert.alert(
        'Test Complete!',
        'All Worldline integration tests have been completed. Check the results below.',
        [{ text: 'OK' }]
      );
      
    } catch (error: any) {
      addTestResult('General Error', 'error', error.message);
      Alert.alert('Test Error', error.message);
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return '#4CAF50';
      case 'error': return '#F44336';
      case 'pending': return '#FF9800';
      default: return '#9E9E9E';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'pending': return '⏳';
      default: return '❓';
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>🧪 Worldline Payment Test</Text>
      
      <TouchableOpacity
        style={[styles.button, isRunning && styles.buttonDisabled]}
        onPress={runTests}
        disabled={isRunning}
      >
        <Text style={styles.buttonText}>
          {isRunning ? 'Running Tests...' : 'Run Worldline Tests'}
        </Text>
      </TouchableOpacity>
      
      {testResults.length > 0 && (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsTitle}>Test Results:</Text>
          {testResults.map((result, index) => (
            <View key={index} style={styles.resultItem}>
              <View style={styles.resultHeader}>
                <Text style={styles.resultIcon}>
                  {getStatusIcon(result.status)}
                </Text>
                <Text style={styles.resultTest}>{result.test}</Text>
                <View
                  style={[
                    styles.statusIndicator,
                    { backgroundColor: getStatusColor(result.status) }
                  ]}
                />
              </View>
              <Text style={styles.resultMessage}>{result.message}</Text>
              {result.data && (
                <Text style={styles.resultData}>
                  {JSON.stringify(result.data, null, 2)}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
      
      <View style={styles.infoContainer}>
        <Text style={styles.infoTitle}>Test Information:</Text>
        <Text style={styles.infoText}>
          • This test will verify your Worldline integration
        </Text>
        <Text style={styles.infoText}>
          • Uses test card: 4111111111111111
        </Text>
        <Text style={styles.infoText}>
          • Tests session creation, payments, and data retrieval
        </Text>
        <Text style={styles.infoText}>
          • Safe to run multiple times
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: '#333',
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  resultsContainer: {
    marginBottom: 20,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  resultItem: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#ddd',
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  resultIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  resultTest: {
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
    color: '#333',
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  resultMessage: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  resultData: {
    fontSize: 12,
    color: '#888',
    fontFamily: 'monospace',
    backgroundColor: '#f0f0f0',
    padding: 8,
    borderRadius: 4,
  },
  infoContainer: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
});







