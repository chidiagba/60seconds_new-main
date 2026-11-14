import { logger } from '@/lib/logger';
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView, Alert } from 'react-native';
import { X, MessageCircle, Gift, Send } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useVoucherStore } from '@/store/voucher-store';

interface BulkActionModalProps {
  visible: boolean;
  onClose: () => void;
  selectedCount: number;
  onSendMessage: (message: string) => Promise<void>;
  onShareVoucher: (voucherId: string, message?: string) => Promise<void>;
}

export default function BulkActionModal({
  visible,
  onClose,
  selectedCount,
  onSendMessage,
  onShareVoucher
}: BulkActionModalProps) {
  const [activeTab, setActiveTab] = useState<'message' | 'voucher'>('message');
  const [message, setMessage] = useState<string>('');
  const [voucherMessage, setVoucherMessage] = useState<string>('');
  const [selectedVoucherId, setSelectedVoucherId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  const { vouchers, fetchVouchers } = useVoucherStore();

  React.useEffect(() => {
    if (visible && vouchers.length === 0) {
      fetchVouchers();
    }
  }, [visible, vouchers.length, fetchVouchers]);

  const handleSendMessage = async () => {
    if (!message.trim()) {
      Alert.alert('Error', 'Please enter a message');
      return;
    }

    setIsLoading(true);
    try {
      await onSendMessage(message.trim());
      setMessage('');
      onClose();
    } catch (error) {
      logger.error('Failed to send message:', error);
      Alert.alert('Error', 'Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  const handleShareVoucher = async () => {
    if (!selectedVoucherId) {
      Alert.alert('Error', 'Please select a voucher');
      return;
    }

    setIsLoading(true);
    try {
      await onShareVoucher(selectedVoucherId, voucherMessage.trim() || undefined);
      setVoucherMessage('');
      setSelectedVoucherId('');
      onClose();
    } catch (error) {
      logger.error('Failed to share voucher:', error);
      Alert.alert('Error', 'Failed to share voucher');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setMessage('');
    setVoucherMessage('');
    setSelectedVoucherId('');
    setActiveTab('message');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>
            Bulk Actions ({selectedCount} customers)
          </Text>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <X size={24} color={Colors.dark.text} />
          </TouchableOpacity>
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'message' && styles.activeTab]}
            onPress={() => setActiveTab('message')}
          >
            <MessageCircle size={20} color={activeTab === 'message' ? Colors.dark.text : Colors.dark.subtext} />
            <Text style={[styles.tabText, activeTab === 'message' && styles.activeTabText]}>
              Send Message
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.tab, activeTab === 'voucher' && styles.activeTab]}
            onPress={() => setActiveTab('voucher')}
          >
            <Gift size={20} color={activeTab === 'voucher' ? Colors.dark.text : Colors.dark.subtext} />
            <Text style={[styles.tabText, activeTab === 'voucher' && styles.activeTabText]}>
              Share Voucher
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {activeTab === 'message' ? (
            <View style={styles.messageTab}>
              <Text style={styles.sectionTitle}>Send Message to {selectedCount} Customers</Text>
              <Text style={styles.sectionDescription}>
                Compose a message that will be sent to all selected customers via direct message.
              </Text>
              
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.messageInput}
                  placeholder="Type your message here..."
                  placeholderTextColor={Colors.dark.subtext}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.messageTemplates}>
                <Text style={styles.templatesTitle}>Quick Templates:</Text>
                <TouchableOpacity
                  style={styles.templateButton}
                  onPress={() => setMessage('Thank you for being a valued customer! We have exciting new offers coming your way.')}
                >
                  <Text style={styles.templateText}>Thank You Message</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.templateButton}
                  onPress={() => setMessage("Don't miss out on our latest event! Check out what's happening this week.")}
                >
                  <Text style={styles.templateText}>Event Promotion</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.templateButton}
                  onPress={() => setMessage("We'd love to hear your feedback! How was your recent experience with us?")}
                >
                  <Text style={styles.templateText}>Feedback Request</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.voucherTab}>
              <Text style={styles.sectionTitle}>Share Voucher with {selectedCount} Customers</Text>
              <Text style={styles.sectionDescription}>
                Select a voucher to share with all selected customers. They will receive it via direct message.
              </Text>

              {/* Voucher Selection */}
              <View style={styles.voucherSelection}>
                <Text style={styles.voucherSelectionTitle}>Select Voucher:</Text>
                {vouchers.filter(v => v.isActive).map(voucher => (
                  <TouchableOpacity
                    key={voucher.id}
                    style={[
                      styles.voucherOption,
                      selectedVoucherId === voucher.id && styles.selectedVoucherOption
                    ]}
                    onPress={() => setSelectedVoucherId(voucher.id)}
                  >
                    <View style={styles.voucherInfo}>
                      <Text style={styles.voucherName}>{voucher.name}</Text>
                      <Text style={styles.voucherDetails}>
                        {voucher.discountType === 'percentage' 
                          ? `${voucher.discountValue}% off`
                          : `$${voucher.discountValue} off`
                        }
                        {voucher.minPurchaseAmount && ` • Min $${voucher.minPurchaseAmount}`}
                      </Text>
                      <Text style={styles.voucherCode}>Code: {voucher.code}</Text>
                      {voucher.expiryDate && (
                        <Text style={styles.voucherExpiry}>
                          Expires: {new Date(voucher.expiryDate).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                    <View style={[
                      styles.radioButton,
                      selectedVoucherId === voucher.id && styles.selectedRadioButton
                    ]} />
                  </TouchableOpacity>
                ))}
              </View>

              {/* Optional Message */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Optional Message (will be sent with voucher):</Text>
                <TextInput
                  style={styles.voucherMessageInput}
                  placeholder="Add a personal message with the voucher..."
                  placeholderTextColor={Colors.dark.subtext}
                  value={voucherMessage}
                  onChangeText={setVoucherMessage}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            </View>
          )}
        </ScrollView>

        {/* Action Button */}
        <View style={styles.actions}>
          <TouchableOpacity 
            style={[styles.actionButton, isLoading && styles.disabledButton]}
            onPress={activeTab === 'message' ? handleSendMessage : handleShareVoucher}
            disabled={isLoading}
          >
            <Send size={20} color={Colors.dark.text} />
            <Text style={styles.actionButtonText}>
              {isLoading 
                ? 'Sending...' 
                : activeTab === 'message' 
                  ? `Send Message to ${selectedCount} Customers`
                  : `Share Voucher with ${selectedCount} Customers`
              }
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.dark.text,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.dark.primary,
  },
  tabText: {
    fontSize: 14,
    color: Colors.dark.subtext,
  },
  activeTabText: {
    color: Colors.dark.text,
    fontWeight: '500' as const,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  messageTab: {
    paddingVertical: 20,
  },
  voucherTab: {
    paddingVertical: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.dark.text,
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: Colors.dark.subtext,
    lineHeight: 20,
    marginBottom: 20,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.dark.text,
    marginBottom: 8,
  },
  messageInput: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top' as const,
  },
  voucherMessageInput: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top' as const,
  },
  messageTemplates: {
    marginTop: 20,
  },
  templatesTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.dark.text,
    marginBottom: 12,
  },
  templateButton: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  templateText: {
    fontSize: 14,
    color: Colors.dark.primary,
  },
  voucherSelection: {
    marginBottom: 20,
  },
  voucherSelectionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.dark.text,
    marginBottom: 12,
  },
  voucherOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedVoucherOption: {
    borderColor: Colors.dark.primary,
  },
  voucherInfo: {
    flex: 1,
  },
  voucherName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.dark.text,
    marginBottom: 4,
  },
  voucherDetails: {
    fontSize: 14,
    color: Colors.dark.primary,
    marginBottom: 2,
  },
  voucherCode: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginBottom: 2,
  },
  voucherExpiry: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.dark.subtext,
    marginLeft: 12,
  },
  selectedRadioButton: {
    borderColor: Colors.dark.primary,
    backgroundColor: Colors.dark.primary,
  },
  actions: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  disabledButton: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold' as const,
  },
});