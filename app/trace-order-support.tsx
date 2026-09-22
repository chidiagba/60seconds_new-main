import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

type Provider = 'paystack' | 'twint' | 'worldline';

type TraceOutput = {
  tracedAt: string;
  input: {
    orderId: string;
    reference: string | null;
    provider: Provider;
  };
  order: any;
  ownerWallet: any;
  ownerWalletTransactions: any[] | { error: string };
  ticketReceipts: any[] | { error: string };
  ownerCredits: any[] | { error: string };
  buyerDebits: any[] | { error: string };
  diagnostics: Record<string, string>;
  computed: {
    orderGrossAmount: number;
    expectedNetAmountAt4PercentFee: number;
    expectedPlatformFee: number;
    ownerCreditAmountFound: number | null;
    ownerCreditDeltaAgainstExpectedNet: number | null;
  };
};

type SelectResult = {
  data: any[] | null;
  error: any;
  usedColumns: string;
};

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

const expectedNetFromGross = (gross: number) => {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return roundMoney(gross / 1.04);
};

const selectWithFallback = async (
  table: string,
  candidates: string[],
  applyQuery: (query: any) => any
): Promise<SelectResult> => {
  let lastError: any = null;

  for (const columns of candidates) {
    const result = await applyQuery(supabase.from(table).select(columns));
    if (!result.error) {
      return { data: (result.data || []) as any[], error: null, usedColumns: columns };
    }

    lastError = result.error;
    const message = String(result.error?.message || '').toLowerCase();
    const isColumnMismatch =
      message.includes('column') ||
      message.includes('schema cache') ||
      message.includes('does not exist');

    if (!isColumnMismatch) {
      return { data: null, error: result.error, usedColumns: columns };
    }
  }

  return { data: null, error: lastError, usedColumns: candidates[candidates.length - 1] || '*' };
};

