import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  BackHandler,
  Linking,
  ScrollView,
} from 'react-native';
import { X, CreditCard, CheckCircle, AlertCircle } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import Colors from '@/constants/colors';
import { WebView } from 'react-native-webview';
import PaystackService from '@/lib/paystack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

type PaystackChannel = 'card' | 'bank' | 'ussd' | 'qr' | 'mobile_money' | 'bank_transfer';
type ChannelSelection = 'all' | PaystackChannel;
const PAYSTACK_EVENT_STORAGE_KEY = '@paystack_payment_events';

const SUPPORTED_CHANNELS: PaystackChannel[] = ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'];

const CHANNEL_OPTIONS: { key: ChannelSelection; label: string }[] = [
  { key: 'all', label: 'All Methods' },
  { key: 'card', label: 'Card' },
  { key: 'bank', label: 'Bank' },
  { key: 'bank_transfer', label: 'Direct Transfer' },
  { key: 'ussd', label: 'USSD' },
  { key: 'qr', label: 'QR Code' },
  { key: 'mobile_money', label: 'Mobile Money' },
];

interface PaystackWebViewProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (reference: string) => void;
  onCancel: () => void;
  amount: number;
  /** The currency the product/cart is priced in. If not NGN, the edge function converts to NGN automatically. */
  currency?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  description?: string;
  metadata?: any;
  paystackSubaccount?: string;
  paystackSplitCode?: string;
  paystackTransactionCharge?: number;
  paystackBearer?: 'account' | 'subaccount';
  requireSplitRouting?: boolean;
  onRoutingSetupRequired?: () => void;
}

