import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Modal, 
  TextInput,
  ActivityIndicator,
  Alert,
  Platform
} from 'react-native';
import { X, Tag, Check, AlertCircle } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useVoucherStore } from '@/store/voucher-store';
import { Voucher } from '@/types';
import * as Haptics from 'expo-haptics';

interface ApplyVoucherModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (discountAmount: number, voucher?: Voucher) => void;
  totalAmount: number;
  productId?: string;
}

export default function ApplyVoucherModal({ 
  visible, 
  onClose, 
  onApply,
  totalAmount,
  productId
}: ApplyVoucherModalProps) {
  const { validateVoucher, isLoading } = useVoucherStore();
  
  const [voucherCode, setVoucherCode] = useState('');
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    voucher?: Voucher;
    discountAmount?: number;
    errorMessage?: string;
  } | null>(null);
  
  const handleHapticFeedback = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };
  
  const handleValidateVoucher = async () => {
    if (!voucherCode.trim()) {
      Alert.alert('Error', 'Please enter a voucher code');
      return;
    }
    
    handleHapticFeedback();
    
    const result = await validateVoucher(voucherCode.trim(), totalAmount, productId);
    setValidationResult(result);
    
    if (result.valid && result.discountAmount) {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  };
  
  const handleApplyVoucher = () => {
    if (validationResult?.valid && validationResult.discountAmount) {
      onApply(validationResult.discountAmount, validationResult.voucher);
      handleClose();
    }
  };
  
  const handleClose = () => {
    setVoucherCode('');
    setValidationResult(null);
    onClose();
  };
  
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Apply Voucher</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.content}>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                value={voucherCode}
                onChangeText={(text) => setVoucherCode(text.toUpperCase())}
                placeholder="Enter voucher code"
                placeholderTextColor={Colors.dark.placeholder}
                autoCapitalize="characters"
              />
              <TouchableOpacity 
                style={[
                  styles.validateButton,
                  isLoading && styles.disabledButton
                ]}
                onPress={handleValidateVoucher}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={Colors.dark.text} />
                ) : (
                  <Text style={styles.validateButtonText}>Validate</Text>
                )}
              </TouchableOpacity>
            </View>
            
            {validationResult && (
              <View style={[
                styles.resultContainer,
                validationResult.valid ? styles.validResult : styles.invalidResult
              ]}>
                {validationResult.valid ? (
                  <>
                    <Check size={20} color="#4CAF50" />
                    <View style={styles.resultTextContainer}>
                      <Text style={styles.validText}>Valid voucher</Text>
                      <Text style={styles.discountText}>
                        Discount: ${validationResult.discountAmount?.toFixed(2)}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <AlertCircle size={20} color="#FF5252" />
                    <Text style={styles.invalidText}>
                      {validationResult.errorMessage || 'Invalid voucher code'}
                    </Text>
                  </>
                )}
              </View>
            )}
            
            <View style={styles.infoContainer}>
              <Tag size={20} color={Colors.dark.primary} />
              <Text style={styles.infoText}>
                Enter a valid voucher code to get a discount on your purchase.
              </Text>
            </View>
          </View>
          
          <View style={styles.footer}>
            <TouchableOpacity 
              style={styles.cancelButton}
              onPress={handleClose}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[
                styles.applyButton,
                (!validationResult?.valid) && styles.disabledButton
              ]}
              onPress={handleApplyVoucher}
              disabled={!validationResult?.valid}
            >
              <Text style={styles.applyButtonText}>Apply Voucher</Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 30,
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
  inputContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.dark.card,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 1,
  },
  validateButton: {
    backgroundColor: Colors.dark.primary,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  validateButtonText: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  resultContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  validResult: {
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
  },
  invalidResult: {
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
  },
  resultTextContainer: {
    marginLeft: 8,
    flex: 1,
  },
  validText: {
    color: '#4CAF50',
    fontWeight: '500',
    marginBottom: 4,
  },
  discountText: {
    color: Colors.dark.text,
  },
  invalidText: {
    color: '#FF5252',
    marginLeft: 8,
    flex: 1,
  },
  infoContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    borderRadius: 8,
    padding: 12,
  },
  infoText: {
    color: Colors.dark.text,
    marginLeft: 8,
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 14,
    marginRight: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  applyButton: {
    flex: 2,
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  applyButtonText: {
    color: Colors.dark.text,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.7,
  },
});