export default function TraceOrderSupportScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [provider, setProvider] = useState<Provider>('paystack');
  const [orderIdInput, setOrderIdInput] = useState('');
  const [referenceInput, setReferenceInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceOutput, setTraceOutput] = useState<TraceOutput | null>(null);

  const resolvedUserId = useMemo(() => String(user?.id || '').trim(), [user?.id]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabsbusiness)/wallet');
  };

  const handleTrace = async () => {
    const orderId = orderIdInput.trim();
    const reference = referenceInput.trim();

    if (!orderId && !reference) {
      Alert.alert('Missing Input', 'Enter either an order ID or a payment reference.');
      return;
    }

    if (!resolvedUserId) {
      Alert.alert('Not Signed In', 'Please sign in before tracing an order.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setTraceOutput(null);

    try {
      let resolvedOrderId = orderId;

      const walletResult = await selectWithFallback(
        'wallets',
        ['id,user_id,balance,currency,updated_at', '*'],
        (query) => query.eq('user_id', resolvedUserId).limit(1)
      );

      const currentWallet = (walletResult.data || [])[0] || null;

      if (!resolvedOrderId && reference && currentWallet?.id) {
        const ownerCreditByRef = await supabase
          .from('transactions')
          .select('metadata,created_at')
          .eq('wallet_id', currentWallet.id)
          .eq('metadata->>entry', 'owner_credit')
          .eq('metadata->>payment_provider', provider)
          .eq('metadata->>payment_reference', reference)
          .order('created_at', { ascending: false })
          .limit(1);

        if (!ownerCreditByRef.error && (ownerCreditByRef.data || []).length) {
          const row = ownerCreditByRef.data?.[0] as any;
          resolvedOrderId = String(row?.metadata?.order_id || row?.metadata?.orderId || '').trim();
        }

        if (!resolvedOrderId) {
          const ownerCreditByTx = await supabase
            .from('transactions')
            .select('metadata,created_at')
            .eq('wallet_id', currentWallet.id)
            .eq('metadata->>entry', 'owner_credit')
            .eq('metadata->>payment_provider', provider)
            .eq('metadata->>payment_transaction_id', reference)
            .order('created_at', { ascending: false })
            .limit(1);

          if (!ownerCreditByTx.error && (ownerCreditByTx.data || []).length) {
            const row = ownerCreditByTx.data?.[0] as any;
            resolvedOrderId = String(row?.metadata?.order_id || row?.metadata?.orderId || '').trim();
          }
        }
      }

      if (!resolvedOrderId) {
        throw new Error('Could not resolve order from this reference for the current account. Try entering the order ID.');
      }

      const orderResult = await selectWithFallback(
        'orders',
        [
          'id,user_id,business_id,total_amount,status,payment_method,payment_status,created_at,updated_at,items',
          'id,user_id,business_id,total_amount,status,payment_method,created_at,updated_at,items',
          '*',
        ],
        (query) => query.eq('id', resolvedOrderId).limit(1)
      );

      if (orderResult.error || !(orderResult.data || []).length) {
        throw new Error(`Order lookup failed: ${orderResult.error?.message || 'not found or inaccessible'}`);
      }

      const order = (orderResult.data || [])[0] as any;

      const ticketReceiptsResult = await selectWithFallback(
        'ticket_receipts',
        ['id,order_id,order_number,buyer_id,owner_id,product_id,unit_price,total_price,currency,issued_at,created_at', '*'],
        (query) => query.eq('order_id', resolvedOrderId).order('created_at', { ascending: true })
      );

      const ownerCreditsResult = await selectWithFallback(
        'transactions',
        ['id,wallet_id,amount,type,status,description,created_at,metadata', '*'],
        (query) =>
          query
            .eq('metadata->>entry', 'owner_credit')
            .eq('metadata->>order_id', resolvedOrderId)
            .eq('metadata->>payment_provider', provider)
            .order('created_at', { ascending: false })
      );

      const buyerDebitsResult = await selectWithFallback(
        'transactions',
        ['id,wallet_id,amount,type,status,description,created_at,metadata', '*'],
        (query) =>
          query
            .eq('metadata->>entry', 'buyer_debit')
            .eq('metadata->>order_id', resolvedOrderId)
            .eq('metadata->>payment_provider', provider)
            .order('created_at', { ascending: false })
      );

      let ownerWallet: any = null;
      let ownerWalletTransactions: any[] | { error: string } = [];
      const ownerId = String(order.business_id || '').trim();
      if (ownerId) {
        const ownerWalletResult = await selectWithFallback(
          'wallets',
          ['id,user_id,balance,currency,updated_at', '*'],
          (query) => query.eq('user_id', ownerId).limit(1)
        );
        ownerWallet = (ownerWalletResult.data || [])[0] || null;

        if (ownerWallet?.id) {
          const ownerWalletTxResult = await selectWithFallback(
            'transactions',
            ['id,amount,type,status,description,created_at,metadata', '*'],
            (query) => query.eq('wallet_id', ownerWallet.id).order('created_at', { ascending: false }).limit(500)
          );
          ownerWalletTransactions = ownerWalletTxResult.error
            ? { error: ownerWalletTxResult.error.message }
            : (ownerWalletTxResult.data || []);
        }
      }

      const orderGrossAmount = Number(order.total_amount || 0);
      const expectedNetAmount = expectedNetFromGross(orderGrossAmount);
      const expectedPlatformFee = roundMoney(Math.max(0, orderGrossAmount - expectedNetAmount));
      const ownerCredit = (ownerCreditsResult.data || [])[0] as any;
      const ownerCreditAmountFound = ownerCredit ? Number(ownerCredit.amount || 0) : null;

      const output: TraceOutput = {
        tracedAt: new Date().toISOString(),
        input: {
          orderId: resolvedOrderId,
          reference: reference || null,
          provider,
        },
        order,
        ownerWallet,
        ownerWalletTransactions,
        ticketReceipts: ticketReceiptsResult.error
          ? { error: ticketReceiptsResult.error.message }
          : (ticketReceiptsResult.data || []),
        ownerCredits: ownerCreditsResult.error
          ? { error: ownerCreditsResult.error.message }
          : (ownerCreditsResult.data || []),
        buyerDebits: buyerDebitsResult.error
          ? { error: buyerDebitsResult.error.message }
          : (buyerDebitsResult.data || []),
        diagnostics: {
          orderColumnsUsed: orderResult.usedColumns,
          ticketReceiptsColumnsUsed: ticketReceiptsResult.usedColumns,
          ownerCreditsColumnsUsed: ownerCreditsResult.usedColumns,
          buyerDebitsColumnsUsed: buyerDebitsResult.usedColumns,
          traceScope: 'Current signed-in account visibility (RLS-aware)',
        },
        computed: {
          orderGrossAmount,
          expectedNetAmountAt4PercentFee: expectedNetAmount,
          expectedPlatformFee,
          ownerCreditAmountFound,
          ownerCreditDeltaAgainstExpectedNet:
            ownerCreditAmountFound === null ? null : roundMoney(ownerCreditAmountFound - expectedNetAmount),
        },
      };

      setTraceOutput(output);
    } catch (traceError: any) {
      setError(traceError?.message || 'Failed to trace order diagnostics.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trace Order Support</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.label}>Order ID</Text>
        <TextInput
          value={orderIdInput}
          onChangeText={setOrderIdInput}
          placeholder="e.g. 1edfd449-8053-4de1-b4b5-359752ebfddc"
          placeholderTextColor={Colors.dark.subtext}
          style={styles.input}
          autoCapitalize="none"
        />

        <Text style={styles.orText}>or</Text>

        <Text style={styles.label}>Payment Reference</Text>
        <TextInput
          value={referenceInput}
          onChangeText={setReferenceInput}
          placeholder="Paystack reference"
          placeholderTextColor={Colors.dark.subtext}
          style={styles.input}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Provider</Text>
        <View style={styles.providerRow}>
          {(['paystack', 'twint', 'worldline'] as Provider[]).map((item) => {
            const selected = provider === item;
            return (
              <TouchableOpacity
                key={item}
                style={[styles.providerPill, selected ? styles.providerPillActive : null]}
                onPress={() => setProvider(item)}
              >
                <Text style={[styles.providerPillText, selected ? styles.providerPillTextActive : null]}>
                  {item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.traceButton} onPress={handleTrace} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.traceButtonText}>Trace Diagnostics</Text>
          )}
        </TouchableOpacity>

        {!!error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Trace Error</Text>
            <Text style={styles.errorMessage}>{error}</Text>
          </View>
        )}

        {traceOutput && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Trace Result</Text>
            <Text selectable style={styles.resultText}>
              {JSON.stringify(traceOutput, null, 2)}
            </Text>
          </View>
        )}

        <Text style={styles.footnote}>
          Note: This screen uses the current signed-in account visibility. If an order is outside your access scope,
          diagnostics may be partial.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    marginTop: 40,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.dark.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  headerSpacer: {
    width: 38,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 28,
  },
  label: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.dark.card,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    borderRadius: 12,
    color: Colors.dark.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 14,
    fontSize: 14,
  },
  orText: {
    color: Colors.dark.subtext,
    fontSize: 12,
    marginBottom: 12,
  },
  providerRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  providerPill: {
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: Colors.dark.card,
  },
  providerPillActive: {
    borderColor: Colors.dark.primary,
    backgroundColor: 'rgba(138,43,226,0.14)',
  },
  providerPillText: {
    color: Colors.dark.subtext,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  providerPillTextActive: {
    color: Colors.dark.primary,
  },
  traceButton: {
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  traceButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  errorCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,90,90,0.35)',
    backgroundColor: 'rgba(255,90,90,0.08)',
    padding: 12,
    marginBottom: 14,
  },
  errorTitle: {
    color: '#FF8B8B',
    fontWeight: '700',
    marginBottom: 4,
  },
  errorMessage: {
    color: Colors.dark.text,
    fontSize: 13,
    lineHeight: 18,
  },
  resultCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    backgroundColor: Colors.dark.card,
    padding: 12,
    marginBottom: 14,
  },
  resultTitle: {
    color: Colors.dark.text,
    fontWeight: '700',
    marginBottom: 8,
  },
  resultText: {
    color: Colors.dark.subtext,
    fontSize: 12,
    lineHeight: 17,
  },
  footnote: {
    color: Colors.dark.subtext,
    fontSize: 12,
    lineHeight: 18,
  },
});
