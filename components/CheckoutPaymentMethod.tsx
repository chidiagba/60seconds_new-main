import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Colors from '@/constants/colors';
import { CheckoutPaymentMethodId, CheckoutPaymentOption } from '@/utils/checkout-payment-methods';

type Props = {
  options: CheckoutPaymentOption[];
  selected: CheckoutPaymentMethodId;
  onSelect: (method: CheckoutPaymentMethodId) => void;
  disabled: boolean;
  total: number;
};
export default function CheckoutPaymentMethod({ options, selected, onSelect, disabled, total }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Payment method</Text>
      {total === 0 ? <Text style={styles.detail}>No payment required.</Text> : (
        <View style={styles.options} accessibilityRole="radiogroup">
          {options.map(option => (
            <TouchableOpacity key={option.id} accessibilityRole="radio"
              accessibilityState={{ checked: selected === option.id, disabled }}
              disabled={disabled} onPress={() => onSelect(option.id)}
              style={[styles.option, selected === option.id && styles.selected]}>
              <Text style={styles.label}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { marginVertical: 12 },
  title: { color: Colors.dark.text, fontWeight: '600', marginBottom: 8 },
  detail: { color: Colors.dark.subtext, lineHeight: 20 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { padding: 10, borderWidth: 1, borderColor: Colors.dark.divider, borderRadius: 8 },
  selected: { borderColor: Colors.dark.primary, backgroundColor: Colors.dark.surface },
  label: { color: Colors.dark.text, fontSize: 13 },
});
