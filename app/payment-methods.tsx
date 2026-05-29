import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Plus } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWalletStore } from '@/store/wallet-store';
import PaymentMethodItem from '@/components/PaymentMethodItem';

export default function PaymentMethodsScreen() {
  const router = useRouter();
  const { 
    paymentMethods, 
    fetchPaymentMethods, 
    removePaymentMethod, 
    setDefaultPaymentMethod,
    isLoading 
  } = useWalletStore();
  
  useEffect(() => {
    console.log('🔍 Payment methods screen mounted, fetching payment methods...');
    fetchPaymentMethods();
  }, []);
  
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/wallet');
  };
  
  const handleAddPaymentMethod = () => {
    router.push('/add-payment-method');
  };
  
  const handleDeletePaymentMethod = (id: string) => {
    Alert.alert(
      "Remove Payment Method",
      "Are you sure you want to remove this payment method?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Remove", 
          style: "destructive",
          onPress: async () => {
            const success = await removePaymentMethod(id);
            if (success) {
              Alert.alert("Success", "Payment method removed successfully.");
            }
          }
        }
      ]
    );
  };
  
  const handleSetDefaultPaymentMethod = async (id: string) => {
    const success = await setDefaultPaymentMethod(id);
    if (success) {
      Alert.alert("Success", "Default payment method updated successfully.");
    }
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Payment Methods</Text>
        <View style={styles.placeholder} />
      </View>
      
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.primary} />
          <Text style={styles.loadingText}>Loading payment methods...</Text>
          <Text style={styles.debugText}>
            Debug: isLoading={isLoading.toString()}, paymentMethods.length={paymentMethods.length}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.content}>
          {paymentMethods.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No payment methods added yet</Text>
              <Text style={styles.emptySubtext}>
                Add a payment method to easily add funds to your wallet
              </Text>
            </View>
          ) : (
            paymentMethods.map((paymentMethod) => (
              <PaymentMethodItem
                key={paymentMethod.id}
                paymentMethod={paymentMethod}
                onDelete={handleDeletePaymentMethod}
                onSetDefault={!paymentMethod.isDefault ? handleSetDefaultPaymentMethod : undefined}
              />
            ))
          )}
          
          <TouchableOpacity 
            style={styles.addButton}
            onPress={handleAddPaymentMethod}
          >
            <Plus size={20} color={Colors.dark.text} />
            <Text style={styles.addButtonText}>Add Payment Method</Text>
          </TouchableOpacity>
          
          <View style={styles.infoContainer}>
            <Text style={styles.infoTitle}>About Payment Methods</Text>
            <Text style={styles.infoText}>
              • Your payment information is securely stored
            </Text>
            <Text style={styles.infoText}>
              • Set a default payment method for quick transactions
            </Text>
            <Text style={styles.infoText}>
              • You can add multiple payment methods for convenience
            </Text>
          </View>
        </ScrollView>
      )}
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
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
    marginTop:40
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: Colors.dark.text,
    marginTop: 16,
    marginBottom: 8,
  },
  debugText: {
    fontSize: 12,
    color: Colors.dark.subtext,
    textAlign: 'center',
    marginTop: 8,
  },
  emptyContainer: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.dark.subtext,
    textAlign: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  addButtonText: {
    color: Colors.dark.text,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  infoContainer: {
    backgroundColor: 'rgba(65, 105, 225, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.secondary,
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: Colors.dark.text,
    marginBottom: 8,
  },
});