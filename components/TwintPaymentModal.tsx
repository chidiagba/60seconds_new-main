import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Colors from '@/constants/colors';

interface TwintPaymentModalProps {
  visible: boolean;
  amountLabel: string;
  reference: string;
  description: string;
  processing: boolean;
  openingApp: boolean;
  onClose: () => void;
  onOpenApp: () => void;
  onComplete: () => void;
}

export default function TwintPaymentModal({
  visible,
  amountLabel,
  reference,
  description,
  processing,
  openingApp,
  onClose,
  onOpenApp,
  onComplete,
}: TwintPaymentModalProps) {
  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Twint Payment</Text>
          <Text style={styles.description}>{description}</Text>

          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Amount</Text>
            <Text style={styles.detailValue}>{amountLabel}</Text>

            <Text style={styles.detailLabel}>Reference</Text>
            <Text style={styles.detailValue}>{reference}</Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, (openingApp || processing) && styles.disabledButton]}
            onPress={onOpenApp}
            disabled={openingApp || processing}
          >
            {openingApp ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Open Twint App</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, processing && styles.disabledButton]}
            onPress={onComplete}
            disabled={processing}
          >
            {processing ? (
              <ActivityIndicator size="small" color={Colors.dark.text} />
            ) : (
              <Text style={styles.secondaryButtonText}>I Completed Payment</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.dark.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  description: {
    fontSize: 14,
    color: Colors.dark.subtext,
    lineHeight: 20,
  },
  detailCard: {
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    borderRadius: 12,
    padding: 12,
    backgroundColor: Colors.dark.background,
    gap: 6,
  },
  detailLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: {
    fontSize: 16,
    color: Colors.dark.text,
    fontWeight: '600',
    marginBottom: 4,
  },
  primaryButton: {
    backgroundColor: '#ED0039',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelText: {
    color: Colors.dark.subtext,
    fontSize: 14,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
});
