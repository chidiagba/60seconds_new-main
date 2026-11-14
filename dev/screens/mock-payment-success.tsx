import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function MockPaymentSuccess() {
  const router = useRouter();
  const searchParams = useLocalSearchParams();
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    const ref = searchParams?.reference as string;
    if (ref) {
      setReference(ref);
      // Auto-close after 3 seconds
      setTimeout(() => {
        if (window.opener) {
          window.close();
        } else {
          router.back();
        }
      }, 3000);
    }
  }, [searchParams, router]);

  const handleClose = () => {
    if (window.opener) {
      window.close();
    } else {
      router.back();
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>✅</Text>
        <Text style={styles.title}>Mock Payment Successful!</Text>
        <Text style={styles.subtitle}>
          This is a test payment for development purposes.
        </Text>
        
        {reference && (
          <View style={styles.referenceContainer}>
            <Text style={styles.referenceLabel}>Reference:</Text>
            <Text style={styles.referenceValue}>{reference}</Text>
          </View>
        )}
        
        <View style={styles.infoContainer}>
          <Text style={styles.infoText}>
            • This is a mock payment for testing
          </Text>
          <Text style={styles.infoText}>
            • No real money was charged
          </Text>
          <Text style={styles.infoText}>
            • This window will close automatically
          </Text>
        </View>
        
        <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
          <Text style={styles.closeButtonText}>Close Window</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    maxWidth: 400,
    width: '100%',
  },
  icon: {
    fontSize: 64,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#28a745',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#6c757d',
    marginBottom: 20,
    textAlign: 'center',
  },
  referenceContainer: {
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    width: '100%',
  },
  referenceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 5,
  },
  referenceValue: {
    fontSize: 12,
    color: '#6c757d',
    fontFamily: 'monospace',
  },
  infoContainer: {
    marginBottom: 25,
    width: '100%',
  },
  infoText: {
    fontSize: 14,
    color: '#6c757d',
    marginBottom: 8,
    textAlign: 'left',
  },
  closeButton: {
    backgroundColor: '#007bff',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 6,
  },
  closeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});






