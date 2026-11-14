import AvatarImage from '@/components/AvatarImage';
import { logger } from '@/lib/logger';
import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  TextInput, 
  ScrollView, 
  ActivityIndicator,
  Alert,
  Linking,
  Platform
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Search, User, ArrowUpRight, Smartphone, DollarSign } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWalletStore } from '@/store/wallet-store';
import WalletBalance from '@/components/WalletBalance';
import { mockVideos } from '@/mocks/videos';
import { Image } from 'expo-image';
import { formatCurrency, getCurrencySymbol } from '@/constants/currencies';

export default function SendMoneyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ 
    recipientId?: string;
    amount?: string;
    note?: string;
    fromQR?: string;
  }>();
  
  const { wallet, transferFunds, isLoading, paymentMethods, fetchPaymentMethods, selectedCurrency } = useWalletStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [amount, setAmount] = useState(params.amount || '');
  const [note, setNote] = useState(params.note || '');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'twint' | 'paystack'>('wallet');
  const currencySymbol = getCurrencySymbol(selectedCurrency);
  const formattedAmount = amount ? formatCurrency(parseFloat(amount), selectedCurrency) : formatCurrency(0, selectedCurrency);
  
  // Handle pre-filled data from QR code
  useEffect(() => {
    if (params.recipientId) {
      const user = mockVideos
        .map(video => video.user)
        .find(user => user.id === params.recipientId);
      
      if (user) {
        setSelectedUser(user);
      }
    }
    
    // Fetch payment methods to check if Twint and Paystack are available
    fetchPaymentMethods();
  }, [params.recipientId]);
  
  // Check if user has Twint or Paystack payment methods
  const hasTwintPaymentMethod = paymentMethods.some(pm => pm.type === 'twint');
  const hasPaystackPaymentMethod = paymentMethods.some(pm => pm.type === 'paystack');
  
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/wallet');
  };
  
  const handleAmountChange = (text: string) => {
    // Only allow numbers and one decimal point
    const regex = /^\d*\.?\d{0,2}$/;
    if (regex.test(text)) {
      setAmount(text);
    }
  };
  
  const handleUserSelect = (user: any) => {
    setSelectedUser(user);
    setSearchQuery('');
  };
  
  const handleTwintPayment = () => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    
    if (!selectedUser) {
      Alert.alert('Recipient Required', 'Please select a recipient.');
      return;
    }
    
    // In a real app, this would generate a QR code or deep link to the Twint app
    // For now, we'll simulate by opening the Twint app if available
    
    Alert.alert(
      'Twint Payment',
      `You will be redirected to the Twint app to send ${formattedAmount} to ${selectedUser.name}.`,
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
                  try {
                    const description = note 
                      ? `Sent to @${selectedUser.username} via Twint: ${note}`
                      : `Sent to @${selectedUser.username} via Twint`;
                    
                    const twintPaymentMethod = paymentMethods.find(pm => pm.type === 'twint');
                    
                    if (twintPaymentMethod) {
                      transferFunds(
                        parseFloat(amount),
                        selectedUser.id,
                        description
                      ).then(success => {
                        if (success) {
                          Alert.alert(
                            'Money Sent',
                            `${formattedAmount} has been sent to ${selectedUser.name} via Twint.`,
                            [{ text: 'OK', onPress: () => router.back() }]
                          );
                        }
                      });
                    } else {
                      throw new Error('No Twint payment method found');
                    }
                  } catch (error) {
                    Alert.alert("Error", "There was a problem processing your Twint payment. Please try again.");
                  }
                }, 2000);
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
              logger.error('An error occurred', err);
              Alert.alert('Error', 'Could not open Twint app. Please try another payment method.');
            });
          }
        }
      ]
    );
  };
  
  const handlePaystackPayment = () => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    
    if (!selectedUser) {
      Alert.alert('Recipient Required', 'Please select a recipient.');
      return;
    }
    
    // In a real app, this would open a Paystack checkout or deep link
    // For now, we'll simulate a successful payment
    
    Alert.alert(
      'Paystack Payment',
      `You will be redirected to Paystack to send ${formattedAmount} to ${selectedUser.name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Continue', 
          onPress: () => {
            // Simulate opening Paystack checkout
            // In a real app, we would use the Paystack SDK or redirect to a web checkout
            
            // Simulate network delay
            setTimeout(() => {
              try {
                const description = note 
                  ? `Sent to @${selectedUser.username} via Paystack: ${note}`
                  : `Sent to @${selectedUser.username} via Paystack`;
                
                const paystackPaymentMethod = paymentMethods.find(pm => pm.type === 'paystack');
                
                if (paystackPaymentMethod) {
                  // Generate a reference
                  const paystackReference = `paystack_ref_${Date.now()}`;
                  
                  transferFunds(
                    parseFloat(amount),
                    selectedUser.id,
                    description
                  ).then(success => {
                    if (success) {
                      Alert.alert(
                        'Money Sent',
                        `${formattedAmount} has been sent to ${selectedUser.name} via Paystack.`,
                        [{ text: 'OK', onPress: () => router.back() }]
                      );
                    }
                  });
                } else {
                  throw new Error('No Paystack payment method found');
                }
              } catch (error) {
                Alert.alert("Error", "There was a problem processing your Paystack payment. Please try again.");
              }
            }, 2000);
          }
        }
      ]
    );
  };
  
  const handleSend = async () => {
    if (paymentMethod === 'twint') {
      handleTwintPayment();
      return;
    }
    
    if (paymentMethod === 'paystack') {
      handlePaystackPayment();
      return;
    }
    
    // Standard wallet transfer
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    
    if (!selectedUser) {
      Alert.alert('Recipient Required', 'Please select a recipient.');
      return;
    }
    
    if (wallet && parseFloat(amount) > wallet.balance) {
      Alert.alert('Insufficient Funds', 'The amount exceeds your available balance.');
      return;
    }
    
    const description = note 
      ? `Sent to @${selectedUser.username}: ${note}`
      : `Sent to @${selectedUser.username}`;
    
    const success = await transferFunds(parseFloat(amount), selectedUser.id, description);
    
    if (success) {
      Alert.alert(
        'Money Sent',
        `${formattedAmount} has been sent to ${selectedUser.name}.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    }
  };
  
  // Filter users based on search query
  const filteredUsers = searchQuery
    ? mockVideos
        .map(video => video.user)
        .filter(user => 
          user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
    : [];
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Send Money</Text>
        <View style={styles.placeholder} />
      </View>
      
      <ScrollView style={styles.content}>
        <WalletBalance compact />
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recipient</Text>
          
          {selectedUser ? (
            <View style={styles.selectedUserContainer}>
              <AvatarImage
                uri={selectedUser.avatar} userId={selectedUser?.id}
                style={styles.userAvatar}
                contentFit="cover"
                transition={300}
              />
              
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{selectedUser.name}</Text>
                <Text style={styles.userUsername}>@{selectedUser.username}</Text>
              </View>
              
              <TouchableOpacity 
                style={styles.changeButton}
                onPress={() => setSelectedUser(null)}
              >
                <Text style={styles.changeButtonText}>Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.searchContainer}>
              <Search size={20} color={Colors.dark.subtext} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by username or name"
                placeholderTextColor={Colors.dark.subtext}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          )}
          
          {searchQuery && !selectedUser && (
            <View style={styles.searchResults}>
              {filteredUsers.length > 0 ? (
                filteredUsers.map(user => (
                  <TouchableOpacity 
                    key={user.id}
                    style={styles.userItem}
                    onPress={() => handleUserSelect(user)}
                  >
                    <AvatarImage
                      uri={user.avatar} userId={user?.id}
                      style={styles.userAvatar}
                      contentFit="cover"
                      transition={300}
                    />
                    
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{user.name}</Text>
                      <Text style={styles.userUsername}>@{user.username}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.noResults}>
                  <User size={24} color={Colors.dark.subtext} />
                  <Text style={styles.noResultsText}>No users found</Text>
                </View>
              )}
            </View>
          )}
        </View>
        
        <View style={styles.section}>
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
              Available Balance: {formatCurrency(wallet.balance, selectedCurrency)}
            </Text>
          )}
          
          <View style={styles.quickAmounts}>
            {[5, 10, 20, 50].map((quickAmount) => (
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
        
        {(hasTwintPaymentMethod || hasPaystackPaymentMethod) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Payment Method</Text>
            
            <View style={styles.paymentMethodContainer}>
              <TouchableOpacity 
                style={[
                  styles.paymentMethodOption,
                  paymentMethod === 'wallet' && styles.selectedPaymentOption
                ]}
                onPress={() => setPaymentMethod('wallet')}
              >
                <Text style={[
                  styles.paymentMethodText,
                  paymentMethod === 'wallet' && styles.selectedPaymentText
                ]}>
                  Wallet
                </Text>
              </TouchableOpacity>
              
              {hasTwintPaymentMethod && (
                <TouchableOpacity 
                  style={[
                    styles.paymentMethodOption,
                    paymentMethod === 'twint' && styles.selectedTwintOption
                  ]}
                  onPress={() => setPaymentMethod('twint')}
                >
                  <Smartphone 
                    size={16} 
                    color={paymentMethod === 'twint' ? '#FFFFFF' : '#ED0039'} 
                    style={styles.paymentIcon} 
                  />
                  <Text style={[
                    styles.paymentMethodText,
                    paymentMethod === 'twint' && styles.selectedTwintText
                  ]}>
                    Twint
                  </Text>
                </TouchableOpacity>
              )}
              
              {hasPaystackPaymentMethod && (
                <TouchableOpacity 
                  style={[
                    styles.paymentMethodOption,
                    paymentMethod === 'paystack' && styles.selectedPaystackOption
                  ]}
                  onPress={() => setPaymentMethod('paystack')}
                >
                  <DollarSign 
                    size={16} 
                    color={paymentMethod === 'paystack' ? '#FFFFFF' : '#0BA4DB'} 
                    style={styles.paymentIcon} 
                  />
                  <Text style={[
                    styles.paymentMethodText,
                    paymentMethod === 'paystack' && styles.selectedPaystackText
                  ]}>
                    Paystack
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Note (Optional)</Text>
          <TextInput
            style={styles.noteInput}
            placeholder="What's this for?"
            placeholderTextColor={Colors.dark.subtext}
            value={note}
            onChangeText={setNote}
            multiline
          />
        </View>
      </ScrollView>
      
      <View style={styles.footer}>
        <TouchableOpacity 
          style={[
            styles.sendButton,
            paymentMethod === 'twint' && styles.twintSendButton,
            paymentMethod === 'paystack' && styles.paystackSendButton,
            (!amount || !selectedUser || isLoading) && styles.disabledButton
          ]}
          onPress={handleSend}
          disabled={!amount || !selectedUser || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={Colors.dark.text} />
          ) : (
            <>
              {paymentMethod === 'twint' ? (
                <Smartphone size={20} color="#FFFFFF" />
              ) : paymentMethod === 'paystack' ? (
                <DollarSign size={20} color="#FFFFFF" />
              ) : (
                <ArrowUpRight size={20} color={Colors.dark.text} />
              )}
              <Text style={styles.sendButtonText}>
                Send {formattedAmount}
                {paymentMethod === 'twint' ? ' with Twint' : paymentMethod === 'paystack' ? ' with Paystack' : ''}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
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
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
  },
  searchResults: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 200,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.dark.text,
  },
  userUsername: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  noResults: {
    padding: 16,
    alignItems: 'center',
  },
  noResultsText: {
    marginTop: 8,
    color: Colors.dark.subtext,
  },
  selectedUserContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 12,
  },
  changeButton: {
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  changeButtonText: {
    fontSize: 12,
    color: Colors.dark.primary,
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
  paymentMethodContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  paymentMethodOption: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    paddingVertical: 12,
    marginHorizontal: 4,
    borderRadius: 8,
  },
  selectedPaymentOption: {
    backgroundColor: 'rgba(138, 43, 226, 0.2)',
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  selectedTwintOption: {
    backgroundColor: '#ED0039',
  },
  selectedPaystackOption: {
    backgroundColor: '#0BA4DB',
  },
  paymentMethodText: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  selectedPaymentText: {
    color: Colors.dark.primary,
    fontWeight: 'bold',
  },
  selectedTwintText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  selectedPaystackText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  paymentIcon: {
    marginRight: 4,
  },
  noteInput: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    padding: 16,
  },
  twintSendButton: {
    backgroundColor: '#ED0039',
  },
  paystackSendButton: {
    backgroundColor: '#0BA4DB',
  },
  disabledButton: {
    backgroundColor: Colors.dark.inactive,
  },
  sendButtonText: {
    color: Colors.dark.text,
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
});