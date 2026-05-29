import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft, CreditCard } from "lucide-react-native";
import Colors from "@/constants/colors";
import { useWalletStore } from "@/store/wallet-store";

export default function TestPaymentScreen() {
  const router = useRouter();
  const { paymentMethods, fetchPaymentMethods, processPaystackPayment, makePayment, isLoading } = useWalletStore();
  const [amount, setAmount] = useState("10.00");
  const [description, setDescription] = useState("Test Payment");

  useEffect(() => {
    console.log('🔍 Test payment screen mounted, fetching payment methods...');
    fetchPaymentMethods();
  }, []);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/payment-methods');
  };

  const handleDirectCardPayment = () => {
    router.push("/direct-card-payment");
  };

  const handlePaystackPayment = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }

    try {
      console.log("🧪 Testing Paystack payment...");
      console.log("💰 Amount:", amount);
      console.log("📝 Description:", description);
      
      const success = await processPaystackPayment(
        parseFloat(amount),
        description,
        {
          test: true,
          source: "test_payment_screen",
          timestamp: new Date().toISOString()
        }
      );

      console.log("🚀 Paystack payment result:", success);

      if (success) {
        Alert.alert(
          "Payment Successful!",
          `Your Paystack payment of $${amount} has been processed successfully!`,
          [{ text: "OK" }]
        );
      } else {
        Alert.alert(
          "Payment Failed",
          "The payment could not be processed. Please try again.",
          [{ text: "OK" }]
        );
      }
    } catch (error: any) {
      console.error("❌ Payment error:", error);
      Alert.alert(
        "Payment Error",
        error.message || "An error occurred during payment processing.",
        [{ text: "OK" }]
      );
    }
  };

  const handleMakePayment = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }

    try {
      console.log("🧪 Testing makePayment...");
      console.log("💰 Amount:", amount);
      console.log("📝 Description:", description);
      
      const success = await makePayment(
        parseFloat(amount),
        description,
        {
          paymentProvider: 'paystack',
          test: true,
          source: "test_payment_screen",
          timestamp: new Date().toISOString()
        }
      );

      if (success) {
        Alert.alert(
          "Payment Successful!",
          `Your payment of $${amount} has been processed successfully!`,
          [{ text: "OK" }]
        );
      } else {
        Alert.alert(
          "Payment Failed",
          "The payment could not be processed. Please try again.",
          [{ text: "OK" }]
        );
      }
    } catch (error: any) {
      console.error("❌ Payment error:", error);
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
        <Text style={styles.title}>Test Payment</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Details</Text>
          
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Amount ($)</Text>
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
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput
              style={styles.input}
              placeholder="Test Payment"
              placeholderTextColor={Colors.dark.subtext}
              value={description}
              onChangeText={setDescription}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Methods</Text>
          <Text style={styles.infoText}>
            Found {paymentMethods.length} payment method(s)
          </Text>
          
          {paymentMethods.map((method) => (
            <View key={method.id} style={styles.paymentMethodItem}>
              <CreditCard size={20} color={Colors.dark.primary} />
              <View style={styles.paymentMethodInfo}>
                <Text style={styles.paymentMethodName}>{method.nickname}</Text>
                <Text style={styles.paymentMethodType}>
                  {method.type.toUpperCase()}
                  {method.paystackEmail && ` - ${method.paystackEmail}`}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.buttonContainer}>


          <TouchableOpacity
            style={[styles.paymentButton, styles.directCardButton]}
            onPress={handleDirectCardPayment}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={Colors.dark.text} />
            ) : (
              <>
                <CreditCard size={20} color={Colors.dark.text} />
                <Text style={styles.paymentButtonText}>Direct Card Payment</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.paymentButton, styles.paystackButton]}
            onPress={handlePaystackPayment}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={Colors.dark.text} />
            ) : (
              <>
                <CreditCard size={20} color={Colors.dark.text} />
                <Text style={styles.paymentButtonText}>Test Paystack Payment</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.paymentButton, styles.makePaymentButton]}
            onPress={handleMakePayment}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={Colors.dark.text} />
            ) : (
              <>
                <CreditCard size={20} color={Colors.dark.text} />
                <Text style={styles.paymentButtonText}>Test Make Payment</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
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
  infoText: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 12,
  },
  paymentMethodItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  paymentMethodInfo: {
    marginLeft: 12,
    flex: 1,
  },
  paymentMethodName: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.dark.text,
  },
  paymentMethodType: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginTop: 2,
  },
  buttonContainer: {
    marginTop: 24,
  },
  paymentButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  paystackButton: {
    backgroundColor: "#0BA4DB",
  },
  makePaymentButton: {
    backgroundColor: Colors.dark.primary,
  },
  mockUserButton: {
    backgroundColor: "#FF6B35",
  },
  directCardButton: {
    backgroundColor: "#28A745",
  },
  paymentButtonText: {
    color: Colors.dark.text,
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 8,
  },
});
