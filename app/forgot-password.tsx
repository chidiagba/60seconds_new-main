import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft } from "lucide-react-native";
import { Image } from "expo-image";
import Colors from "@/constants/colors";
import { OtpInput } from "@/components/OtpInput";
import { supabase } from "@/lib/supabase";

const normalizeEmailInput = (value: string) => value.replace(/\s+/g, "").trim().toLowerCase();

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { email: paramEmail } = useLocalSearchParams<{ email?: string }>();

  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState(typeof paramEmail === "string" ? paramEmail : "");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [error, setError] = useState("");

  const normalizedEmail = useMemo(() => normalizeEmailInput(email), [email]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((count) => (count <= 1 ? 0 : count - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleSendOtp = async () => {
    if (!normalizedEmail) {
      Alert.alert("Error", "Please enter your email address");
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      Alert.alert("Error", "Please enter a valid email address");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const { data, error: invokeError } = await supabase.functions.invoke("send-otp", {
        body: { email: normalizedEmail, type: "recovery" },
      });

      if (invokeError) {
        setError((data as any)?.message || invokeError.message || "Failed to send code. Try again.");
        return;
      }

      if (data?.success) {
        setStep(2);
        setResendCooldown(60);
      } else {
        setError((data as any)?.message || "Failed to send code. Try again.");
      }
    } catch {
      setError("Could not send code. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || resendLoading) return;

    setResendLoading(true);
    setError("");

    try {
      const { data, error: invokeError } = await supabase.functions.invoke("send-otp", {
        body: { email: normalizedEmail, type: "recovery" },
      });

      if (invokeError || !data?.success) {
        setError((data as any)?.message || invokeError?.message || "Failed to resend code.");
        return;
      }

      setResendCooldown(60);
    } catch {
      setError("Failed to resend code.");
    } finally {
      setResendLoading(false);
    }
  }, [normalizedEmail, resendCooldown, resendLoading]);

  const handleVerifyOtp = useCallback(async () => {
    if (!otp || otp.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }

    setVerifyLoading(true);
    setError("");

    try {
      const { data, error: invokeError } = await supabase.functions.invoke("verify-otp", {
        body: { email: normalizedEmail, code: otp.trim(), type: "recovery" },
      });

      if (invokeError) {
        const rawMessage = (data as any)?.error || (data as any)?.message || invokeError.message || "";
        const fallback = /non-2xx/i.test(rawMessage)
          ? "Could not verify code. Please try again."
          : "Invalid or expired code";
        setError(rawMessage || fallback);
        return;
      }

      if (data?.success && data?.code) {
        router.push(`/reset-password?email=${encodeURIComponent(normalizedEmail)}&code=${encodeURIComponent(data.code)}`);
      } else {
        setError((data as any)?.error || "Invalid or expired code");
      }
    } catch {
      setError("Verification failed. Try again.");
    } finally {
      setVerifyLoading(false);
    }
  }, [normalizedEmail, otp, router]);

  const goToLogin = () => router.push("/signin");

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
          <TouchableOpacity onPress={() => (step === 2 ? setStep(1) : router.back())} style={styles.backButton}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
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
          {step === 1 ? (
            <>
              <Text style={styles.title}>Forgot Password?</Text>
              <Text style={styles.subtitle}>Enter your email and we&apos;ll send a 6-digit code to reset your password in the app.</Text>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email Address</Text>
                <TextInput
                  style={styles.textInput}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    setError("");
                  }}
                  placeholder="Enter your email"
                  placeholderTextColor={Colors.dark.subtext}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                />
              </View>

              <TouchableOpacity style={[styles.resetButton, isLoading && styles.resetButtonDisabled]} onPress={handleSendOtp} disabled={isLoading}>
                <Text style={styles.resetButtonText}>{isLoading ? "Sending..." : "Send code"}</Text>
              </TouchableOpacity>

              <View style={styles.backToSigninContainer}>
                <Text style={styles.backToSigninText}>Remember your password? </Text>
                <TouchableOpacity onPress={goToLogin}>
                  <Text style={styles.backToSigninLink}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Enter verification code</Text>
              <Text style={styles.subtitle}>We sent a 6-digit code to {normalizedEmail}. Enter it below.</Text>

              <OtpInput
                value={otp}
                onChange={(value) => {
                  setOtp(value);
                  setError("");
                }}
                onResend={handleResend}
                onVerify={handleVerifyOtp}
                resendCooldown={resendCooldown}
                isLoading={resendLoading}
                isVerifyLoading={verifyLoading}
                error={error}
                verifyButtonText="Verify & continue"
              />

              <TouchableOpacity onPress={() => setStep(1)} style={styles.changeEmailBtn}>
                <Text style={styles.changeEmailText}>Change email</Text>
              </TouchableOpacity>

              <View style={styles.backToSigninContainer}>
                <Text style={styles.backToSigninText}>Remember your password? </Text>
                <TouchableOpacity onPress={goToLogin}>
                  <Text style={styles.backToSigninLink}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  scrollContent: { flexGrow: 1, paddingBottom: 40 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },
  logoContainer: { alignItems: "center", marginTop: 20, marginBottom: 40 },
  logoImageContainer: {
    width: 120,
    height: 120,
    borderRadius: 100,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.dark.primary,
    marginBottom: 16,
  },
  logoImage: { width: "100%", height: "100%" },
  logoText: { fontSize: 28, fontWeight: "bold", color: Colors.dark.text },
  formContainer: { paddingHorizontal: 24 },
  title: { fontSize: 24, fontWeight: "bold", color: Colors.dark.text, textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 16, color: Colors.dark.subtext, textAlign: "center", marginBottom: 32, lineHeight: 22 },
  inputGroup: { marginBottom: 20 },
  inputLabel: { fontSize: 14, fontWeight: "500", color: Colors.dark.text, marginBottom: 8 },
  textInput: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  resetButton: { backgroundColor: Colors.dark.primary, borderRadius: 8, paddingVertical: 16, alignItems: "center", marginTop: 20, marginBottom: 20 },
  resetButtonDisabled: { backgroundColor: Colors.dark.subtext },
  resetButtonText: { color: Colors.dark.text, fontSize: 16, fontWeight: "600" },
  backToSigninContainer: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginBottom: 40 },
  backToSigninText: { color: Colors.dark.subtext, fontSize: 14 },
  backToSigninLink: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
  changeEmailBtn: { alignSelf: "center", marginTop: 14, marginBottom: 8 },
  changeEmailText: { color: Colors.dark.primary, fontSize: 14, fontWeight: "600" },
  errorText: { color: Colors.dark.error, marginBottom: 12, textAlign: "center" },
});
