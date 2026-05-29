import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { X, CreditCard, CheckCircle, AlertCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { usePaystack } from 'react-native-paystack-webview';
import PaystackService from '@/lib/paystack';

interface PaystackWebViewProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (reference: string) => void;
  onCancel: () => void;
  amount: number;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  description?: string;
  metadata?: any;
}

export default function PaystackWebView({
  visible,
  onClose,
  onSuccess,
  onCancel,
  amount,
  email,
  firstName = '',
  lastName = '',
  phone = '',
  description = 'Payment',
  metadata = {}
}: PaystackWebViewProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'processing' | 'success' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const paystack = usePaystack();

  const buildReference = () => `60seconds_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const verifyHostedCheckoutPayment = async (reference: string) => {
    try {
      setIsLoading(true);
      setPaymentStatus('processing');
      const verification = await PaystackService.verifyPayment(reference);
      const status = String(verification?.data?.status || '').toLowerCase();

      if (status === 'success') {
        setPaymentStatus('success');
        setIsLoading(false);
        setTimeout(() => onSuccess(reference), 250);
        return;
      }

      throw new Error(`Payment not completed yet (status: ${status || 'unknown'}).`);
    } catch (error: any) {
      const message = error?.message || 'Could not verify payment yet.';
      setPaymentStatus('failed');
      setErrorMessage(message);
      setIsLoading(false);
      Alert.alert('Verification Pending', message);
    }
  };

  const openHostedCheckoutFlow = async () => {
    const reference = buildReference();

    const paymentData = await PaystackService.initializePayment({
      email,
      amount,
      currency: 'NGN',
      reference,
      metadata: {
        ...metadata,
        firstName,
        lastName,
        phone,
        description,
        platform: Platform.OS,
        checkout_mode: 'hosted_url',
        timestamp: new Date().toISOString(),
      },
      channels: ['card', 'bank', 'ussd', 'bank_transfer'],
    });

    if (!paymentData?.authorization_url) {
      throw new Error('Paystack did not return a checkout URL.');
    }

    const canOpen = await Linking.canOpenURL(paymentData.authorization_url);
    if (!canOpen) {
      throw new Error('Could not open Paystack checkout URL on this device.');
    }

    await Linking.openURL(paymentData.authorization_url);

    setIsLoading(false);
    setPaymentStatus('idle');
    Alert.alert(
      'Complete Payment',
      'Paystack checkout was opened in your browser. After payment, come back and tap "I have completed payment".',
      [
        { text: 'Cancel Payment', style: 'cancel', onPress: onCancel },
        { text: 'I have completed payment', onPress: () => verifyHostedCheckoutPayment(paymentData.reference || reference) },
      ],
      { cancelable: false }
    );
  };
  
  const handlePaystackPayment = async () => {
    setIsLoading(true);
    setPaymentStatus('processing');
    setErrorMessage('');

    try {
      const popup = paystack?.popup;
      if (!popup?.newTransaction && !popup?.checkout) {
        throw new Error('Paystack checkout is unavailable right now.');
      }

      if (!email) {
        throw new Error('A valid email is required to continue with Paystack.');
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Invalid amount. Please enter a value greater than 0.');
      }

      // Android WebView can fail on checkout.paystack.com/popup with ERR_BLOCKED_BY_RESPONSE.
      // Use hosted checkout URL there to guarantee the Paystack screen opens.
      if (Platform.OS === 'android') {
        await openHostedCheckoutFlow();
        return;
      }

      const reference = buildReference();

      const transactionPayload = {
        email,
        amount,
        reference,
        metadata: {
          ...metadata,
          firstName,
          lastName,
          phone,
          description,
          platform: 'mobile',
          timestamp: new Date().toISOString(),
        },
        onSuccess: (response: any) => {
          const completedReference = response?.transactionRef || response?.reference || reference;
          setPaymentStatus('success');
          setIsLoading(false);
          setTimeout(() => {
            onSuccess(completedReference);
          }, 300);
        },
        onCancel: () => {
          setPaymentStatus('idle');
          setIsLoading(false);
          setErrorMessage('');
          onCancel();
        },
        onError: (err: any) => {
          const message = err?.message || 'Paystack checkout failed';
          setPaymentStatus('failed');
          setErrorMessage(message);
          setIsLoading(false);
          Alert.alert(
            'Payment Unavailable',
            message,
            [
              { text: 'Cancel Payment', style: 'cancel', onPress: onCancel },
              { text: 'Retry', onPress: handlePaystackPayment },
            ]
          );
        },
      };

      // On Android WebView, PaystackPop.checkout can route to /popup which may be blocked.
      // newTransaction keeps the flow in a single transaction view and avoids that blocker.
      if (popup?.newTransaction) {
        await popup.newTransaction(transactionPayload);
      } else {
        await popup.checkout(transactionPayload);
      }
    } catch (error: any) {
      console.error('Paystack payment error:', error);

      const errorText = String(error?.message || '').toLowerCase();
      if (
        Platform.OS === 'android' &&
        (errorText.includes('err_blocked_by_response') ||
          errorText.includes('blocked_by_response') ||
          errorText.includes('/popup'))
      ) {
        try {
          setErrorMessage('');
          await openHostedCheckoutFlow();
          return;
        } catch (fallbackError: any) {
          console.error('Paystack hosted fallback error:', fallbackError);
          setPaymentStatus('failed');
          setErrorMessage(fallbackError?.message || 'Failed to open hosted checkout.');
          setIsLoading(false);
          Alert.alert('Payment Unavailable', fallbackError?.message || 'Failed to open hosted checkout.');
          return;
        }
      }

      setPaymentStatus('failed');
      setErrorMessage(error.message || 'Payment failed. Please try again.');
      setIsLoading(false);
      Alert.alert(
        'Payment Unavailable',
        error.message || 'There was an error starting the Paystack payment.',
        [
          { text: 'Cancel Payment', style: 'cancel', onPress: onCancel },
          { text: 'Retry', onPress: handlePaystackPayment },
        ]
      );
    }
  };
  
  const handleCancel = () => {
    setIsLoading(false);
    setPaymentStatus('idle');
    setErrorMessage('');
    onCancel();
  };
  
  const handleClose = () => {
    setIsLoading(false);
    setPaymentStatus('idle');
    setErrorMessage('');
    onClose();
  };
  
  const getStatusIcon = () => {
    switch (paymentStatus) {
      case 'success':
        return <CheckCircle size={48} color="#10B981" />;
      case 'failed':
        return <AlertCircle size={48} color="#EF4444" />;
      default:
        return <CreditCard size={48} color={Colors.dark.primary} />;
    }
  };
  
  const getStatusMessage = () => {
    switch (paymentStatus) {
      case 'processing':
        return 'Processing your payment...';
      case 'success':
        return 'Payment successful!';
      case 'failed':
        return errorMessage || 'Payment failed';
      default:
        return description;
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
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Paystack Payment</Text>
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.content}>
            <View style={styles.paymentInfo}>
              <View style={[
                styles.iconContainer,
                paymentStatus === 'success' && styles.successIconContainer,
                paymentStatus === 'failed' && styles.failedIconContainer
              ]}>
                {getStatusIcon()}
              </View>
              
              <Text style={styles.amountText}>
                {new Intl.NumberFormat('en-NG', {
                  style: 'currency',
                  currency: 'NGN',
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(amount)}
              </Text>
              <Text style={[
                styles.descriptionText,
                paymentStatus === 'success' && styles.successText,
                paymentStatus === 'failed' && styles.failedText
              ]}>
                {getStatusMessage()}
              </Text>
              
              <View style={styles.detailsContainer}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Email:</Text>
                  <Text style={styles.detailValue}>{email}</Text>
                </View>
                
                {firstName && lastName && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Name:</Text>
                    <Text style={styles.detailValue}>{`${firstName} ${lastName}`}</Text>
                  </View>
                )}
                
                {phone && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Phone:</Text>
                    <Text style={styles.detailValue}>{phone}</Text>
                  </View>
                )}
              </View>
            </View>
            
            {paymentStatus === 'idle' && (
              <View style={styles.paymentMethods}>
                <Text style={styles.methodsTitle}>Supported Payment Methods</Text>
                <View style={styles.methodsList}>
                  {['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'].map((channel) => (
                    <Text key={channel} style={styles.methodItem}>
                      • {channel.replace('_', ' ')}
                    </Text>
                  ))}
                </View>
              </View>
            )}
            
            {paymentStatus === 'failed' && errorMessage && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}
          </View>
          
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel} disabled={isLoading}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            {paymentStatus === 'success' ? (
              <TouchableOpacity
                style={styles.successButton}
                onPress={handleClose}
              >
                <Text style={styles.successButtonText}>Continue</Text>
              </TouchableOpacity>
            ) : paymentStatus === 'failed' ? (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  setPaymentStatus('idle');
                  setErrorMessage('');
                }}
              >
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.payButton, isLoading && styles.disabledButton]}
                onPress={handlePaystackPayment}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={Colors.dark.text} />
                ) : (
                  <Text style={styles.payButtonText}>Pay with Paystack</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.dark.background,
    borderRadius: 16,
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
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
  content: {
    padding: 16,
  },
  paymentInfo: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(11, 164, 219, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  amountText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  descriptionText: {
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: 'center',
    marginBottom: 16,
  },
  detailsContainer: {
    width: '100%',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 14,
    color: Colors.dark.subtext,
  },
  detailValue: {
    fontSize: 14,
    color: Colors.dark.text,
    fontWeight: '500',
  },
  paymentMethods: {
    marginBottom: 16,
  },
  methodsTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  methodsList: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
  },
  methodItem: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 4,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: Colors.dark.text,
    fontWeight: '500',
    fontSize: 16,
  },
  payButton: {
    flex: 2,
    backgroundColor: '#0BA4DB',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: Colors.dark.inactive,
  },
  payButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  successIconContainer: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  failedIconContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  successText: {
    color: '#10B981',
  },
  failedText: {
    color: '#EF4444',
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  errorText: {
    color: '#EF4444',
    textAlign: 'center',
    fontSize: 14,
  },
  successButton: {
    flex: 2,
    backgroundColor: '#10B981',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  successButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  retryButton: {
    flex: 2,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
});