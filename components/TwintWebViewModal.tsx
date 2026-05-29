import React from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Colors from '@/constants/colors';

interface TwintWebViewModalProps {
  visible: boolean;
  url: string;
  processing: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export default function TwintWebViewModal({
  visible,
  url,
  processing,
  onClose,
  onComplete,
}: TwintWebViewModalProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Twint Web Checkout</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        <WebView
          source={{ uri: url }}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.dark.primary} />
            </View>
          )}
        />

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.completeButton, processing && styles.disabledButton]}
            onPress={onComplete}
            disabled={processing}
          >
            {processing ? (
              <ActivityIndicator size="small" color={Colors.dark.text} />
            ) : (
              <Text style={styles.completeButtonText}>I Completed Payment</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  closeText: {
    color: Colors.dark.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.background,
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    backgroundColor: Colors.dark.card,
  },
  completeButton: {
    borderRadius: 12,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    paddingVertical: 14,
  },
  completeButtonText: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
});
