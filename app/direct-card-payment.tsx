import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft, CreditCard } from "lucide-react-native";
import Colors from "@/constants/colors";
import { useWalletStore } from "@/store/wallet-store";
import PaystackService from "@/lib/paystack";

export default function DirectCardPaymentScreen() {
  const router = useRouter();
  const { isLoading } = useWalletStore();
  
  const [amount, setAmount] = useState("10.00");
  const [email, setEmail] = useState("test@example.com");
  const [cardNumber, setCardNumber] = useState("");
  const [expiryMonth, setExpiryMonth] = useState("");
  const [expiryYear, setExpiryYear] = useState("");
  const [cvv, setCvv] = useState("");
  const [cardholderName, setCardholderName] = useState("");

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/payment-methods');
  };

  const handleCardNumberChange = (text: string) => {
    // Remove non-numeric characters
    const cleaned = text.replace(/\D/g, "");
    // Format with spaces every 4 digits
    let formatted = "";
    for (let i = 0; i < cleaned.length; i++) {
      if (i > 0 && i % 4 === 0) {
        formatted += " ";
      }
      formatted += cleaned[i];
    }
    setCardNumber(formatted.slice(0, 19));
  };

  const handleExpiryMonthChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "");
    setExpiryMonth(cleaned.slice(0, 2));
  };

  const handleExpiryYearChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "");
    setExpiryYear(cleaned.slice(0, 2));
  };

  const handleCvvChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "");
    setCvv(cleaned.slice(0, 4));
  };

  const handleDirectCardPayment = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }

    if (!email || !email.includes("@")) {
      Alert.alert("Error", "Please enter a valid email address");
      return;
    }

    if (!cardNumber || cardNumber.replace(/\s/g, "").length < 16) {
      Alert.alert("Error", "Please enter a valid card number");
      return;
    }

    if (!expiryMonth || !expiryYear) {
      Alert.alert("Error", "Please enter expiry month and year");
      return;
    }

    if (!cvv || cvv.length < 3) {
      Alert.alert("Error", "Please enter a valid CVV");
      return;
    }

    if (!cardholderName) {
      Alert.alert("Error", "Please enter cardholder name");
      return;
    }

    try {
      console.log("💳 Processing direct credit card payment...");
      console.log("💰 Amount:", amount);
      console.log("📧 Email:", email);
      console.log("💳 Card:", cardNumber.replace(/\s/g, "").slice(0, 4) + "****");
      
      // Authentication required - no mock users in production
      
      // Process direct card payment
      const result = await PaystackService.processDirectCardPayment({
        email,
        amount: parseFloat(amount),
        currency: 'NGN',
        cardNumber: cardNumber.replace(/\s/g, ""),
        expiryMonth,
        expiryYear,
        cvv,
        cardholderName,
        metadata: {
          source: "direct_card_payment",
          test: true,
          timestamp: new Date().toISOString()
        }
      });

      if (result.success) {
        console.log("✅ Direct card payment successful:", result);
        
        Alert.alert(
          "Payment Initialized!",
          `Your payment of ₦${amount} has been initialized successfully!\n\nReference: ${result.reference}\n\nThis will appear in your Paystack console.`,
          [
            {
              text: "Open Paystack Checkout",
              onPress: () => {
                if (result.authorization_url) {
                  Linking.openURL(result.authorization_url);
                }
              }
            },
            { text: "OK" }
          ]
        );
      } else {
        Alert.alert("Payment Failed", "The payment could not be processed. Please try again.");
      }
    } catch (error: any) {
      console.error("❌ Direct card payment error:", error);
      Alert.alert(
        "Payment Error",
        error.message || "An error occurred during payment processing.",
        [{ text: "OK" }]
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Direct Card Payment</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Details</Text>
          
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Amount (₦)</Text>
            <TextInput
              style={styles.input}
              placeholder="10.00"
              placeholderTextColor={Colors.dark.subtext}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="test@example.com"
              placeholderTextColor={Colors.dark.subtext}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Card Information</Text>
          
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
              <Text style={styles.inputLabel}>Expiry Month</Text>
              <TextInput
                style={styles.input}
                placeholder="12"
                placeholderTextColor={Colors.dark.subtext}
                keyboardType="number-pad"
                value={expiryMonth}
                onChangeText={handleExpiryMonthChange}
              />
            </View>

            <View style={[styles.inputContainer, { flex: 1, marginLeft: 8 }]}>
              <Text style={styles.inputLabel}>Expiry Year</Text>
              <TextInput
                style={styles.input}
                placeholder="25"
                placeholderTextColor={Colors.dark.subtext}
                keyboardType="number-pad"
                value={expiryYear}
                onChangeText={handleExpiryYearChange}
              />
            </View>
          </View>

          <View style={styles.rowInputs}>
            <View style={[styles.inputContainer, { flex: 1, marginRight: 8 }]}>
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

            <View style={[styles.inputContainer, { flex: 2, marginLeft: 8 }]}>
              <Text style={styles.inputLabel}>Cardholder Name</Text>
              <TextInput
                style={styles.input}
                placeholder="John Doe"
                placeholderTextColor={Colors.dark.subtext}
                value={cardholderName}
                onChangeText={setCardholderName}
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Credit Cards</Text>
          <Text style={styles.helpText}>
            Use these test card numbers for Paystack:
          </Text>
          <Text style={styles.cardInfo}>
            • Visa: 4084084084084081{'\n'}
            • Mastercard: 5555555555554444{'\n'}
            • Any CVV: 123{'\n'}
            • Any future expiry date
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.paymentButton, isLoading && styles.disabledButton]}
          onPress={handleDirectCardPayment}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={Colors.dark.text} />
          ) : (
            <>
              <CreditCard size={20} color={Colors.dark.text} />
              <Text style={styles.paymentButtonText}>Pay with Credit Card</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  rowInputs: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  helpText: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 8,
  },
  cardInfo: {
    fontSize: 12,
    color: Colors.dark.subtext,
    fontFamily: "monospace",
    backgroundColor: Colors.dark.card,
    padding: 12,
    borderRadius: 8,
  },
  paymentButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0BA4DB",
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  disabledButton: {
    backgroundColor: Colors.dark.inactive,
  },
  paymentButtonText: {
    color: Colors.dark.text,
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 8,
  },
});