export default function PaystackWebView({
  visible,
  onClose,
  onSuccess,
  onCancel,
  amount,
  currency = 'NGN',
  email,
  firstName = '',
  lastName = '',
  phone = '',
  description = 'Payment',
  metadata = {},
  paystackSubaccount,
  paystackSplitCode,
  paystackTransactionCharge,
  paystackBearer,
  requireSplitRouting = false,
  onRoutingSetupRequired,
}: PaystackWebViewProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'processing' | 'success' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedChannel, setSelectedChannel] = useState<ChannelSelection>('all');
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutReference, setCheckoutReference] = useState<string | null>(null);
  const [checkoutWebViewReady, setCheckoutWebViewReady] = useState(false);
  const [externalCheckoutMode, setExternalCheckoutMode] = useState(false);
  const insets = useSafeAreaInsets();
  const authUser = useAuthStore((state) => state.user);

  // Ref to prevent stale-closure success fire after the user has cancelled/navigated away
  const isCancelledRef = useRef(false);

  // Register Android back-button handler while this modal is visible
  useEffect(() => {
    if (!visible) {
      isCancelledRef.current = false;
      return;
    }
    setSelectedChannel('all');
    setPaymentStatus('idle');
    setErrorMessage('');
    setCheckoutUrl(null);
    setCheckoutReference(null);
    setCheckoutWebViewReady(false);
    setExternalCheckoutMode(false);
    const onBackPress = () => {
      // Treat hardware back as a cancellation — do NOT silently close
      if (paymentStatus === 'processing') {
        Alert.alert(
          'Payment In Progress',
          'A payment is currently being processed. Please wait or cancel explicitly.',
          [{ text: 'OK' }]
        );
        return true; // consume the event
      }
      isCancelledRef.current = true;
      setIsLoading(false);
      setPaymentStatus('idle');
      setErrorMessage('');
      trackPaymentEvent('cancelled', {
        message: 'User pressed back button',
      }).catch(() => undefined);
      onCancel();
      return true; // consume the event so navigation does not also fire
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [visible, paymentStatus]);

  const buildReference = () => `60seconds_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const trackPaymentEvent = React.useCallback(async (
    status: 'started' | 'success' | 'failed' | 'cancelled',
    details: {
      reference?: string;
      message?: string;
      source?: 'popup' | 'hosted';
      verifiedStatus?: string;
    } = {}
  ) => {
    try {
      const existing = await AsyncStorage.getItem(PAYSTACK_EVENT_STORAGE_KEY);
      const parsed = existing ? JSON.parse(existing) : [];
      const next = [
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          timestamp: new Date().toISOString(),
          platform: Platform.OS,
          status,
          amount,
          email,
          channel: selectedChannel || 'none',
          description,
          ...details,
        },
        ...(Array.isArray(parsed) ? parsed : []),
      ].slice(0, 100);

      await AsyncStorage.setItem(PAYSTACK_EVENT_STORAGE_KEY, JSON.stringify(next));
    } catch (trackingError) {
      console.warn('Failed to track Paystack payment event:', trackingError);
    }
  }, [amount, description, email, selectedChannel]);

  const verifyReferenceAndComplete = async (reference: string, source: 'popup' | 'hosted') => {
    try {
      setIsLoading(true);
      setPaymentStatus('processing');
      const verification = await PaystackService.verifyPayment(reference);
      const status = String(verification?.data?.status || '').toLowerCase();

      if (status === 'success') {
        setPaymentStatus('success');
        setIsLoading(false);
        await trackPaymentEvent('success', {
          reference,
          source,
          verifiedStatus: status,
        });
        // Guard: if the user cancelled/navigated away before verification finished,
        // do NOT fire the success callback — it would show a false positive.
        if (isCancelledRef.current) {
          return;
        }
        setTimeout(() => {
          if (!isCancelledRef.current) {
            onSuccess(reference);
          }
        }, 250);
        return;
      }

      throw new Error(`Payment not completed yet (status: ${status || 'unknown'}).`);
    } catch (error: any) {
      const message = error?.message || 'Could not verify payment yet.';
      setPaymentStatus('failed');
      setErrorMessage(message);
      setIsLoading(false);
      await trackPaymentEvent('failed', {
        reference,
        source,
        message,
      });
      Alert.alert(
        'Payment Not Successful',
        message,
        [
          {
            text: 'Payment Cancelled',
            style: 'cancel',
            onPress: () => {
              trackPaymentEvent('cancelled', {
                reference,
                source,
                message: 'User cancelled after verification failure',
              }).catch(() => undefined);
              onCancel();
            },
          },
          {
            text: 'Retry Verification',
            onPress: () => {
              verifyReferenceAndComplete(reference, source);
            },
          },
        ]
      );
    }
  };

  const resolveChannels = (): PaystackChannel[] => {
    if (selectedChannel === 'all') {
      return SUPPORTED_CHANNELS;
    }
    return [selectedChannel];
  };

  const resolveRoutingBeforeCheckout = async (input: {
    subaccount?: string;
    splitCode?: string;
  }): Promise<{
    subaccount?: string;
    splitCode?: string;
    bearer?: 'account' | 'subaccount';
  }> => {
    const normalizedSubaccount = String(input.subaccount || '').trim();
    const normalizedSplitCode = String(input.splitCode || '').trim();

    if (!requireSplitRouting) {
      return {
        subaccount: normalizedSubaccount || undefined,
        splitCode: normalizedSplitCode || undefined,
        bearer: paystackBearer || ((normalizedSubaccount || normalizedSplitCode) ? 'account' : undefined),
      };
    }

    if (normalizedSubaccount || normalizedSplitCode) {
      return {
        subaccount: normalizedSubaccount || undefined,
        splitCode: normalizedSubaccount ? undefined : (normalizedSplitCode || undefined),
        bearer: paystackBearer || 'account',
      };
    }

    const ownerId = String(metadata?.ownerId || metadata?.recipientId || '').trim();
    const currentUserId = String(authUser?.id || '').trim();
    const canUpdateBankDetails = Boolean(ownerId && currentUserId && ownerId === currentUserId);

    if (!ownerId) {
      const missingOwnerError: any = new Error(
        'Organizer split routing is missing. Configure Paystack subaccount/split before checkout.'
      );
      missingOwnerError.routingErrorCode = 'SPLIT_ROUTING_MISSING';
      missingOwnerError.canUpdateBankDetails = canUpdateBankDetails;
      throw missingOwnerError;
    }

    const { data, error } = await supabase.functions.invoke('paystack-resolve-routing', {
      body: { ownerId },
    });

    if (error) {
      const resolveError: any = new Error(
        `Unable to confirm organizer payout routing right now. ${error.message || 'Please try again.'}`
      );
      resolveError.routingErrorCode = 'ROUTING_LOOKUP_FAILED';
      resolveError.canUpdateBankDetails = canUpdateBankDetails;
      throw resolveError;
    }

    if (data?.success) {
      const resolvedSubaccount = String(data?.routing?.subaccount || '').trim();
      const resolvedSplitCode = String(data?.routing?.splitCode || '').trim();
      if (resolvedSubaccount || resolvedSplitCode) {
        return {
          subaccount: resolvedSubaccount || undefined,
          splitCode: resolvedSubaccount ? undefined : (resolvedSplitCode || undefined),
          bearer: paystackBearer || ((resolvedSubaccount || resolvedSplitCode) ? 'account' : undefined),
        };
      }
    }

    const routingErrorMessage = String(
      data?.error ||
        data?.verificationReason ||
        'Organizer split routing is missing. Configure Paystack subaccount/split before checkout.'
    );

    const routingError: any = new Error(routingErrorMessage);
    routingError.routingErrorCode = String(data?.code || 'SPLIT_ROUTING_MISSING').trim() || 'SPLIT_ROUTING_MISSING';
    routingError.canUpdateBankDetails = canUpdateBankDetails;
    throw routingError;
  };

  const openHostedCheckoutFlow = async (channels: PaystackChannel[]) => {
    const reference = buildReference();
    const resolvedRouting = await resolveRoutingBeforeCheckout({
      subaccount: paystackSubaccount,
      splitCode: paystackSplitCode,
    });
    const effectiveSubaccount = resolvedRouting.subaccount;
    const effectiveSplitCode = resolvedRouting.splitCode;
    const effectiveBearer = resolvedRouting.bearer;

    await trackPaymentEvent('started', {
      reference,
      source: 'hosted',
      message: 'Hosted checkout opened',
    });

    const paymentData = await PaystackService.initializePayment({
      email,
      amount,
      currency: currency || 'NGN',
      reference,
      callback_url: 'myapp://paystack/callback',
      subaccount: effectiveSubaccount,
      split_code: effectiveSplitCode,
      transaction_charge: paystackTransactionCharge,
      bearer: effectiveBearer,
      metadata: {
        ...metadata,
        firstName,
        lastName,
        phone,
        description,
        platform: Platform.OS,
        checkout_mode: 'hosted_url',
        split_mode: effectiveSubaccount ? 'single_subaccount' : (effectiveSplitCode ? 'split_group' : 'none'),
        timestamp: new Date().toISOString(),
      },
      channels,
    });

    if (!paymentData?.authorization_url) {
      throw new Error('Paystack did not return a checkout URL.');
    }

    const nextCheckoutUrl = String(paymentData.authorization_url);
    const shouldUseExternal = /checkout\.paystack\.com/i.test(nextCheckoutUrl);

    setCheckoutReference(paymentData.reference || reference);
    setCheckoutUrl(nextCheckoutUrl);
    setCheckoutWebViewReady(false);
    setExternalCheckoutMode(shouldUseExternal);
    setIsLoading(false);
    setPaymentStatus('idle');

    if (shouldUseExternal) {
      // Paystack checkout is often Cloudflare-protected in embedded WebViews.
      // Launching in browser avoids 403 challenge failures.
      let openedExternally = false;
      try {
        await WebBrowser.openBrowserAsync(nextCheckoutUrl, {
          showTitle: true,
          enableBarCollapsing: true,
        });
        openedExternally = true;
      } catch {
        try {
          await Linking.openURL(nextCheckoutUrl);
          openedExternally = true;
        } catch {
          openedExternally = false;
        }
      }

      if (!openedExternally) {
        throw new Error('Could not open secure Paystack checkout. Please try again.');
      }
    }
  };

  const handlePaystackPayment = async () => {
    setIsLoading(true);
    setPaymentStatus('processing');
    setErrorMessage('');

    try {
      if (!email) {
        throw new Error('A valid email is required to continue with Paystack.');
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Invalid amount. Please enter a value greater than 0.');
      }

      const channels = resolveChannels();
      await trackPaymentEvent('started', {
        source: 'hosted',
        message: 'Payment initiated from hosted Paystack modal',
      });
      await openHostedCheckoutFlow(channels);
    } catch (error: any) {
      console.error('Paystack payment error:', error);

      const message = error?.message || 'There was an error starting the Paystack payment.';
      const canShowRoutingFixButton =
        typeof onRoutingSetupRequired === 'function' &&
        (error?.canUpdateBankDetails === true || /split routing|subaccount|bank details|bank account/i.test(message));
      setPaymentStatus('failed');
      setErrorMessage(message);
      setIsLoading(false);
      await trackPaymentEvent('failed', {
        source: 'hosted',
        message,
      });

      const alertButtons: Array<{ text: string; style?: 'cancel' | 'default' | 'destructive'; onPress?: () => void }> = [];
      if (canShowRoutingFixButton) {
        alertButtons.push({
          text: 'Update Bank Details',
          onPress: () => {
            onRoutingSetupRequired?.();
          },
        });
      }

      alertButtons.push(
        { text: 'Retry', onPress: handlePaystackPayment },
        { text: 'Cancel Payment', style: 'cancel', onPress: onCancel }
      );

      Alert.alert(
        'Payment Unavailable',
        message,
        alertButtons
      );
    }
  };
  
  const handleCancel = () => {
    isCancelledRef.current = true;
    setIsLoading(false);
    setPaymentStatus('idle');
    setErrorMessage('');
    setCheckoutUrl(null);
    setCheckoutReference(null);
    setCheckoutWebViewReady(false);
    setExternalCheckoutMode(false);
    trackPaymentEvent('cancelled', {
      message: 'User cancelled from Paystack modal button',
    }).catch(() => undefined);
    Alert.alert('Payment Cancelled', 'Your Paystack payment was cancelled.', [
      { text: 'OK', onPress: onCancel },
    ]);
  };
  
  const handleClose = () => {
    isCancelledRef.current = true;
    setIsLoading(false);
    setPaymentStatus('idle');
    setErrorMessage('');
    setCheckoutUrl(null);
    setCheckoutReference(null);
    setCheckoutWebViewReady(false);
    setExternalCheckoutMode(false);
    onClose();
  };

  const handleWebViewError = async (message: string) => {
    const reason = message || 'Paystack checkout could not be loaded.';

    if (reason.includes('(403)') && checkoutUrl) {
      setExternalCheckoutMode(true);
      await trackPaymentEvent('failed', {
        source: 'hosted',
        reference: checkoutReference || undefined,
        message: `${reason} - switching to browser checkout`,
      });
      Alert.alert(
        'Secure Checkout Notice',
        'Paystack blocked embedded checkout on this device. We will open secure checkout in your browser instead.',
        [
          {
            text: 'Open Browser',
            onPress: async () => {
              try {
                await WebBrowser.openBrowserAsync(checkoutUrl, {
                  showTitle: true,
                  enableBarCollapsing: true,
                });
              } catch {
                await Linking.openURL(checkoutUrl);
              }
            },
          },
        ]
      );
      setIsLoading(false);
      setPaymentStatus('idle');
      setErrorMessage('Continue payment in browser, then return here and tap "I\'ve completed the payment".');
      return;
    }

    setIsLoading(false);
    setPaymentStatus('failed');
    setErrorMessage(reason);
    await trackPaymentEvent('failed', {
      source: 'hosted',
      reference: checkoutReference || undefined,
      message: reason,
    });
  };

  const handleChangePaymentMethod = () => {
    setCheckoutUrl(null);
    setCheckoutReference(null);
    setCheckoutWebViewReady(false);
    setExternalCheckoutMode(false);
    setPaymentStatus('idle');
    setErrorMessage('');
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

  const selectedChannelLabel =
    CHANNEL_OPTIONS.find((option) => option.key === selectedChannel)?.label || 'Paystack';
  const isHostedCheckoutOpen = !!checkoutUrl;
  const modalBottomPadding = Math.max(insets.bottom, 16);
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleCancel}
    >
      <View style={styles.modalContainer}>
        <View style={[styles.modalContent, { paddingBottom: modalBottomPadding }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Paystack Payment</Text>
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentScrollContainer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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
                  currency: currency || 'NGN',
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(amount)}
                {currency && currency.toUpperCase() !== 'NGN' && (
                  <Text style={{ fontSize: 12, color: '#888' }}>{`\n(will be converted to NGN)`}</Text>
                )}
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

            {isHostedCheckoutOpen && paymentStatus !== 'success' && (
              <View style={styles.checkoutContainer}>
                <View style={styles.checkoutWebViewCard}>
                  {externalCheckoutMode ? (
                    <View style={styles.externalCheckoutNotice}>
                      <Text style={styles.externalCheckoutTitle}>Secure Browser Checkout</Text>
                      <Text style={styles.externalCheckoutText}>
                        Paystack checkout is opened in your browser for secure verification. Complete payment there,
                        then return to this app and tap "I've completed the payment".
                      </Text>
                      <TouchableOpacity
                        style={styles.reopenCheckoutButton}
                        onPress={async () => {
                          if (!checkoutUrl) return;
                          try {
                            await WebBrowser.openBrowserAsync(checkoutUrl, {
                              showTitle: true,
                              enableBarCollapsing: true,
                            });
                          } catch {
                            await Linking.openURL(checkoutUrl);
                          }
                        }}
                      >
                        <Text style={styles.reopenCheckoutButtonText}>Open Paystack Checkout</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      {!checkoutWebViewReady && (
                        <View style={styles.checkoutLoaderOverlay}>
                          <ActivityIndicator size="large" color="#0BA4DB" />
                          <Text style={styles.checkoutLoaderText}>Loading Paystack checkout...</Text>
                        </View>
                      )}
                      <WebView
                        source={{ uri: checkoutUrl }}
                        style={styles.checkoutWebView}
                        startInLoadingState
                        javaScriptEnabled
                        domStorageEnabled
                        mixedContentMode="always"
                        sharedCookiesEnabled
                        thirdPartyCookiesEnabled
                        javaScriptCanOpenWindowsAutomatically
                        setSupportMultipleWindows={false}
                        userAgent="Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
                        onLoadStart={() => setCheckoutWebViewReady(false)}
                        onLoadEnd={() => setCheckoutWebViewReady(true)}
                        onError={(event) => {
                          const message = event?.nativeEvent?.description || 'Paystack page failed to load.';
                          handleWebViewError(message).catch(() => undefined);
                        }}
                        onHttpError={(event) => {
                          const statusCode = event?.nativeEvent?.statusCode;
                          const description = event?.nativeEvent?.description || 'HTTP error while loading Paystack checkout.';
                          handleWebViewError(`${description} (${statusCode || 'unknown'})`).catch(() => undefined);
                        }}
                      />
                    </>
                  )}
                </View>

                <TouchableOpacity
                  style={[styles.completePaymentButton, (isLoading || !checkoutReference) && styles.disabledButton]}
                  onPress={() => {
                    if (!checkoutReference) {
                      Alert.alert('Payment Unavailable', 'Missing Paystack reference. Please try again.');
                      return;
                    }
                    verifyReferenceAndComplete(checkoutReference, 'hosted');
                  }}
                  disabled={isLoading || !checkoutReference}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.completePaymentButtonText}>I've completed the payment</Text>
                  )}
                </TouchableOpacity>

                <View style={styles.checkoutActionRow}>
                  <TouchableOpacity style={styles.changeMethodButton} onPress={handleChangePaymentMethod}>
                    <Text style={styles.changeMethodButtonText}>Change Payment Method</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelCheckoutButton} onPress={handleCancel}>
                    <Text style={styles.cancelCheckoutButtonText}>Cancel Payment</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            
            {!isHostedCheckoutOpen && paymentStatus === 'idle' && (
              <View style={styles.paymentMethods}>
                <Text style={styles.methodsTitle}>Supported Payment Methods</Text>
                <View style={styles.methodsList}>
                  {SUPPORTED_CHANNELS.map((channel) => (
                    <Text key={channel} style={styles.methodItem}>
                      • {channel === 'bank_transfer' ? 'Direct Transfer' : channel.replace('_', ' ')}
                    </Text>
                  ))}
                </View>
                <Text style={styles.selectMethodTitle}>Choose an Option</Text>
                <View style={styles.channelPills}>
                  {CHANNEL_OPTIONS.map((option) => {
                    const selected = selectedChannel === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.channelPill, selected && styles.channelPillActive]}
                        onPress={() => setSelectedChannel(option.key)}
                      >
                        <Text style={[styles.channelPillText, selected && styles.channelPillTextActive]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  style={[
                    styles.inlineProceedButton,
                    isLoading && styles.disabledInlineProceedButton,
                  ]}
                  onPress={handlePaystackPayment}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={Colors.dark.text} />
                  ) : (
                    <Text style={styles.inlineProceedButtonText}>
                      {selectedChannel ? `Proceed with ${selectedChannelLabel}` : 'Choose Method to Continue'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
            
            {paymentStatus === 'failed' && errorMessage && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}
          </ScrollView>

          {!isHostedCheckoutOpen && <View style={[styles.footer, { paddingBottom: modalBottomPadding }]}>
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
                  setSelectedChannel('all');
                  setCheckoutUrl(null);
                  setCheckoutReference(null);
                  setCheckoutWebViewReady(false);
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
                  <Text style={styles.payButtonText}>
                    {selectedChannel ? `Proceed with ${selectedChannelLabel}` : 'Choose Method to Continue'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>}
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
    width: '92%',
    maxWidth: 400,
    maxHeight: '92%',
    overflow: 'hidden',
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
  contentScrollContainer: {
    paddingBottom: 20,
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
  selectMethodTitle: {
    fontSize: 14,
    color: Colors.dark.text,
    marginTop: 12,
    marginBottom: 8,
    fontWeight: '500',
  },
  channelPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  channelPill: {
    backgroundColor: Colors.dark.background,
    borderColor: Colors.dark.divider,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  channelPillActive: {
    backgroundColor: 'rgba(11, 164, 219, 0.2)',
    borderColor: '#0BA4DB',
  },
  channelPillText: {
    fontSize: 13,
    color: Colors.dark.subtext,
    fontWeight: '500',
  },
  channelPillTextActive: {
    color: '#0BA4DB',
  },
  inlineProceedButton: {
    marginTop: 12,
    backgroundColor: '#0BA4DB',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledInlineProceedButton: {
    backgroundColor: Colors.dark.inactive,
  },
  inlineProceedButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    gap: 12,
    backgroundColor: Colors.dark.background,
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
  checkoutContainer: {
    marginBottom: 16,
  },
  checkoutWebViewCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    height: 360,
  },
  checkoutWebView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  checkoutLoaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  checkoutLoaderText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '500',
  },
  externalCheckoutNotice: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 14,
    backgroundColor: '#FFFFFF',
  },
  externalCheckoutTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
  externalCheckoutText: {
    fontSize: 13,
    color: '#334155',
    textAlign: 'center',
    lineHeight: 19,
  },
  reopenCheckoutButton: {
    backgroundColor: '#0BA4DB',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  reopenCheckoutButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  completePaymentButton: {
    marginTop: 12,
    backgroundColor: '#22C55E',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completePaymentButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  checkoutActionRow: {
    marginTop: 10,
    gap: 10,
  },
  changeMethodButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    backgroundColor: Colors.dark.card,
    paddingVertical: 10,
    alignItems: 'center',
  },
  changeMethodButtonText: {
    color: Colors.dark.text,
    fontWeight: '600',
    fontSize: 14,
  },
  cancelCheckoutButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelCheckoutButtonText: {
    color: '#EF4444',
    fontWeight: '700',
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