import React, { useEffect, useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  ActivityIndicator,
  Linking
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { 
  ArrowLeft, 
  ArrowUpRight, 
  ArrowDownLeft, 
  CreditCard, 
  DollarSign, 
  ShoppingBag, 
  RefreshCw, 
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  Smartphone
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWalletStore } from '@/store/wallet-store';
import { useAuthStore } from '@/store/auth-store';
import { Transaction } from '@/types/wallet';
import { formatCurrency, normalizeCurrencyCode } from '@/constants/currencies';

export default function TransactionDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const { transactions, fetchWallet, fetchTransactions, isLoading, selectedCurrency } = useWalletStore();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  
  useEffect(() => {
    const loadTransaction = async () => {
      if (transactions.length === 0) {
        await fetchWallet();
        await fetchTransactions();
        return;
      }

      const foundTransaction = transactions.find(tx => String(tx.id) === String(id));
      setTransaction(foundTransaction || null);
    };

    loadTransaction();
  }, [fetchTransactions, fetchWallet, id, transactions]);
  
  useEffect(() => {
    if (transactions.length > 0) {
      const foundTransaction = transactions.find(tx => String(tx.id) === String(id));
      setTransaction(foundTransaction || null);
    }
  }, [transactions]);
  
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(user?.isBusinessAccount ? '/(tabsbusiness)/wallet' : '/transactions');
  };
  
  const getTransactionIcon = () => {
    if (!transaction) return null;
    
    const isTwint = transaction.metadata?.paymentProvider === 'twint';
    
    switch (transaction.type) {
      case 'deposit':
        if (isTwint) {
          return <Smartphone size={32} color="#ED0039" />;
        }
        return <ArrowDownLeft size={32} color={Colors.dark.success} />;
      case 'withdrawal':
        return <ArrowUpRight size={32} color={Colors.dark.error} />;
      case 'payment':
        if (transaction.status === 'failed') {
          return <AlertCircle size={32} color={Colors.dark.error} />;
        }
        if (isTwint) {
          return <Smartphone size={32} color="#ED0039" />;
        }
        return <ShoppingBag size={32} color={Colors.dark.primary} />;
      case 'refund':
        return <RefreshCw size={32} color={Colors.dark.success} />;
      case 'transfer':
        return <ArrowUpRight size={32} color={transaction.amount > 0 ? Colors.dark.success : Colors.dark.error} />;
      case 'fee':
        return <DollarSign size={32} color={Colors.dark.warning} />;
      default:
        return <CreditCard size={32} color={Colors.dark.primary} />;
    }
  };
  
  const getTransactionTitle = () => {
    if (!transaction) return '';
    
    const isTwint = transaction.metadata?.paymentProvider === 'twint';
    
    switch (transaction.type) {
      case 'deposit':
        return isTwint ? 'Twint Deposit' : 'Added Funds';
      case 'withdrawal':
        return 'Withdrawal';
      case 'payment':
        return isTwint ? 'Twint Payment' : 'Payment';
      case 'refund':
        return 'Refund';
      case 'transfer':
        return transaction.amount > 0 ? 'Received Transfer' : 'Sent Transfer';
      case 'fee':
        return 'Platform Fee';
      default:
        return 'Transaction';
    }
  };
  
  const getStatusIcon = () => {
    if (!transaction) return null;
    
    switch (transaction.status) {
      case 'completed':
        return <CheckCircle size={20} color={Colors.dark.success} />;
      case 'pending':
        return <Clock size={20} color={Colors.dark.warning} />;
      case 'failed':
        return <XCircle size={20} color={Colors.dark.error} />;
      case 'cancelled':
        return <XCircle size={20} color={Colors.dark.error} />;
      default:
        return null;
    }
  };
  
  const getStatusColor = () => {
    if (!transaction) return Colors.dark.subtext;
    
    switch (transaction.status) {
      case 'completed':
        return Colors.dark.success;
      case 'pending':
        return Colors.dark.warning;
      case 'failed':
        return Colors.dark.error;
      case 'cancelled':
        return Colors.dark.error;
      default:
        return Colors.dark.subtext;
    }
  };
  
  const formatDate = (dateInput?: string) => {
    if (!dateInput) return 'Date unavailable';

    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      return 'Date unavailable';
    }

    return date.toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };
  
  const handleOpenTwint = () => {
    if (!transaction?.metadata?.twintTransactionId) return;
    
    // In a real app, this would open the Twint app with the transaction details
    // For now, we'll just open the Twint website
    Linking.openURL('https://www.twint.ch/en/');
  };
  
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }
  
  if (!transaction) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Transaction Details</Text>
          <View style={styles.placeholder} />
        </View>
        
        <View style={styles.notFoundContainer}>
          <AlertCircle size={48} color={Colors.dark.error} />
          <Text style={styles.notFoundText}>Transaction not found</Text>
          <TouchableOpacity style={styles.backToTransactionsButton} onPress={handleBack}>
            <Text style={styles.backToTransactionsText}>Back to Transactions</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  
  const isTwintTransaction = transaction.metadata?.paymentProvider === 'twint';
  const metadata = (transaction.metadata || {}) as Record<string, any>;
  const isOwnerCreditEntry = String(metadata.entry || '').trim() === 'owner_credit';
  const detailCurrency = normalizeCurrencyCode(metadata.currency, selectedCurrency);
  const formattedAmount = formatCurrency(transaction.amount, detailCurrency);
  const signedFormattedAmount = `${transaction.amount > 0 ? '+' : ''}${formattedAmount}`;
  const walletImpact = transaction.amount > 0 ? 'Credit to wallet' : 'Debit from wallet';
  const metadataAmount = (key: string) => {
    const value = Number(metadata[key]);
    return Number.isFinite(value) ? formatCurrency(value, detailCurrency) : null;
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Transaction Details</Text>
        <View style={styles.placeholder} />
      </View>
      
      <ScrollView style={styles.content}>
        <View style={[
          styles.transactionHeader,
          isTwintTransaction && styles.twintTransactionHeader
        ]}>
          <View style={[
            styles.iconContainer,
            isTwintTransaction && styles.twintIconContainer
          ]}>
            {getTransactionIcon()}
          </View>
          
          <Text style={styles.transactionTitle}>{getTransactionTitle()}</Text>
          
          <Text style={[
            styles.transactionAmount,
            transaction.amount > 0 ? styles.positiveAmount : styles.negativeAmount
          ]}>
            {signedFormattedAmount}
          </Text>
          
          <View style={[styles.statusContainer, { backgroundColor: `${getStatusColor()}20` }]}>
            {getStatusIcon()}
            <Text style={[styles.statusText, { color: getStatusColor() }]}>
              {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
            </Text>
          </View>
          
          {isTwintTransaction && (
            <TouchableOpacity 
              style={styles.twintButton}
              onPress={handleOpenTwint}
            >
              <Smartphone size={16} color="#FFFFFF" />
              <Text style={styles.twintButtonText}>View in Twint</Text>
            </TouchableOpacity>
          )}
        </View>
        
        <View style={styles.detailsSection}>
          <Text style={styles.sectionTitle}>Transaction Details</Text>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Transaction ID</Text>
            <Text style={styles.detailValue}>{transaction.id}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date & Time</Text>
            <Text style={styles.detailValue}>{formatDate(transaction.createdAt)}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Description</Text>
            <Text style={styles.detailValue}>{transaction.description}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Wallet Impact</Text>
            <Text style={styles.detailValue}>{walletImpact}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Type</Text>
            <Text style={styles.detailValue}>
              {transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)}
            </Text>
          </View>
          
          {transaction.transactionFee !== undefined && !isOwnerCreditEntry && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Platform Fee</Text>
              <Text style={styles.detailValue}>{formatCurrency(transaction.transactionFee, detailCurrency)}</Text>
            </View>
          )}
          
          {transaction.metadata?.subtotal !== undefined && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Subtotal</Text>
              <Text style={styles.detailValue}>{formatCurrency(transaction.metadata.subtotal, detailCurrency)}</Text>
            </View>
          )}
          
          {isTwintTransaction && transaction.metadata?.twintTransactionId && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Twint Transaction ID</Text>
              <Text style={styles.detailValue}>{transaction.metadata.twintTransactionId}</Text>
            </View>
          )}
        </View>
        
        {transaction.metadata && Object.keys(transaction.metadata).length > 0 && (
          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>Additional Information</Text>

            {metadata.entry && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Ledger Entry</Text>
                <Text style={styles.detailValue}>{String(metadata.entry).replace(/_/g, ' ')}</Text>
              </View>
            )}

            {metadata.gross_amount !== undefined && !isOwnerCreditEntry && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Gross Amount</Text>
                <Text style={styles.detailValue}>{metadataAmount('gross_amount')}</Text>
              </View>
            )}

            {metadata.platform_fee_amount !== undefined && !isOwnerCreditEntry && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Platform Fee</Text>
                <Text style={styles.detailValue}>{metadataAmount('platform_fee_amount')}</Text>
              </View>
            )}

            {metadata.net_amount !== undefined && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Net Added</Text>
                <Text style={styles.detailValue}>{metadataAmount('net_amount')}</Text>
              </View>
            )}

            {metadata.order_id && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Order ID</Text>
                <Text style={styles.detailValue}>{metadata.order_id}</Text>
              </View>
            )}

            {metadata.payment_reference && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Payment Reference</Text>
                <Text style={styles.detailValue}>{metadata.payment_reference}</Text>
              </View>
            )}
            
            {transaction.metadata.productId && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Product ID</Text>
                <Text style={styles.detailValue}>{transaction.metadata.productId}</Text>
              </View>
            )}
            
            {transaction.metadata.videoId && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Event ID</Text>
                <Text style={styles.detailValue}>{transaction.metadata.videoId}</Text>
              </View>
            )}
            
            {transaction.metadata.recipientId && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Recipient ID</Text>
                <Text style={styles.detailValue}>{transaction.metadata.recipientId}</Text>
              </View>
            )}
            
            {transaction.metadata.senderId && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Sender ID</Text>
                <Text style={styles.detailValue}>{transaction.metadata.senderId}</Text>
              </View>
            )}
            
            {transaction.metadata.paymentMethodId && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Payment Method ID</Text>
                <Text style={styles.detailValue}>{transaction.metadata.paymentMethodId}</Text>
              </View>
            )}
            
            {transaction.metadata.originalTransactionId && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Original Transaction ID</Text>
                <Text style={styles.detailValue}>{transaction.metadata.originalTransactionId}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
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
  },
  transactionHeader: {
    backgroundColor: Colors.dark.card,
    padding: 24,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  twintTransactionHeader: {
    backgroundColor: 'rgba(237, 0, 57, 0.05)',
    borderBottomColor: '#ED0039',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  twintIconContainer: {
    backgroundColor: 'rgba(237, 0, 57, 0.1)',
  },
  transactionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  transactionAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  positiveAmount: {
    color: Colors.dark.success,
  },
  negativeAmount: {
    color: Colors.dark.error,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
  twintButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ED0039',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 16,
  },
  twintButtonText: {
    color: '#FFFFFF',
    fontWeight: '500',
    marginLeft: 8,
  },
  detailsSection: {
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.dark.text,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  detailLabel: {
    fontSize: 14,
    color: Colors.dark.subtext,
  },
  detailValue: {
    fontSize: 14,
    color: Colors.dark.text,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },
  notFoundContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  notFoundText: {
    fontSize: 18,
    color: Colors.dark.text,
    marginTop: 16,
    marginBottom: 24,
  },
  backToTransactionsButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  backToTransactionsText: {
    color: Colors.dark.text,
    fontWeight: '600',
  },
});
