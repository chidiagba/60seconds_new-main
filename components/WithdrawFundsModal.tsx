import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  TextInput, 
  ScrollView, 
  Pressable,
  ActivityIndicator,
  Alert
} from 'react-native';
import { X, Landmark, AlertTriangle } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWalletStore } from '@/store/wallet-store';
import { BusinessBankAccount } from '@/types/wallet';
import { formatCurrency, getCurrencySymbol, normalizeCurrencyCode } from '@/constants/currencies';

interface WithdrawFundsModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function WithdrawFundsModal({ visible, onClose }: WithdrawFundsModalProps) {
  const { 
    wallet, 
    transactions,
    businessBankAccount, 
    fetchWallet,
    fetchTransactions,
    fetchBusinessBankAccount, 
    requestWithdrawal, 
    isLoading,
    selectedCurrency,
  } = useWalletStore();
  const [amount, setAmount] = useState('');
  const [showInsufficientDialog, setShowInsufficientDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const activeCurrency = normalizeCurrencyCode(businessBankAccount?.currency, selectedCurrency);
  const currencySymbol = getCurrencySymbol(activeCurrency);
  const formattedAmount = amount ? formatCurrency(parseFloat(amount), activeCurrency) : formatCurrency(0, activeCurrency);
  const usesDirectPayout =
    String(businessBankAccount?.countryCode || '').trim().toUpperCase() === 'NG' ||
    businessBankAccount?.payoutProvider === 'paystack';
  const claimableBalance = React.useMemo(() => {
    const isCompletedLike = (status?: string) => {
      const normalized = String(status || '').trim().toLowerCase();
      return normalized === 'completed' || normalized === 'success' || normalized === 'successful' || normalized === 'paid';
    };

    return Math.max(
      Number(wallet?.balance || 0),
      transactions
        .filter((tx) => isCompletedLike(tx.status))
        .reduce((sum, tx) => {
          const metadata = (tx.metadata || {}) as Record<string, any>;
          const entry = String(metadata.entry || '').trim();
          if (entry === 'owner_credit') return sum + Math.max(0, Number(tx.amount || 0));
          if (entry === 'owner_withdrawal' || tx.type === 'withdrawal') return sum - Math.abs(Number(tx.amount || 0));
          return sum;
        }, 0)
    );
  }, [transactions, wallet?.balance]);
  
  React.useEffect(() => {
    if (visible) {
      fetchBusinessBankAccount();
      fetchWallet();
      fetchTransactions();
      setAmount('');
      setShowInsufficientDialog(false);
      setShowSuccessDialog(false);
      setSuccessMessage('');
    }
  }, [visible]);
  
  const handleAmountChange = (text: string) => {
    // Only allow numbers and one decimal point
    const regex = /^\d*\.?\d{0,2}$/;
    if (regex.test(text)) {
      setAmount(text);
    }
  };
  
  const handleWithdraw = async () => {
    await fetchWallet();
    await fetchTransactions();
   
     // Recalculate balance AFTER fetching fresh transactions
     const freshTransactions = useWalletStore.getState().transactions;
     const freshWallet = useWalletStore.getState().wallet;
     const freshClaimableBalance = Math.max(
       Number(freshWallet?.balance || 0),
       freshTransactions
         .filter((tx) => {
           const normalized = String(tx.status || '').trim().toLowerCase();
           return normalized === 'completed' || normalized === 'success' || normalized === 'successful' || normalized === 'paid';
         })
         .reduce((sum, tx) => {
           const metadata = (tx.metadata || {}) as Record<string, any>;
           const entry = String(metadata.entry || '').trim();
           if (entry === 'owner_credit') return sum + Math.max(0, Number(tx.amount || 0));
           if (entry === 'owner_withdrawal' || tx.type === 'withdrawal') return sum - Math.abs(Number(tx.amount || 0));
           return sum;
         }, 0)
     );

    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    
    if (!businessBankAccount) {
      Alert.alert('Bank Account Required', 'Please add a bank account to your profile.');
      return;
    }
    
     if (parseFloat(amount) > freshClaimableBalance) {
      setShowInsufficientDialog(true);
      return;
    }
    
    const withdrawalResult = await requestWithdrawal(parseFloat(amount));
    
    if (withdrawalResult.success) {
      const message = withdrawalResult.providerQueued
        ? `Your withdrawal for ${formattedAmount} has been queued. Paystack transfer balance is temporarily low, so payout will be processed automatically once provider funds are available.`
        : withdrawalResult.ledgerRecorded
        ? usesDirectPayout
          ? `Your Direct Payout for ${formattedAmount} has been submitted for instant transfer.`
          : `Your withdrawal request for ${formattedAmount} has been submitted and is being processed.`
        : usesDirectPayout
          ? `Your Direct Payout for ${formattedAmount} has been submitted to Paystack. The transfer is in progress, and your withdrawal history will sync once the withdrawal_requests table is available.`
          : `Your withdrawal for ${formattedAmount} has been submitted. The payout is in progress, and your withdrawal history will sync once the withdrawal_requests table is available.`;

      setSuccessMessage(message);
      setShowSuccessDialog(true);
      return;
    }

    const latestError = useWalletStore.getState().error || 'Unable to process withdrawal request. Please try again.';
    if (/insufficient/i.test(latestError)) {
      setShowInsufficientDialog(true);
      return;
    }

    Alert.alert('Withdrawal Failed', latestError);
  };
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Withdraw Funds</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.scrollContent}>
            <View style={styles.amountContainer}>
              <Text style={styles.sectionTitle}>Amount</Text>
              <View style={styles.amountInputContainer}>
                <Text style={styles.currencySymbol}>{currencySymbol}</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="0.00"
                  placeholderTextColor={Colors.dark.subtext}
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={handleAmountChange}
                />
              </View>
              
