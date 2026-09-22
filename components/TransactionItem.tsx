import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  CreditCard, 
  DollarSign, 
  ShoppingBag, 
  RefreshCw, 
  AlertCircle,
  Smartphone
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { Transaction } from '@/types/wallet';
import { formatCurrency, normalizeCurrencyCode } from '@/constants/currencies';
import { useWalletStore } from '@/store/wallet-store';

interface TransactionItemProps {
  transaction: Transaction;
  onPress?: (transaction: Transaction) => void;
}

export default function TransactionItem({ transaction, onPress }: TransactionItemProps) {
  const router = useRouter();
  const selectedCurrency = useWalletStore((state) => state.selectedCurrency);
  const ledgerEntry = String((transaction.metadata as any)?.entry || '').trim();
  const provider = String((transaction.metadata as any)?.paymentProvider || (transaction.metadata as any)?.payment_provider || '').toLowerCase();
  const purchaseItems = Array.isArray((transaction.metadata as any)?.items)
    ? (transaction.metadata as any).items
    : [];
  const firstItem = purchaseItems[0] || {};
  const itemQuantity = purchaseItems.reduce(
    (sum: number, item: any) => sum + Math.max(1, Number(item?.quantity || 1)),
    0
  );
  const itemKind = String(firstItem?.type || '').toLowerCase();
  const itemName = String(firstItem?.name || firstItem?.product_name || '').trim();
  
  const getTransactionIcon = () => {
    const isTwint = transaction.metadata?.paymentProvider === 'twint';
    
    switch (transaction.type) {
      case 'deposit':
        if (isTwint) {
          return <Smartphone size={24} color="#ED0039" />;
        }
        return <ArrowDownLeft size={24} color={Colors.dark.success} />;
      case 'withdrawal':
        return <ArrowUpRight size={24} color={Colors.dark.error} />;
      case 'payment':
        if (transaction.status === 'failed') {
          return <AlertCircle size={24} color={Colors.dark.error} />;
        }
        if (isTwint) {
          return <Smartphone size={24} color="#ED0039" />;
        }
        return <ShoppingBag size={24} color={Colors.dark.primary} />;
      case 'refund':
        return <RefreshCw size={24} color={Colors.dark.success} />;
      case 'transfer':
        return <ArrowUpRight size={24} color={transaction.amount > 0 ? Colors.dark.success : Colors.dark.error} />;
      case 'fee':
        return <DollarSign size={24} color={Colors.dark.warning} />;
      default:
        return <CreditCard size={24} color={Colors.dark.primary} />;
    }
  };
  
  const getTransactionTitle = () => {
    if (ledgerEntry === 'owner_credit') {
      if (itemKind.includes('ticket')) return 'Ticket Sale';
      if (itemKind) return 'Product Sale';
      return 'Purchase Payment';
    }
    if (ledgerEntry === 'paystack_bank_settlement') {
      return transaction.status === 'completed' ? 'Bank Settlement' : 'Bank Settlement Pending';
    }
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

  const getDescription = () => {
    if (ledgerEntry === 'owner_credit') {
      const count = itemQuantity > 0 ? `${itemQuantity}× ` : '';
      const order = String((transaction.metadata as any)?.order_id || '').slice(0, 8);
      if (itemName) return `${count}${itemName}${purchaseItems.length > 1 ? ` +${purchaseItems.length - 1}` : ''}`;
      if (order) return `Paid order #${order}`;
      return provider === 'paystack' ? 'Paid purchase via Paystack' : 'Paid purchase';
    }
    if (ledgerEntry === 'paystack_bank_settlement') {
      const bank = String((transaction.metadata as any)?.bank_name || 'connected bank');
      const ending = String((transaction.metadata as any)?.bank_account_ending || '');
      return transaction.status === 'completed'
        ? `Paystack subaccount to ${bank}${ending ? ` • ${ending}` : ''}`
        : `Awaiting settlement to ${bank}${ending ? ` • ${ending}` : ''}`;
    }
    return String(transaction.description || 'Transaction');
  };
  
  const getStatusColor = () => {
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
  
  const formatDateTime = (dateInput?: string) => {
    if (!dateInput) return 'Date unavailable';

    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      return 'Date unavailable';
    }

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };
  
  const handlePress = () => {
    if (onPress) {
      onPress(transaction);
    } else {
      router.push({
        pathname: '/transaction-details',
        params: { id: transaction.id }
      });
    }
  };

  const transactionCurrency = normalizeCurrencyCode(
    (transaction.metadata as any)?.currency,
    selectedCurrency
  );
  const safeAmount = Number.isFinite(Number(transaction?.amount)) ? Number(transaction.amount) : 0;
  const isOutgoing = transaction.type === 'withdrawal' ||
    String((transaction.metadata as any)?.entry || '').trim() === 'owner_withdrawal' ||
    safeAmount < 0;
  const safeStatus = String(transaction?.status || 'pending').trim().toLowerCase();
  const formattedAmount = formatCurrency(Math.abs(safeAmount), transactionCurrency);
  
  return (
    <TouchableOpacity style={styles.container} onPress={handlePress}>
      <View style={[
        styles.iconContainer, 
        transaction.metadata?.paymentProvider === 'twint' && styles.twintIconContainer
      ]}>
        {getTransactionIcon()}
      </View>
      
      <View style={styles.detailsContainer}>
        <Text style={styles.title}>{getTransactionTitle()}</Text>
        <Text style={styles.description} numberOfLines={1}>
          {getDescription()}
        </Text>
        <Text style={styles.date}>{formatDateTime(transaction.createdAt)}</Text>
      </View>
      
      <View style={styles.amountContainer}>
        <Text style={[
          styles.amount, 
          !isOutgoing ? styles.positive : styles.negative
        ]}>
          {!isOutgoing ? '+' : '-'}{formattedAmount}
        </Text>
        
        <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor()}20` }]}>
          <Text style={[styles.statusText, { color: getStatusColor() }]}>
            {safeStatus.charAt(0).toUpperCase() + safeStatus.slice(1)}
          </Text>
        </View>
        
        {transaction.metadata?.paymentProvider === 'twint' && (
          <View style={styles.twintBadge}>
            <Smartphone size={10} color="#FFFFFF" />
            <Text style={styles.twintBadgeText}>Twint</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  twintIconContainer: {
    backgroundColor: 'rgba(237, 0, 57, 0.1)',
  },
  detailsContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 4,
  },
  date: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  positive: {
    color: Colors.dark.success,
  },
  negative: {
    color: Colors.dark.error,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  twintBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ED0039',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 4,
  },
  twintBadgeText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '500',
    marginLeft: 2,
  },
});
