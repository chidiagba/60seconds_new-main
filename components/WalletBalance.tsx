import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, Pressable, ScrollView, GestureResponderEvent } from 'react-native';
import { PlusCircle, ArrowDownLeft, ArrowUpRight, RefreshCw, ChevronDown } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useWalletStore } from '@/store/wallet-store';
import { formatCurrency, getCurrencySymbol, CURRENCY_LIST, CurrencyCode, normalizeCurrencyCode } from '@/constants/currencies';

interface WalletBalanceProps {
  onAddFunds?: () => void;
  onSend?: () => void;
  onWithdraw?: () => void;
  onRefresh?: () => void;
  onBalancePress?: () => void;
  compact?: boolean;
}

export default function WalletBalance({ 
  onAddFunds, 
  onSend, 
  onWithdraw, 
  onRefresh,
  onBalancePress,
  compact = false 
}: WalletBalanceProps) {
  const { wallet, isLoading, fetchWallet, selectedCurrency, setCurrency } = useWalletStore();
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  
  React.useEffect(() => {
    if (!wallet) {
      fetchWallet();
    }
  }, [wallet]);
  
  const handleRefresh = () => {
    fetchWallet();
    if (onRefresh) onRefresh();
  };
  
  if (isLoading && !wallet) {
    return (
      <View style={[styles.container, compact && styles.compactContainer]}>
        <ActivityIndicator size="small" color={Colors.dark.primary} />
      </View>
    );
  }
  
  if (!wallet) {
    return (
      <View style={[styles.container, compact && styles.compactContainer]}>
        <Text style={styles.errorText}>Wallet not available</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh}>
          <RefreshCw size={16} color={Colors.dark.primary} />
          <Text style={styles.refreshText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const activeCurrency = normalizeCurrencyCode((wallet as any)?.currency, selectedCurrency);
  
  const handleCurrencySelect = (currency: CurrencyCode) => {
    setCurrency(currency);
    setShowCurrencyModal(false);
  };

  const handleCurrencySelectorPress = (event: GestureResponderEvent) => {
    event.stopPropagation();
    setShowCurrencyModal(true);
  };
  
  return (
    <View style={[styles.container, compact && styles.compactContainer]}>
      <TouchableOpacity
        style={styles.balanceContainer}
        onPress={onBalancePress}
        activeOpacity={onBalancePress ? 0.85 : 1}
        disabled={!onBalancePress}
      >
        <Text style={styles.balanceLabel}>Wallet Balance</Text>
        <Text style={styles.balanceAmount}>{formatCurrency(wallet.balance, activeCurrency)}</Text>
        
        <TouchableOpacity 
          style={styles.currencySelector} 
          onPress={handleCurrencySelectorPress}
        >
          <Text style={styles.currencySelectorText}>{getCurrencySymbol(activeCurrency)} {activeCurrency}</Text>
          <ChevronDown size={16} color={Colors.dark.primary} />
        </TouchableOpacity>
      </TouchableOpacity>
      
      {!compact && (
        <View style={styles.actionsContainer}>
          {onAddFunds && (
            <TouchableOpacity style={styles.actionButton} onPress={onAddFunds}>
              <PlusCircle size={20} color={Colors.dark.primary} />
              <Text style={styles.actionText}>Add Funds</Text>
            </TouchableOpacity>
          )}
          
          {onSend && (
            <TouchableOpacity style={styles.actionButton} onPress={onSend}>
              <ArrowUpRight size={20} color={Colors.dark.primary} />
              <Text style={styles.actionText}>Send</Text>
            </TouchableOpacity>
          )}
          
          {onWithdraw && (
            <TouchableOpacity style={styles.actionButton} onPress={onWithdraw}>
              <ArrowDownLeft size={20} color={Colors.dark.primary} />
              <Text style={styles.actionText}>Withdraw</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color={Colors.dark.primary} />
        </View>
      )}
      
      <Modal
        visible={showCurrencyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCurrencyModal(false)}
      >
        <View style={styles.modalContainer}>
          <Pressable style={styles.backdrop} onPress={() => setShowCurrencyModal(false)} />
          
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Currency</Text>
            </View>
            
            <ScrollView style={styles.currencyList}>
              {CURRENCY_LIST.map((currency) => (
                <TouchableOpacity
                  key={currency.code}
                  style={[
                    styles.currencyItem,
                    activeCurrency === currency.code && styles.currencyItemSelected
                  ]}
                  onPress={() => handleCurrencySelect(currency.code)}
                >
                  <View style={styles.currencyInfo}>
                    <Text style={styles.currencySymbol}>{currency.symbol}</Text>
                    <View>
                      <Text style={styles.currencyCode}>{currency.code}</Text>
                      <Text style={styles.currencyName}>{currency.name}</Text>
                    </View>
                  </View>
                  {activeCurrency === currency.code && (
                    <View style={styles.selectedIndicator} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  compactContainer: {
    padding: 12,
    marginBottom: 0,
  },
  balanceContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  actionButton: {
    alignItems: 'center',
  },
  actionText: {
    color: Colors.dark.primary,
    marginTop: 4,
    fontSize: 12,
    fontWeight: '500',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  errorText: {
    color: Colors.dark.error,
    textAlign: 'center',
    marginBottom: 8,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshText: {
    color: Colors.dark.primary,
    marginLeft: 4,
    fontSize: 14,
  },
  currencySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  currencySelectorText: {
    color: Colors.dark.primary,
    fontSize: 12,
    fontWeight: '600',
    marginRight: 4,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  modalContent: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    width: '85%',
    maxHeight: '60%',
    overflow: 'hidden',
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    textAlign: 'center',
  },
  currencyList: {
    maxHeight: 400,
  },
  currencyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  currencyItemSelected: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  currencyInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencySymbol: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginRight: 12,
    width: 40,
  },
  currencyCode: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  currencyName: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginTop: 2,
  },
  selectedIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.dark.primary,
  },
});
