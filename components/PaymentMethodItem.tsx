import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { CreditCard, Trash2, CheckCircle, Landmark, CreditCard as CreditCardIcon, Smartphone, DollarSign } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { PaymentMethod } from '@/types/wallet';

interface PaymentMethodItemProps {
  paymentMethod: PaymentMethod;
  onDelete?: (id: string) => void;
  onSetDefault?: (id: string) => void;
  onSelect?: (paymentMethod: PaymentMethod) => void;
  selectable?: boolean;
}

export default function PaymentMethodItem({ 
  paymentMethod, 
  onDelete, 
  onSetDefault,
  onSelect,
  selectable = false
}: PaymentMethodItemProps) {
  const getPaymentMethodIcon = () => {
    switch (paymentMethod.type) {
      case 'credit_card':
        return <CreditCard size={24} color={Colors.dark.primary} />;
      case 'bank_account':
        return <Landmark size={24} color={Colors.dark.primary} />;
      case 'paypal':
        return <CreditCardIcon size={24} color={Colors.dark.primary} />;
      case 'twint':
        return <Smartphone size={24} color="#ED0039" />;
      case 'paystack':
        return <DollarSign size={24} color="#0BA4DB" />;
      default:
        return <CreditCard size={24} color={Colors.dark.primary} />;
    }
  };
  
  const getPaymentMethodDetails = () => {
    switch (paymentMethod.type) {
      case 'credit_card':
        return `${paymentMethod.cardType?.toUpperCase() || 'Card'} •••• ${paymentMethod.lastFour}`;
      case 'bank_account':
        return `${paymentMethod.bankName} •••• ${paymentMethod.lastFour}`;
      case 'paypal':
        return 'PayPal Account';
      case 'twint':
        return paymentMethod.twintPhoneNumber ? 
          `Phone: ${formatPhoneNumber(paymentMethod.twintPhoneNumber)}` : 
          'Twint Account';
      case 'paystack':
        return paymentMethod.paystackEmail ? 
          `Email: ${formatEmail(paymentMethod.paystackEmail)}` : 
          'Paystack Account';
      default:
        return '';
    }
  };
  
  // Format phone number to show only last 4 digits
  const formatPhoneNumber = (phone: string) => {
    if (phone.length <= 4) return phone;
    return `•••• ${phone.slice(-4)}`;
  };
  
  // Format email to show only first 2 characters and domain
  const formatEmail = (email: string) => {
    if (!email.includes('@')) return email;
    const [username, domain] = email.split('@');
    if (username.length <= 2) return email;
    return `${username.substring(0, 2)}•••@${domain}`;
  };
  
  return (
    <TouchableOpacity 
      style={[
        styles.container,
        paymentMethod.type === 'twint' && styles.twintContainer,
        paymentMethod.type === 'paystack' && styles.paystackContainer
      ]}
      onPress={() => onSelect && onSelect(paymentMethod)}
      disabled={!selectable && !onSetDefault}
    >
      <View style={[
        styles.iconContainer,
        paymentMethod.type === 'twint' && styles.twintIconContainer,
        paymentMethod.type === 'paystack' && styles.paystackIconContainer
      ]}>
        {getPaymentMethodIcon()}
      </View>
      
      <View style={styles.detailsContainer}>
        <Text style={styles.nickname}>{paymentMethod.nickname}</Text>
        <Text style={styles.details}>{getPaymentMethodDetails()}</Text>
        {paymentMethod.expiryDate && (
          <Text style={styles.expiry}>Expires: {paymentMethod.expiryDate}</Text>
        )}
      </View>
      
      <View style={styles.actionsContainer}>
        {paymentMethod.isDefault && (
          <View style={styles.defaultBadge}>
            <CheckCircle size={12} color={Colors.dark.success} />
            <Text style={styles.defaultText}>Default</Text>
          </View>
        )}
        
        {!paymentMethod.isDefault && onSetDefault && (
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => onSetDefault(paymentMethod.id)}
          >
            <Text style={styles.setDefaultText}>Set Default</Text>
          </TouchableOpacity>
        )}
        
        {onDelete && (
          <TouchableOpacity 
            style={styles.deleteButton}
            onPress={() => onDelete(paymentMethod.id)}
          >
            <Trash2 size={16} color={Colors.dark.error} />
          </TouchableOpacity>
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
  twintContainer: {
    borderLeftWidth: 4,
    borderLeftColor: '#ED0039',
  },
  paystackContainer: {
    borderLeftWidth: 4,
    borderLeftColor: '#0BA4DB',
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
  paystackIconContainer: {
    backgroundColor: 'rgba(11, 164, 219, 0.1)',
  },
  detailsContainer: {
    flex: 1,
  },
  nickname: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  details: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 2,
  },
  expiry: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  actionsContainer: {
    alignItems: 'flex-end',
  },
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(75, 181, 67, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  defaultText: {
    fontSize: 12,
    color: Colors.dark.success,
    marginLeft: 4,
  },
  actionButton: {
    marginBottom: 8,
  },
  setDefaultText: {
    fontSize: 12,
    color: Colors.dark.primary,
  },
  deleteButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});