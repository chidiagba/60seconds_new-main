import React, { useEffect, useMemo, useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  TextInput, 
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Landmark, CheckCircle, AlertCircle, Search, ChevronDown, Check, X } from 'lucide-react-native';
import { getAllCountries, FlagType, type Country as PickerCountry } from 'react-native-country-picker-modal';
import Colors from '@/constants/colors';
import { useWalletStore } from '@/store/wallet-store';
import { useAuthStore } from '@/store/auth-store';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { resolveCurrencyFromCountry } from '@/utils/country-currency';
import {
  getBankFieldRequirement,
  getBanksForCountry,
  isValidIban,
  isValidSwift,
  normalizeIban,
  normalizeSwift,
} from '@/utils/bank-directory';

type CountryOption = {
  code: string;
  name: string;
  flag: string;
  searchValue: string;
};

const normalizeCountryName = (name: PickerCountry['name']) => {
  if (typeof name === 'string') {
    return name;
  }

  return String((name as any)?.common || '');
};

const sanitizeAccountNumber = (value: string, isIban: boolean) => {
  const trimmed = value.trim();
  if (isIban) return normalizeIban(trimmed);
  return trimmed.replace(/\s+/g, '');
};

export default function BankAccountsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { user: authUser, profile } = useAuth();
  const { 
    businessBankAccount, 
    fetchBusinessBankAccount, 
    addBusinessBankAccount,
    updateBusinessBankAccount,
    isLoading,
    error: walletError,
  } = useWalletStore();
  
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [swiftCode, setSwiftCode] = useState('');
  const [country, setCountry] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [countrySearch, setCountrySearch] = useState('');
  const [isCountryModalVisible, setIsCountryModalVisible] = useState(false);
  const [allCountries, setAllCountries] = useState<CountryOption[]>([]);
  const [isCountryListLoading, setIsCountryListLoading] = useState(true);
  const [suggestedBanks, setSuggestedBanks] = useState<string[]>(getBanksForCountry(''));
  const [isBankListLoading, setIsBankListLoading] = useState(false);
  const [showBankDropdown, setShowBankDropdown] = useState(false);
  const [bankSearch, setBankSearch] = useState('');
  const [payoutProvider, setPayoutProvider] = useState<'stripe' | 'paystack'>('stripe');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const loggedInEmail = (profile?.email || authUser?.email || user?.email || '').trim().toLowerCase();
  const loggedInName = (profile?.full_name || user?.name || '').trim();

  const bankRequirement = useMemo(() => getBankFieldRequirement(countryCode), [countryCode]);
  const filteredBanks = useMemo(() => {
    const query = bankSearch.trim().toLowerCase();
    if (!query) return suggestedBanks;
    return suggestedBanks.filter((entry) => entry.toLowerCase().includes(query));
  }, [suggestedBanks, bankSearch]);
  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    if (!query) return allCountries;
    return allCountries.filter((entry) => entry.searchValue.includes(query));
  }, [allCountries, countrySearch]);

  const countryBadge = countryCode ? `${country} (${countryCode})` : country || 'Select country';
  const verificationState = businessBankAccount?.verificationStatus || (businessBankAccount?.isVerified ? 'verified' : 'pending');
  const verificationReason = businessBankAccount?.verificationReason || '';

  useEffect(() => {
    let mounted = true;

    const loadCountries = async () => {
      try {
        const countries = await getAllCountries(FlagType.EMOJI, 'common');
        if (!mounted) return;

        const mapped = countries
          .map((entry) => {
            const displayName = normalizeCountryName(entry.name);
            return {
              code: entry.cca2,
              name: displayName,
              flag: entry.flag || '🌍',
              searchValue: `${displayName} ${entry.cca2}`.toLowerCase(),
            };
          })
          .sort((left, right) => left.name.localeCompare(right.name));

        setAllCountries(mapped);
      } catch (error) {
        console.error('Failed to load countries for bank accounts:', error);
      } finally {
        if (mounted) {
          setIsCountryListLoading(false);
        }
      }
    };

    void loadCountries();

    return () => {
      mounted = false;
    };
  }, []);
  
  useEffect(() => {
    if (!user?.isBusinessAccount) {
      Alert.alert(
        "Business Account Required",
        "Only business accounts can manage bank accounts.",
        [{ text: "OK", onPress: () => router.back() }]
      );
      return;
    }
    
    void fetchBusinessBankAccount();
  }, [user?.isBusinessAccount, fetchBusinessBankAccount]);

  useEffect(() => {
    if (allCountries.length === 0) return;

    const profileCode = (profile?.country_code || '').trim().toUpperCase();
    const profileCountry = (profile?.country || '').trim();

    if (countryCode || country) return;

    if (profileCode) {
      const matched = allCountries.find((entry) => entry.code === profileCode);
      if (matched) {
        setCountryCode(matched.code);
        setCountry(matched.name);
        return;
      }
    }

    if (profileCountry) {
      const matched = allCountries.find((entry) => entry.name.toLowerCase() === profileCountry.toLowerCase());
      if (matched) {
        setCountryCode(matched.code);
        setCountry(matched.name);
      }
    }
  }, [allCountries, profile?.country_code, profile?.country, countryCode, country]);

  useEffect(() => {
    let mounted = true;

    const loadBanks = async () => {
      const normalizedCode = countryCode.trim().toUpperCase();

      if (!normalizedCode) {
        setSuggestedBanks(getBanksForCountry(normalizedCode));
        return;
      }

      if (normalizedCode !== 'NG') {
        setSuggestedBanks(getBanksForCountry(normalizedCode));
        return;
      }

      setIsBankListLoading(true);

      try {
        const { data, error } = await supabase.functions.invoke('paystack-bank-list', {
          body: { countryCode: 'NG' },
        });

        if (error) {
          throw new Error(error.message || 'Failed to load Paystack bank list');
        }

        const banks = Array.isArray(data?.banks)
          ? data.banks
              .map((entry: any) => String(entry?.name || '').trim())
              .filter((entry: string) => entry.length > 0)
          : [];

        if (!mounted) return;

        setSuggestedBanks(banks.length > 0 ? banks : getBanksForCountry('NG'));
      } catch (error) {
        console.error('Failed to load Paystack bank list:', error);
        if (!mounted) return;
        setSuggestedBanks(getBanksForCountry('NG'));
      } finally {
        if (mounted) {
          setIsBankListLoading(false);
        }
      }
    };

    void loadBanks();

    return () => {
      mounted = false;
    };
  }, [countryCode]);
  
  useEffect(() => {
    if (businessBankAccount && !isEditing) {
      setAccountName(businessBankAccount.accountName);
      setAccountNumber(businessBankAccount.iban || businessBankAccount.accountNumber);
      setRoutingNumber(businessBankAccount.routingNumber || '');
      setSwiftCode(businessBankAccount.swiftCode || '');
      setBankName(businessBankAccount.bankName);
      setPayoutProvider(businessBankAccount.payoutProvider || 'stripe');
      if (businessBankAccount.country) {
        setCountry(businessBankAccount.country);
      }
    } else if (!businessBankAccount && !isEditing && loggedInName) {
      setAccountName(loggedInName);
    }
  }, [businessBankAccount, isEditing, loggedInName]);
  
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabsbusiness)/wallet');
  };
  
  const handleEdit = () => {
    setIsEditing(true);
  };
  
  const handleCancel = () => {
    if (businessBankAccount) {
      setAccountName(businessBankAccount.accountName);
      setAccountNumber(businessBankAccount.iban || businessBankAccount.accountNumber);
      setRoutingNumber(businessBankAccount.routingNumber || '');
      setSwiftCode(businessBankAccount.swiftCode || '');
      setBankName(businessBankAccount.bankName);
      setCountry(businessBankAccount.country || country);
      setPayoutProvider(businessBankAccount.payoutProvider || 'stripe');
    } else {
      setAccountName(loggedInName);
      setAccountNumber('');
      setRoutingNumber('');
      setSwiftCode('');
      setBankName('');
      setPayoutProvider('stripe');
    }
    setBankSearch('');
    setShowBankDropdown(false);
    setIsEditing(false);
  };

  const handleCountrySelect = (entry: CountryOption) => {
    setCountry(entry.name);
    setCountryCode(entry.code);
    setCountrySearch('');
    setIsCountryModalVisible(false);
    setBankName('');
    setBankSearch('');
    setRoutingNumber('');
    setSwiftCode('');
    if (entry.code === 'NG') {
      setPayoutProvider('paystack');
    } else {
      setPayoutProvider('stripe');
    }
  };
  
  const validateForm = () => {
    const accountIsIban = bankRequirement.identifierType === 'iban';
    const cleanedAccountNumber = sanitizeAccountNumber(accountNumber, accountIsIban);

    if (!countryCode || !country) {
      Alert.alert('Error', 'Please select your country.');
      return false;
    }

    if (!loggedInEmail) {
      Alert.alert('Error', 'Could not read your login email. Please sign in again.');
      return false;
    }

    if (!accountName.trim()) {
      Alert.alert('Error', 'Please enter account holder name exactly as registered with your bank.');
      return false;
    }

    if (!bankName.trim()) {
      Alert.alert('Error', 'Please choose or enter a bank name.');
      return false;
    }

    if (!cleanedAccountNumber) {
      Alert.alert('Error', `Please enter ${bankRequirement.identifierLabel}.`);
      return false;
    }

    if (accountIsIban && !isValidIban(cleanedAccountNumber)) {
      Alert.alert('Error', 'Please enter a valid IBAN format.');
      return false;
    }

    if (bankRequirement.secondaryFieldType === 'routing' && bankRequirement.secondaryRequired && !routingNumber.trim()) {
      Alert.alert('Error', `Please enter ${bankRequirement.secondaryLabel}.`);
      return false;
    }

    if (bankRequirement.secondaryFieldType === 'swift') {
      const normalizedSwift = normalizeSwift(swiftCode);
      if (bankRequirement.secondaryRequired && !normalizedSwift) {
        Alert.alert('Error', 'Please enter SWIFT / BIC code.');
        return false;
      }

      if (normalizedSwift && !isValidSwift(normalizedSwift)) {
        Alert.alert('Error', 'Please enter a valid SWIFT / BIC code.');
        return false;
      }
    }

    if (bankRequirement.secondaryFieldType === 'routing' && swiftCode.trim()) {
      const normalizedSwift = normalizeSwift(swiftCode);
      if (!isValidSwift(normalizedSwift)) {
        Alert.alert('Error', 'Optional SWIFT code is invalid.');
        return false;
      }
    }
    
    return true;
  };
  
  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);

    const accountIsIban = bankRequirement.identifierType === 'iban';
    const normalizedAccountNumber = sanitizeAccountNumber(accountNumber, accountIsIban);
    const normalizedSwiftCode = normalizeSwift(swiftCode);
    const currency = resolveCurrencyFromCountry({
      country,
      countryCode,
      fallbackCurrency: 'USD',
    });
    
    const bankAccountData = {
      accountName: accountName.trim(),
      accountNumber: normalizedAccountNumber,
      routingNumber: bankRequirement.secondaryFieldType === 'routing' ? routingNumber.trim() : '',
      iban: accountIsIban ? normalizedAccountNumber : '',
      swiftCode: normalizedSwiftCode || '',
      bankName: bankName.trim(),
      payoutProvider,
      country,
      countryCode,
      currency,
    };

    const isStripeNonNgFlow =
      payoutProvider === 'stripe' && String(countryCode || '').trim().toUpperCase() !== 'NG';
    const isCreateFlow = !businessBankAccount;

    const resolveAndConfirmPaystackAccount = async (): Promise<string | null> => {
      const { data, error } = await supabase.functions.invoke('paystack-verify-business-bank-account', {
        body: {
          accountName: bankAccountData.accountName,
          accountNumber: bankAccountData.accountNumber,
          bankName: bankAccountData.bankName,
          bankCode: '',
          countryCode: bankAccountData.countryCode,
          currency: bankAccountData.currency,
          resolveOnly: true,
        },
      });

      if (error) {
        Alert.alert('Save failed', error.message || 'Could not verify this bank account with Paystack.');
        return null;
      }

      if (!data?.verified) {
        Alert.alert('Save failed', data?.verificationReason || 'Could not verify this bank account with Paystack.');
        return null;
      }

      const resolvedName = String(data?.accountName || bankAccountData.accountName || '').trim();

      return await new Promise<string | null>((resolve) => {
        Alert.alert(
          'Confirm Bank Account',
          `Paystack found account name:\n${resolvedName}\n\nDo you want to save this bank account?`,
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => resolve(null),
            },
            {
              text: 'Confirm',
              onPress: () => resolve(resolvedName),
            },
          ],
          { cancelable: true, onDismiss: () => resolve(null) }
        );
      });
    };
    
    try {
      if (payoutProvider === 'paystack' && countryCode === 'NG') {
        const confirmedAccountName = await resolveAndConfirmPaystackAccount();
        if (!confirmedAccountName) {
          return;
        }
        bankAccountData.accountName = confirmedAccountName;
        setAccountName(confirmedAccountName);
      }

      let success;

      if (businessBankAccount) {
        success = await updateBusinessBankAccount(bankAccountData);
      } else {
        success = await addBusinessBankAccount(bankAccountData);
      }

      if (success) {
        await fetchBusinessBankAccount();
        const latestBankAccount = useWalletStore.getState().businessBankAccount;
        const latestIsPaystackNg =
          String(latestBankAccount?.payoutProvider || '').trim().toLowerCase() === 'paystack' &&
          String(latestBankAccount?.countryCode || '').trim().toUpperCase() === 'NG';
        const latestRoutingReady =
          Boolean(String(latestBankAccount?.paystackRecipientCode || '').trim()) &&
          Boolean(String(latestBankAccount?.paystackSubaccountCode || '').trim());

        if (isCreateFlow && isStripeNonNgFlow) {
          setShowSuccessDialog(true);
        } else {
          const successMessage = latestIsPaystackNg
            ? latestRoutingReady
              ? 'Bank account saved and verified. Paystack recipient/subaccount routing is ready for split payments and withdrawals.'
              : 'Bank account saved, but Paystack routing is still incomplete. Please re-check your details to finish recipient/subaccount setup.'
            : businessBankAccount
              ? 'Bank account updated successfully.'
              : 'Bank account added successfully.';

          Alert.alert(
            'Success',
            successMessage,
            [{ text: 'OK' }]
          );
        }
        setIsEditing(false);
        return;
      }

      const latestError = useWalletStore.getState().error;
      Alert.alert('Save failed', latestError || walletError || 'Could not save bank account. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };
  
  if (!user?.isBusinessAccount) {
    return null;
  }
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Bank Account</Text>
        <View style={styles.placeholder} />
      </View>
      
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        {isLoading && !businessBankAccount && !isSaving ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.dark.primary} />
          </View>
        ) : (
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
            keyboardShouldPersistTaps="handled"
          >
          {businessBankAccount && !isEditing ? (
            <View style={styles.bankAccountCard}>
              <View style={styles.bankIconContainer}>
                <Landmark size={32} color={Colors.dark.primary} />
              </View>
              
              <Text style={styles.bankName}>{businessBankAccount.bankName}</Text>
              <Text style={styles.accountName}>{businessBankAccount.accountName}</Text>
              <Text style={styles.countryLabel}>{businessBankAccount.country || 'Country not set'}</Text>
              <Text style={styles.loginEmailLabel}>Linked login email: {loggedInEmail || 'N/A'}</Text>
              <Text style={styles.providerLabel}>Payout provider: {businessBankAccount.payoutProvider === 'paystack' ? 'Paystack' : 'Stripe'}</Text>

              <View style={styles.accountTagsRow}>
                <View style={styles.primaryTag}>
                  <Text style={styles.primaryTagText}>{businessBankAccount.isPrimary === false ? 'SECONDARY' : 'PRIMARY'}</Text>
                </View>
                {verificationState === 'verified' ? (
                  <View style={styles.verifiedTag}>
                    <Text style={styles.verifiedTagText}>VERIFIED</Text>
                  </View>
                ) : null}
              </View>
              
              <View style={styles.accountDetails}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{businessBankAccount.iban ? 'IBAN' : 'Account Number'}</Text>
                  <Text style={styles.detailValue}>{businessBankAccount.iban || businessBankAccount.accountNumber}</Text>
                </View>

                {!!businessBankAccount.routingNumber && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Routing / Sort Code</Text>
                    <Text style={styles.detailValue}>{businessBankAccount.routingNumber}</Text>
                  </View>
                )}

                {!!businessBankAccount.swiftCode && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>SWIFT / BIC</Text>
                    <Text style={styles.detailValue}>{businessBankAccount.swiftCode}</Text>
                  </View>
                )}
              </View>
              
              <View style={styles.verificationStatus}>
                {verificationState === 'verified' ? (
                  <>
                    <CheckCircle size={20} color={Colors.dark.success} />
                    <Text style={styles.verifiedText}>Verified</Text>
                  </>
                ) : verificationState === 'failed' ? (
                  <>
                    <AlertCircle size={20} color={Colors.dark.error || '#FF6B6B'} />
                    <Text style={styles.failedText}>Verification Failed</Text>
                  </>
                ) : (
                  <>
                    <AlertCircle size={20} color="#FFC107" />
                    <Text style={styles.unverifiedText}>Verification Pending</Text>
                  </>
                )}
              </View>

              {(verificationState === 'failed' || verificationState === 'pending') && !!verificationReason && (
                <Text style={styles.verificationReasonText}>{verificationReason}</Text>
              )}
              
              <TouchableOpacity 
                style={styles.editButton}
                onPress={handleEdit}
              >
                <Text style={styles.editButtonText}>Edit Bank Account</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.formContainer}>
              <Text style={styles.formTitle}>
                {businessBankAccount ? 'Edit Bank Account' : 'Add Bank Account'}
              </Text>
              
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Linked Login Email</Text>
                <View style={styles.readonlyField}>
                  <Text style={styles.readonlyFieldText}>{loggedInEmail || 'Not available'}</Text>
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Country</Text>
                <TouchableOpacity
                  style={styles.selectInput}
                  onPress={() => setIsCountryModalVisible(true)}
                  disabled={!(isEditing || !businessBankAccount)}
                >
                  <Text style={styles.selectInputText}>{countryBadge}</Text>
                  <ChevronDown size={18} color={Colors.dark.subtext} />
                </TouchableOpacity>
              </View>

              {countryCode === 'NG' && (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Payout Provider</Text>
                  <View style={styles.providerToggleRow}>
                    {(['stripe', 'paystack'] as const).map((provider) => {
                      const selected = payoutProvider === provider;
                      return (
                        <TouchableOpacity
                          key={provider}
                          style={[styles.providerChip, selected && styles.providerChipSelected]}
                          onPress={() => setPayoutProvider(provider)}
                        >
                          <Text style={[styles.providerChipText, selected && styles.providerChipTextSelected]}>
                            {provider === 'stripe' ? 'Stripe' : 'Paystack'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={styles.providerHint}>Paystack is recommended for Nigerian business accounts. Stripe remains available if you prefer it.</Text>
                </View>
              )}

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Bank Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Search or type bank name"
                  placeholderTextColor={Colors.dark.subtext}
                  value={bankSearch || bankName}
                  onChangeText={(value) => {
                    setBankSearch(value);
                    setBankName(value);
                    setShowBankDropdown(true);
                  }}
                  onFocus={() => setShowBankDropdown(true)}
                  editable={isEditing || !businessBankAccount}
                />

                {showBankDropdown && (isEditing || !businessBankAccount) && (
                  <View style={styles.dropdownList}>
                    {isBankListLoading ? (
                      <View style={styles.dropdownLoadingRow}>
                        <ActivityIndicator size="small" color={Colors.dark.primary} />
                        <Text style={styles.dropdownLoadingText}>Loading Paystack banks...</Text>
                      </View>
                    ) : (
                      filteredBanks.slice(0, 12).map((item) => (
                        <TouchableOpacity
                          key={item}
                          style={styles.dropdownItem}
                          onPress={() => {
                            setBankName(item);
                            setBankSearch(item);
                            setShowBankDropdown(false);
                          }}
                        >
                          <Text style={styles.dropdownItemText}>{item}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                )}
              </View>
              
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Account Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Full legal name on bank account"
                  placeholderTextColor={Colors.dark.subtext}
                  value={accountName}
                  onChangeText={setAccountName}
                  editable={isEditing || !businessBankAccount}
                />
              </View>
              
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>{bankRequirement.identifierLabel}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={bankRequirement.identifierPlaceholder}
                  placeholderTextColor={Colors.dark.subtext}
                  keyboardType={bankRequirement.identifierKeyboard}
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                  editable={isEditing || !businessBankAccount}
                  autoCapitalize="characters"
                />
              </View>

              {bankRequirement.secondaryFieldType === 'routing' && (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>{bankRequirement.secondaryLabel}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={bankRequirement.secondaryPlaceholder}
                    placeholderTextColor={Colors.dark.subtext}
                    value={routingNumber}
                    onChangeText={setRoutingNumber}
                    editable={isEditing || !businessBankAccount}
                    autoCapitalize="characters"
                  />
                </View>
              )}

              {bankRequirement.secondaryFieldType === 'swift' && (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>{bankRequirement.secondaryLabel}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={bankRequirement.secondaryPlaceholder}
                    placeholderTextColor={Colors.dark.subtext}
                    value={swiftCode}
                    onChangeText={setSwiftCode}
                    editable={isEditing || !businessBankAccount}
                    autoCapitalize="characters"
                  />
                </View>
              )}

              {bankRequirement.secondaryFieldType === 'routing' && !!bankRequirement.swiftOptionalLabel && (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>{bankRequirement.swiftOptionalLabel}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. BOFAUS3N"
                    placeholderTextColor={Colors.dark.subtext}
                    value={swiftCode}
                    onChangeText={setSwiftCode}
                    editable={isEditing || !businessBankAccount}
                    autoCapitalize="characters"
                  />
                </View>
              )}
              
              <View style={styles.infoContainer}>
                <Text style={styles.infoTitle}>Important Information</Text>
                <Text style={styles.infoText}>
                  • This bank account is linked to your logged in profile and used for payouts.
                </Text>
                <Text style={styles.infoText}>
                  • Country-specific fields are enforced automatically (IBAN / Routing / SWIFT).
                </Text>
                <Text style={styles.infoText}>
                  • You may be asked to provide additional documentation
                </Text>
              </View>
              
              <View style={styles.buttonContainer}>
                {(isEditing || !businessBankAccount) && (
                  <>
                    <TouchableOpacity 
                      style={styles.cancelButton}
                      onPress={businessBankAccount ? handleCancel : handleBack}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                      style={styles.saveButton}
                      onPress={handleSave}
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <ActivityIndicator size="small" color={Colors.dark.text} />
                      ) : (
                        <Text style={styles.saveButtonText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      <Modal
        visible={showSuccessDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSuccessDialog(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.successDialogCard}>
            <View style={styles.successIconWrap}>
              <CheckCircle size={30} color={Colors.dark.success} />
            </View>
            <Text style={styles.successDialogTitle}>Bank Account Added</Text>
            <Text style={styles.successDialogSubtitle}>
              Your bank details were saved to Supabase and are ready for payouts.
            </Text>
            <Text style={styles.successDialogStatus}>Bank added successfully and verified</Text>

            <TouchableOpacity
              style={styles.successDialogButton}
              onPress={() => setShowSuccessDialog(false)}
            >
              <Text style={styles.successDialogButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isCountryModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsCountryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Country</Text>
              <TouchableOpacity onPress={() => setIsCountryModalVisible(false)}>
                <X size={18} color={Colors.dark.subtext} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchWrap}>
              <Search size={16} color={Colors.dark.subtext} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search country"
                placeholderTextColor={Colors.dark.subtext}
                value={countrySearch}
                onChangeText={setCountrySearch}
                autoCapitalize="none"
              />
            </View>

            {isCountryListLoading ? (
              <ActivityIndicator size="small" color={Colors.dark.primary} style={{ marginTop: 24 }} />
            ) : (
              <FlatList
                data={filteredCountries}
                keyExtractor={(item) => item.code}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const isSelected = item.code === countryCode;
                  return (
                    <TouchableOpacity style={styles.countryRow} onPress={() => handleCountrySelect(item)}>
                      <View style={styles.countryRowLeft}>
                        <Text style={styles.countryFlag}>{item.flag}</Text>
                        <Text style={styles.countryRowName}>{item.name}</Text>
                      </View>
                      {isSelected ? <Check size={16} color={Colors.dark.primary} /> : null}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
    marginTop:40
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  contentContainer: {
    paddingBottom: 24,
  },
  keyboardContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bankAccountCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  bankIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  bankName: {
    fontSize: 20,
    fontWeight: 'bold',
  dropdownLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  dropdownLoadingText: {
    color: Colors.dark.subtext,
    fontSize: 13,
  },
    color: Colors.dark.text,
    marginBottom: 4,
  },
  accountName: {
    fontSize: 16,
    color: Colors.dark.text,
    marginBottom: 4,
  },
  countryLabel: {
    fontSize: 13,
    color: Colors.dark.subtext,
    marginBottom: 6,
  },
  loginEmailLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginBottom: 16,
  },
  providerLabel: {
    fontSize: 12,
    color: Colors.dark.primary,
    fontWeight: '600',
    marginBottom: 16,
  },
  accountTagsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  primaryTag: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  primaryTagText: {
    color: Colors.dark.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  verifiedTag: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: Colors.dark.success,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  verifiedTagText: {
    color: Colors.dark.success,
    fontSize: 11,
    fontWeight: '700',
  },
  accountDetails: {
    width: '100%',
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  detailLabel: {
    fontSize: 14,
    color: Colors.dark.subtext,
  },
  detailValue: {
    fontSize: 14,
    color: Colors.dark.text,
    fontWeight: '500',
  },
  verificationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  verifiedText: {
    marginLeft: 8,
    fontSize: 14,
    color: Colors.dark.success,
  },
  unverifiedText: {
    marginLeft: 8,
    fontSize: 14,
    color: "#FFC107",
  },
  failedText: {
    marginLeft: 8,
    fontSize: 14,
    color: Colors.dark.error || '#FF6B6B',
  },
  verificationReasonText: {
    color: Colors.dark.subtext,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 14,
    marginTop: -8,
  },
  editButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    width: '100%',
    alignItems: 'center',
  },
  editButtonText: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  formContainer: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 20,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: Colors.dark.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.dark.background,
    borderRadius: 8,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
  },
  selectInput: {
    backgroundColor: Colors.dark.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectInputText: {
    color: Colors.dark.text,
    fontSize: 15,
  },
  readonlyField: {
    backgroundColor: Colors.dark.background,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  readonlyFieldText: {
    color: Colors.dark.subtext,
    fontSize: 14,
  },
  dropdownList: {
    marginTop: 8,
    backgroundColor: Colors.dark.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.divider,
  },
  dropdownItemText: {
    color: Colors.dark.text,
    fontSize: 14,
  },
  providerToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  providerChip: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  providerChipSelected: {
    backgroundColor: Colors.dark.primary,
    borderColor: Colors.dark.primary,
  },
  providerChipText: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: '600',
  },
  providerChipTextSelected: {
    color: '#FFFFFF',
  },
  providerHint: {
    fontSize: 12,
    color: Colors.dark.subtext,
    lineHeight: 18,
  },
  infoContainer: {
    backgroundColor: 'rgba(65, 105, 225, 0.1)',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.dark.secondary,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 12,
    color: Colors.dark.text,
    marginBottom: 4,
  },
  buttonContainer: {
    flexDirection: 'row',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginRight: 8,
  },
  cancelButtonText: {
    color: Colors.dark.primary,
    fontWeight: '500',
  },
  saveButton: {
    flex: 1,
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  successDialogCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    alignItems: 'center',
  },
  successIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  successDialogTitle: {
    color: Colors.dark.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  successDialogSubtitle: {
    color: Colors.dark.subtext,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  successDialogStatus: {
    color: Colors.dark.success,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 18,
    textAlign: 'center',
  },
  successDialogButton: {
    width: '100%',
    backgroundColor: Colors.dark.success,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  successDialogButtonText: {
    color: '#052718',
    fontWeight: '800',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    maxHeight: '78%',
    padding: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalTitle: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 14,
    paddingVertical: 10,
    marginLeft: 8,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.divider,
  },
  countryRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countryFlag: {
    fontSize: 18,
    marginRight: 10,
  },
  countryRowName: {
    color: Colors.dark.text,
    fontSize: 14,
  },
});