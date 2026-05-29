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
  Alert,
  Linking,
  Platform
} from 'react-native';
import { X, Smartphone, DollarSign } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWalletStore } from '@/store/wallet-store';
import PaymentMethodItem from './PaymentMethodItem';
import PaystackWebView from './PaystackWebView';
import { PaymentMethod } from '@/types/wallet';
import { useAuthStore } from '@/store/auth-store';
import { formatCurrency, getCurrencySymbol } from '@/constants/currencies';

interface AddFundsModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function AddFundsModal({ visible, onClose }: AddFundsModalProps) {
  const { paymentMethods, fetchPaymentMethods, addFunds, isLoading, selectedCurrency } = useWalletStore();
  const [amount, setAmount] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | null>(null);
  const [showTwintOptions, setShowTwintOptions] = useState(false);
  const [showPaystackOptions, setShowPaystackOptions] = useState(false);
  const [showPaystackWebView, setShowPaystackWebView] = useState(false);
  const { user } = useAuthStore();
  
  React.useEffect(() => {
    if (visible) {
      fetchPaymentMethods();
      setAmount('');
      setSelectedPaymentMethod(null);
      setShowTwintOptions(false);
      setShowPaystackOptions(false);
    }
  }, [visible]);
  
  const handleAmountChange = (text: string) => {
    // Only allow numbers and one decimal point
    const regex = /^\d*\.?\d{0,2}$/;
    if (regex.test(text)) {
      setAmount(text);
    }
  };
  
  const handleSelectPaymentMethod = (paymentMethod: PaymentMethod) => {
    setSelectedPaymentMethod(paymentMethod);
    
    // If Twint is selected, show Twint-specific options
    if (paymentMethod.type === 'twint') {
      setShowTwintOptions(true);
      setShowPaystackOptions(false);
    } 
    // If Paystack is selected, show Paystack-specific options
    else if (paymentMethod.type === 'paystack') {
      setShowPaystackOptions(true);
      setShowTwintOptions(false);
    }
    else {
      setShowTwintOptions(false);
      setShowPaystackOptions(false);
    }
  };
  
  const handleAddFunds = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    
    if (!selectedPaymentMethod) {
      Alert.alert('Payment Method Required', 'Please select a payment method.');
      return;
    }
    
    // If Twint is selected, handle differently
    if (selectedPaymentMethod.type === 'twint') {
      handleTwintPayment();
      return;
    }
    
    // If Paystack is selected, handle differently
    if (selectedPaymentMethod.type === 'paystack') {
      handlePaystackPayment();
      return;
    }
    
    const success = await addFunds(parseFloat(amount), selectedPaymentMethod.id);
    
