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
import { X, Landmark } from 'lucide-react-native';
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
    businessBankAccount, 
    fetchBusinessBankAccount, 
    requestWithdrawal, 
    isLoading,
    selectedCurrency,
  } = useWalletStore();
  const [amount, setAmount] = useState('');
  const activeCurrency = normalizeCurrencyCode(businessBankAccount?.currency, selectedCurrency);
  const currencySymbol = getCurrencySymbol(activeCurrency);
  const formattedAmount = amount ? formatCurrency(parseFloat(amount), activeCurrency) : formatCurrency(0, activeCurrency);
  
  React.useEffect(() => {
    if (visible) {
      fetchBusinessBankAccount();
      setAmount('');
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
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    
    if (!businessBankAccount) {
      Alert.alert('Bank Account Required', 'Please add a bank account to your profile.');
      return;
    }
    
    if (wallet && parseFloat(amount) > wallet.balance) {
      Alert.alert('Insufficient Funds', 'The amount exceeds your available balance.');
      return;
    }
    
    const success = await requestWithdrawal(parseFloat(amount));
    
    if (success) {
      Alert.alert(
        'Withdrawal Requested',
        `Your withdrawal request for ${formattedAmount} has been submitted and is being processed.`,
        [{ text: 'OK', onPress: onClose }]
      );
    }
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
                  Available Balance: {formatCurrency(wallet.balance, activeCurrency)}
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
                • Withdrawals are typically processed within 1-3 business days
              </Text>
              <Text style={styles.infoText}>
                • A small processing fee may apply depending on your bank
              </Text>
              <Text style={styles.infoText}>
                • Minimum withdrawal amount is $50
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
});