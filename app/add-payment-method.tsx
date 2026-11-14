import { logger } from '@/lib/logger';
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  CreditCard,
  Landmark,
  Smartphone,
  DollarSign,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import { useWalletStore } from "@/store/wallet-store";
import { useAuthStore } from "@/store/auth-store";
import { useAuth } from "@/lib/auth";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

const isNigerianCountryValue = (value?: string | null): boolean => {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "NG" || normalized === "NGA" || normalized === "NIGERIA";
};

export default function AddPaymentMethodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addPaymentMethod, isLoading } = useWalletStore();
  const { user, isAuthenticated } = useAuthStore();
  const { profile, user: authUser } = useAuth();

  const [paymentType, setPaymentType] = useState<
    "credit_card" | "bank_account" | "twint" | "paystack"
  >("credit_card");
  const [nickname, setNickname] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [cvv, setCvv] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");
  const [twintPhoneNumber, setTwintPhoneNumber] = useState("");
  const [twintCardNumber, setTwintCardNumber] = useState("");
  const [twintExpiryDate, setTwintExpiryDate] = useState("");
  const [twintCvv, setTwintCvv] = useState("");
  const [twintCardholderName, setTwintCardholderName] = useState("");
  const [paystackEmail, setPaystackEmail] = useState("");

  const isLoggedInNigerianUser =
    !!(user?.id || authUser?.id) &&
    [
      profile?.country_code,
      profile?.country,
      (authUser as any)?.user_metadata?.country_code,
      (authUser as any)?.user_metadata?.country,
      (user as any)?.countryCode,
      (user as any)?.country,
    ].some((value) => isNigerianCountryValue(value));

  useEffect(() => {
    if (!isLoggedInNigerianUser && paymentType === "paystack") {
      setPaymentType("credit_card");
    }
  }, [isLoggedInNigerianUser, paymentType]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/payment-methods');
  };

  const handleCardNumberChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "");
    let formatted = "";
    for (let i = 0; i < cleaned.length; i++) {
      if (i > 0 && i % 4 === 0) formatted += " ";
      formatted += cleaned[i];
    }
    setCardNumber(formatted.slice(0, 19)); // Format for card number (xxxx xxxx xxxx xxxx)
  };

  const handleExpiryDateChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "");
    let formatted = "";
    for (let i = 0; i < cleaned.length; i++) {
      if (i === 2) formatted += "/";
      formatted += cleaned[i];
    }
    setExpiryDate(formatted.slice(0, 5)); // Limit to MM/YY format
  };

  const handleCvvChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "");
    setCvv(cleaned.slice(0, 4)); // Limit to 3 or 4 digits
  };

  const handleSave = async () => {
    let currentUser = user;
    if (!user || !isAuthenticated) {
      Alert.alert('Sign in required', 'Please sign in to add a payment method.');
      return;
    }

    if (paymentType === "paystack" && !isLoggedInNigerianUser) {
      Alert.alert("Unavailable", "Paystack is only available for Nigerian users.");
      return;
    }

    // Input Validation
    if (!nickname) {
      Alert.alert("Error", "Please enter a nickname for this payment method.");
      return;
    }

    if (paymentType === "credit_card") {
      if (!cardNumber || cardNumber.replace(/\s/g, "").length < 16) {
        Alert.alert("Error", "Please enter a valid card number.");
        return;
      }

      if (!expiryDate || expiryDate.length < 5) {
        Alert.alert("Error", "Please enter a valid expiry date (MM/YY).");
        return;
      }

      if (!cvv || cvv.length < 3) {
        Alert.alert("Error", "Please enter a valid CVV code.");
        return;
      }

      if (!cardholderName) {
        Alert.alert("Error", "Please enter the cardholder name.");
        return;
      }
    }

    // Prepare Payment Method Object
    let paymentMethod: any = {
      type: paymentType,
      nickname,
      isDefault: false,
    };

    if (paymentType === "bank_account") {
      paymentMethod = {
        ...paymentMethod,
        bankName,
        accountType,
        lastFour: accountNumber.slice(-4),
      };
    } else if (paymentType === "twint") {
      paymentMethod = {
        ...paymentMethod,
        twintPhoneNumber,
        cardNumber: twintCardNumber,
        expiryDate: twintExpiryDate,
        cvv: twintCvv,
        cardholderName: twintCardholderName,
        lastFour: twintCardNumber.replace(/\s/g, "").slice(-4),
      };
    }

    const success = await addPaymentMethod(paymentMethod, currentUser);

    if (success) {
      Alert.alert("Payment Method Saved", "Your payment method has been saved.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } else {
      Alert.alert("Error", "Failed to save payment method. Please try again.", [
        { text: "OK" },
      ]);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Add Payment Method</Text>
        <View style={styles.placeholder} />
      </View>

      <KeyboardAwareScrollView
        style={styles.content}
        enableOnAndroid
        extraScrollHeight={80}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Type</Text>

          <View style={styles.paymentTypeContainer}>
            <TouchableOpacity
              style={[
                styles.paymentTypeOption,
                paymentType === "credit_card" && styles.selectedPaymentType,
              ]}
              onPress={() => setPaymentType("credit_card")}
            >
              <CreditCard
                size={24}
                color={paymentType === "credit_card" ? Colors.dark.primary : Colors.dark.text}
              />
              <Text
                style={[
                  styles.paymentTypeText,
                  paymentType === "credit_card" && styles.selectedPaymentTypeText,
                ]}
              >
                Credit Card
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.paymentTypeOption,
                paymentType === "bank_account" && styles.selectedPaymentType,
              ]}
              onPress={() => setPaymentType("bank_account")}
            >
              <Landmark
                size={24}
                color={paymentType === "bank_account" ? Colors.dark.primary : Colors.dark.text}
              />
              <Text
                style={[
                  styles.paymentTypeText,
                  paymentType === "bank_account" && styles.selectedPaymentTypeText,
                ]}
              >
                Bank Account
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.paymentTypeOption,
                paymentType === "twint" && styles.selectedTwintType,
              ]}
              onPress={() => setPaymentType("twint")}
            >
              <Smartphone size={24} color={paymentType === "twint" ? "#FFFFFF" : "#ED0039"} />
              <Text
                style={[
                  styles.paymentTypeText,
                  paymentType === "twint" && styles.selectedTwintTypeText,
                ]}
              >
                Twint
              </Text>
            </TouchableOpacity>

            {isLoggedInNigerianUser && (
              <TouchableOpacity
                style={[
                  styles.paymentTypeOption,
                  paymentType === "paystack" && styles.selectedPaystackType,
                ]}
                onPress={() => setPaymentType("paystack")}
              >
                <DollarSign size={24} color={paymentType === "paystack" ? "#FFFFFF" : "#0BA4DB"} />
                <Text
                  style={[
                    styles.paymentTypeText,
                    paymentType === "paystack" && styles.selectedPaystackTypeText,
                  ]}
                >
                  Paystack
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Nickname</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. My Personal Card"
              placeholderTextColor={Colors.dark.subtext}
              value={nickname}
              onChangeText={setNickname}
            />
          </View>

          {paymentType === "credit_card" && (
            <>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Card Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder="1234 5678 9012 3456"
                  placeholderTextColor={Colors.dark.subtext}
                  keyboardType="number-pad"
                  value={cardNumber}
                  onChangeText={handleCardNumberChange}
                />
              </View>

              <View style={styles.rowInputs}>
                <View style={[styles.inputContainer, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.inputLabel}>Expiry Date</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="MM/YY"
                    placeholderTextColor={Colors.dark.subtext}
                    keyboardType="number-pad"
                    value={expiryDate}
                    onChangeText={handleExpiryDateChange}
                  />
                </View>
                <View style={[styles.inputContainer, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.inputLabel}>CVV</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="123"
                    placeholderTextColor={Colors.dark.subtext}
                    keyboardType="number-pad"
                    value={cvv}
                    onChangeText={handleCvvChange}
                    secureTextEntry
                  />
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Cardholder Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="John Doe"
                  placeholderTextColor={Colors.dark.subtext}
                  value={cardholderName}
                  onChangeText={setCardholderName}
                />
              </View>
            </>
          )}
        </View>
      </KeyboardAwareScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom:
              Platform.OS === "android" ? Math.max(16, insets.bottom + 10) : 16,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.saveButton, isLoading && styles.disabledButton]}
          onPress={handleSave}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={Colors.dark.text} />
          ) : (
            <Text style={styles.saveButtonText}>
              {paymentType === "credit_card"
                ? "Pay with Paystack"
                : paymentType === "twint"
                  ? "Pay with Twint"
                  : "Save Payment Method"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  rowInputs: { flexDirection: 'row', gap: 12 },
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
    marginTop: 40,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.dark.text,
    marginBottom: 12,
  },
  paymentTypeContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  paymentTypeOption: {
    width: "48%",
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  selectedPaymentType: {
    backgroundColor: "rgba(138, 43, 226, 0.1)",
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  selectedTwintType: {
    backgroundColor: "#ED0039",
  },
  selectedPaystackType: {
    backgroundColor: "#0BA4DB",
  },
  paymentTypeText: {
    marginTop: 8,
    fontSize: 14,
    color: Colors.dark.text,
  },
  selectedPaymentTypeText: {
    color: Colors.dark.primary,
    fontWeight: "500",
  },
  selectedTwintTypeText: {
    color: "#FFFFFF",
    fontWeight: "500",
  },
  selectedPaystackTypeText: {
    color: "#FFFFFF",
    fontWeight: "500",
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
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    marginBottom: 0,
  },
  saveButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  disabledButton: {
    backgroundColor: Colors.dark.inactive,
  },
  saveButtonText: {
    color: Colors.dark.text,
    fontWeight: "bold",
    fontSize: 16,
  },
});

























////////////////////         before      13       jan        2026        ////////////////



// } from "react-native";
// import { useRouter } from "expo-router";
// import {
//   ArrowLeft,
//   CreditCard,
//   Landmark,
//   Smartphone,
//   DollarSign,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { useWalletStore } from "@/store/wallet-store";
// import { useAuthStore } from "@/store/auth-store";
// import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
// // import { trpc } from "@/lib/trpc"; // TODO: Re-enable when API integration is ready

// // Lazy import DatatransService to avoid module loading issues
// let DatatransService: any = null;
// let isServiceLoading = false;
// const getDatatransService = async () => {
//   if (DatatransService) {
//     return DatatransService;
//   }
  
//   if (isServiceLoading) {
//     // Wait a bit if already loading
//     await new Promise(resolve => setTimeout(resolve, 100));
//     if (DatatransService) {
//       return DatatransService;
//     }
//   }
  
//   isServiceLoading = true;
//   try {
//     logger.debug("📦 Loading DatatransService module...");
//     const module = await import("@/lib/datatrans");
//     logger.debug("📦 Module loaded:", !!module);
//     logger.debug("📦 Module default:", !!module.default);
    
//     if (!module || !module.default) {
//       throw new Error("DatatransService module did not export correctly");
//     }
    
//     DatatransService = module.default;
    
//     // Verify the service has the required methods
//     if (typeof DatatransService.isRealDatatransKey !== 'function') {
//       logger.error("❌ DatatransService missing isRealDatatransKey method");
//       throw new Error("DatatransService is missing required methods");
//     }
    
//     logger.debug("✅ DatatransService loaded successfully");
//     return DatatransService;
//   } catch (error: any) {
//     logger.error("❌ Failed to load DatatransService:", error);
//     logger.error("❌ Error details:", error.message, error.stack);
//     isServiceLoading = false;
//     throw new Error(`Failed to load Datatrans payment service: ${error.message}. Please restart the app.`);
//   } finally {
//     isServiceLoading = false;
//   }
// };

// export default function AddPaymentMethodScreen() {
//   const router = useRouter();
//   const { addPaymentMethod, isLoading } = useWalletStore();
//   const { user, isAuthenticated } = useAuthStore();

//   // Debug: Log user state
//   logger.debug("🔍 Add Payment Method Screen - User state:", user);
//   logger.debug("🔍 Add Payment Method Screen - User ID:", user?.id);
//   logger.debug("🔍 Add Payment Method Screen - User email:", user?.email);
//   logger.debug(
//     "🔍 Add Payment Method Screen - isAuthenticated:",
//     isAuthenticated
//   );
//   logger.debug("🔍 Add Payment Method Screen - User type:", typeof user);
//   logger.debug("🔍 Add Payment Method Screen - User is null:", user === null);
//   logger.debug(
//     "🔍 Add Payment Method Screen - User is undefined:",
//     user === undefined
//   );

//   // TODO: Re-enable TRPC mutations when API integration is ready
//   // const createPaystackCustomer = trpc.paystack.createCustomer.useMutation();
//   // const createWorldlineCustomer = trpc.worldline.createCustomer.useMutation();

//   const [paymentType, setPaymentType] = useState<
//     "credit_card" | "bank_account" | "twint" | "paystack" | "worldline" | "datatrans"
//   >("credit_card");
//   const [nickname, setNickname] = useState("");
//   const [cardNumber, setCardNumber] = useState("");
//   const [expiryDate, setExpiryDate] = useState("");
//   const [cvv, setCvv] = useState("");
//   const [cardholderName, setCardholderName] = useState("");
//   const [bankName, setBankName] = useState("");
//   const [accountNumber, setAccountNumber] = useState("");
//   const [routingNumber, setRoutingNumber] = useState("");
//   const [accountType, setAccountType] = useState<"checking" | "savings">(
//     "checking"
//   );
//   const [twintPhoneNumber, setTwintPhoneNumber] = useState("");
//   const [twintCardNumber, setTwintCardNumber] = useState("");
//   const [twintExpiryDate, setTwintExpiryDate] = useState("");
//   const [twintCvv, setTwintCvv] = useState("");
//   const [twintCardholderName, setTwintCardholderName] = useState("");
//   const [paystackEmail, setPaystackEmail] = useState("");
//   const [worldlineEmail, setWorldlineEmail] = useState("");
//   const [worldlineCardNumber, setWorldlineCardNumber] = useState("");
//   const [worldlineExpiryDate, setWorldlineExpiryDate] = useState("");
//   const [worldlineCvv, setWorldlineCvv] = useState("");
//   const [worldlineCardholderName, setWorldlineCardholderName] = useState("");
//   const [datatransEmail, setDatatransEmail] = useState("");
//   const [datatransCardNumber, setDatatransCardNumber] = useState("");
//   const [datatransExpiryDate, setDatatransExpiryDate] = useState("");
//   const [datatransCvv, setDatatransCvv] = useState("");
//   const [datatransCardholderName, setDatatransCardholderName] = useState("");
//   const [datatransAmount, setDatatransAmount] = useState("100");
//   const [isDefault, setIsDefault] = useState(false);
//   const [isTestMode, setIsTestMode] = useState(false); // Test mode disabled for production
//   const [paystackStatus, setPaystackStatus] = useState<
//     "checking" | "real" | "mock"
//   >("checking");
  
//   // Datatrans success modal state
//   const [showDatatransSuccessModal, setShowDatatransSuccessModal] = useState(false);
//   const [datatransSuccessData, setDatatransSuccessData] = useState<{
//     reference: string;
//     transactionId?: string;
//     amount: number;
//     currency: string;
//     status: string;
//   } | null>(null);

//   const handleBack = () => {
//     router.back();
//   };

//   // Check Paystack configuration status
//   useEffect(() => {
//     const checkPaystackStatus = async () => {
//       try {
//         const { PAYSTACK_CONFIG } = await import("@/lib/paystack-config");
//         const isRealPaystackKey =
//           PAYSTACK_CONFIG.PUBLIC_KEY &&
//           PAYSTACK_CONFIG.PUBLIC_KEY.startsWith("pk_test_") &&
//           !PAYSTACK_CONFIG.PUBLIC_KEY.includes(
//             "YOUR_ACTUAL_TEST_PUBLIC_KEY_HERE"
//           );

//         setPaystackStatus(isRealPaystackKey ? "real" : "mock");
//       } catch (error) {
//         logger.error("Error checking Paystack status:", error);
//         setPaystackStatus("mock");
//       }
//     };

//     checkPaystackStatus();
//   }, []);

//   // Test functions removed for production

//   // Quick fill all Datatrans test data with one click
//   const fillAllDatatransTestData = () => {
//     logger.debug("🚀 Filling all Datatrans test data...");
//     setNickname("My Datatrans Card");
//     setDatatransEmail("test@example.com");
//     setDatatransAmount("100.00");
//     setDatatransCardNumber("4111111111111111"); // Visa test card
//     setDatatransExpiryDate("12/25");
//     setDatatransCvv("123");
//     setDatatransCardholderName("John Doe");
//     setIsDefault(false);
//     logger.debug("✅ All Datatrans test data filled - Ready to test!");
//     Alert.alert(
//       "✅ Test Data Filled!",
//       "All fields have been filled with test data.\n\n💡 Make sure you have:\n• DATATRANS_MERCHANT_ID set\n• DATATRANS_PASSWORD set\n\nThen click 'Pay with Datatrans' to test!\n\n📊 View transactions at:\nhttps://admin.sandbox.datatrans.com",
//       [{ text: "Got it!" }]
//     );
//   };

//   const handleCardNumberChange = (text: string) => {
//     // Remove non-numeric characters
//     const cleaned = text.replace(/\D/g, "");

//     // Format with spaces every 4 digits
//     let formatted = "";
//     for (let i = 0; i < cleaned.length; i++) {
//       if (i > 0 && i % 4 === 0) {
//         formatted += " ";
//       }
//       formatted += cleaned[i];
//     }

//     // Limit to 19 characters (16 digits + 3 spaces)
//     setCardNumber(formatted.slice(0, 19));
//   };

//   const handleExpiryDateChange = (text: string) => {
//     // Remove non-numeric characters
//     const cleaned = text.replace(/\D/g, "");

//     // Format as MM/YY
//     if (cleaned.length <= 2) {
//       setExpiryDate(cleaned);
//     } else {
//       setExpiryDate(`${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}`);
//     }
//   };

//   const handleCvvChange = (text: string) => {
//     // Remove non-numeric characters and limit to 4 digits
//     const cleaned = text.replace(/\D/g, "");
//     setCvv(cleaned.slice(0, 4));
//   };

//   const handleTwintPhoneNumberChange = (text: string) => {
//     // Format phone number
//     const cleaned = text.replace(/\D/g, "");
//     let formatted = "";

//     if (cleaned.length > 0) {
//       formatted = "+";
//       if (cleaned.length > 2) {
//         formatted += `${cleaned.slice(0, 2)} `;
//         if (cleaned.length > 5) {
//           formatted += `${cleaned.slice(2, 5)} `;
//           formatted += cleaned.slice(5, Math.min(cleaned.length, 12));
//         } else {
//           formatted += cleaned.slice(2);
//         }
//       } else {
//         formatted += cleaned;
//       }
//     }

//     setTwintPhoneNumber(formatted);
//   };

//   const handleTwintCardNumberChange = (text: string) => {
//     // Remove non-numeric characters
//     const cleaned = text.replace(/\D/g, "");

//     // Format with spaces every 4 digits
//     let formatted = "";
//     for (let i = 0; i < cleaned.length; i++) {
//       if (i > 0 && i % 4 === 0) {
//         formatted += " ";
//       }
//       formatted += cleaned[i];
//     }

//     // Limit to 19 characters (16 digits + 3 spaces)
//     setTwintCardNumber(formatted.slice(0, 19));
//   };

//   const handleTwintExpiryDateChange = (text: string) => {
//     // Remove non-numeric characters
//     const cleaned = text.replace(/\D/g, "");

//     // Format as MM/YY
//     if (cleaned.length <= 2) {
//       setTwintExpiryDate(cleaned);
//     } else {
//       setTwintExpiryDate(`${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}`);
//     }
//   };

//   const handleTwintCvvChange = (text: string) => {
//     // Remove non-numeric characters and limit to 4 digits
//     const cleaned = text.replace(/\D/g, "");
//     setTwintCvv(cleaned.slice(0, 4));
//   };

//   const handleWorldlineCardNumberChange = (text: string) => {
//     // Remove non-numeric characters
//     const cleaned = text.replace(/\D/g, "");

//     // Format with spaces every 4 digits
//     let formatted = "";
//     for (let i = 0; i < cleaned.length; i++) {
//       if (i > 0 && i % 4 === 0) {
//         formatted += " ";
//       }
//       formatted += cleaned[i];
//     }

//     // Limit to 19 characters (16 digits + 3 spaces)
//     setWorldlineCardNumber(formatted.slice(0, 19));
//   };

//   const handleWorldlineExpiryDateChange = (text: string) => {
//     // Remove non-numeric characters
//     const cleaned = text.replace(/\D/g, "");

//     // Format as MM/YY
//     if (cleaned.length <= 2) {
//       setWorldlineExpiryDate(cleaned);
//     } else {
//       setWorldlineExpiryDate(`${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}`);
//     }
//   };

//   const handleWorldlineCvvChange = (text: string) => {
//     // Remove non-numeric characters and limit to 4 digits
//     const cleaned = text.replace(/\D/g, "");
//     setWorldlineCvv(cleaned.slice(0, 4));
//   };

//   const handleDatatransCardNumberChange = (text: string) => {
//     // Remove non-numeric characters
//     const cleaned = text.replace(/\D/g, "");

//     // Format with spaces every 4 digits
//     let formatted = "";
//     for (let i = 0; i < cleaned.length; i++) {
//       if (i > 0 && i % 4 === 0) {
//         formatted += " ";
//       }
//       formatted += cleaned[i];
//     }

//     // Limit to 19 characters (16 digits + 3 spaces)
//     setDatatransCardNumber(formatted.slice(0, 19));
//   };

//   const handleDatatransExpiryDateChange = (text: string) => {
//     // Remove non-numeric characters
//     const cleaned = text.replace(/\D/g, "");

//     // Format as MM/YY
//     if (cleaned.length <= 2) {
//       setDatatransExpiryDate(cleaned);
//     } else {
//       setDatatransExpiryDate(`${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}`);
//     }
//   };

//   const handleDatatransCvvChange = (text: string) => {
//     // Remove non-numeric characters and limit to 4 digits
//     const cleaned = text.replace(/\D/g, "");
//     setDatatransCvv(cleaned.slice(0, 4));
//   };

//   const validateEmail = (email: string) => {
//     const re =
//       /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
//     return re.test(String(email).toLowerCase());
//   };

//   const savePaymentMethodAfterPayment = async (
//     currentUser: any,
//     reference: string,
//     paymentProvider: "paystack" | "worldline" | "datatrans" = "paystack"
//   ) => {
//     try {
//       logger.debug(
//         `💾 Saving payment method after successful ${paymentProvider} payment...`
//       );

//       // Determine card type based on first digit
//       const firstDigit = (
//         paymentProvider === "paystack"
//           ? cardNumber
//           : paymentProvider === "worldline"
//           ? worldlineCardNumber
//           : paymentProvider === "datatrans"
//           ? datatransCardNumber
//           : twintCardNumber
//       ).replace(/\s/g, "")[0];
//       let cardType: "visa" | "mastercard" | "amex" | "discover" = "visa";

//       if (firstDigit === "4") {
//         cardType = "visa";
//       } else if (firstDigit === "5") {
//         cardType = "mastercard";
//       } else if (firstDigit === "3") {
//         cardType = "amex";
//       } else if (firstDigit === "6") {
//         cardType = "discover";
//       }

//       // Get card details based on payment provider
//       const cardDetails =
//         paymentProvider === "paystack"
//           ? {
//               cardNumber,
//               expiryDate,
//               cardholderName,
//             }
//           : paymentProvider === "worldline"
//           ? {
//               cardNumber: worldlineCardNumber,
//               expiryDate: worldlineExpiryDate,
//               cardholderName: worldlineCardholderName,
//             }
//           : paymentProvider === "datatrans"
//           ? {
//               cardNumber: datatransCardNumber,
//               expiryDate: datatransExpiryDate,
//               cardholderName: datatransCardholderName,
//             }
//           : {
//               cardNumber: twintCardNumber,
//               expiryDate: twintExpiryDate,
//               cardholderName: twintCardholderName,
//             };

//       // Save to Supabase using the appropriate service
//       try {
//         if (paymentProvider === "paystack") {
//           const { default: PaystackService } = await import("@/lib/paystack");
//           const supabasePaymentMethod =
//             await PaystackService.savePaymentMethodToSupabase({
//               userId: currentUser.id,
//               nickname: nickname,
//               cardType: cardType,
//               isDefault: isDefault,
//               paystackReference: reference,
//               authorization: {
//                 authorization_code: `AUTH_${Date.now()}`,
//                 last4: cardDetails.cardNumber.replace(/\s/g, "").slice(-4),
//                 exp_month: cardDetails.expiryDate.split("/")[0],
//                 exp_year: `20${cardDetails.expiryDate.split("/")[1]}`,
//                 brand: cardType,
//                 bank: "TEST BANK",
//                 country_code: "NG",
//               },
//             });
//           logger.debug(
//             "✅ Paystack payment method saved to Supabase:",
//             supabasePaymentMethod
//           );
//         } else if (paymentProvider === "worldline") {
//           const { default: WorldlineService } = await import("@/lib/worldline");
//           const supabasePaymentMethod =
//             await WorldlineService.savePaymentMethodToSupabase({
//               userId: currentUser.id,
//               nickname: nickname,
//               cardType: cardType,
//               isDefault: isDefault,
//               worldlineReference: reference,
//               authorization: {
//                 authorization_code: `AUTH_${Date.now()}`,
//                 last4: cardDetails.cardNumber.replace(/\s/g, "").slice(-4),
//                 exp_month: cardDetails.expiryDate.split("/")[0],
//                 exp_year: `20${cardDetails.expiryDate.split("/")[1]}`,
//                 brand: cardType,
//                 bank: "TEST BANK",
//                 country_code: "US",
//               },
//             });
//           logger.debug(
//             "✅ Worldline payment method saved to Supabase:",
//             supabasePaymentMethod
//           );
//         } else if (paymentProvider === "datatrans") {
//           const service = await getDatatransService();
//           if (!service) {
//             throw new Error("DatatransService is not available. Please restart the app.");
//           }
//           const supabasePaymentMethod =
//             await service.savePaymentMethodToSupabase({
//               userId: currentUser.id,
//               nickname: nickname,
//               cardType: cardType,
//               isDefault: isDefault,
//               datatransReference: reference,
//               authorization: {
//                 authorization_code: `AUTH_${Date.now()}`,
//                 last4: cardDetails.cardNumber.replace(/\s/g, "").slice(-4),
//                 exp_month: cardDetails.expiryDate.split("/")[0],
//                 exp_year: `20${cardDetails.expiryDate.split("/")[1]}`,
//                 brand: cardType,
//                 bank: "TEST BANK",
//                 country_code: "CH",
//               },
//             });
//           logger.debug(
//             "✅ Datatrans payment method saved to Supabase:",
//             supabasePaymentMethod
//           );
//         }
//       } catch (supabaseError) {
//         logger.debug(
//           "⚠️ Supabase save failed, continuing with local save:",
//           supabaseError
//         );
//       }

//       // Also save to local wallet store for immediate UI updates
//       const paymentMethod = {
//         type:
//           paymentProvider === "paystack"
//             ? ("credit_card" as const)
//             : paymentProvider === "worldline"
//             ? ("worldline" as const)
//             : paymentProvider === "datatrans"
//             ? ("datatrans" as const)
//             : ("twint" as const),
//         nickname,
//         isDefault,
//         lastFour: cardDetails.cardNumber.replace(/\s/g, "").slice(-4),
//         expiryDate: cardDetails.expiryDate,
//         cardType,
//         metadata: {
//           [`${paymentProvider}Reference`]: reference,
//           [`${paymentProvider}PaymentMethod`]: true,
//           cardholderName: cardDetails.cardholderName,
//           description: `${
//             paymentProvider.charAt(0).toUpperCase() + paymentProvider.slice(1)
//           } payment method setup`,
//         },
//       };

//       const success = await addPaymentMethod(paymentMethod, currentUser);

//       if (success) {
//         logger.debug(
//           `🎉 Payment method saved successfully after ${paymentProvider} payment!`
//         );

//         // Check if this was a real transaction
//         const isRealKey =
//           paymentProvider === "paystack"
//             ? (await import("@/lib/paystack-config")).PAYSTACK_CONFIG
//                 .PUBLIC_KEY &&
//               (
//                 await import("@/lib/paystack-config")
//               ).PAYSTACK_CONFIG.PUBLIC_KEY.startsWith("pk_test_") &&
//               !(
//                 await import("@/lib/paystack-config")
//               ).PAYSTACK_CONFIG.PUBLIC_KEY.includes(
//                 "YOUR_ACTUAL_TEST_PUBLIC_KEY_HERE"
//               )
//             : (await import("@/lib/worldline")).default.isRealWorldlineKey();

//         if (isRealKey) {
//           const dashboardUrl =
//             paymentProvider === "paystack"
//               ? "https://dashboard.paystack.com/#/transactions"
//               : paymentProvider === "worldline"
//               ? "https://dashboard.worldline-solutions.com/transactions"
//               : "https://admin.sandbox.datatrans.com";

//           Alert.alert(
//             "🎉 Payment Method Saved!",
//             `Your ${paymentProvider} payment method has been successfully added and verified!\n\n📊 Check your ${paymentProvider} dashboard to see the transaction:\n🔗 ${dashboardUrl}`,
//             [{ text: "OK", onPress: () => router.back() }]
//           );
//         } else {
//           Alert.alert(
//             "Payment Method Saved",
//             `Your ${paymentProvider} payment method has been successfully added and verified!`,
//             [{ text: "OK", onPress: () => router.back() }]
//           );
//         }
//       } else {
//         logger.debug("❌ Failed to save payment method after payment");
//         Alert.alert(
//           "Warning",
//           "Payment was successful but failed to save payment method. Please try adding it again.",
//           [{ text: "OK" }]
//         );
//       }
//     } catch (error: any) {
//       logger.error("❌ Error saving payment method after payment:", error);
//       Alert.alert(
//         "Error",
//         "Payment was successful but failed to save payment method. Please try adding it again.",
//         [{ text: "OK" }]
//       );
//     }
//   };

//   const handleSave = async () => {
//     // TEMPORARY: Create mock user if authentication is not working
//     let currentUser = user;
//     if (!user || !isAuthenticated) {
//       logger.debug("⚠️ No user found, creating mock user for testing");
//       currentUser = {
//         id: "mock_user_" + Date.now(),
//         email: "test@example.com",
//         name: "Test User",
//         username: "testuser",
//         avatar: "",
//         followers: 0,
//         following: 0,
//         isBusinessAccount: false,
//       };
//     }

//     // Validate inputs based on payment type
//     if (!nickname) {
//       Alert.alert("Error", "Please enter a nickname for this payment method.");
//       return;
//     }

//     logger.debug("🚀 Starting payment method creation process...");
//     logger.debug("👤 Current user:", currentUser);
//     logger.debug("👤 User ID:", currentUser?.id);
//     logger.debug("👤 Payment type:", paymentType);
//     logger.debug("👤 Nickname:", nickname);

//     if (paymentType === "credit_card") {
//       if (!cardNumber || cardNumber.replace(/\s/g, "").length < 16) {
//         Alert.alert("Error", "Please enter a valid card number.");
//         return;
//       }

//       if (!expiryDate || expiryDate.length < 5) {
//         Alert.alert("Error", "Please enter a valid expiry date (MM/YY).");
//         return;
//       }

//       if (!cvv || cvv.length < 3) {
//         Alert.alert("Error", "Please enter a valid CVV code.");
//         return;
//       }

//       if (!cardholderName) {
//         Alert.alert("Error", "Please enter the cardholder name.");
//         return;
//       }

//       // Process Paystack payment for credit card
//       try {
//         logger.debug("💳 Processing credit card payment with Paystack...");

//         // Import PaystackService
//         const { default: PaystackService } = await import("@/lib/paystack");

//         // Check if using real Paystack integration
//         const { PAYSTACK_CONFIG } = await import("@/lib/paystack-config");
//         const isRealPaystackKey =
//           PAYSTACK_CONFIG.PUBLIC_KEY &&
//           PAYSTACK_CONFIG.PUBLIC_KEY.startsWith("pk_test_") &&
//           !PAYSTACK_CONFIG.PUBLIC_KEY.includes(
//             "YOUR_ACTUAL_TEST_PUBLIC_KEY_HERE"
//           );

//         if (isRealPaystackKey) {
//           Alert.alert(
//             "🎯 Real Paystack Integration Active!",
//             "This payment will appear in your Paystack dashboard!\n\n🔗 Dashboard: https://dashboard.paystack.com/#/transactions",
//             [{ text: "Continue", style: "default" }]
//           );
//         }

//         // Parse expiry date
//         const [month, year] = expiryDate.split("/");
//         const expiryYear = `20${year}`;

//         // Generate a unique reference
//         const reference = PaystackService.generateReference("credit_card");

//         // Process direct card payment with Paystack
//         const paymentResult = await PaystackService.processDirectCardPayment({
//           email: currentUser?.email || "user@example.com",
//           amount: 100, // ₦100.00 test amount (will be converted to 10000 kobo in PaystackService)
//           currency: "NGN", // Using NGN for better Paystack test compatibility
//           reference,
//           cardNumber: cardNumber.replace(/\s/g, ""),
//           expiryMonth: month,
//           expiryYear: expiryYear,
//           cvv: cvv,
//           cardholderName: cardholderName,
//           userId: currentUser?.id || "",
//           paymentType: "wallet_funding",
//           metadata: {
//             nickname: nickname,
//             cardType: "credit_card",
//             isDefault: isDefault,
//             description: "Credit card payment method setup",
//           },
//         });

//         if (paymentResult.success) {
//           logger.debug(
//             "✅ Paystack payment processed successfully:",
//             paymentResult
//           );

//           // Show success message and redirect to Paystack checkout
//           Alert.alert(
//             "Payment Processing",
//             "Your payment is being processed. You will be redirected to complete the payment.",
//             [
//               {
//                 text: "Continue",
//                 onPress: () => {
//                   // For web platform, open Paystack checkout
//                   if (Platform.OS === "web") {
//                     PaystackService.openCheckout({
//                       email: currentUser?.email || "user@example.com",
//                       amount: 100,
//                       currency: "NGN",
//                       reference,
//                       userId: currentUser?.id || "",
//                       paymentType: "wallet_funding",
//                       metadata: {
//                         nickname: nickname,
//                         cardType: "credit_card",
//                         isDefault: isDefault,
//                         description: "Credit card payment method setup",
//                       },
//                     })
//                       .then((paymentReference) => {
//                         logger.debug("Payment completed:", paymentReference);
//                         // Save payment method after successful payment
//                         if (currentUser) {
//                           savePaymentMethodAfterPayment(currentUser, reference);
//                         }
//                       })
//                       .catch((error) => {
//                         logger.error("Payment failed:", error);
//                         Alert.alert("Payment Failed", error.message);
//                       });
//                   } else {
//                     // For mobile, show authorization URL to complete payment
//                     Alert.alert(
//                       "Complete Payment",
//                       `Payment initialized successfully!\n\nTo complete the payment and see it in your Paystack dashboard:\n\n1. Open this URL in your browser:\n${paymentResult.authorization_url}\n\n2. Use test card details:\n• Card: 4084084084084081\n• Expiry: 12/25\n• CVV: 408\n\n3. Complete the payment\n\n4. Check your dashboard: https://dashboard.paystack.com/#/transactions`,
//                       [
//                         {
//                           text: "Copy URL",
//                           onPress: () => {
//                             // Copy URL to clipboard (if available)
//                             logger.debug(
//                               "🔗 Authorization URL:",
//                               paymentResult.authorization_url
//                             );
//                             Alert.alert(
//                               "URL Copied",
//                               "Check console logs for the URL"
//                             );
//                           },
//                         },
//                       ]


// import React, { useState, useEffect } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   TextInput,
//   ScrollView,
//   ActivityIndicator,
//   Alert,
//   KeyboardAvoidingView,
//   Platform,
//   Modal,
//                     );
//                   }
//                 },
//               },
//             ]
//           );
//           return;
//         } else {
//           throw new Error("Payment processing failed");
//         }
//       } catch (error: any) {
//         logger.error("❌ Paystack payment error:", error);
//         Alert.alert(
//           "Payment Error",
//           error.message || "Failed to process payment. Please try again.",
//           [{ text: "OK" }]
//         );
//         return;
//       }
//     } else if (paymentType === "bank_account") {
//       if (!bankName) {
//         Alert.alert("Error", "Please enter a bank name.");
//         return;
//       }

//       if (!accountNumber || accountNumber.length < 8) {
//         Alert.alert("Error", "Please enter a valid account number.");
//         return;
//       }

//       if (!routingNumber || routingNumber.length < 9) {
//         Alert.alert("Error", "Please enter a valid routing number.");
//         return;
//       }
//     } else if (paymentType === "twint") {
//       if (!twintPhoneNumber || twintPhoneNumber.length < 10) {
//         Alert.alert("Error", "Please enter a valid phone number for Twint.");
//         return;
//       }

//       if (!twintCardNumber || twintCardNumber.replace(/\s/g, "").length < 16) {
//         Alert.alert("Error", "Please enter a valid card number for Twint.");
//         return;
//       }

//       if (!twintExpiryDate || twintExpiryDate.length < 5) {
//         Alert.alert(
//           "Error",
//           "Please enter a valid expiry date (MM/YY) for Twint."
//         );
//         return;
//       }

//       if (!twintCvv || twintCvv.length < 3) {
//         Alert.alert("Error", "Please enter a valid CVV code for Twint.");
//         return;
//       }

//       if (!twintCardholderName) {
//         Alert.alert("Error", "Please enter the cardholder name for Twint.");
//         return;
//       }
//     } else if (paymentType === "paystack") {
//       logger.debug("🔍 Validating Paystack payment method...");
//       logger.debug("🔍 Paystack email:", paystackEmail);
//       logger.debug("🔍 Email validation result:", validateEmail(paystackEmail));

//       if (!paystackEmail || !validateEmail(paystackEmail)) {
//         logger.debug("❌ Paystack validation failed");
//         Alert.alert("Error", "Please enter a valid email for Paystack.");
//         return;
//       }
//       logger.debug("✅ Paystack validation passed");
//     } else if (paymentType === "worldline") {
//       if (!worldlineEmail || !validateEmail(worldlineEmail)) {
//         Alert.alert("Error", "Please enter a valid email for Worldline.");
//         return;
//       }

//       if (
//         !worldlineCardNumber ||
//         worldlineCardNumber.replace(/\s/g, "").length < 16
//       ) {
//         Alert.alert("Error", "Please enter a valid card number for Worldline.");
//         return;
//       }

//       if (!worldlineExpiryDate || worldlineExpiryDate.length < 5) {
//         Alert.alert(
//           "Error",
//           "Please enter a valid expiry date (MM/YY) for Worldline."
//         );
//         return;
//       }

//       if (!worldlineCvv || worldlineCvv.length < 3) {
//         Alert.alert("Error", "Please enter a valid CVV code for Worldline.");
//         return;
//       }

//       if (!worldlineCardholderName) {
//         Alert.alert("Error", "Please enter the cardholder name for Worldline.");
//         return;
//       }

//       // Process Worldline payment for card
//       try {
//         logger.debug("💳 Processing Worldline card payment...");

//         // Import WorldlineService
//         const { default: WorldlineService } = await import("@/lib/worldline");

//         // Check if using real Worldline integration
//         const isRealWorldlineKey = WorldlineService.isRealWorldlineKey();

//         if (isRealWorldlineKey) {
//           Alert.alert(
//             "🎯 Real Worldline Integration Active!",
//             "This payment will appear in your Worldline dashboard!\n\n🔗 Dashboard: https://dashboard.worldline-solutions.com/transactions",
//             [{ text: "Continue", style: "default" }]
//           );
//         }

//         // Parse expiry date
//         const [month, year] = worldlineExpiryDate.split("/");
//         const expiryYear = `20${year}`;

//         // Generate a unique reference
//         const reference = WorldlineService.generateReference("worldline_card");

//         // Process direct card payment with Worldline
//         const paymentResult = await WorldlineService.processDirectCardPayment({
//           email: currentUser?.email || worldlineEmail,
//           amount: 100, // $100.00 test amount
//           currency: "USD", // Using USD for Worldline
//           reference,
//           cardNumber: worldlineCardNumber.replace(/\s/g, ""),
//           expiryMonth: month,
//           expiryYear: expiryYear,
//           cvv: worldlineCvv,
//           cardholderName: worldlineCardholderName,
//           userId: currentUser?.id || "",
//           paymentType: "wallet_funding",
//           metadata: {
//             nickname: nickname,
//             cardType: "worldline_card",
//             isDefault: isDefault,
//             description: "Worldline payment method setup",
//           },
//         });

//         if (paymentResult.success) {
//           logger.debug(
//             "✅ Worldline payment processed successfully:",
//             paymentResult
//           );

//           // Show success message and redirect to Worldline checkout
//           Alert.alert(
//             "Payment Processing",
//             "Your Worldline payment is being processed. You will be redirected to complete the payment.",
//             [
//               {
//                 text: "Continue",
//                 onPress: () => {
//                   // For web platform, open Worldline checkout
//                   if (Platform.OS === "web") {
//                     WorldlineService.openCheckout({
//                       amount: 100,
//                       currency: "USD",
//                       orderId: reference,
//                       customerEmail: currentUser?.email || worldlineEmail,
//                       customerName: worldlineCardholderName,
//                       description: "Worldline payment method setup",
//                       userId: currentUser?.id || "",
//                       paymentType: "wallet_funding",
//                       metadata: {
//                         nickname: nickname,
//                         cardType: "worldline_card",
//                         isDefault: isDefault,
//                         description: "Worldline payment method setup",
//                       },
//                     })
//                       .then((paymentReference) => {
//                         logger.debug(
//                           "Worldline payment completed:",
//                           paymentReference
//                         );
//                         // Save payment method after successful payment
//                         if (currentUser) {
//                           savePaymentMethodAfterPayment(
//                             currentUser,
//                             reference,
//                             "worldline"
//                           );
//                         }
//                       })
//                       .catch((error) => {
//                         logger.error("Worldline payment failed:", error);
//                         Alert.alert("Payment Failed", error.message);
//                       });
//                   } else {
//                     // For mobile, show authorization URL to complete payment
//                     Alert.alert(
//                       "Complete Payment",
//                       `Worldline payment initialized successfully!\n\nTo complete the payment and see it in your Worldline dashboard:\n\n1. Open this URL in your browser:\n${paymentResult.data.authorization_url}\n\n2. Use test card details:\n• Card: 4111111111111111\n• Expiry: 12/25\n• CVV: 123\n\n3. Complete the payment\n\n4. Check your dashboard: https://dashboard.worldline-solutions.com/transactions`,
//                       [
//                         {
//                           text: "Copy URL",
//                           onPress: () => {
//                             // Copy URL to clipboard (if available)
//                             logger.debug(
//                               "🔗 Worldline Authorization URL:",
//                               paymentResult.data.authorization_url
//                             );
//                             Alert.alert(
//                               "URL Copied",
//                               "Check console logs for the URL"
//                             );
//                           },
//                         },
//                       ]
//                     );
//                   }
//                 },
//               },
//             ]
//           );
//           return;
//         } else {
//           throw new Error("Worldline payment processing failed");
//         }
//       } catch (error: any) {
//         logger.error("❌ Worldline payment error:", error);
//         Alert.alert(
//           "Payment Error",
//           error.message ||
//             "Failed to process Worldline payment. Please try again.",
//           [{ text: "OK" }]
//         );
//         return;
//       }
//     } else if (paymentType === "datatrans") {
//       if (!nickname || nickname.trim() === "") {
//         Alert.alert("Error", "Please enter a nickname for this payment method.");
//         return;
//       }

//       if (!datatransEmail || !validateEmail(datatransEmail)) {
//         Alert.alert("Error", "Please enter a valid email for Datatrans.");
//         return;
//       }

//       if (!datatransAmount || parseFloat(datatransAmount) <= 0) {
//         Alert.alert("Error", "Please enter a valid amount greater than 0.");
//         return;
//       }

//       if (
//         !datatransCardNumber ||
//         datatransCardNumber.replace(/\s/g, "").length < 16
//       ) {
//         Alert.alert("Error", "Please enter a valid card number for Datatrans.");
//         return;
//       }

//       if (!datatransExpiryDate || datatransExpiryDate.length < 5) {
//         Alert.alert(
//           "Error",
//           "Please enter a valid expiry date (MM/YY) for Datatrans."
//         );
//         return;
//       }

//       if (!datatransCvv || datatransCvv.length < 3) {
//         Alert.alert("Error", "Please enter a valid CVV code for Datatrans.");
//         return;
//       }

//       if (!datatransCardholderName) {
//         Alert.alert("Error", "Please enter the cardholder name for Datatrans.");
//         return;
//       }

//       // Process Datatrans payment for card
//       try {
//         logger.debug("💳 Processing Datatrans card payment...");

//         // Load DatatransService
//         const service = await getDatatransService();
//         if (!service) {
//           throw new Error("DatatransService is not available. Please restart the app.");
//         }

//         // Check if using real Datatrans integration
//         const isRealDatatransKey = service.isRealDatatransKey();

//         if (isRealDatatransKey) {
//           Alert.alert(
//             "🎯 Real Datatrans Integration Active!",
//             "This payment will appear in your Datatrans dashboard!\n\n🔗 Dashboard: https://admin.sandbox.datatrans.com",
//             [{ text: "Continue", style: "default" }]
//           );
//         }

//         // Parse expiry date
//         const [month, year] = datatransExpiryDate.split("/");
//         const expiryYear = `20${year}`;

//         // Generate a unique reference
//         const reference = service.generateReference("datatrans_card");

//         // Parse amount - default to 100 if empty or invalid
//         const amount = parseFloat(datatransAmount) || 100;
        
//         // Process direct card payment with Datatrans
//         logger.debug("📤 Sending payment request to backend...");
//         const paymentResult = await service.processDirectCardPayment({
//           email: currentUser?.email || datatransEmail,
//           amount: amount, // Use amount from input field
//           currency: "CHF", // Using CHF for Datatrans
//           reference,
//           cardNumber: datatransCardNumber.replace(/\s/g, ""),
//           expiryMonth: month,
//           expiryYear: expiryYear,
//           cvv: datatransCvv,
//           cardholderName: datatransCardholderName,
//           userId: currentUser?.id || "",
//           paymentType: "wallet_funding",
//           metadata: {
//             nickname: nickname,
//             cardType: "datatrans_card",
//             isDefault: isDefault,
//             description: "Datatrans payment method setup",
//           },
//         });

//         // REPLACE START - Proper error logging and success handling
//         logger.debug("📥 Payment result received:", JSON.stringify({
//           success: paymentResult.success,
//           status: paymentResult.data?.status,
//           message: typeof paymentResult.message === 'string' ? paymentResult.message : JSON.stringify(paymentResult.message),
//           transactionId: paymentResult.data?.transaction_id,
//           reference: paymentResult.data?.reference,
//         }, null, 2));

//         if (paymentResult.success) {
//           const successData = {
//             reference: paymentResult.data?.reference || reference,
//             transactionId: paymentResult.data?.transaction_id,
//             amount: paymentResult.data?.amount || amount,
//             currency: paymentResult.data?.currency || "CHF",
//             status: paymentResult.data?.status || "success",
//           };
          
//           logger.debug("✅ Datatrans payment processed successfully:", JSON.stringify(successData, null, 2));

//           // Set success data and show modal
//           setDatatransSuccessData(successData);
//           setShowDatatransSuccessModal(true);

//           // Save payment method after successful payment
//           if (currentUser) {
//             savePaymentMethodAfterPayment(
//               currentUser,
//               successData.reference,
//               "datatrans"
//             );
//           }
//           return;
//         } else {
//           // Extract error message properly - handle object errors and "[object Object]" strings
//           let errorMsg = "Datatrans payment processing failed";
          
//           // Check if message is already "[object Object]" - need to get actual error from backend logs
//           if (typeof paymentResult.message === 'string') {
//             if (paymentResult.message === '[object Object]') {
//               // Message was incorrectly stringified, try to get from data or log full object
//               errorMsg = "Payment failed. Check backend logs for details. Common issues: Invalid Datatrans credentials or API endpoint error.";
//               logger.error("❌ Error message is '[object Object]' - backend error handling issue");
//               logger.error("❌ Full payment result object:", JSON.stringify(paymentResult, null, 2));
//               logger.error("❌ paymentResult.data:", JSON.stringify(paymentResult.data, null, 2));
//             } else {
//               errorMsg = paymentResult.message;
//             }
//           } else if (paymentResult.message && typeof paymentResult.message === 'object') {
//             errorMsg = JSON.stringify(paymentResult.message, null, 2);
//           } else if (paymentResult.data?.message) {
//             if (typeof paymentResult.data.message === 'string' && paymentResult.data.message !== '[object Object]') {
//               errorMsg = paymentResult.data.message;
//             } else {
//               errorMsg = JSON.stringify(paymentResult.data.message, null, 2);
//             }
//           }
          
//           // Try to extract from gateway_response if available
//           if (paymentResult.data?.gateway_response) {
//             const gatewayError = paymentResult.data.gateway_response;
//             if (gatewayError.message && typeof gatewayError.message === 'string' && gatewayError.message !== '[object Object]') {
//               errorMsg = gatewayError.message;
//             } else if (gatewayError.error && typeof gatewayError.error === 'string') {
//               errorMsg = gatewayError.error;
//             }
//           }
          
//           logger.error("❌ Payment failed - Full result:", JSON.stringify(paymentResult, null, 2));
//           logger.error("❌ Extracted error message:", errorMsg);
          
//           Alert.alert(
//             "Payment Failed",
//             `Datatrans payment failed:\n\n${errorMsg}\n\nPlease check:\n• Datatrans credentials in .env\n• Backend server logs\n• Network connection`,
//             [{ text: "OK" }]
//           );
//           return;
//         }
//       } catch (error: any) {
//         // Extract error message safely
//         let errorMessage = "Failed to process Datatrans payment. Please try again.";
        
//         if (error?.message) {
//           if (typeof error.message === 'string') {
//             errorMessage = error.message;
//           } else {
//             errorMessage = JSON.stringify(error.message, null, 2);
//           }
//         } else if (error?.data?.message) {
//           errorMessage = typeof error.data.message === 'string' 
//             ? error.data.message 
//             : JSON.stringify(error.data.message, null, 2);
//         } else if (error?.data) {
//           errorMessage = JSON.stringify(error.data, null, 2);
//         }
        
//         logger.error("❌ Datatrans payment error - Full error:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
//         logger.error("❌ Extracted error message:", errorMessage);
        
//         Alert.alert(
//           "Payment Error",
//           errorMessage,
//           [{ text: "OK" }]
//         );
//         return;
//       }
//         // REPLACE END
//     }

//     // Create payment method object based on type
//     logger.debug("🔧 Creating payment method object...");
//     let paymentMethod: any = {
//       type: paymentType,
//       nickname,
//       isDefault,
//     };
//     logger.debug("🔧 Base payment method:", paymentMethod);

//     if (paymentType === "bank_account") {
//       paymentMethod = {
//         ...paymentMethod,
//         bankName,
//         accountType,
//         lastFour: accountNumber.slice(-4),
//       };
//     } else if (paymentType === "twint") {
//       paymentMethod = {
//         ...paymentMethod,
//         twintPhoneNumber,
//         cardNumber: twintCardNumber,
//         expiryDate: twintExpiryDate,
//         cvv: twintCvv,
//         cardholderName: twintCardholderName,
//         lastFour: twintCardNumber.replace(/\s/g, "").slice(-4),
//         metadata: {
//           twint_phone: twintPhoneNumber,
//           card_type: "twint",
//           description: "Twint payment method with card details",
//         },
//       };
//     } else if (paymentType === "paystack") {
//       // For now, save Paystack payment method locally (we'll add API integration later)
//       logger.debug("🚀 Saving Paystack payment method locally...");

//       paymentMethod = {
//         ...paymentMethod,
//         paystackEmail,
//         paystackAuthCode: `PAYSTACK_${Date.now()}`, // Temporary local ID
//         metadata: {
//           paystack_email: paystackEmail,
//           nickname: nickname,
//           created_locally: true,
//           // TODO: Add real Paystack customer creation later
//         },
//       };

//       logger.debug("✅ Paystack payment method prepared:", paymentMethod);
//     } else if (paymentType === "worldline") {
//       // For now, save Worldline payment method locally (we'll add API integration later)
//       logger.debug("🚀 Saving Worldline payment method locally...");

//       paymentMethod = {
//         ...paymentMethod,
//         worldlineEmail,
//         cardNumber: worldlineCardNumber,
//         expiryDate: worldlineExpiryDate,
//         cvv: worldlineCvv,
//         cardholderName: worldlineCardholderName,
//         lastFour: worldlineCardNumber.replace(/\s/g, "").slice(-4),
//         worldlineCustomerId: `WORLDLINE_${Date.now()}`, // Temporary local ID
//         worldlinePaymentMethodId: `pm_${Date.now()}`, // Temporary local ID
//         metadata: {
//           worldline_email: worldlineEmail,
//           card_type: "worldline",
//           nickname: nickname,
//           created_locally: true,
//           description: "Worldline payment method with card details",
//           // TODO: Add real Worldline customer creation later
//         },
//       };

//       logger.debug("✅ Worldline payment method prepared:", paymentMethod);
//     } else if (paymentType === "datatrans") {
//       // For now, save Datatrans payment method locally (we'll add API integration later)
//       logger.debug("🚀 Saving Datatrans payment method locally...");

//       paymentMethod = {
//         ...paymentMethod,
//         datatransEmail,
//         cardNumber: datatransCardNumber,
//         expiryDate: datatransExpiryDate,
//         cvv: datatransCvv,
//         cardholderName: datatransCardholderName,
//         lastFour: datatransCardNumber.replace(/\s/g, "").slice(-4),
//         datatransCustomerId: `DATATRANS_${Date.now()}`, // Temporary local ID
//         datatransPaymentMethodId: `pm_${Date.now()}`, // Temporary local ID
//         metadata: {
//           datatrans_email: datatransEmail,
//           card_type: "datatrans",
//           nickname: nickname,
//           created_locally: true,
//           description: "Datatrans payment method with card details",
//           // TODO: Add real Datatrans customer creation later
//         },
//       };

//       logger.debug("✅ Datatrans payment method prepared:", paymentMethod);
//     }

//     logger.debug("🚀 Calling addPaymentMethod with:");
//     logger.debug("🚀 Payment method:", paymentMethod);
//     logger.debug("🚀 Current user:", currentUser);

//     const success = await addPaymentMethod(paymentMethod, currentUser);

//     logger.debug("🚀 addPaymentMethod result:", success);

//     if (success) {
//       logger.debug("🎉 Payment method saved successfully!");
//       const successMessage =
//         (paymentType as string) === "paystack"
//           ? "Your Paystack payment method has been saved successfully! The details will be shown every time you open the app."
//           : (paymentType as string) === "worldline"
//           ? "Your Worldline payment method has been saved successfully! The details will be shown every time you open the app."
//           : (paymentType as string) === "datatrans"
//           ? "Your Datatrans payment method has been saved successfully! The details will be shown every time you open the app."
//           : (paymentType as string) === "twint"
//           ? "Your Twint payment method has been saved successfully! The details will be shown every time you open the app."
//           : "Your payment method has been added successfully.";

//       Alert.alert("Payment Method Saved", successMessage, [
//         { text: "OK", onPress: () => router.back() },
//       ]);
//     } else {
//       logger.debug("❌ Payment method save failed");
//       Alert.alert("Error", "Failed to save payment method. Please try again.", [
//         { text: "OK" },
//       ]);
//     }
//   };

//   // TEMPORARY: Skip authentication check to fix the loop issue
//   // TODO: Fix auth store persistence issue properly
//   logger.debug(
//     "🔍 Authentication state - isAuthenticated:",
//     isAuthenticated,
//     "user:",
//     user ? "exists" : "null"
//   );

//   // For now, allow access to prevent the sign-in loop
//   // if (!isAuthenticated || !user) {
//   //   logger.debug("⚠️ Authentication check failed - showing auth required screen");
//   //   logger.debug("⚠️ isAuthenticated:", isAuthenticated);
//   //   logger.debug("⚠️ user:", user);
//   //
//   //   return (
//   //     <View style={styles.container}>
//   //       <View style={styles.header}>
//   //         <TouchableOpacity style={styles.backButton} onPress={handleBack}>
//   //           <ArrowLeft size={24} color={Colors.dark.text} />
//   //         </TouchableOpacity>
//   //         <Text style={styles.title}>Add Payment Method</Text>
//   //         <View style={styles.placeholder} />
//   //       </View>
//   //
//   //       <View style={styles.authRequiredContainer}>
//   //         <Text style={styles.authRequiredTitle}>Authentication Required</Text>
//   //         <Text style={styles.authRequiredText}>
//   //           Please sign in to add payment methods to your account.
//   //         </Text>
//   //         <Text style={styles.debugText}>
//   //           Debug: isAuthenticated={isAuthenticated.toString()}, user={user ? 'exists' : 'null'}
//   //         </Text>
//   //         <TouchableOpacity
//   //           style={styles.signInButton}
//   //           onPress={() => router.push("/signin")}
//   //         >
//   //           <Text style={styles.signInButtonText}>Sign In</Text>
//   //         </TouchableOpacity>
//   //       </View>
//   //     </View>
//   //   );
//   // }

//   return (
//     <KeyboardAvoidingView
//       style={styles.container}
//       behavior={Platform.OS === "ios" ? "padding" : undefined}
//     >
//       <View style={styles.header}>
//         <TouchableOpacity style={styles.backButton} onPress={handleBack}>
//           <ArrowLeft size={24} color={Colors.dark.text} />
//         </TouchableOpacity>
//         <Text style={styles.title}>Add Payment Method</Text>
//         <View style={styles.placeholder} />
//       </View>

//       {/* Test mode indicators removed for production */}

//       <KeyboardAwareScrollView
//         style={styles.content}
//         enableOnAndroid={true}
//         extraScrollHeight={80}
//         keyboardShouldPersistTaps="handled"
//         showsVerticalScrollIndicator={false}
//       >
//         <View style={styles.section}>
//           <Text style={styles.sectionTitle}>Payment Type</Text>

//           <View style={styles.paymentTypeContainer}>
//             <TouchableOpacity
//               style={[
//                 styles.paymentTypeOption,
//                 paymentType === "credit_card" && styles.selectedPaymentType,
//               ]}
//               onPress={() => setPaymentType("credit_card")}
//             >
//               <CreditCard
//                 size={24}
//                 color={
//                   paymentType === "credit_card"
//                     ? Colors.dark.primary
//                     : Colors.dark.text
//                 }
//               />
//               <Text
//                 style={[
//                   styles.paymentTypeText,
//                   paymentType === "credit_card" &&
//                     styles.selectedPaymentTypeText,
//                 ]}
//               >
//                 Credit Card
//               </Text>
//             </TouchableOpacity>

//             <TouchableOpacity
//               style={[
//                 styles.paymentTypeOption,
//                 paymentType === "bank_account" && styles.selectedPaymentType,
//               ]}
//               onPress={() => setPaymentType("bank_account")}
//             >
//               <Landmark
//                 size={24}
//                 color={
//                   paymentType === "bank_account"
//                     ? Colors.dark.primary
//                     : Colors.dark.text
//                 }
//               />
//               <Text
//                 style={[
//                   styles.paymentTypeText,
//                   paymentType === "bank_account" &&
//                     styles.selectedPaymentTypeText,
//                 ]}
//               >
//                 Bank Account
//               </Text>
//             </TouchableOpacity>

//             <TouchableOpacity
//               style={[
//                 styles.paymentTypeOption,
//                 paymentType === "twint" && styles.selectedTwintType,
//               ]}
//               onPress={() => setPaymentType("twint")}
//             >
//               <Smartphone
//                 size={24}
//                 color={paymentType === "twint" ? "#FFFFFF" : "#ED0039"}
//               />
//               <Text
//                 style={[
//                   styles.paymentTypeText,
//                   paymentType === "twint" && styles.selectedTwintTypeText,
//                 ]}
//               >
//                 Twint
//               </Text>
//             </TouchableOpacity>

//             <TouchableOpacity
//               style={[
//                 styles.paymentTypeOption,
//                 paymentType === "paystack" && styles.selectedPaystackType,
//               ]}
//               onPress={() => setPaymentType("paystack")}
//             >
//               <DollarSign
//                 size={24}
//                 color={paymentType === "paystack" ? "#FFFFFF" : "#0BA4DB"}
//               />
//               <Text
//                 style={[
//                   styles.paymentTypeText,
//                   paymentType === "paystack" && styles.selectedPaystackTypeText,
//                 ]}
//               >
//                 Paystack
//               </Text>
//             </TouchableOpacity>

//             <TouchableOpacity
//               style={[
//                 styles.paymentTypeOption,
//                 paymentType === "worldline" && styles.selectedWorldlineType,
//               ]}
//               onPress={() => setPaymentType("worldline")}
//             >
//               <DollarSign
//                 size={24}
//                 color={paymentType === "worldline" ? "#FFFFFF" : "#0066CC"}
//               />
//               <Text
//                 style={[
//                   styles.paymentTypeText,
//                   paymentType === "worldline" &&
//                     styles.selectedWorldlineTypeText,
//                 ]}
//               >
//                 Worldline
//               </Text>
//             </TouchableOpacity>

//             <TouchableOpacity
//               style={[
//                 styles.paymentTypeOption,
//                 paymentType === "datatrans" && styles.selectedDatatransType,
//               ]}
//               onPress={() => setPaymentType("datatrans")}
//             >
//               <DollarSign
//                 size={24}
//                 color={paymentType === "datatrans" ? "#FFFFFF" : "#FF6B00"}
//               />
//               <Text
//                 style={[
//                   styles.paymentTypeText,
//                   paymentType === "datatrans" &&
//                     styles.selectedDatatransTypeText,
//                 ]}
//               >
//                 Datatrans
//               </Text>
//             </TouchableOpacity>
//           </View>
//         </View>

//         <View style={styles.section}>
//           <Text style={styles.sectionTitle}>Details</Text>

//           <View style={styles.inputContainer}>
//             <Text style={styles.inputLabel}>Nickname</Text>
//             <TextInput
//               style={styles.input}
//               placeholder="e.g. My Personal Card"
//               placeholderTextColor={Colors.dark.subtext}
//               value={nickname}
//               onChangeText={setNickname}
//             />
//           </View>

//           {paymentType === "credit_card" && (
//             <>
//               {/* TEST BUTTONS - TO BE REMOVED LATER */}

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Card Number</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="1234 5678 9012 3456"
//                   placeholderTextColor={Colors.dark.subtext}
//                   keyboardType="number-pad"
//                   value={cardNumber}
//                   onChangeText={handleCardNumberChange}
//                 />
//               </View>

//               <View style={styles.rowInputs}>
//                 <View
//                   style={[styles.inputContainer, { flex: 1, marginRight: 8 }]}
//                 >
//                   <Text style={styles.inputLabel}>Expiry Date</Text>
//                   <TextInput
//                     style={styles.input}
//                     placeholder="MM/YY"
//                     placeholderTextColor={Colors.dark.subtext}
//                     keyboardType="number-pad"
//                     value={expiryDate}
//                     onChangeText={handleExpiryDateChange}
//                   />
//                 </View>

//                 <View
//                   style={[styles.inputContainer, { flex: 1, marginLeft: 8 }]}
//                 >
//                   <Text style={styles.inputLabel}>CVV</Text>
//                   <TextInput
//                     style={styles.input}
//                     placeholder="123"
//                     placeholderTextColor={Colors.dark.subtext}
//                     keyboardType="number-pad"
//                     value={cvv}
//                     onChangeText={handleCvvChange}
//                     secureTextEntry
//                   />
//                 </View>
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Cardholder Name</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="John Doe"
//                   placeholderTextColor={Colors.dark.subtext}
//                   value={cardholderName}
//                   onChangeText={setCardholderName}
//                 />
//               </View>
//             </>
//           )}

//           {paymentType === "bank_account" && (
//             <>
//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Bank Name</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="e.g. Chase Bank"
//                   placeholderTextColor={Colors.dark.subtext}
//                   value={bankName}
//                   onChangeText={setBankName}
//                 />
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Account Number</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="123456789"
//                   placeholderTextColor={Colors.dark.subtext}
//                   keyboardType="number-pad"
//                   value={accountNumber}
//                   onChangeText={setAccountNumber}
//                 />
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Routing Number</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="987654321"
//                   placeholderTextColor={Colors.dark.subtext}
//                   keyboardType="number-pad"
//                   value={routingNumber}
//                   onChangeText={setRoutingNumber}
//                 />
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Account Type</Text>
//                 <View style={styles.accountTypeContainer}>
//                   <TouchableOpacity
//                     style={[
//                       styles.accountTypeOption,
//                       accountType === "checking" && styles.selectedAccountType,
//                     ]}
//                     onPress={() => setAccountType("checking")}
//                   >
//                     <Text
//                       style={[
//                         styles.accountTypeText,
//                         accountType === "checking" &&
//                           styles.selectedAccountTypeText,
//                       ]}
//                     >
//                       Checking
//                     </Text>
//                   </TouchableOpacity>

//                   <TouchableOpacity
//                     style={[
//                       styles.accountTypeOption,
//                       accountType === "savings" && styles.selectedAccountType,
//                     ]}
//                     onPress={() => setAccountType("savings")}
//                   >
//                     <Text
//                       style={[
//                         styles.accountTypeText,
//                         accountType === "savings" &&
//                           styles.selectedAccountTypeText,
//                       ]}
//                     >
//                       Savings
//                     </Text>
//                   </TouchableOpacity>
//                 </View>
//               </View>
//             </>
//           )}

//           {paymentType === "twint" && (
//             <>
//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Phone Number</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="+41 79 123 4567"
//                   placeholderTextColor={Colors.dark.subtext}
//                   keyboardType="phone-pad"
//                   value={twintPhoneNumber}
//                   onChangeText={handleTwintPhoneNumberChange}
//                 />
//                 <Text style={styles.inputHelp}>
//                   Enter the phone number associated with your Twint account
//                 </Text>
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Card Number</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="1234 5678 9012 3456"
//                   placeholderTextColor={Colors.dark.subtext}
//                   keyboardType="number-pad"
//                   value={twintCardNumber}
//                   onChangeText={handleTwintCardNumberChange}
//                 />
//               </View>

//               <View style={styles.rowInputs}>
//                 <View
//                   style={[styles.inputContainer, { flex: 1, marginRight: 8 }]}
//                 >
//                   <Text style={styles.inputLabel}>Expiry Date</Text>
//                   <TextInput
//                     style={styles.input}
//                     placeholder="MM/YY"
//                     placeholderTextColor={Colors.dark.subtext}
//                     keyboardType="number-pad"
//                     value={twintExpiryDate}
//                     onChangeText={handleTwintExpiryDateChange}
//                   />
//                 </View>

//                 <View
//                   style={[styles.inputContainer, { flex: 1, marginLeft: 8 }]}
//                 >
//                   <Text style={styles.inputLabel}>CVV</Text>
//                   <TextInput
//                     style={styles.input}
//                     placeholder="123"
//                     placeholderTextColor={Colors.dark.subtext}
//                     keyboardType="number-pad"
//                     value={twintCvv}
//                     onChangeText={handleTwintCvvChange}
//                     secureTextEntry
//                   />
//                 </View>
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Cardholder Name</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="John Doe"
//                   placeholderTextColor={Colors.dark.subtext}
//                   value={twintCardholderName}
//                   onChangeText={setTwintCardholderName}
//                 />
//               </View>
//             </>
//           )}

//           {paymentType === "paystack" && (
//             <View style={styles.inputContainer}>
//               <Text style={styles.inputLabel}>Email Address</Text>
//               <TextInput
//                 style={styles.input}
//                 placeholder="email@example.com"
//                 placeholderTextColor={Colors.dark.subtext}
//                 keyboardType="email-address"
//                 autoCapitalize="none"
//                 value={paystackEmail}
//                 onChangeText={setPaystackEmail}
//               />
//               <Text style={styles.inputHelp}>
//                 Enter the email address associated with your Paystack account
//               </Text>
//             </View>
//           )}

//           {paymentType === "worldline" && (
//             <>
//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Email Address</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="email@example.com"
//                   placeholderTextColor={Colors.dark.subtext}
//                   keyboardType="email-address"
//                   autoCapitalize="none"
//                   value={worldlineEmail}
//                   onChangeText={setWorldlineEmail}
//                 />
//                 <Text style={styles.inputHelp}>
//                   Enter the email address associated with your Worldline account
//                 </Text>
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Card Number</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="1234 5678 9012 3456"
//                   placeholderTextColor={Colors.dark.subtext}
//                   keyboardType="number-pad"
//                   value={worldlineCardNumber}
//                   onChangeText={handleWorldlineCardNumberChange}
//                 />
//               </View>

//               <View style={styles.rowInputs}>
//                 <View
//                   style={[styles.inputContainer, { flex: 1, marginRight: 8 }]}
//                 >
//                   <Text style={styles.inputLabel}>Expiry Date</Text>
//                   <TextInput
//                     style={styles.input}
//                     placeholder="MM/YY"
//                     placeholderTextColor={Colors.dark.subtext}
//                     keyboardType="number-pad"
//                     value={worldlineExpiryDate}
//                     onChangeText={handleWorldlineExpiryDateChange}
//                   />
//                 </View>

//                 <View
//                   style={[styles.inputContainer, { flex: 1, marginLeft: 8 }]}
//                 >
//                   <Text style={styles.inputLabel}>CVV</Text>
//                   <TextInput
//                     style={styles.input}
//                     placeholder="123"
//                     placeholderTextColor={Colors.dark.subtext}
//                     keyboardType="number-pad"
//                     value={worldlineCvv}
//                     onChangeText={handleWorldlineCvvChange}
//                     secureTextEntry
//                   />
//                 </View>
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Cardholder Name</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="John Doe"
//                   placeholderTextColor={Colors.dark.subtext}
//                   value={worldlineCardholderName}
//                   onChangeText={setWorldlineCardholderName}
//                 />
//               </View>
//             </>
//           )}

//           {paymentType === "datatrans" && (
//             <>
//               {/* INFO SECTION */}
//               <View style={styles.infoContainer}>
//                 <Text style={styles.infoTitle}>📊 View Transactions in Dashboard</Text>
//                 <Text style={styles.infoText}>
//                   After processing a payment, view it in your Datatrans Dashboard:
//                 </Text>
//                 <Text style={styles.infoLink}>
//                   https://admin.datatrans.com
//                 </Text>
//                 <Text style={styles.infoNote}>
//                   ⚠️ Make sure DATATRANS_MERCHANT_ID and DATATRANS_PASSWORD are set in your .env file
//                 </Text>
//               </View>

//               {/* QUICK FILL BUTTON */}
//               <TouchableOpacity
//                 style={styles.quickFillButton}
//                 onPress={fillAllDatatransTestData}
//               >
//                 <Text style={styles.quickFillButtonText}>
//                   ⚡ Quick Fill All Test Data
//                 </Text>
//               </TouchableOpacity>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Email Address</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="email@example.com"
//                   placeholderTextColor={Colors.dark.subtext}
//                   keyboardType="email-address"
//                   autoCapitalize="none"
//                   value={datatransEmail}
//                   onChangeText={setDatatransEmail}
//                 />
//                 <Text style={styles.inputHelp}>
//                   Enter the email address for this payment
//                 </Text>
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Amount (CHF)</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="100.00"
//                   placeholderTextColor={Colors.dark.subtext}
//                   keyboardType="decimal-pad"
//                   value={datatransAmount}
//                   onChangeText={(text) => {
//                     // Allow only numbers and one decimal point
//                     const cleaned = text.replace(/[^0-9.]/g, '');
//                     // Ensure only one decimal point
//                     const parts = cleaned.split('.');
//                     if (parts.length > 2) {
//                       setDatatransAmount(parts[0] + '.' + parts.slice(1).join(''));
//                     } else {
//                       setDatatransAmount(cleaned);
//                     }
//                   }}
//                 />
//                 <Text style={styles.inputHelp}>
//                   Enter the payment amount in Swiss Francs (CHF)
//                 </Text>
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Card Number</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="1234 5678 9012 3456"
//                   placeholderTextColor={Colors.dark.subtext}
//                   keyboardType="number-pad"
//                   value={datatransCardNumber}
//                   onChangeText={handleDatatransCardNumberChange}
//                 />
//               </View>

//               <View style={styles.rowInputs}>
//                 <View
//                   style={[styles.inputContainer, { flex: 1, marginRight: 8 }]}
//                 >
//                   <Text style={styles.inputLabel}>Expiry Date</Text>
//                   <TextInput
//                     style={styles.input}
//                     placeholder="MM/YY"
//                     placeholderTextColor={Colors.dark.subtext}
//                     keyboardType="number-pad"
//                     value={datatransExpiryDate}
//                     onChangeText={handleDatatransExpiryDateChange}
//                   />
//                 </View>

//                 <View
//                   style={[styles.inputContainer, { flex: 1, marginLeft: 8 }]}
//                 >
//                   <Text style={styles.inputLabel}>CVV</Text>
//                   <TextInput
//                     style={styles.input}
//                     placeholder="123"
//                     placeholderTextColor={Colors.dark.subtext}
//                     keyboardType="number-pad"
//                     value={datatransCvv}
//                     onChangeText={handleDatatransCvvChange}
//                     secureTextEntry
//                   />
//                 </View>
//               </View>

//               <View style={styles.inputContainer}>
//                 <Text style={styles.inputLabel}>Cardholder Name</Text>
//                 <TextInput
//                   style={styles.input}
//                   placeholder="John Doe"
//                   placeholderTextColor={Colors.dark.subtext}
//                   value={datatransCardholderName}
//                   onChangeText={setDatatransCardholderName}
//                 />
//               </View>
//             </>
//           )}

//           <View style={styles.checkboxContainer}>
//             <TouchableOpacity
//               style={[styles.checkbox, isDefault && styles.checkboxChecked]}
//               onPress={() => setIsDefault(!isDefault)}
//             >
//               {isDefault && <View style={styles.checkboxInner} />}
//             </TouchableOpacity>
//             <Text style={styles.checkboxLabel}>
//               Set as default payment method
//             </Text>
//           </View>
//         </View>
//       </KeyboardAwareScrollView>

//       <View style={styles.footer}>
//         <TouchableOpacity
//           style={[styles.saveButton, isLoading && styles.disabledButton]}
//           onPress={handleSave}
//           disabled={isLoading}
//         >
//           {isLoading ? (
//             <ActivityIndicator size="small" color={Colors.dark.text} />
//           ) : (
//             <Text style={styles.saveButtonText}>
//               {paymentType === "credit_card"
//                 ? "Pay with Paystack"
//                 : paymentType === "worldline"
//                 ? "Pay with Worldline"
//                 : paymentType === "datatrans"
//                 ? "Pay with Datatrans"
//                 : paymentType === "twint"
//                 ? "Pay with Twint"
//                 : "Save Payment Method"}
//             </Text>
//           )}
//         </TouchableOpacity>
//       </View>

//       {/* Datatrans Success Modal */}
//       <Modal
//         visible={showDatatransSuccessModal}
//         transparent={true}
//         animationType="fade"
//         onRequestClose={() => setShowDatatransSuccessModal(false)}
//       >
//         <View style={styles.modalOverlay}>
//           <View style={styles.modalContent}>
//             <Text style={styles.modalTitle}>🎉 Payment Successful!</Text>
            
//             {datatransSuccessData && (
//               <>
//                 <View style={styles.modalInfoRow}>
//                   <Text style={styles.modalLabel}>Reference:</Text>
//                   <Text style={styles.modalValue}>{datatransSuccessData.reference}</Text>
//                 </View>
                
//                 {datatransSuccessData.transactionId && (
//                   <View style={styles.modalInfoRow}>
//                     <Text style={styles.modalLabel}>Transaction ID:</Text>
//                     <Text style={styles.modalValue}>{datatransSuccessData.transactionId}</Text>
//                   </View>
//                 )}
                
//                 <View style={styles.modalInfoRow}>
//                   <Text style={styles.modalLabel}>Amount:</Text>
//                   <Text style={styles.modalValue}>
//                     {datatransSuccessData.amount} {datatransSuccessData.currency}
//                   </Text>
//                 </View>
                
//                 <View style={styles.modalInfoRow}>
//                   <Text style={styles.modalLabel}>Status:</Text>
//                   <Text style={[styles.modalValue, styles.modalStatusSuccess]}>
//                     {datatransSuccessData.status.toUpperCase()}
//                   </Text>
//                 </View>
                
//                 <View style={styles.modalNote}>
//                   <Text style={styles.modalNoteText}>
//                     📊 Check this reference in your Datatrans dashboard:
//                   </Text>
//                   <Text style={styles.modalLink}>
//                     https://admin.datatrans.com
//                   </Text>
//                 </View>
//               </>
//             )}
            
//             <TouchableOpacity
//               style={styles.modalButton}
//               onPress={() => {
//                 setShowDatatransSuccessModal(false);
//                 router.back();
//               }}
//             >
//               <Text style={styles.modalButtonText}>Close</Text>
//             </TouchableOpacity>
//           </View>
//         </View>
//       </Modal>
//     </KeyboardAvoidingView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//     marginTop: 40,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   title: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   placeholder: {
//     width: 40,
//   },
//   content: {
//     flex: 1,
//     padding: 16,
//   },
//   section: {
//     marginBottom: 24,
//   },
//   sectionTitle: {
//     fontSize: 16,
//     fontWeight: "500",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   paymentTypeContainer: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "space-between",
//   },
//   paymentTypeOption: {
//     width: "48%",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//     alignItems: "center",
//     marginBottom: 12,
//   },
//   selectedPaymentType: {
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   selectedTwintType: {
//     backgroundColor: "#ED0039",
//   },
//   selectedPaystackType: {
//     backgroundColor: "#0BA4DB",
//   },
//   selectedWorldlineType: {
//     backgroundColor: "#0066CC",
//   },
//   selectedDatatransType: {
//     backgroundColor: "#FF6B00",
//   },
//   paymentTypeText: {
//     marginTop: 8,
//     fontSize: 14,
//     color: Colors.dark.text,
//   },
//   selectedPaymentTypeText: {
//     color: Colors.dark.primary,
//     fontWeight: "500",
//   },
//   selectedTwintTypeText: {
//     color: "#FFFFFF",
//     fontWeight: "500",
//   },
//   selectedPaystackTypeText: {
//     color: "#FFFFFF",
//     fontWeight: "500",
//   },
//   selectedWorldlineTypeText: {
//     color: "#FFFFFF",
//     fontWeight: "500",
//   },
//   selectedDatatransTypeText: {
//     color: "#FFFFFF",
//     fontWeight: "500",
//   },
//   inputContainer: {
//     marginBottom: 16,
//   },
//   inputLabel: {
//     fontSize: 14,
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   input: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//     color: Colors.dark.text,
//     fontSize: 16,
//   },
//   inputHelp: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//     marginTop: 4,
//   },
//   rowInputs: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//   },
//   accountTypeContainer: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//   },
//   accountTypeOption: {
//     flex: 1,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//     alignItems: "center",
//     marginHorizontal: 4,
//   },
//   selectedAccountType: {
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//   },
//   accountTypeText: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },
//   selectedAccountTypeText: {
//     color: Colors.dark.primary,
//     fontWeight: "500",
//   },
//   checkboxContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     marginTop: 8,
//   },
//   checkbox: {
//     width: 24,
//     height: 24,
//     borderRadius: 4,
//     borderWidth: 2,
//     borderColor: Colors.dark.primary,
//     marginRight: 12,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   checkboxChecked: {
//     backgroundColor: Colors.dark.primary,
//   },
//   checkboxInner: {
//     width: 12,
//     height: 12,
//     backgroundColor: Colors.dark.text,
//     borderRadius: 2,
//   },
//   checkboxLabel: {
//     fontSize: 14,
//     color: Colors.dark.text,
//   },
//   footer: {
//     padding: 16,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//     marginBottom: 20,
//   },
//   saveButton: {
//     backgroundColor: Colors.dark.primary,
//     borderRadius: 12,
//     padding: 16,
//     alignItems: "center",
//   },
//   disabledButton: {
//     backgroundColor: Colors.dark.inactive,
//   },
//   saveButtonText: {
//     color: Colors.dark.text,
//     fontWeight: "bold",
//     fontSize: 16,
//   },
//   authRequiredContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   authRequiredTitle: {
//     fontSize: 24,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 16,
//     textAlign: "center",
//   },
//   authRequiredText: {
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//     marginBottom: 32,
//     lineHeight: 24,
//   },
//   signInButton: {
//     backgroundColor: Colors.dark.primary,
//     borderRadius: 12,
//     paddingVertical: 16,
//     paddingHorizontal: 32,
//   },
//   signInButtonText: {
//     color: Colors.dark.text,
//     fontWeight: "bold",
//     fontSize: 16,
//   },
//   testingNotice: {
//     backgroundColor: Colors.dark.card,
//     padding: 12,
//     margin: 16,
//     borderRadius: 8,
//     borderLeftWidth: 4,
//     borderLeftColor: Colors.dark.primary,
//   },
//   testingNoticeText: {
//     color: Colors.dark.text,
//     fontSize: 14,
//     fontWeight: "500",
//   },
//   // Test mode styles removed for production
//   testButtonsContainer: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//     marginBottom: 16,
//     borderWidth: 2,
//     borderColor: "#FF6B35",
//   },
//   testButtonsTitle: {
//     fontSize: 14,
//     fontWeight: "600",
//     color: "#FF6B35",
//     marginBottom: 12,
//     textAlign: "center",
//   },
//   testButtonsRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     gap: 8,
//   },
//   testButton: {
//     flex: 1,
//     backgroundColor: "#4CAF50",
//     borderRadius: 8,
//     paddingVertical: 8,
//     paddingHorizontal: 12,
//     alignItems: "center",
//   },
//   testButtonFailed: {
//     backgroundColor: "#F44336",
//   },
//   testButtonText: {
//     color: "#FFFFFF",
//     fontSize: 12,
//     fontWeight: "600",
//   },
//   // Info container for Datatrans
//   infoContainer: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//     marginBottom: 16,
//     borderWidth: 1,
//     borderColor: "#FF6B00",
//   },
//   infoTitle: {
//     fontSize: 16,
//     fontWeight: "600",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   infoText: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 8,
//     lineHeight: 20,
//   },
//   infoLink: {
//     fontSize: 12,
//     color: "#FF6B00",
//     fontWeight: "500",
//     marginBottom: 8,
//     textDecorationLine: "underline",
//   },
//   infoNote: {
//     fontSize: 12,
//     color: "#FFA500",
//     fontStyle: "italic",
//     marginTop: 4,
//   },
//   // Quick fill button
//   quickFillButton: {
//     backgroundColor: "#FF6B00",
//     borderRadius: 12,
//     padding: 16,
//     marginBottom: 16,
//     alignItems: "center",
//     borderWidth: 2,
//     borderColor: "#FF8C42",
//   },
//   quickFillButtonText: {
//     color: "#FFFFFF",
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   // Datatrans Success Modal Styles
//   modalOverlay: {
//     flex: 1,
//     backgroundColor: "rgba(0, 0, 0, 0.7)",
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   modalContent: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 16,
//     padding: 24,
//     width: "100%",
//     maxWidth: 400,
//     borderWidth: 1,
//     borderColor: "#FF6B00",
//   },
//   modalTitle: {
//     fontSize: 24,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 20,
//     textAlign: "center",
//   },
//   modalInfoRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "flex-start",
//     marginBottom: 12,
//     paddingBottom: 12,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   modalLabel: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     fontWeight: "500",
//     flex: 1,
//   },
//   modalValue: {
//     fontSize: 14,
//     color: Colors.dark.text,
//     fontWeight: "600",
//     flex: 2,
//     textAlign: "right",
//   },
//   modalStatusSuccess: {
//     color: "#4CAF50",
//   },
//   modalNote: {
//     marginTop: 16,
//     padding: 12,
//     backgroundColor: "rgba(255, 107, 0, 0.1)",
//     borderRadius: 8,
//     borderLeftWidth: 3,
//     borderLeftColor: "#FF6B00",
//   },
//   modalNoteText: {
//     fontSize: 12,
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   modalLink: {
//     fontSize: 12,
//     color: "#FF6B00",
//     fontWeight: "500",
//     textDecorationLine: "underline",
//   },
//   modalButton: {
//     backgroundColor: "#FF6B00",
//     borderRadius: 12,
//     padding: 16,
//     alignItems: "center",
//     marginTop: 20,
//   },
//   modalButtonText: {
//     color: "#FFFFFF",
//     fontSize: 16,
//     fontWeight: "bold",
//   },
// });