              {wallet && (
                <Text style={styles.availableBalance}>
                  Available Balance: {formatCurrency(claimableBalance, activeCurrency)}
                </Text>
              )}
              
              <View style={styles.quickAmounts}>
                {[50, 100, 500, 1000].map((quickAmount) => (
                  <TouchableOpacity
                    key={quickAmount}
                    style={styles.quickAmountButton}
                    onPress={() => setAmount(quickAmount.toString())}
                  >
                    <Text style={styles.quickAmountText}>{currencySymbol}{quickAmount}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            
            <View style={styles.bankAccountContainer}>
              <Text style={styles.sectionTitle}>Bank Account</Text>
              
              {businessBankAccount ? (
                <View style={styles.bankAccountCard}>
                  <View style={styles.bankIconContainer}>
                    <Landmark size={24} color={Colors.dark.primary} />
                  </View>
                  
                  <View style={styles.bankDetails}>
                    <Text style={styles.bankName}>{businessBankAccount.bankName}</Text>
                    <Text style={styles.accountName}>{businessBankAccount.accountName}</Text>
                    <Text style={styles.accountNumber}>Account: {businessBankAccount.accountNumber}</Text>
                    <Text style={styles.accountNumber}>Provider: {businessBankAccount.payoutProvider === 'paystack' ? 'Paystack' : 'Stripe'}</Text>
                    {usesDirectPayout && (
                      <Text style={styles.transferHint}>
                        Direct Payout is enabled for this account. Paystack will create a recipient and transfer the payout instantly.
                      </Text>
                    )}
                    
                    {businessBankAccount.isVerified ? (
                      <View style={styles.verifiedBadge}>
                        <Text style={styles.verifiedText}>Verified</Text>
                      </View>
                    ) : (
                      <View style={styles.unverifiedBadge}>
                        <Text style={styles.unverifiedText}>Unverified</Text>
                      </View>
                    )}
                  </View>
                </View>
              ) : (
                <View style={styles.noBankAccount}>
                  <Text style={styles.noBankAccountText}>
                    No bank account linked. Please add a bank account in your profile settings.
                  </Text>
                </View>
              )}
            </View>
            
            <View style={styles.infoContainer}>
              <Text style={styles.infoTitle}>Withdrawal Information</Text>
              <Text style={styles.infoText}>
                {usesDirectPayout
                  ? '• Direct Payout transfers are sent instantly to your bank account'
                  : '• Withdrawals are processed after your request is submitted'}
              </Text>
              <Text style={styles.infoText}>
                • A small processing fee may apply depending on your bank
              </Text>
              <Text style={styles.infoText}>
                • Minimum withdrawal amount can be as low as $5
              </Text>
            </View>
          </ScrollView>
          
          <View style={styles.footer}>
            <TouchableOpacity 
              style={[
                styles.withdrawButton,
                (!amount || !businessBankAccount || isLoading) && styles.disabledButton
              ]}
              onPress={handleWithdraw}
              disabled={!amount || !businessBankAccount || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={Colors.dark.text} />
              ) : (
                <Text style={styles.withdrawButtonText}>
                  Withdraw {formattedAmount}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Modal
        visible={showInsufficientDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInsufficientDialog(false)}
      >
        <View style={styles.insufficientOverlay}>
          <View style={styles.insufficientCard}>
            <View style={styles.insufficientIconWrap}>
              <AlertTriangle size={22} color="#F59E0B" />
            </View>

            <Text style={styles.insufficientTitle}>Insufficient Balance</Text>
            <Text style={styles.insufficientText}>
              Your available balance is {formatCurrency(claimableBalance, activeCurrency)}.
              {'\n'}
              Please enter a lower amount or add more funds before withdrawing.
            </Text>

            <TouchableOpacity
              style={styles.insufficientButton}
              onPress={() => setShowInsufficientDialog(false)}
              activeOpacity={0.9}
            >
              <Text style={styles.insufficientButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showSuccessDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSuccessDialog(false)}
      >
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <View style={styles.successIconWrap}>
              <Text style={styles.successIconText}>{activeCurrency}</Text>
            </View>

            <Text style={styles.successTitle}>Withdrawal Submitted</Text>
            <Text style={styles.successAmount}>{formattedAmount}</Text>
            <Text style={styles.successText}>{successMessage}</Text>

            <TouchableOpacity
              style={styles.successButton}
              onPress={() => {
                setShowSuccessDialog(false);
                onClose();
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.successButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  modalContent: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flex: 1,
    padding: 16,
  },
  amountContainer: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  currencySymbol: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    color: Colors.dark.text,
  },
  availableBalance: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 16,
  },
  quickAmounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quickAmountButton: {
    backgroundColor: Colors.dark.card,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  quickAmountText: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  bankAccountContainer: {
    marginBottom: 24,
  },
  bankAccountCard: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
  },
  bankIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  bankDetails: {
    flex: 1,
  },
  bankName: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  accountName: {
    fontSize: 14,
    color: Colors.dark.text,
    marginBottom: 2,
  },
  accountNumber: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 8,
  },
  transferHint: {
    fontSize: 12,
    color: '#0BA4DB',
    marginBottom: 8,
    lineHeight: 17,
  },
  verifiedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(75, 181, 67, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  verifiedText: {
    fontSize: 12,
    color: Colors.dark.success,
  },
  unverifiedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  unverifiedText: {
    fontSize: 12,
    color: '#FFC107',
  },
  noBankAccount: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  noBankAccountText: {
    color: Colors.dark.subtext,
    textAlign: 'center',
  },
  infoContainer: {
    backgroundColor: 'rgba(65, 105, 225, 0.1)',
    borderRadius: 12,
    padding: 16,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.dark.secondary,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 12,
    color: Colors.dark.text,
    marginBottom: 4,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  withdrawButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: Colors.dark.inactive,
  },
  withdrawButtonText: {
    color: Colors.dark.text,
    fontWeight: 'bold',
    fontSize: 16,
  },
  insufficientOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  insufficientCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    paddingHorizontal: 18,
    paddingVertical: 20,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  insufficientIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  insufficientTitle: {
    color: Colors.dark.text,
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 8,
  },
  insufficientText: {
    color: Colors.dark.subtext,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  insufficientButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  insufficientButtonText: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '700',
  },
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  successCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
    paddingHorizontal: 18,
    paddingVertical: 20,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  successIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(59, 130, 246, 0.16)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  successIconText: {
    color: '#60A5FA',
    fontSize: 12,
    fontWeight: '800',
  },
  successTitle: {
    color: Colors.dark.text,
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 6,
  },
  successAmount: {
    color: '#60A5FA',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 10,
  },
  successText: {
    color: Colors.dark.subtext,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  successButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  successButtonText: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '700',
  },
});
