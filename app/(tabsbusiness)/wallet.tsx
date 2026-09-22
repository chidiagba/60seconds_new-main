import { calculateOwnerWalletBalance } from '@/supabase/functions/_shared/owner-wallet-balance';
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Modal,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  CreditCard,
  Landmark,
  History,
  QrCode,
  ScanLine,
  X,
  MapPin,
} from "lucide-react-native";

import Colors from "@/constants/colors";
import { useWalletStore } from "@/store/wallet-store";
import { useAuthStore } from "@/store/auth-store";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/constants/currencies";

import WalletBalance from "@/components/WalletBalance";
import TransactionItem from "@/components/TransactionItem";
import AddFundsModal from "@/components/AddFundsModal";
import WithdrawFundsModal from "@/components/WithdrawFundsModal";

type ProfileRow = {
  id: string;
  is_business_account?: boolean | null;
  isBusinessAccount?: boolean | null; // fallback if your column is camelCase
  country?: string | null;
};

export default function WalletScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    wallet,
    transactions,
    businessBankAccount,
    fetchWallet,
    fetchTransactions,
    fetchBusinessBankAccount,
    manualReconcileBusinessWallet,
    isLoading,
    isBackgroundSyncing,
    isReconcilingBusinessWallet,
    selectedCurrency,
    lastBusinessReconciledAt,
    lastBusinessReconcileStatus,
    setCurrency,
  } =
    useWalletStore();

  const [showAddFundsModal, setShowAddFundsModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // ✅ Eligibility state for Add Funds (based on Supabase profile)
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(true);
  const [isAddFundsEligible, setIsAddFundsEligible] = useState(false);
  const [showAddFundsBlockedPopup, setShowAddFundsBlockedPopup] =
    useState(false);

  // Loaded from Supabase for messaging (optional)
  const [profileCountry, setProfileCountry] = useState<string | null>(null);
  const [isBusinessFromDb, setIsBusinessFromDb] = useState<boolean | null>(null);

  useEffect(() => {
    const loadWalletData = async () => {
      await fetchBusinessBankAccount();
      await fetchWallet();
      await fetchTransactions();
    };

    loadWalletData();
  }, [fetchBusinessBankAccount, fetchTransactions, fetchWallet]);

  useEffect(() => {
    if (!user?.id || !wallet?.id) return;

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleTransactionRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void fetchTransactions({ silent: true });
      }, 250);
    };

    const channel = supabase
      .channel(`business-wallet-${wallet.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transactions",
          filter: `wallet_id=eq.${wallet.id}`,
        },
        scheduleTransactionRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wallets",
          filter: `id=eq.${wallet.id}`,
        },
        () => {
          scheduleTransactionRefresh();
        }
      )
      .subscribe();

    // Paystack does not emit webhook events for automatic bank settlements.
    // Poll the idempotent settlement reconciler while the organizer is looking
    // at the wallet so the balance sheet stays aligned with Paystack.
    const settlementPoll = setInterval(() => {
      void fetchTransactions({ silent: true });
    }, 60_000);

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      clearInterval(settlementPoll);
      void supabase.removeChannel(channel);
    };
  }, [fetchTransactions, fetchWallet, user?.id, wallet?.id]);

  useEffect(() => {
    const updateCooldown = () => {
      if (!lastBusinessReconciledAt) {
        setCooldownSeconds(0);
        return;
      }
      const nextSyncAt = new Date(lastBusinessReconciledAt).getTime() + 60_000;
      setCooldownSeconds(Math.max(0, Math.ceil((nextSyncAt - Date.now()) / 1000)));
    };
    updateCooldown();
    const timer = setInterval(updateCooldown, 1000);
    return () => clearInterval(timer);
  }, [lastBusinessReconciledAt]);

  const handleRefreshWallet = async () => {
    await fetchBusinessBankAccount();
    await fetchWallet();
    await fetchTransactions();
  };

  const formatReconciledAt = (value: string | null) => {
    if (!value) return "Never";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Unknown";
    return parsed.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const handleManualReconcile = async () => {
    const success = await manualReconcileBusinessWallet();
    Alert.alert(
      success ? "Wallet Reconciled" : "Reconciliation Failed",
      success
        ? "Business wallet balance and transaction history have been refreshed from settlement records."
        : "Unable to complete reconciliation now. Please try again."
    );
  };

  useEffect(() => {
    if (!businessBankAccount) return;

    const nigeriaSignals = [
      businessBankAccount.country,
      businessBankAccount.countryCode,
      businessBankAccount.currency,
      businessBankAccount.bankName,
      businessBankAccount.payoutProvider,
    ]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);

    const isNigerianBank = nigeriaSignals.some((value) =>
      value === 'ng' ||
      value === 'nga' ||
      value === 'ngn' ||
      value === 'nigeria' ||
      value.includes('nigeria') ||
      value.includes('opay') ||
      value.includes('paystack')
    );

    if (isNigerianBank && selectedCurrency !== 'NGN') {
      setCurrency('NGN');
    }
  }, [businessBankAccount, selectedCurrency, setCurrency]);

  const handleBalancePress = () => {
    router.push({
      pathname: "/transactions",
      params: { ledger: "business" },
    });
  };

  // ✅ Fetch user type + country from Supabase and determine eligibility
  useEffect(() => {
    let mounted = true;

    const checkEligibility = async () => {
      try {
        setIsCheckingEligibility(true);

        const authUserId = user?.id;
        if (!authUserId) {
          if (!mounted) return;
          // If no user, safest is to disable
          setIsAddFundsEligible(false);
          return;
        }

        // NOTE: Change table name/columns if your schema differs
        const { data, error } = await supabase
          .from("profiles")
          .select("id,country,is_business_account,isBusinessAccount")
          .eq("id", authUserId)
          .single<ProfileRow>();

        if (error) throw error;

        const dbIsBusiness =
          (data?.is_business_account ?? data?.isBusinessAccount ?? null) === true;

        const dbCountry = (data?.country ?? "").trim();
        if (!mounted) return;

        setProfileCountry(dbCountry || null);
        setIsBusinessFromDb(dbIsBusiness);

        // ✅ Rule:
        // - Only PRIVATE users in Nigeria can Add Funds
        // - Business users => not eligible (as per your requirement)
        const isNigeria = dbCountry.toLowerCase() === "nigeria";
        const eligible = !dbIsBusiness && isNigeria;

        setIsAddFundsEligible(eligible);
      } catch (e) {
        // If any error, keep it disabled (safer)
        if (!mounted) return;
        setIsAddFundsEligible(false);
      } finally {
        if (!mounted) return;
        setIsCheckingEligibility(false);
      }
    };

    checkEligibility();

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const isBusinessAccount = useMemo(() => {
    // Prefer Supabase value when available, fallback to auth store
    if (isBusinessFromDb !== null) return isBusinessFromDb;
    return !!user?.isBusinessAccount;
  }, [isBusinessFromDb, user?.isBusinessAccount]);

  const handleAddFunds = () => {
    if (isCheckingEligibility) return;

    if (!isAddFundsEligible) {
      setShowAddFundsBlockedPopup(true);
      return;
    }
    setShowAddFundsModal(true);
  };

  const handleSendMoney = () => {
    router.push("/send-money");
  };

  const handleReceiveMoney = () => {
    router.push("/receive-money");
  };

  const handleScanQR = () => {
    router.push({ pathname: "/scan-qr", params: { mode: "redeem" } });
  };

  const handleWithdraw = () => {
    setShowWithdrawModal(true);
  };

  const handleViewAllTransactions = () => {
    router.push({
      pathname: "/transactions",
      params: { ledger: "business" },
    });
  };

  const handleManagePaymentMethods = () => {
    router.push("/payment-methods");
  };

  const handleManageBankAccounts = () => {
    router.push("/bank-accounts");
  };

  const handleTraceOrderSupport = () => {
    router.push("/trace-order-support");
  };

  const handleTestPayment = () => {
    router.push("/test-payment");
  };

  const handleTransactionPress = (transaction: any) => {
    router.push({
      pathname: "/transaction-details",
      params: { id: transaction.id },
    });
  };

  const renderTransactionItem = ({ item }: { item: any }) => (
    <TransactionItem transaction={item} onPress={handleTransactionPress} />
  );

  const addFundsDisabled = isCheckingEligibility || !isAddFundsEligible;
  const businessTransactions = transactions.filter((transaction: any) => {
    const entry = String(transaction?.metadata?.entry || '').trim();
    if (entry === 'owner_credit' || entry === 'owner_withdrawal') return true;
    // Keep legacy historical business records visible across app versions/devices.
    return transaction.type !== 'fee';
  });
  const walletFlow = useMemo(() => {
    const done = (status: unknown) => ['completed', 'success', 'successful', 'paid'].includes(String(status || '').toLowerCase());
    const totals = businessTransactions.reduce((result, transaction: any) => {
      const metadata = transaction?.metadata || {};
      const entry = String(metadata.entry || '');
      const amount = Math.abs(Number(transaction?.amount || 0));
      if (entry === 'owner_credit' && done(transaction?.status)) result.sales += amount;
      if (entry === 'paystack_bank_settlement') {
        if (done(transaction?.status)) result.settled += amount;
        else if (['pending', 'processing'].includes(String(transaction?.status || '').toLowerCase())) result.pendingSettlement += amount;
      } else if ((entry === 'owner_withdrawal' || transaction?.type === 'withdrawal') && done(transaction?.status)) {
        result.manualWithdrawals += amount;
      }
      return result;
    }, { sales: 0, pendingSettlement: 0, settled: 0, manualWithdrawals: 0 });
    const available = calculateOwnerWalletBalance(businessTransactions, true);
    return { ...totals, settledToBank: totals.settled + totals.manualWithdrawals, inSubaccount: available, available };
  }, [businessTransactions]);

  const flowAmount = (amount: number) => formatCurrency(amount, selectedCurrency);

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentContainer}
      >
      <Text style={styles.title}>Wallet</Text>

      <WalletBalance
        onAddFunds={handleAddFunds}
        onSend={handleSendMoney}
        onWithdraw={isBusinessAccount ? handleWithdraw : undefined}
        onRefresh={handleRefreshWallet}
        onBalancePress={handleBalancePress}
      />

      {isBusinessAccount && (
        <View style={styles.reconcileContainer}>
          <View style={styles.reconcileButtonsRow}>
            <TouchableOpacity
              style={[
                styles.reconcileButton,
                isReconcilingBusinessWallet ? styles.reconcileButtonDisabled : null,
              ]}
              onPress={handleManualReconcile}
              disabled={isReconcilingBusinessWallet}
            >
              {isReconcilingBusinessWallet ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.reconcileButtonText}>Reconcile Wallet Now</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.traceOrderButton}
              onPress={handleTraceOrderSupport}
            >
              <Text style={styles.traceOrderButtonText}>Trace Order</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.reconcileMetaText}>
            Last reconciled: {formatReconciledAt(lastBusinessReconciledAt)}
            {lastBusinessReconcileStatus === "failed" ? " (last attempt failed)" : ""}
          </Text>
          <Text style={styles.reconcileMetaText}>
            {isBackgroundSyncing
              ? "Checking Paystack statuses in background…"
              : cooldownSeconds > 0
                ? `Next Paystack status check in ${cooldownSeconds}s`
                : "Paystack status check ready"}
          </Text>
        </View>
      )}

      <View style={styles.actionsContainer}>
        {/* ✅ Add Funds (with eligibility check) */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            addFundsDisabled ? styles.actionButtonDisabled : null,
          ]}
          onPress={handleAddFunds}
          activeOpacity={0.85}
        >
          <View
            style={[
              styles.actionIconContainer,
              addFundsDisabled ? styles.actionIconDisabled : null,
            ]}
          >
            {isCheckingEligibility ? (
              <ActivityIndicator size="small" color={Colors.dark.primary} />
            ) : (
              <Plus size={20} color={Colors.dark.primary} />
            )}
          </View>
          <Text
            style={[
              styles.actionText,
              addFundsDisabled ? styles.actionTextDisabled : null,
            ]}
          >
            Add Funds
          </Text>
        </TouchableOpacity>

        {isBusinessAccount && (
          <>
            <TouchableOpacity style={styles.actionButton} onPress={handleSendMoney}>
              <View style={styles.actionIconContainer}>
                <ArrowUpRight size={20} color={Colors.dark.primary} />
              </View>
              <Text style={styles.actionText}>Send</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleReceiveMoney}
            >
              <View style={styles.actionIconContainer}>
                <QrCode size={20} color={Colors.dark.primary} />
              </View>
              <Text style={styles.actionText}>Receive</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleWithdraw}
            >
              <View style={styles.actionIconContainer}>
                <ArrowDownLeft size={20} color={Colors.dark.primary} />
              </View>
              <Text style={styles.actionText}>Withdraw</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.actionButton} onPress={handleScanQR}>
          <View style={styles.actionIconContainer}>
            <ScanLine size={20} color={Colors.dark.primary} />
          </View>
          <Text style={styles.actionText}>Verify purchase</Text>
        </TouchableOpacity>

        {/* <TouchableOpacity style={styles.actionButton} onPress={handleTestPayment}>
          <View style={styles.actionIconContainer}>
            <CreditCard size={20} color={Colors.dark.primary} />
          </View>
          <Text style={styles.actionText}>Test Payment</Text>
        </TouchableOpacity> */}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 24 }}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleManagePaymentMethods}
        >
          <View style={styles.actionIconContainer}>
            <CreditCard size={20} color={Colors.dark.primary} />
          </View>
          <Text style={styles.actionText}>Cards</Text>
        </TouchableOpacity>

        {isBusinessAccount && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleManageBankAccounts}
          >
            <View style={styles.actionIconContainer}>
              <Landmark size={20} color={Colors.dark.primary} />
            </View>
            <Text style={styles.actionText}>Bank</Text>
          </TouchableOpacity>
        )}
      </View>

      {isBusinessAccount && (
        <View style={styles.linkedBankContainer}>
          <View style={styles.linkedBankHeader}>
            <Text style={styles.sectionTitle}>Linked Bank Account</Text>
            <TouchableOpacity onPress={handleManageBankAccounts}>
              <Text style={styles.viewAllText}>{businessBankAccount ? 'Manage' : 'Add'}</Text>
            </TouchableOpacity>
          </View>

          {businessBankAccount ? (
            <View style={styles.linkedBankCard}>
              <View style={styles.linkedBankIconWrap}>
                <Landmark size={18} color={Colors.dark.primary} />
              </View>
              <View style={styles.linkedBankTextWrap}>
                <Text style={styles.linkedBankName}>{businessBankAccount.bankName}</Text>
                <Text style={styles.linkedBankMeta}>{businessBankAccount.accountName}</Text>
                <Text style={styles.linkedBankMeta}>
                  Account ending {(businessBankAccount.iban || businessBankAccount.accountNumber || '').slice(-4) || 'N/A'}
                </Text>
                <Text style={styles.linkedBankMeta}>
                  Status: {businessBankAccount.verificationStatus || (businessBankAccount.isVerified ? 'verified' : 'pending')}
                </Text>
                {String(businessBankAccount.countryCode || '').toUpperCase() === 'NG' && (
                  <Text style={styles.linkedBankMeta}>
                    Paystack subaccount: {businessBankAccount.paystackSubaccountCode ? 'linked' : 'pending setup'}
                  </Text>
                )}
                {!businessBankAccount.isVerified && !!businessBankAccount.verificationReason && (
                  <Text style={styles.linkedBankMeta}>Reason: {businessBankAccount.verificationReason}</Text>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.linkedBankEmptyCard}>
              <Text style={styles.linkedBankEmptyText}>No linked bank account yet. Add one to receive withdrawals in your wallet.</Text>
            </View>
          )}
        </View>
      )}

      {isBusinessAccount && (
        <View style={styles.flowContainer}>
          <Text style={styles.sectionTitle}>Paystack Money Flow</Text>
          <View style={styles.flowCard}>
            <View style={styles.flowRow}><Text style={styles.flowLabel}>Total sales received</Text><Text style={styles.flowCredit}>+{flowAmount(walletFlow.sales)}</Text></View>
            <View style={styles.flowRow}><Text style={styles.flowLabel}>In Paystack subaccount</Text><Text style={styles.flowValue}>{flowAmount(walletFlow.inSubaccount)}</Text></View>
            <View style={styles.flowRow}><Text style={styles.flowLabel}>Pending bank settlement</Text><Text style={styles.flowPending}>{flowAmount(walletFlow.pendingSettlement)}</Text></View>
            <View style={styles.flowRow}><Text style={styles.flowLabel}>Settled to bank</Text><Text style={styles.flowValue}>{flowAmount(walletFlow.settledToBank)}</Text></View>
            <View style={[styles.flowRow, styles.flowAvailableRow]}><Text style={styles.flowAvailableLabel}>Available balance</Text><Text style={styles.flowAvailableValue}>{flowAmount(walletFlow.available)}</Text></View>
          </View>
        </View>
      )}

      <View style={styles.transactionsContainer}>
        <View style={styles.transactionsHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <TouchableOpacity onPress={handleViewAllTransactions}>
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>

        {isLoading && businessTransactions.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={Colors.dark.primary} />
          </View>
        ) : businessTransactions.length === 0 ? (
          <View style={styles.emptyContainer}>
            <History size={48} color={Colors.dark.subtext} />
            <Text style={styles.emptyText}>No transactions yet</Text>
          </View>
        ) : (
          <FlatList
            data={businessTransactions.slice(0, 5)}
            renderItem={renderTransactionItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.transactionsList}
            scrollEnabled={false}
          />
        )}
      </View>
      </ScrollView>

      {/* ✅ Normal Add Funds modal (only opens when eligible) */}
      <AddFundsModal
        visible={showAddFundsModal}
        onClose={() => setShowAddFundsModal(false)}
      />

      <WithdrawFundsModal
        visible={showWithdrawModal}
        onClose={() => setShowWithdrawModal(false)}
      />

      {/* ✅ Beautiful popup when Add Funds is blocked */}
      <Modal
        visible={showAddFundsBlockedPopup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddFundsBlockedPopup(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.popupCard}>
            <View style={styles.popupHeader}>
              <View style={styles.popupIconWrap}>
                <MapPin size={18} color={Colors.dark.primary} />
              </View>
              <TouchableOpacity
                onPress={() => setShowAddFundsBlockedPopup(false)}
                style={styles.closeBtn}
              >
                <X size={18} color={Colors.dark.subtext} />
              </TouchableOpacity>
            </View>

            <Text style={styles.popupTitle}>Add Funds not available</Text>
            <Text style={styles.popupText}>
              This feature is not available in your location. Only{" "}
              <Text style={styles.popupTextStrong}>Nigeria private users</Text>{" "}
              can add funds to their wallet.
            </Text>

            {!!profileCountry && (
              <View style={styles.popupMetaRow}>
                <Text style={styles.popupMetaLabel}>Your country:</Text>
                <Text style={styles.popupMetaValue}>{profileCountry}</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.popupPrimaryBtn}
              onPress={() => setShowAddFundsBlockedPopup(false)}
              activeOpacity={0.9}
            >
              <Text style={styles.popupPrimaryBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 16,
    marginTop: 40,
  },
  reconcileContainer: {
    marginBottom: 16,
  },
  reconcileButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reconcileButton: {
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.dark.primary,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  reconcileButtonDisabled: {
    opacity: 0.75,
  },
  reconcileButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  reconcileMetaText: {
    marginTop: 8,
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  traceOrderButton: {
    marginLeft: 10,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  traceOrderButtonText: {
    color: Colors.dark.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  actionsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  actionButton: {
    alignItems: "center",
    width: "20%",
    marginBottom: 16,
  },
  actionButtonDisabled: {
    opacity: 0.65,
  },
  actionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(138, 43, 226, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  actionIconDisabled: {
    backgroundColor: "rgba(138, 43, 226, 0.08)",
  },
  actionText: {
    fontSize: 12,
    color: Colors.dark.text,
  },
  actionTextDisabled: {
    color: Colors.dark.subtext,
  },
  linkedBankContainer: {
    marginBottom: 20,
  },
  linkedBankHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  linkedBankCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  linkedBankIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(138, 43, 226, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  linkedBankTextWrap: {
    flex: 1,
  },
  linkedBankName: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.dark.text,
    marginBottom: 2,
  },
  linkedBankMeta: {
    fontSize: 13,
    color: Colors.dark.subtext,
  },
  linkedBankEmptyCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  linkedBankEmptyText: {
    fontSize: 13,
    color: Colors.dark.subtext,
    lineHeight: 18,
  },
  flowContainer: {
    marginBottom: 20,
  },
  flowCard: {
    marginTop: 12,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    paddingHorizontal: 14,
  },
  flowRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.divider,
  },
  flowLabel: { color: Colors.dark.subtext, fontSize: 13, flex: 1 },
  flowValue: { color: Colors.dark.text, fontSize: 13, fontWeight: "700" },
  flowCredit: { color: Colors.dark.success, fontSize: 13, fontWeight: "700" },
  flowPending: { color: Colors.dark.warning, fontSize: 13, fontWeight: "700" },
  flowAvailableRow: { borderBottomWidth: 0, minHeight: 50 },
  flowAvailableLabel: { color: Colors.dark.text, fontSize: 14, fontWeight: "700" },
  flowAvailableValue: { color: Colors.dark.success, fontSize: 16, fontWeight: "800" },
  transactionsContainer: {
    marginBottom: 8,
  },
  transactionsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  viewAllText: {
    fontSize: 14,
    color: Colors.dark.primary,
  },
  transactionsList: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    overflow: "hidden",
  },
  loadingContainer: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: "center",
  },

  // ✅ Popup styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  popupCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  popupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  popupIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(138, 43, 226, 0.14)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  popupTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.dark.text,
    marginBottom: 8,
  },
  popupText: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.dark.subtext,
    marginBottom: 14,
  },
  popupTextStrong: {
    color: Colors.dark.text,
    fontWeight: "700",
  },
  popupMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    marginBottom: 14,
  },
  popupMetaLabel: {
    color: Colors.dark.subtext,
    fontSize: 12,
  },
  popupMetaValue: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: "700",
  },
  popupPrimaryBtn: {
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.dark.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  popupPrimaryBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});














////////////////   old code




// import React, { useEffect, useMemo, useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   ActivityIndicator,
//   Modal,
// } from "react-native";
// import { useRouter } from "expo-router";
// import {
//   ArrowUpRight,
//   ArrowDownLeft,
//   Plus,
//   CreditCard,
//   Landmark,
//   History,
//   QrCode,
//   ScanLine,
//   X,
//   MapPin,
// } from "lucide-react-native";

// import Colors from "@/constants/colors";
// import { useWalletStore } from "@/store/wallet-store";
// import { useAuthStore } from "@/store/auth-store";
// import { supabase } from "@/lib/supabase";

// import WalletBalance from "@/components/WalletBalance";
// import TransactionItem from "@/components/TransactionItem";
// import AddFundsModal from "@/components/AddFundsModal";
// import WithdrawFundsModal from "@/components/WithdrawFundsModal";

// type ProfileRow = {
//   id: string;
//   is_business_account?: boolean | null;
//   isBusinessAccount?: boolean | null; // fallback if your column is camelCase
//   country?: string | null;
// };

// export default function WalletScreen() {
//   const router = useRouter();
//   const { user } = useAuthStore();
//   const { transactions, fetchWallet, fetchTransactions, isLoading } =
//     useWalletStore();

//   const [showAddFundsModal, setShowAddFundsModal] = useState(false);
//   const [showWithdrawModal, setShowWithdrawModal] = useState(false);

//   // ✅ Eligibility state for Add Funds (based on Supabase profile)
//   const [isCheckingEligibility, setIsCheckingEligibility] = useState(true);
//   const [isAddFundsEligible, setIsAddFundsEligible] = useState(false);
//   const [showAddFundsBlockedPopup, setShowAddFundsBlockedPopup] =
//     useState(false);

//   // Loaded from Supabase for messaging (optional)
//   const [profileCountry, setProfileCountry] = useState<string | null>(null);
//   const [isBusinessFromDb, setIsBusinessFromDb] = useState<boolean | null>(null);

//   useEffect(() => {
//     fetchWallet();
//     fetchTransactions();
//   }, []);

//   // ✅ Fetch user type + country from Supabase and determine eligibility
//   useEffect(() => {
//     let mounted = true;

//     const checkEligibility = async () => {
//       try {
//         setIsCheckingEligibility(true);

//         const authUserId = user?.id;
//         if (!authUserId) {
//           if (!mounted) return;
//           // If no user, safest is to disable
//           setIsAddFundsEligible(false);
//           return;
//         }

//         // NOTE: Change table name/columns if your schema differs
//         const { data, error } = await supabase
//           .from("profiles")
//           .select("id,country,is_business_account,isBusinessAccount")
//           .eq("id", authUserId)
//           .single<ProfileRow>();

//         if (error) throw error;

//         const dbIsBusiness =
//           (data?.is_business_account ?? data?.isBusinessAccount ?? null) === true;

//         const dbCountry = (data?.country ?? "").trim();
//         if (!mounted) return;

//         setProfileCountry(dbCountry || null);
//         setIsBusinessFromDb(dbIsBusiness);

//         // ✅ Rule:
//         // - Only PRIVATE users in Nigeria can Add Funds
//         // - Business users => not eligible (as per your requirement)
//         const isNigeria = dbCountry.toLowerCase() === "nigeria";
//         const eligible = !dbIsBusiness && isNigeria;

//         setIsAddFundsEligible(eligible);
//       } catch (e) {
//         // If any error, keep it disabled (safer)
//         if (!mounted) return;
//         setIsAddFundsEligible(false);
//       } finally {
//         if (!mounted) return;
//         setIsCheckingEligibility(false);
//       }
//     };

//     checkEligibility();

//     return () => {
//       mounted = false;
//     };
//   }, [user?.id]);

//   const isBusinessAccount = useMemo(() => {
//     // Prefer Supabase value when available, fallback to auth store
//     if (isBusinessFromDb !== null) return isBusinessFromDb;
//     return !!user?.isBusinessAccount;
//   }, [isBusinessFromDb, user?.isBusinessAccount]);

//   const handleAddFunds = () => {
//     if (isCheckingEligibility) return;

//     if (!isAddFundsEligible) {
//       setShowAddFundsBlockedPopup(true);
//       return;
//     }
//     setShowAddFundsModal(true);
//   };

//   const handleSendMoney = () => {
//     router.push("/send-money");
//   };

//   const handleReceiveMoney = () => {
//     router.push("/receive-money");
//   };

//   const handleScanQR = () => {
//     router.push("/scan-qr");
//   };

//   const handleWithdraw = () => {
//     setShowWithdrawModal(true);
//   };

//   const handleViewAllTransactions = () => {
//     router.push("/transactions");
//   };

//   const handleManagePaymentMethods = () => {
//     router.push("/payment-methods");
//   };

//   const handleManageBankAccounts = () => {
//     router.push("/bank-accounts");
//   };

//   const handleTestPayment = () => {
//     router.push("/test-payment");
//   };

//   const handleTransactionPress = (transaction: any) => {
//     router.push({
//       pathname: "/transaction-details",
//       params: { id: transaction.id },
//     });
//   };

//   const renderTransactionItem = ({ item }: { item: any }) => (
//     <TransactionItem transaction={item} onPress={handleTransactionPress} />
//   );

//   const addFundsDisabled = isCheckingEligibility || !isAddFundsEligible;

//   return (
//     <View style={styles.container}>
//       <Text style={styles.title}>Wallet</Text>

//       <WalletBalance
//         onAddFunds={handleAddFunds}
//         onSend={handleSendMoney}
//         onWithdraw={isBusinessAccount ? handleWithdraw : undefined}
//       />

//       <View style={styles.actionsContainer}>
//         {/* ✅ Add Funds (with eligibility check) */}
//         <TouchableOpacity
//           style={[
//             styles.actionButton,
//             addFundsDisabled ? styles.actionButtonDisabled : null,
//           ]}
//           onPress={handleAddFunds}
//           activeOpacity={0.85}
//         >
//           <View
//             style={[
//               styles.actionIconContainer,
//               addFundsDisabled ? styles.actionIconDisabled : null,
//             ]}
//           >
//             {isCheckingEligibility ? (
//               <ActivityIndicator size="small" color={Colors.dark.primary} />
//             ) : (
//               <Plus size={20} color={Colors.dark.primary} />
//             )}
//           </View>
//           <Text
//             style={[
//               styles.actionText,
//               addFundsDisabled ? styles.actionTextDisabled : null,
//             ]}
//           >
//             Add Funds
//           </Text>
//         </TouchableOpacity>

//         <TouchableOpacity style={styles.actionButton} onPress={handleSendMoney}>
//           <View style={styles.actionIconContainer}>
//             <ArrowUpRight size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Send</Text>
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={styles.actionButton}
//           onPress={handleReceiveMoney}
//         >
//           <View style={styles.actionIconContainer}>
//             <QrCode size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Receive</Text>
//         </TouchableOpacity>

//         <TouchableOpacity style={styles.actionButton} onPress={handleScanQR}>
//           <View style={styles.actionIconContainer}>
//             <ScanLine size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Scan</Text>
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={styles.actionButton}
//           onPress={handleTestPayment}
//         >
//           <View style={styles.actionIconContainer}>
//             <CreditCard size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Test Payment</Text>
//         </TouchableOpacity>

//         {isBusinessAccount && (
//           <TouchableOpacity style={styles.actionButton} onPress={handleWithdraw}>
//             <View style={styles.actionIconContainer}>
//               <ArrowDownLeft size={20} color={Colors.dark.primary} />
//             </View>
//             <Text style={styles.actionText}>Withdraw</Text>
//           </TouchableOpacity>
//         )}
//       </View>

//       <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 24 }}>
//         <TouchableOpacity
//           style={styles.actionButton}
//           onPress={handleManagePaymentMethods}
//         >
//           <View style={styles.actionIconContainer}>
//             <CreditCard size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Cards</Text>
//         </TouchableOpacity>

//         {isBusinessAccount && (
//           <TouchableOpacity
//             style={styles.actionButton}
//             onPress={handleManageBankAccounts}
//           >
//             <View style={styles.actionIconContainer}>
//               <Landmark size={20} color={Colors.dark.primary} />
//             </View>
//             <Text style={styles.actionText}>Bank</Text>
//           </TouchableOpacity>
//         )}
//       </View>

//       <View style={styles.transactionsContainer}>
//         <View style={styles.transactionsHeader}>
//           <Text style={styles.sectionTitle}>Recent Transactions</Text>
//           <TouchableOpacity onPress={handleViewAllTransactions}>
//             <Text style={styles.viewAllText}>View All</Text>
//           </TouchableOpacity>
//         </View>

//         {isLoading && transactions.length === 0 ? (
//           <View style={styles.loadingContainer}>
//             <ActivityIndicator size="small" color={Colors.dark.primary} />
//           </View>
//         ) : transactions.length === 0 ? (
//           <View style={styles.emptyContainer}>
//             <History size={48} color={Colors.dark.subtext} />
//             <Text style={styles.emptyText}>No transactions yet</Text>
//           </View>
//         ) : (
//           <FlatList
//             data={transactions.slice(0, 5)}
//             renderItem={renderTransactionItem}
//             keyExtractor={(item) => item.id}
//             contentContainerStyle={styles.transactionsList}
//           />
//         )}
//       </View>

//       {/* ✅ Normal Add Funds modal (only opens when eligible) */}
//       <AddFundsModal
//         visible={showAddFundsModal}
//         onClose={() => setShowAddFundsModal(false)}
//       />

//       <WithdrawFundsModal
//         visible={showWithdrawModal}
//         onClose={() => setShowWithdrawModal(false)}
//       />

//       {/* ✅ Beautiful popup when Add Funds is blocked */}
//       <Modal
//         visible={showAddFundsBlockedPopup}
//         transparent
//         animationType="fade"
//         onRequestClose={() => setShowAddFundsBlockedPopup(false)}
//       >
//         <View style={styles.modalOverlay}>
//           <View style={styles.popupCard}>
//             <View style={styles.popupHeader}>
//               <View style={styles.popupIconWrap}>
//                 <MapPin size={18} color={Colors.dark.primary} />
//               </View>
//               <TouchableOpacity
//                 onPress={() => setShowAddFundsBlockedPopup(false)}
//                 style={styles.closeBtn}
//               >
//                 <X size={18} color={Colors.dark.subtext} />
//               </TouchableOpacity>
//             </View>

//             <Text style={styles.popupTitle}>Add Funds not available</Text>
//             <Text style={styles.popupText}>
//               This feature is not available in your location. Only{" "}
//               <Text style={styles.popupTextStrong}>Nigeria private users</Text>{" "}
//               can add funds to their wallet.
//             </Text>

//             {!!profileCountry && (
//               <View style={styles.popupMetaRow}>
//                 <Text style={styles.popupMetaLabel}>Your country:</Text>
//                 <Text style={styles.popupMetaValue}>{profileCountry}</Text>
//               </View>
//             )}

//             <TouchableOpacity
//               style={styles.popupPrimaryBtn}
//               onPress={() => setShowAddFundsBlockedPopup(false)}
//               activeOpacity={0.9}
//             >
//               <Text style={styles.popupPrimaryBtnText}>OK</Text>
//             </TouchableOpacity>
//           </View>
//         </View>
//       </Modal>
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//     padding: 16,
//   },
//   title: {
//     fontSize: 24,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 16,
//     marginTop: 40,
//   },
//   actionsContainer: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "space-between",
//     marginBottom: 24,
//   },
//   actionButton: {
//     alignItems: "center",
//     width: "20%",
//     marginBottom: 16,
//   },
//   actionButtonDisabled: {
//     opacity: 0.65,
//   },
//   actionIconContainer: {
//     width: 48,
//     height: 48,
//     borderRadius: 24,
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     justifyContent: "center",
//     alignItems: "center",
//     marginBottom: 8,
//   },
//   actionIconDisabled: {
//     backgroundColor: "rgba(138, 43, 226, 0.08)",
//   },
//   actionText: {
//     fontSize: 12,
//     color: Colors.dark.text,
//   },
//   actionTextDisabled: {
//     color: Colors.dark.subtext,
//   },
//   transactionsContainer: {
//     flex: 1,
//   },
//   transactionsHeader: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     marginBottom: 12,
//   },
//   sectionTitle: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   viewAllText: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//   },
//   transactionsList: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     overflow: "hidden",
//   },
//   loadingContainer: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 20,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   emptyContainer: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 40,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   emptyText: {
//     marginTop: 16,
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//   },

//   // ✅ Popup styles
//   modalOverlay: {
//     flex: 1,
//     backgroundColor: "rgba(0,0,0,0.55)",
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   popupCard: {
//     width: "100%",
//     maxWidth: 420,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 16,
//     padding: 16,
//     borderWidth: 1,
//     borderColor: "rgba(255,255,255,0.06)",
//   },
//   popupHeader: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     marginBottom: 10,
//   },
//   popupIconWrap: {
//     width: 34,
//     height: 34,
//     borderRadius: 17,
//     backgroundColor: "rgba(138, 43, 226, 0.14)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   closeBtn: {
//     width: 34,
//     height: 34,
//     borderRadius: 17,
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: "rgba(255,255,255,0.05)",
//   },
//   popupTitle: {
//     fontSize: 18,
//     fontWeight: "800",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   popupText: {
//     fontSize: 14,
//     lineHeight: 20,
//     color: Colors.dark.subtext,
//     marginBottom: 14,
//   },
//   popupTextStrong: {
//     color: Colors.dark.text,
//     fontWeight: "700",
//   },
//   popupMetaRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     paddingVertical: 10,
//     paddingHorizontal: 12,
//     backgroundColor: "rgba(255,255,255,0.04)",
//     borderRadius: 12,
//     marginBottom: 14,
//   },
//   popupMetaLabel: {
//     color: Colors.dark.subtext,
//     fontSize: 12,
//   },
//   popupMetaValue: {
//     color: Colors.dark.text,
//     fontSize: 12,
//     fontWeight: "700",
//   },
//   popupPrimaryBtn: {
//     height: 44,
//     borderRadius: 12,
//     backgroundColor: Colors.dark.primary,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   popupPrimaryBtnText: {
//     color: "#fff",
//     fontSize: 14,
//     fontWeight: "800",
//     letterSpacing: 0.3,
//   },
// });
















// import React, { useState, useEffect } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   FlatList,
//   ActivityIndicator,
// } from "react-native";
// import { useRouter } from "expo-router";
// import {
//   Wallet,
//   ArrowUpRight,
//   ArrowDownLeft,
//   Plus,
//   CreditCard,
//   Landmark,
//   History,
//   QrCode,
//   ScanLine,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { useWalletStore } from "@/store/wallet-store";
// import { useAuthStore } from "@/store/auth-store";
// import WalletBalance from "@/components/WalletBalance";
// import TransactionItem from "@/components/TransactionItem";
// import AddFundsModal from "@/components/AddFundsModal";
// import WithdrawFundsModal from "@/components/WithdrawFundsModal";

// export default function WalletScreen() {
//   const router = useRouter();
//   const { user } = useAuthStore();
//   const { wallet, transactions, fetchWallet, fetchTransactions, isLoading } =
//     useWalletStore();

//   const [showAddFundsModal, setShowAddFundsModal] = useState(false);
//   const [showWithdrawModal, setShowWithdrawModal] = useState(false);

//   useEffect(() => {
//     fetchWallet();
//     fetchTransactions();
//   }, []);

//   const handleAddFunds = () => {
//     setShowAddFundsModal(true);
//   };

//   const handleSendMoney = () => {
//     router.push("/send-money");
//   };

//   const handleReceiveMoney = () => {
//     router.push("/receive-money");
//   };

//   const handleScanQR = () => {
//     router.push("/scan-qr");
//   };

//   const handleWithdraw = () => {
//     setShowWithdrawModal(true);
//   };

//   const handleViewAllTransactions = () => {
//     router.push("/transactions");
//   };

//   const handleManagePaymentMethods = () => {
//     router.push("/payment-methods");
//   };

//   const handleManageBankAccounts = () => {
//     router.push("/bank-accounts");
//   };

//   const handleTestPayment = () => {
//     router.push("/test-payment");
//   };

//   const handleTransactionPress = (transaction: any) => {
//     router.push({
//       pathname: "/transaction-details",
//       params: { id: transaction.id },
//     });
//   };

//   const renderTransactionItem = ({ item }: { item: any }) => (
//     <TransactionItem transaction={item} onPress={handleTransactionPress} />
//   );

//   return (
//     <View style={styles.container}>
//       <Text style={styles.title}>Wallet</Text>

//       <WalletBalance
//         onAddFunds={handleAddFunds}
//         onSend={handleSendMoney}
//         onWithdraw={user?.isBusinessAccount ? handleWithdraw : undefined}
//       />

//       <View style={styles.actionsContainer}>
//         <TouchableOpacity style={styles.actionButton} onPress={handleAddFunds}>
//           <View style={styles.actionIconContainer}>
//             <Plus size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Add Funds</Text>
//         </TouchableOpacity>

//         <TouchableOpacity style={styles.actionButton} onPress={handleSendMoney}>
//           <View style={styles.actionIconContainer}>
//             <ArrowUpRight size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Send</Text>
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={styles.actionButton}
//           onPress={handleReceiveMoney}
//         >
//           <View style={styles.actionIconContainer}>
//             <QrCode size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Receive</Text>
//         </TouchableOpacity>

//         <TouchableOpacity style={styles.actionButton} onPress={handleScanQR}>
//           <View style={styles.actionIconContainer}>
//             <ScanLine size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Scan</Text>
//         </TouchableOpacity>

//         <TouchableOpacity style={styles.actionButton} onPress={handleTestPayment}>
//           <View style={styles.actionIconContainer}>
//             <CreditCard size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Test Payment</Text>
//         </TouchableOpacity>

//         {user?.isBusinessAccount && (
//           <TouchableOpacity
//             style={styles.actionButton}
//             onPress={handleWithdraw}
//           >
//             <View style={styles.actionIconContainer}>
//               <ArrowDownLeft size={20} color={Colors.dark.primary} />
//             </View>
//             <Text style={styles.actionText}>Withdraw</Text>
//           </TouchableOpacity>
//         )}

//         {/* <TouchableOpacity style={styles.actionButton} onPress={handleManagePaymentMethods}>
//           <View style={styles.actionIconContainer}>
//             <CreditCard size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Cards</Text>
//         </TouchableOpacity>
        
//         {user?.isBusinessAccount && (
//           <TouchableOpacity style={styles.actionButton} onPress={handleManageBankAccounts}>
//             <View style={styles.actionIconContainer}>
//               <Landmark size={20} color={Colors.dark.primary} />
//             </View>
//             <Text style={styles.actionText}>Bank</Text>
//           </TouchableOpacity>
//         )} */}
//       </View>

//       <View
//         style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 24 }}
//       >
//         <TouchableOpacity
//           style={styles.actionButton}
//           onPress={handleManagePaymentMethods}
//         >
//           <View style={styles.actionIconContainer}>
//             <CreditCard size={20} color={Colors.dark.primary} />
//           </View>
//           <Text style={styles.actionText}>Cards</Text>
//         </TouchableOpacity>

//         {user?.isBusinessAccount && (
//           <TouchableOpacity
//             style={styles.actionButton}
//             onPress={handleManageBankAccounts}
//           >
//             <View style={styles.actionIconContainer}>
//               <Landmark size={20} color={Colors.dark.primary} />
//             </View>
//             <Text style={styles.actionText}>Bank</Text>
//           </TouchableOpacity>
//         )}
//       </View>

//       <View style={styles.transactionsContainer}>
//         <View style={styles.transactionsHeader}>
//           <Text style={styles.sectionTitle}>Recent Transactions</Text>
//           <TouchableOpacity onPress={handleViewAllTransactions}>
//             <Text style={styles.viewAllText}>View All</Text>
//           </TouchableOpacity>
//         </View>

//         {isLoading && transactions.length === 0 ? (
//           <View style={styles.loadingContainer}>
//             <ActivityIndicator size="small" color={Colors.dark.primary} />
//           </View>
//         ) : transactions.length === 0 ? (
//           <View style={styles.emptyContainer}>
//             <History size={48} color={Colors.dark.subtext} />
//             <Text style={styles.emptyText}>No transactions yet</Text>
//           </View>
//         ) : (
//           <FlatList
//             data={transactions.slice(0, 5)}
//             renderItem={renderTransactionItem}
//             keyExtractor={(item) => item.id}
//             contentContainerStyle={styles.transactionsList}
//           />
//         )}
//       </View>

//       <AddFundsModal
//         visible={showAddFundsModal}
//         onClose={() => setShowAddFundsModal(false)}
//       />

//       <WithdrawFundsModal
//         visible={showWithdrawModal}
//         onClose={() => setShowWithdrawModal(false)}
//       />
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//     padding: 16,
//   },
//   title: {
//     fontSize: 24,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 16,
//     marginTop: 40,
//   },
//   actionsContainer: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "space-between",
//     marginBottom: 24,
//   },
//   actionButton: {
//     alignItems: "center",
//     width: "20%",
//     marginBottom: 16,
//   },
//   actionIconContainer: {
//     width: 48,
//     height: 48,
//     borderRadius: 24,
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     justifyContent: "center",
//     alignItems: "center",
//     marginBottom: 8,
//   },
//   actionText: {
//     fontSize: 12,
//     color: Colors.dark.text,
//   },
//   transactionsContainer: {
//     flex: 1,
//   },
//   transactionsHeader: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     marginBottom: 12,
//   },
//   sectionTitle: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   viewAllText: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//   },
//   transactionsList: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     overflow: "hidden",
//   },
//   loadingContainer: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 20,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   emptyContainer: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 40,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   emptyText: {
//     marginTop: 16,
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//   },
// });