    if (success) {
      Alert.alert(
        'Funds Added',
        `${formatCurrency(parseFloat(amount), selectedCurrency)} has been added to your wallet.`,
        [{ text: 'OK', onPress: onClose }]
      );
    }
  };
  
  const handleTwintPayment = () => {
    // In a real app, this would generate a QR code or deep link to the Twint app
    // For now, we'll simulate by opening the Twint app if available
    
    Alert.alert(
      'Twint Payment',
      `You will be redirected to the Twint app to complete your payment of ${formatCurrency(parseFloat(amount), selectedCurrency)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Continue', 
          onPress: () => {
            // Try to open Twint app
            const twintUrl = 'twint://';
            const twintWebUrl = 'https://www.twint.ch/en/';
            
            Linking.canOpenURL(twintUrl).then(supported => {
              if (supported) {
                Linking.openURL(twintUrl);
                
                // After returning from Twint app, we would normally verify the payment
                // For now, we'll simulate a successful payment
                setTimeout(() => {
                  if (selectedPaymentMethod) {
                    addFunds(parseFloat(amount), selectedPaymentMethod.id, 'twint')
                      .then(success => {
                        if (success) {
                          Alert.alert(
                            'Twint Payment Successful',
                            `${formatCurrency(parseFloat(amount), selectedCurrency)} has been added to your wallet via Twint.`,
                            [{ text: 'OK', onPress: onClose }]
                          );
                        }
                      });
                  }
                }, 1000);
              } else {
                Alert.alert(
                  'Twint App Not Found',
                  'Please install the Twint app to continue with this payment method.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { 
                      text: 'Get Twint', 
                      onPress: () => Linking.openURL(twintWebUrl)
                    }
                  ]
                );
              }
            }).catch(err => {
              console.error('An error occurred', err);
              Alert.alert('Error', 'Could not open Twint app. Please try another payment method.');
            });
          }
        }
      ]
    );
  };
  
  const handlePaystackPayment = () => {
    if (!user?.email) {
      Alert.alert('Error', 'Email is required for Paystack payments.');
      return;
    }
    
    setShowPaystackWebView(true);
  };
  
  const handlePaystackSuccess = async (reference: string) => {
    setShowPaystackWebView(false);
    
    if (selectedPaymentMethod) {
      const success = await addFunds(parseFloat(amount), selectedPaymentMethod.id, 'paystack');
      
      if (success) {
        Alert.alert(
          'Paystack Payment Successful',
          `${formatCurrency(parseFloat(amount), selectedCurrency)} has been added to your wallet via Paystack.\nReference: ${reference}`,
          [{ text: 'OK', onPress: onClose }]
        );
      }
    }
  };
  
  const handlePaystackCancel = () => {
    setShowPaystackWebView(false);
    Alert.alert('Payment Cancelled', 'Your Paystack payment was cancelled.');
  };
  
  const getDefaultPaymentMethod = () => {
    return paymentMethods.find(pm => pm.isDefault) || (paymentMethods.length > 0 ? paymentMethods[0] : null);
  };
  
  // Filter payment methods by type
  const standardPaymentMethods = paymentMethods.filter(pm => pm.type !== 'twint' && pm.type !== 'paystack');
  const twintPaymentMethods = paymentMethods.filter(pm => pm.type === 'twint');
  const paystackPaymentMethods = paymentMethods.filter(pm => pm.type === 'paystack');
  
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
            <Text style={styles.title}>Add Funds</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.scrollContent}>
            <View style={styles.amountContainer}>
              <Text style={styles.sectionTitle}>Amount</Text>
              <View style={styles.amountInputContainer}>
                <Text style={styles.currencySymbol}>{getCurrencySymbol(selectedCurrency)}</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="0.00"
                  placeholderTextColor={Colors.dark.subtext}
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={handleAmountChange}
                />
              </View>
              
              <View style={styles.quickAmounts}>
                {[100, 500, 1000, 5000].map((quickAmount) => (
                  <TouchableOpacity
                    key={quickAmount}
                    style={styles.quickAmountButton}
                    onPress={() => setAmount(quickAmount.toString())}
                  >
                    <Text style={styles.quickAmountText}>{getCurrencySymbol(selectedCurrency)}{quickAmount.toLocaleString()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            
            {/* Quick Payment Options */}
            <View style={styles.quickPaymentContainer}>
              <Text style={styles.sectionTitle}>Quick Payment Options</Text>
              
              <View style={styles.quickPaymentOptions}>
                {/* Twint Option */}
                {twintPaymentMethods.length > 0 && (
                  <TouchableOpacity 
                    style={styles.twintButton}
                    onPress={() => {
                      if (twintPaymentMethods.length > 0) {
                        handleSelectPaymentMethod(twintPaymentMethods[0]);
                      }
                    }}
                  >
                    <Smartphone size={24} color="#FFFFFF" />
                    <Text style={styles.twintButtonText}>Pay with Twint</Text>
                  </TouchableOpacity>
                )}
                
                {/* Paystack Option */}
                {paystackPaymentMethods.length > 0 && (
                  <TouchableOpacity 
                    style={styles.paystackButton}
                    onPress={() => {
                      if (paystackPaymentMethods.length > 0) {
                        handleSelectPaymentMethod(paystackPaymentMethods[0]);
                      }
                    }}
                  >
                    <DollarSign size={24} color="#FFFFFF" />
                    <Text style={styles.paystackButtonText}>Pay with Paystack</Text>
                  </TouchableOpacity>
                )}
              </View>
              
              {/* Twint Options */}
              {showTwintOptions && (
                <View style={styles.paymentOptions}>
                  {twintPaymentMethods.map((paymentMethod) => (
                    <PaymentMethodItem
                      key={paymentMethod.id}
                      paymentMethod={paymentMethod}
                      selectable
                      onSelect={handleSelectPaymentMethod}
                    />
                  ))}
                </View>
              )}
              
              {/* Paystack Options */}
              {showPaystackOptions && (
                <View style={styles.paymentOptions}>
                  {paystackPaymentMethods.map((paymentMethod) => (
                    <PaymentMethodItem
                      key={paymentMethod.id}
                      paymentMethod={paymentMethod}
                      selectable
                      onSelect={handleSelectPaymentMethod}
                    />
                  ))}
                </View>
              )}
              
              {(twintPaymentMethods.length > 0 || paystackPaymentMethods.length > 0) && (
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>OR</Text>
                  <View style={styles.dividerLine} />
                </View>
              )}
            </View>
            
            <View style={styles.paymentMethodsContainer}>
              <Text style={styles.sectionTitle}>Other Payment Methods</Text>
              
              {standardPaymentMethods.length === 0 ? (
                <View style={styles.noPaymentMethods}>
                  <Text style={styles.noPaymentMethodsText}>
                    No payment methods available. Please add a payment method in your profile.
                  </Text>
                </View>
              ) : (
                <>
                  {standardPaymentMethods.map((paymentMethod) => (
                    <PaymentMethodItem
                      key={paymentMethod.id}
                      paymentMethod={paymentMethod}
                      selectable
                      onSelect={handleSelectPaymentMethod}
                    />
                  ))}
                </>
              )}
            </View>
          </ScrollView>
          
          <View style={styles.footer}>
            <TouchableOpacity 
              style={[
                styles.addFundsButton,
                (!amount || !selectedPaymentMethod) && styles.disabledButton,
                selectedPaymentMethod?.type === 'twint' && styles.twintAddFundsButton,
                selectedPaymentMethod?.type === 'paystack' && styles.paystackAddFundsButton
              ]}
              onPress={handleAddFunds}
              disabled={!amount || !selectedPaymentMethod || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={Colors.dark.text} />
              ) : (
                <Text style={styles.addFundsButtonText}>
                  {selectedPaymentMethod?.type === 'twint' 
                    ? `Pay ${amount ? formatCurrency(parseFloat(amount), selectedCurrency) : formatCurrency(0, selectedCurrency)} with Twint`
                    : selectedPaymentMethod?.type === 'paystack'
                    ? `Pay ${amount ? formatCurrency(parseFloat(amount), selectedCurrency) : formatCurrency(0, selectedCurrency)} with Paystack`
                    : `Add ${amount ? formatCurrency(parseFloat(amount), selectedCurrency) : formatCurrency(0, selectedCurrency)} to Wallet`
                  }
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
      
      {/* Paystack WebView Modal */}
      <PaystackWebView
        visible={showPaystackWebView}
        onClose={() => setShowPaystackWebView(false)}
        onSuccess={handlePaystackSuccess}
        onCancel={handlePaystackCancel}
        amount={parseFloat(amount) || 0}
        email={user?.email || ''}
        firstName={user?.name?.split(' ')[0] || ''}
        lastName={user?.name?.split(' ').slice(1).join(' ') || ''}
        phone={''}
        description={`Add funds to 60Seconds wallet`}
        metadata={{
          userId: user?.id,
          paymentMethodId: selectedPaymentMethod?.id,
          type: 'wallet_funding'
        }}
      />
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
    marginBottom: 16,
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
  quickPaymentContainer: {
    marginBottom: 24,
  },
  quickPaymentOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  twintButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ED0039',
    borderRadius: 12,
    padding: 16,
    marginRight: 8,
  },
  twintButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  paystackButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0BA4DB',
    borderRadius: 12,
    padding: 16,
    marginLeft: 8,
  },
  paystackButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  paymentOptions: {
    marginBottom: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.dark.divider,
  },
  dividerText: {
    color: Colors.dark.subtext,
    paddingHorizontal: 16,
    fontSize: 14,
  },
  paymentMethodsContainer: {
    marginBottom: 24,
  },
  noPaymentMethods: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  noPaymentMethodsText: {
    color: Colors.dark.subtext,
    textAlign: 'center',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  addFundsButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  twintAddFundsButton: {
    backgroundColor: '#ED0039',
  },
  paystackAddFundsButton: {
    backgroundColor: '#0BA4DB',
  },
  disabledButton: {
    backgroundColor: Colors.dark.inactive,
  },
  addFundsButtonText: {
    color: Colors.dark.text,
    fontWeight: 'bold',
    fontSize: 16,
  },
});