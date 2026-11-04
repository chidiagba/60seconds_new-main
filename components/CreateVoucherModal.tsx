import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Modal, 
  TextInput, 
  ScrollView, 
  Switch,
  Alert,
  Platform
} from 'react-native';
import { X, Calendar, Tag, Info } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useVoucherStore } from '@/store/voucher-store';
import { useProductStore } from '@/store/product-store';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';

interface CreateVoucherModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function CreateVoucherModal({ visible, onClose }: CreateVoucherModalProps) {
  const { createVoucher, isLoading } = useVoucherStore();
  const { products } = useProductStore();
  
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [minPurchaseAmount, setMinPurchaseAmount] = useState('');
  const [maxDiscountAmount, setMaxDiscountAmount] = useState('');
  const [usageLimit, setUsageLimit] = useState('100');
  const [expiryDate, setExpiryDate] = useState(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); // 30 days from now
  const [isProductSpecific, setIsProductSpecific] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | undefined>(undefined);
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  const handleHapticFeedback = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };
  
  const generateRandomCode = () => {
    handleHapticFeedback();
    
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    setCode(result);
  };
  
  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setExpiryDate(selectedDate);
    }
  };
  
  const showDatepicker = () => {
    handleHapticFeedback();
    setShowDatePicker(true);
  };
  
  const handleCreateVoucher = async () => {
    // Validate inputs
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a voucher name');
      return;
    }
    
    if (!code.trim()) {
      Alert.alert('Error', 'Please enter a voucher code');
      return;
    }
    
    const discountValueNum = parseFloat(discountValue);
    if (isNaN(discountValueNum) || discountValueNum <= 0) {
      Alert.alert('Error', 'Please enter a valid discount value');
      return;
    }
    
    if (discountType === 'percentage' && discountValueNum > 100) {
      Alert.alert('Error', 'Percentage discount cannot exceed 100%');
      return;
    }
    
    const usageLimitNum = parseInt(usageLimit);
    if (isNaN(usageLimitNum) || usageLimitNum <= 0) {
      Alert.alert('Error', 'Please enter a valid usage limit');
      return;
    }
    
    let minPurchaseAmountNum = undefined;
    if (minPurchaseAmount.trim()) {
      minPurchaseAmountNum = parseFloat(minPurchaseAmount);
      if (isNaN(minPurchaseAmountNum) || minPurchaseAmountNum < 0) {
        Alert.alert('Error', 'Please enter a valid minimum purchase amount');
        return;
      }
    }
    
    let maxDiscountAmountNum = undefined;
    if (maxDiscountAmount.trim()) {
      maxDiscountAmountNum = parseFloat(maxDiscountAmount);
      if (isNaN(maxDiscountAmountNum) || maxDiscountAmountNum <= 0) {
        Alert.alert('Error', 'Please enter a valid maximum discount amount');
        return;
      }
    }
    
    // Create voucher object
    const voucherData = {
      name,
      code: code.toUpperCase(),
      description,
      discountType,
      discountValue: discountValueNum,
      minPurchaseAmount: minPurchaseAmountNum,
      maxDiscountAmount: maxDiscountAmountNum,
      usageLimit: usageLimitNum,
      expiryDate: expiryDate.toISOString(),
      isActive: true,
      productId: isProductSpecific ? selectedProductId : undefined,
    };
    
    // Create voucher
    const success = await createVoucher(voucherData);
    
    if (success) {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      
      Alert.alert(
        'Success',
        'Voucher created successfully',
        [{ text: 'OK', onPress: handleClose }]
      );
    } else {
      Alert.alert('Unable to create voucher', useVoucherStore.getState().error || 'Please try again.');
    }
  };
  
  const handleClose = () => {
    // Reset form
    setName('');
    setCode('');
    setDescription('');
    setDiscountType('percentage');
    setDiscountValue('');
    setMinPurchaseAmount('');
    setMaxDiscountAmount('');
    setUsageLimit('100');
    setExpiryDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    setIsProductSpecific(false);
    setSelectedProductId(undefined);
    
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
            <Text style={styles.title}>Create New Voucher</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.formContainer}>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Voucher Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Summer Sale"
                placeholderTextColor={Colors.dark.placeholder}
              />
            </View>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Voucher Code</Text>
              <View style={styles.codeInputContainer}>
                <TextInput
                  style={styles.codeInput}
                  value={code}
                  onChangeText={(text) => setCode(text.toUpperCase())}
                  placeholder="e.g. SUMMER25"
                  placeholderTextColor={Colors.dark.placeholder}
                  autoCapitalize="characters"
                />
                <TouchableOpacity 
                  style={styles.generateButton}
                  onPress={generateRandomCode}
                >
                  <Text style={styles.generateButtonText}>Generate</Text>
                </TouchableOpacity>
              </View>
            </View>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={description}
                onChangeText={setDescription}
                placeholder="Describe what this voucher offers"
                placeholderTextColor={Colors.dark.placeholder}
                multiline
                numberOfLines={3}
              />
            </View>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Discount Type</Text>
              <View style={styles.segmentedControl}>
                <TouchableOpacity 
                  style={[
                    styles.segmentButton,
                    discountType === 'percentage' && styles.segmentButtonActive
                  ]}
                  onPress={() => {
                    handleHapticFeedback();
                    setDiscountType('percentage');
                  }}
                >
                  <Text style={[
                    styles.segmentButtonText,
                    discountType === 'percentage' && styles.segmentButtonTextActive
                  ]}>Percentage (%)</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[
                    styles.segmentButton,
                    discountType === 'fixed' && styles.segmentButtonActive
                  ]}
                  onPress={() => {
                    handleHapticFeedback();
                    setDiscountType('fixed');
                  }}
                >
                  <Text style={[
                    styles.segmentButtonText,
                    discountType === 'fixed' && styles.segmentButtonTextActive
                  ]}>Fixed Amount ($)</Text>
                </TouchableOpacity>
              </View>
            </View>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>
                {discountType === 'percentage' ? 'Discount Percentage' : 'Discount Amount'}
              </Text>
              <View style={styles.inputWithPrefix}>
                <Text style={styles.inputPrefix}>
                  {discountType === 'percentage' ? '%' : '$'}
                </Text>
                <TextInput
                  style={styles.prefixedInput}
                  value={discountValue}
                  onChangeText={setDiscountValue}
                  placeholder={discountType === 'percentage' ? "e.g. 25" : "e.g. 10.00"}
                  placeholderTextColor={Colors.dark.placeholder}
                  keyboardType="numeric"
                />
              </View>
            </View>
            
            {discountType === 'percentage' && (
              <View style={styles.formGroup}>
                <Text style={styles.label}>Maximum Discount Amount (Optional)</Text>
                <View style={styles.inputWithPrefix}>
                  <Text style={styles.inputPrefix}>$</Text>
                  <TextInput
                    style={styles.prefixedInput}
                    value={maxDiscountAmount}
                    onChangeText={setMaxDiscountAmount}
                    placeholder="e.g. 50.00"
                    placeholderTextColor={Colors.dark.placeholder}
                    keyboardType="numeric"
                  />
                </View>
                <Text style={styles.helperText}>
                  Limits the maximum discount amount when using percentage
                </Text>
              </View>
            )}
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Minimum Purchase Amount (Optional)</Text>
              <View style={styles.inputWithPrefix}>
                <Text style={styles.inputPrefix}>$</Text>
                <TextInput
                  style={styles.prefixedInput}
                  value={minPurchaseAmount}
                  onChangeText={setMinPurchaseAmount}
                  placeholder="e.g. 100.00"
                  placeholderTextColor={Colors.dark.placeholder}
                  keyboardType="numeric"
                />
              </View>
            </View>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Usage Limit</Text>
              <TextInput
                style={styles.input}
                value={usageLimit}
                onChangeText={setUsageLimit}
                placeholder="e.g. 100"
                placeholderTextColor={Colors.dark.placeholder}
                keyboardType="numeric"
              />
              <Text style={styles.helperText}>
                Maximum number of times this voucher can be used
              </Text>
            </View>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Expiry Date</Text>
              <TouchableOpacity 
                style={styles.datePickerButton}
                onPress={showDatepicker}
              >
                <Calendar size={20} color={Colors.dark.primary} />
                <Text style={styles.dateText}>
                  {expiryDate.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </Text>
              </TouchableOpacity>
              
              {showDatePicker && (
                <DateTimePicker
                  value={expiryDate}
                  mode="date"
                  display="default"
                  onChange={handleDateChange}
                  minimumDate={new Date()}
                />
              )}
            </View>
            
            <View style={styles.formGroup}>
              <View style={styles.switchContainer}>
                <Text style={styles.label}>Product-specific Voucher</Text>
                <Switch
                  value={isProductSpecific}
                  onValueChange={(value) => {
                    handleHapticFeedback();
                    setIsProductSpecific(value);
                    if (!value) {
                      setSelectedProductId(undefined);
                    }
                  }}
                  trackColor={{ false: Colors.dark.inactive, true: Colors.dark.primary }}
                  thumbColor={Colors.dark.text}
                />
              </View>
              
              {isProductSpecific && (
                <View style={styles.productSelector}>
                  <Text style={styles.sublabel}>Select Product</Text>
                  
                  {products.length === 0 ? (
                    <View style={styles.noProductsContainer}>
                      <Info size={20} color={Colors.dark.subtext} />
                      <Text style={styles.noProductsText}>
                        No products available. Add products first.
                      </Text>
                    </View>
                  ) : (
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false}
                      style={styles.productsScrollView}
                    >
                      {products.map(product => (
                        <TouchableOpacity
                          key={product.id}
                          style={[
                            styles.productItem,
                            selectedProductId === product.id && styles.selectedProductItem
                          ]}
                          onPress={() => {
                            handleHapticFeedback();
                            setSelectedProductId(product.id);
                          }}
                        >
                          <Text style={[
                            styles.productItemText,
                            selectedProductId === product.id && styles.selectedProductItemText
                          ]}>
                            {product.name}
                          </Text>
                          <Text style={styles.productItemPrice}>
                            {product.currency ? `${product.currency} ` : '$'}{product.price.toFixed(2)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
              )}
            </View>
            
            <View style={styles.infoContainer}>
              <Tag size={20} color={Colors.dark.primary} />
              <Text style={styles.infoText}>
                Vouchers can be shared with customers via a code that they can enter during checkout.
              </Text>
            </View>
          </ScrollView>
          
          <View style={styles.footer}>
            <TouchableOpacity 
              style={styles.cancelButton}
              onPress={handleClose}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[
                styles.createButton,
                isLoading && styles.disabledButton
              ]}
              onPress={handleCreateVoucher}
              disabled={isLoading}
            >
              <Text style={styles.createButtonText}>
                {isLoading ? 'Creating...' : 'Create Voucher'}
              </Text>
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
    height: '90%',
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
  formContainer: {
    padding: 16,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  sublabel: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  codeInputContainer: {
    flexDirection: 'row',
  },
  codeInput: {
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
  generateButton: {
    backgroundColor: Colors.dark.primary,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  generateButtonText: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    overflow: 'hidden',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: Colors.dark.primary,
  },
  segmentButtonText: {
    color: Colors.dark.text,
  },
  segmentButtonTextActive: {
    fontWeight: '600',
  },
  inputWithPrefix: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
  },
  inputPrefix: {
    paddingLeft: 12,
    color: Colors.dark.text,
    fontSize: 16,
  },
  prefixedInput: {
    flex: 1,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
  },
  helperText: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginTop: 4,
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
  },
  dateText: {
    color: Colors.dark.text,
    marginLeft: 8,
    fontSize: 16,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  productSelector: {
    marginTop: 8,
  },
  productsScrollView: {
    marginTop: 8,
  },
  productItem: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
    marginRight: 12,
    minWidth: 150,
  },
  selectedProductItem: {
    backgroundColor: Colors.dark.primary,
  },
  productItemText: {
    color: Colors.dark.text,
    fontWeight: '500',
    marginBottom: 4,
  },
  selectedProductItemText: {
    fontWeight: 'bold',
  },
  productItemPrice: {
    color: Colors.dark.subtext,
    fontSize: 12,
  },
  noProductsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 16,
  },
  noProductsText: {
    color: Colors.dark.subtext,
    marginLeft: 8,
  },
  infoContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
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
  createButton: {
    flex: 2,
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.7,
  },
  createButtonText: {
    color: Colors.dark.text,
    fontWeight: '600',
  },
});
