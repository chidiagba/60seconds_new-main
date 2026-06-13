import React, { useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, History } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWalletStore } from '@/store/wallet-store';
import { useAuthStore } from '@/store/auth-store';
import TransactionItem from '@/components/TransactionItem';
import { Transaction } from '@/types/wallet';

export default function TransactionsScreen() {
  const router = useRouter();
  const { ledger } = useLocalSearchParams<{ ledger?: string }>();
  const { user } = useAuthStore();
  const { transactions, fetchWallet, fetchTransactions, isLoading } = useWalletStore();
  
  useEffect(() => {
    const loadTransactions = async () => {
      await fetchWallet();
      await fetchTransactions();
    };

    loadTransactions();
  }, [fetchTransactions, fetchWallet]);
  
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(user?.isBusinessAccount ? '/(tabsbusiness)/wallet' : '/(tabs)/wallet');
  };
  
  const handleTransactionPress = (transaction: Transaction) => {
    router.push({
      pathname: '/transaction-details',
      params: { id: transaction.id }
    });
  };

  const isBusinessLedger = ledger === 'business' || user?.isBusinessAccount;
  const visibleTransactions = isBusinessLedger
    ? transactions.filter((transaction) => {
      const entry = String((transaction.metadata as any)?.entry || '').trim();
      if (entry === 'owner_credit' || entry === 'owner_withdrawal') return true;
      return transaction.type !== 'fee';
    })
    : transactions;
  
  const renderTransactionItem = ({ item }: { item: Transaction }) => (
    <TransactionItem 
      transaction={item} 
      onPress={handleTransactionPress}
    />
  );
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Transaction History</Text>
        <View style={styles.placeholder} />
      </View>
      
      {isLoading && visibleTransactions.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.primary} />
        </View>
      ) : visibleTransactions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <History size={64} color={Colors.dark.subtext} />
          <Text style={styles.emptyText}>No transactions yet</Text>
          <Text style={styles.emptySubtext}>Your transaction history will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={visibleTransactions}
          renderItem={renderTransactionItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.transactionsList}
        />
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
    marginTop: 40
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
  transactionsList: {
    backgroundColor: Colors.dark.card,
    margin: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  emptySubtext: {
    marginTop: 8,
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: 'center',
  },
});
