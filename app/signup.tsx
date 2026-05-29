import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
  Keyboard,
  Modal,
  FlatList,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, Link } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Eye,
  EyeOff,
  ArrowLeft,
  UserPlus,
  Building2,
  User,
  ChevronDown,
  ChevronUp,
  Search,
  X,
  Check,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { getAllCountries, FlagType, type Country as PickerCountry } from "react-native-country-picker-modal";

import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const BUSINESS_TYPE_OPTIONS = ["Bar", "Event Promotion", "Venue", "Nightclub", "Festivals"] as const;
const COUNTRY_PAGE_SIZE = 9;

type CountryOption = {
  code: string;
  name: string;
  flag: string;
  searchValue: string;
};

const normalizeCountryName = (name: PickerCountry["name"]) => {
  if (typeof name === "string") {
    return name;
  }

  return String((name as any)?.common || "");
};

export default function SignUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp: supabaseSignUp } = useAuth();

  const [step, setStep] = useState(1);
  const [accountType, setAccountType] = useState<"personal" | "business">("personal");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [isBusinessTypeDropdownOpen, setIsBusinessTypeDropdownOpen] = useState(false);
  const [country, setCountry] = useState("Nigeria");
  const [countryCode, setCountryCode] = useState("NG");
  const [countrySearch, setCountrySearch] = useState("");
  const [allCountries, setAllCountries] = useState<CountryOption[]>([]);
  const [visibleCountryCount, setVisibleCountryCount] = useState(COUNTRY_PAGE_SIZE);
  const [isCountryModalVisible, setIsCountryModalVisible] = useState(false);
  const [isCountryListLoading, setIsCountryListLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitHint, setSubmitHint] = useState("");

  const nameInputRef = useRef<TextInput>(null);
  const usernameInputRef = useRef<TextInput>(null);
  const emailInputRef = useRef<TextInput>(null);
  const businessNameInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const confirmPasswordInputRef = useRef<TextInput>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadCountries = async () => {
      try {
        const getEmojiFlag = (countryCode: string) => {
          return countryCode
            .toUpperCase()
            .replace(/./g, (char) => String.fromCodePoint(char.charCodeAt(0) + 127397));
        };

        const countries = await getAllCountries(FlagType.EMOJI, "common");
        if (!isMounted) {
          return;
        }

        const mappedCountries = countries
          .map((entry) => {
            const displayName = normalizeCountryName(entry.name);
            return {
              code: entry.cca2,
              name: displayName,
              flag: getEmojiFlag(entry.cca2) || "🌍",
              searchValue: `${displayName} ${entry.cca2}`.toLowerCase(),
            };
          })
          .sort((left, right) => {
            if (left.code === "NG") return -1;
            if (right.code === "NG") return 1;
            return left.name.localeCompare(right.name);
          });

        setAllCountries(mappedCountries);

        const nigeria = mappedCountries.find((entry) => entry.code === "NG");
        if (nigeria) {
          setCountry(nigeria.name);
          setCountryCode(nigeria.code);
        }
      } catch (loadError) {
        console.error("Failed to load countries:", loadError);
      } finally {
        if (isMounted) {
          setIsCountryListLoading(false);
        }
      }
    };

    void loadCountries();

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    if (!query) {
      return allCountries;
    }

    return allCountries.filter((entry) => entry.searchValue.includes(query));
  }, [allCountries, countrySearch]);

  const visibleCountries = useMemo(
    () => filteredCountries.slice(0, visibleCountryCount),
    [filteredCountries, visibleCountryCount]
  );

  const selectedCountryOption = useMemo(
    () => allCountries.find((entry) => entry.code === countryCode) || null,
    [allCountries, countryCode]
  );

  useEffect(() => {
    setVisibleCountryCount(COUNTRY_PAGE_SIZE);
  }, [countrySearch, isCountryModalVisible]);

  const togglePasswordVisibility = () => setShowPassword((currentValue) => !currentValue);
  const handleNextStep = () => setStep(2);
  const handlePreviousStep = () => setStep(1);

  const validateEmail = (emailValue: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(emailValue);
  };

  const validatePassword = (passwordValue: string) => {
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    return passwordRegex.test(passwordValue);
  };

  const openCountryModal = () => {
    Keyboard.dismiss();
    setIsCountryModalVisible(true);
  };

  const closeCountryModal = () => {
    setIsCountryModalVisible(false);
    setCountrySearch("");
  };

  const loadMoreCountries = useCallback(() => {
    setVisibleCountryCount((currentCount) => {
      if (currentCount >= filteredCountries.length) {
        return currentCount;
      }

      return Math.min(currentCount + COUNTRY_PAGE_SIZE, filteredCountries.length);
    });
  }, [filteredCountries.length]);

  const handleSelectCountry = (selectedCountry: CountryOption) => {
    setCountry(selectedCountry.name);
    setCountryCode(selectedCountry.code);
    closeCountryModal();
  };

  const handleSignUp = async () => {
    Keyboard.dismiss();

    const normalizedName = name.trim();
    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedBusinessName = businessName.trim();

    if (!normalizedName || !normalizedUsername || !normalizedEmail || !password || !confirmPassword) {
      setError("Please fill in all required fields");
      return;
    }

    if (!countryCode || !country) {
      setError("Please select your country to continue");
      return;
    }

    if (accountType === "business" && (!normalizedBusinessName || !businessType)) {
      setError("Please fill in all required business information");
      return;
    }

    if (!validateEmail(normalizedEmail)) {
      setError("Please enter a valid email address");
      return;
    }

    if (!validatePassword(password)) {
      setError("Password must be at least 8 characters with uppercase, lowercase, and number");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setError("");
    setSubmitHint("Creating your account...");
    setIsLoading(true);

    const slowResponseTimer = setTimeout(() => {
      setSubmitHint("Still creating your account. Response is taking longer than usual.");
    }, 4000);

    const weakConnectionTimer = setTimeout(() => {
      setSubmitHint("Connection looks weak or the server is slow. Please keep this screen open.");
    }, 10000);

    try {
      // Check if username is already taken
      const { data: usernameData } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", normalizedUsername)
        .maybeSingle();

      if (usernameData) {
        setError("This username is already taken. Please choose another one.");
        setIsLoading(false);
        return;
      }

      // Existing account path: guide users to complete verification instead of failing signup.
      const { data: existingUserData, error: existingUserErr } = await supabase.functions.invoke("get-uid-by-email", {
        body: { email: normalizedEmail },
      });

      if (!existingUserErr && existingUserData?.uid) {
        const existingUid = String(existingUserData.uid);
        const alreadyOtpVerified = existingUserData.otp_verified === true;

        if (!alreadyOtpVerified) {
          Alert.alert(
            "PIN verification required",
            "This email is already registered. Please complete PIN verification before login.",
            [
              {
                text: "Continue",
                onPress: () =>
                  router.replace(`/verify-otp?email=${encodeURIComponent(normalizedEmail)}&user_id=${encodeURIComponent(existingUid)}`),
              },
            ]
          );
          return;
        }

        setError("This email is already registered. Please sign in with your password.");
        return;
      }

      const profileData = {
        full_name: normalizedName,
        username: normalizedUsername,
        user_type: accountType === "business" ? ("business" as const) : ("private" as const),
        country,
        country_code: countryCode,
        ...(accountType === "business" && {
          business_name: normalizedBusinessName,
          business_type: businessType,
        }),
      };

      const signUpResult = await supabaseSignUp(normalizedEmail, password, profileData);

      if (!signUpResult.error) {
        let pinSent = false;
        const { data: otpData, error: otpSendError } = await supabase.functions.invoke("send-otp", {
          body: {
            email: normalizedEmail,
            type: "signup",
            user_id: signUpResult.userId,
          },
        });

        if (!otpSendError && otpData?.success) {
          pinSent = true;
        }

        if (!pinSent) {
          const smtpHint =
            "PIN email could not be sent right now. You can retry from the verification screen. Check Supabase SMTP settings (Auth > Email > SMTP), sender domain verification, and spam folder.";
          const reason = (otpData as any)?.message || otpSendError?.message || "Failed to send PIN code.";
          Alert.alert("PIN Send Delayed", `${reason}\n\n${smtpHint}`);
        }

        const query = `email=${encodeURIComponent(normalizedEmail)}&user_id=${encodeURIComponent(signUpResult.userId || "")}&pin_sent=${pinSent ? "1" : "0"}`;
        router.replace(`/verify-otp?${query}`);
      } else {
        const errorMessage =
          typeof signUpResult.error === "string"
            ? signUpResult.error
            : signUpResult.error?.message || "Registration failed";
        Alert.alert("Signup Failed", errorMessage);
      }
    } catch (signUpError) {
      console.error("Signup error:", signUpError);
      if (isMountedRef.current) {
        Alert.alert("Signup Failed", "An unexpected error occurred. Please try again.");
      }
    } finally {
      clearTimeout(slowResponseTimer);
      clearTimeout(weakConnectionTimer);
      if (isMountedRef.current) {
        setIsLoading(false);
        setSubmitHint("");
      }
    }
  };

  const renderCountryItem = ({ item }: { item: CountryOption }) => {
    const isSelected = item.code === countryCode;

    return (
      <TouchableOpacity
        style={[styles.countryRow, isSelected && styles.countryRowSelected]}
        activeOpacity={0.8}
        onPress={() => handleSelectCountry(item)}
      >
        <View style={styles.countryRowLeft}>
          <Text style={styles.countryFlag}>{item.flag}</Text>
          <View style={styles.countryCopy}>
            <Text style={styles.countryName}>{item.name}</Text>
            <Text style={styles.countryCodeText}>{item.code}</Text>
          </View>
        </View>
        {isSelected ? <Check size={18} color={Colors.dark.primary} /> : null}
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(40, insets.bottom + 20) }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          {/* Buttons removed per user request */}
        </View>

        <View style={styles.logoContainer}>
          <View style={styles.logoImageContainer}>
            <Image
              source={require("../assets/images/second.png")}
              style={styles.logoImage}
              contentFit="contain"
              transition={300}
            />
          </View>
          <Text style={styles.logoText}>60Seconds</Text>
        </View>

        <View style={styles.formContainer}>
          <Text style={styles.title}>Create Account</Text>

          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {step === 1 ? (
            <>
              <Text style={styles.stepTitle}>Choose Account Type</Text>

              <View style={styles.accountTypeContainer}>
                <TouchableOpacity
                  style={[styles.accountTypeOption, accountType === "personal" && styles.selectedAccountType]}
                  onPress={() => setAccountType("personal")}
                  activeOpacity={0.85}
                >
                  <User size={32} color={accountType === "personal" ? Colors.dark.primary : Colors.dark.subtext} />
                  <Text style={[styles.accountTypeText, accountType === "personal" && styles.selectedAccountTypeText]}>
                    Personal Account
                  </Text>
                  <Text style={styles.accountTypeDescription}>
                    For individuals looking to discover and enjoy nightlife
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.accountTypeOption, accountType === "business" && styles.selectedBusinessAccountType]}
                  onPress={() => setAccountType("business")}
                  activeOpacity={0.85}
                >
                  <Building2
                    size={32}
                    color={accountType === "business" ? Colors.dark.secondary : Colors.dark.subtext}
                  />
                  <Text
                    style={[
                      styles.accountTypeText,
                      accountType === "business" && styles.selectedBusinessAccountTypeText,
                    ]}
                  >
                    Business Account
                  </Text>
                  <Text style={styles.accountTypeDescription}>For venues, event organizers, and promoters</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.actionButton} onPress={handleNextStep} activeOpacity={0.9}>
                {Platform.OS !== "web" ? (
                  <LinearGradient
                    colors={
                      accountType === "personal"
                        ? (Colors.dark.gradients.primary as [string, string])
                        : (Colors.dark.gradients.secondary as [string, string])
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.gradientButton}
                  >
                    <Text style={styles.actionButtonText}>Continue</Text>
                  </LinearGradient>
                ) : (
                  <View
                    style={[
                      styles.gradientButton,
                      { backgroundColor: accountType === "personal" ? Colors.dark.primary : Colors.dark.secondary },
                    ]}
                  >
                    <Text style={styles.actionButtonText}>Continue</Text>
                  </View>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.stepTitle}>
                {accountType === "personal" ? "Personal Information" : "Business Information"}
              </Text>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Full Name *</Text>
                <TouchableOpacity style={styles.inputWrapper} activeOpacity={1} onPress={() => nameInputRef.current?.focus()}>
                  <TextInput
                    ref={nameInputRef}
                    style={styles.input}
                    placeholder="Enter your full name"
                    placeholderTextColor={Colors.dark.subtext}
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Username *</Text>
                <TouchableOpacity style={styles.inputWrapper} activeOpacity={1} onPress={() => usernameInputRef.current?.focus()}>
                  <TextInput
                    ref={usernameInputRef}
                    style={styles.input}
                    placeholder="Choose a username"
                    placeholderTextColor={Colors.dark.subtext}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Email *</Text>
                <TouchableOpacity style={styles.inputWrapper} activeOpacity={1} onPress={() => emailInputRef.current?.focus()}>
                  <TextInput
                    ref={emailInputRef}
                    style={styles.input}
                    placeholder="Enter your email"
                    placeholderTextColor={Colors.dark.subtext}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Country *</Text>
                <TouchableOpacity style={styles.inputWrapper} activeOpacity={0.85} onPress={openCountryModal}>
                  <View style={styles.countryTriggerContent}>
                    <Text style={styles.countryTriggerFlag}>{selectedCountryOption?.flag || "🇳🇬"}</Text>
                    <Text style={styles.countryTriggerText}>{selectedCountryOption?.name || country || "Nigeria"}</Text>
                  </View>
                  <ChevronDown size={20} color={Colors.dark.subtext} style={styles.dropdownIcon} />
                </TouchableOpacity>
              </View>

              {accountType === "business" ? (
                <>
                  <View style={styles.inputContainer}>
                    <Text style={styles.label}>Business Name *</Text>
                    <TouchableOpacity
                      style={styles.inputWrapper}
                      activeOpacity={1}
                      onPress={() => businessNameInputRef.current?.focus()}
                    >
                      <TextInput
                        ref={businessNameInputRef}
                        style={styles.input}
                        placeholder="Enter your business name"
                        placeholderTextColor={Colors.dark.subtext}
                        value={businessName}
                        onChangeText={setBusinessName}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.inputContainer}>
                    <Text style={styles.label}>Business Type *</Text>
                    <TouchableOpacity
                      style={styles.inputWrapper}
                      activeOpacity={0.85}
                      onPress={() => setIsBusinessTypeDropdownOpen((currentValue) => !currentValue)}
                    >
                      <Text style={[styles.input, !businessType && styles.placeholderText]}>
                        {businessType || "Select business type"}
                      </Text>
                      {isBusinessTypeDropdownOpen ? (
                        <ChevronUp size={20} color={Colors.dark.subtext} style={styles.dropdownIcon} />
                      ) : (
                        <ChevronDown size={20} color={Colors.dark.subtext} style={styles.dropdownIcon} />
                      )}
                    </TouchableOpacity>
                    {isBusinessTypeDropdownOpen ? (
                      <View style={styles.dropdownMenu}>
                        {BUSINESS_TYPE_OPTIONS.map((option) => (
                          <TouchableOpacity
                            key={option}
                            style={styles.dropdownItem}
                            onPress={() => {
                              setBusinessType(option);
                              setIsBusinessTypeDropdownOpen(false);
                            }}
                          >
                            <Text style={styles.dropdownItemText}>{option}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </>
              ) : null}

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Password *</Text>
                <TouchableOpacity style={styles.inputWrapper} activeOpacity={1} onPress={() => passwordInputRef.current?.focus()}>
                  <TextInput
                    ref={passwordInputRef}
                    style={styles.passwordInput}
                    placeholder="Create a password"
                    placeholderTextColor={Colors.dark.subtext}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity style={styles.eyeIcon} onPress={togglePasswordVisibility}>
                    {showPassword ? (
                      <EyeOff size={20} color={Colors.dark.subtext} />
                    ) : (
                      <Eye size={20} color={Colors.dark.subtext} />
                    )}
                  </TouchableOpacity>
                </TouchableOpacity>
                <Text style={styles.passwordRequirements}>
                  Must be at least 8 characters with uppercase, lowercase, and number
                </Text>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Confirm Password *</Text>
                <TouchableOpacity
                  style={styles.inputWrapper}
                  activeOpacity={1}
                  onPress={() => confirmPasswordInputRef.current?.focus()}
                >
                  <TextInput
                    ref={confirmPasswordInputRef}
                    style={styles.input}
                    placeholder="Confirm your password"
                    placeholderTextColor={Colors.dark.subtext}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.actionButton} onPress={handleSignUp} disabled={isLoading} activeOpacity={0.9}>
                {isLoading ? (
                  Platform.OS !== "web" ? (
                    <LinearGradient
                      colors={
                        accountType === "personal"
                          ? (Colors.dark.gradients.primary as [string, string])
                          : (Colors.dark.gradients.secondary as [string, string])
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.gradientButton}
                    >
                      <ActivityIndicator color={Colors.dark.text} style={styles.buttonSpinner} />
                      <Text style={styles.actionButtonText}>Creating Account...</Text>
                    </LinearGradient>
                  ) : (
                    <View
                      style={[
                        styles.gradientButton,
                        { backgroundColor: accountType === "personal" ? Colors.dark.primary : Colors.dark.secondary },
                      ]}
                    >
                      <ActivityIndicator color={Colors.dark.text} style={styles.buttonSpinner} />
                      <Text style={styles.actionButtonText}>Creating Account...</Text>
                    </View>
                  )
                ) : Platform.OS !== "web" ? (
                  <LinearGradient
                    colors={
                      accountType === "personal"
                        ? (Colors.dark.gradients.primary as [string, string])
                        : (Colors.dark.gradients.secondary as [string, string])
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.gradientButton}
                  >
                    <Text style={styles.actionButtonText}>Create Account</Text>
                    <UserPlus size={20} color={Colors.dark.text} />
                  </LinearGradient>
                ) : (
                  <View
                    style={[
                      styles.gradientButton,
                      { backgroundColor: accountType === "personal" ? Colors.dark.primary : Colors.dark.secondary },
                    ]}
                  >
                    <Text style={styles.actionButtonText}>Create Account</Text>
                    <UserPlus size={20} color={Colors.dark.text} />
                  </View>
                )}
              </TouchableOpacity>

              {isLoading ? (
                <View style={styles.submitHintContainer}>
                  <Text style={styles.submitHintText}>{submitHint}</Text>
                </View>
              ) : null}

              <Text style={styles.termsText}>
                By signing up, you agree to our Terms of Service and Privacy Policy
              </Text>
            </>
          )}
        </View>
      </ScrollView>

      <Modal visible={isCountryModalVisible} animationType="slide" transparent onRequestClose={closeCountryModal}>
        <View style={styles.countryModalRoot}>
          <TouchableOpacity style={styles.countryModalBackdrop} activeOpacity={1} onPress={closeCountryModal} />
          <View style={[styles.countryModalCard, { paddingBottom: Math.max(insets.bottom, 20) }]}> 
            <View style={styles.countryModalHeader}>
              <View>
                <Text style={styles.countryModalTitle}>Select Country</Text>
                <Text style={styles.countryModalSubtitle}>Nigeria is selected by default</Text>
              </View>
              <TouchableOpacity style={styles.countryModalCloseButton} onPress={closeCountryModal}>
                <X size={20} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.countrySearchBox}>
              <Search size={18} color={Colors.dark.subtext} />
              <TextInput
                style={styles.countrySearchInput}
                placeholder="Search country"
                placeholderTextColor={Colors.dark.subtext}
                value={countrySearch}
                onChangeText={setCountrySearch}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>

            {isCountryListLoading ? (
              <View style={styles.countryLoadingState}>
                <ActivityIndicator color={Colors.dark.primary} size="small" />
                <Text style={styles.countryLoadingText}>Loading countries...</Text>
              </View>
            ) : (
              <FlatList
                data={visibleCountries}
                keyExtractor={(item) => item.code}
                renderItem={renderCountryItem}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={COUNTRY_PAGE_SIZE}
                maxToRenderPerBatch={COUNTRY_PAGE_SIZE}
                windowSize={5}
                removeClippedSubviews={Platform.OS !== "web"}
                onEndReached={loadMoreCountries}
                onEndReachedThreshold={0.4}
                contentContainerStyle={styles.countryListContent}
                ListEmptyComponent={
                  <View style={styles.countryEmptyState}>
                    <Text style={styles.countryEmptyText}>No country matches your search.</Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },
  signInLink: {
    padding: 8,
  },
  signInLinkText: {
    color: Colors.dark.primary,
    fontSize: 16,
    fontWeight: "600",
  },
  logoContainer: {
    alignItems: "center",
    marginTop: 20,
    marginBottom: 36,
  },
  logoImageContainer: {
    width: 120,
    height: 120,
    borderRadius: 100,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.dark.primary,
    marginBottom: 16,
    elevation: 8,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  logoImage: {
    width: "100%",
    height: "100%",
  },
  logoText: {
    fontSize: 28,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  formContainer: {
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 24,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: 20,
  },
  errorContainer: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: Colors.dark.error,
  },
  errorText: {
    color: Colors.dark.error,
    fontSize: 14,
  },
  accountTypeContainer: {
    marginBottom: 24,
  },
  accountTypeOption: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  selectedAccountType: {
    borderColor: Colors.dark.primary,
    backgroundColor: "rgba(99, 102, 241, 0.1)",
  },
  selectedBusinessAccountType: {
    borderColor: Colors.dark.secondary,
    backgroundColor: "rgba(244, 114, 182, 0.12)",
  },
  accountTypeText: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginTop: 12,
    marginBottom: 8,
  },
  selectedAccountTypeText: {
    color: Colors.dark.primary,
  },
  selectedBusinessAccountTypeText: {
    color: Colors.dark.secondary,
  },
  accountTypeDescription: {
    fontSize: 15,
    color: Colors.dark.subtext,
    lineHeight: 22,
  },
  actionButton: {
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 16,
    elevation: 4,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  gradientButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  actionButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "600",
    marginRight: 8,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 15,
    color: Colors.dark.text,
    marginBottom: 8,
    fontWeight: "500",
  },
  inputWrapper: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
  },
  passwordInput: {
    flex: 1,
    minWidth: 0,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
  },
  placeholderText: {
    color: Colors.dark.subtext,
  },
  dropdownIcon: {
    marginRight: 16,
  },
  dropdownMenu: {
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    backgroundColor: Colors.dark.card,
  },
  dropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  dropdownItemText: {
    color: Colors.dark.text,
    fontSize: 16,
  },
  eyeIcon: {
    padding: 16,
  },
  buttonSpinner: {
    marginRight: 10,
  },
  submitHintContainer: {
    marginBottom: 16,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(99, 102, 241, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.28)",
  },
  submitHintText: {
    color: Colors.dark.text,
    fontSize: 13,
    lineHeight: 19,
  },
  passwordRequirements: {
    fontSize: 12,
    color: Colors.dark.subtext,
    marginTop: 8,
    lineHeight: 18,
  },
  termsText: {
    fontSize: 13,
    color: Colors.dark.subtext,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  countryTriggerContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  countryTriggerFlag: {
    fontSize: 20,
    marginRight: 12,
  },
  countryTriggerText: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 16,
  },
  countryModalRoot: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  countryModalBackdrop: {
    flex: 1,
  },
  countryModalCard: {
    maxHeight: "78%",
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  countryModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  countryModalTitle: {
    color: Colors.dark.text,
    fontSize: 20,
    fontWeight: "700",
  },
  countryModalSubtitle: {
    marginTop: 4,
    color: Colors.dark.subtext,
    fontSize: 13,
  },
  countryModalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dark.card,
    alignItems: "center",
    justifyContent: "center",
  },
  countrySearchBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: Colors.dark.card,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    marginBottom: 14,
  },
  countrySearchInput: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 16,
    paddingVertical: 14,
    marginLeft: 10,
  },
  countryListContent: {
    paddingBottom: 8,
  },
  countryRow: {
    minHeight: 60,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: Colors.dark.card,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  countryRowSelected: {
    borderColor: Colors.dark.primary,
    backgroundColor: "rgba(99, 102, 241, 0.12)",
  },
  countryRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  countryFlag: {
    fontSize: 22,
    marginRight: 12,
  },
  countryCopy: {
    flex: 1,
    minWidth: 0,
  },
  countryName: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "600",
  },
  countryCodeText: {
    color: Colors.dark.subtext,
    fontSize: 12,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  countryLoadingState: {
    paddingVertical: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  countryLoadingText: {
    marginTop: 10,
    color: Colors.dark.subtext,
    fontSize: 14,
  },
  countryEmptyState: {
    paddingVertical: 28,
    alignItems: "center",
  },
  countryEmptyText: {
    color: Colors.dark.subtext,
    fontSize: 14,
  },
});
