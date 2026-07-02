import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Eye, EyeOff, CheckCircle } from "lucide-react-native";
import { Image } from "expo-image";
import Colors from "@/constants/colors";
import { config } from "@/lib/config";

export default function ResetPasswordScreen() {
  const router = useRouter();
    const insets = useSafeAreaInsets();
  const urlParams = useLocalSearchParams();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [passwordReset, setPasswordReset] = useState(false);
  const [error, setError] = useState("");

  const email = urlParams.email || "";
  const code = urlParams.code || "";

  const validatePassword = (password: string) => {
    const minLength = password.length >= 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    
    return {
      isValid: minLength && hasUpperCase && hasLowerCase && hasNumbers,
      minLength,
      hasUpperCase,
      hasLowerCase,
      hasNumbers,
    };
  };

  const handleSubmit = async () => {
    // Clear previous errors
    setError("");

    // Validation
    if (!newPassword || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      let errorMsg = "Password must be at least 8 characters and contain:";
      if (!passwordValidation.minLength) errorMsg += "\n• At least 8 characters";
      if (!passwordValidation.hasUpperCase) errorMsg += "\n• One uppercase letter";
      if (!passwordValidation.hasLowerCase) errorMsg += "\n• One lowercase letter";
      if (!passwordValidation.hasNumbers) errorMsg += "\n• One number";
      setError(errorMsg);
      return;
    }

    if (!email || !code) {
      Alert.alert(
        "Error",
        "Invalid reset request. Please start over from the forgot password screen.",
        [
          {
            text: "Go to Forgot Password",
            onPress: () => router.replace("/forgot-password"),
          },
          {
            text: "Cancel",
            style: "cancel",
          },
        ]
      );
      return;
    }

    setIsLoading(true);

    try {
      const { url: supabaseUrl, anonKey } = config.supabase;
      const res = await fetch(`${supabaseUrl}/functions/v1/update-password-by-uid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          email: String(email).trim().toLowerCase(),
          code: String(code).trim(),
          newPassword: newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorMsg = (data as any)?.error ||
          (data as any)?.message ||
          `Request failed (${res.status}). Check that the password reset function is deployed.`;
        setError(errorMsg);
        setIsLoading(false);
        return;
      }

      if ((data as any)?.error) {
        setError((data as any).error);
        setIsLoading(false);
        return;
      }

      if (data?.success || data?.userId) {
        setPasswordReset(true);
        setIsLoading(false);
      } else {
        setError("Password update did not complete. Please try again.");
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error("Password reset error:", err);
      setError(err?.message || "An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  const passwordValidation = validatePassword(newPassword);

  if (passwordReset) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(40, insets.bottom + 20) },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.replace("/signin")} style={styles.backButton}>
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
            <View style={styles.successContainer}>
              <CheckCircle size={64} color={Colors.dark.primary} style={styles.successIcon} />
              <Text style={styles.successTitle}>Password Reset Complete</Text>
              <Text style={styles.successMessage}>
                Your password has been successfully updated. You can now sign in with your new password.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.signinButton}
              onPress={() => router.replace("/signin")}
            >
              <Text style={styles.signinButtonText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(40, insets.bottom + 20) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
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
          <Text style={styles.title}>Reset Your Password</Text>
          <Text style={styles.subtitle}>
            {email ? `Enter a new password for ${email}` : "Enter your new password below"}
          </Text>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {(!email || !code) && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                Invalid reset request. Please start over from the forgot password screen.
              </Text>
              <TouchableOpacity
                style={styles.requestLinkButton}
                onPress={() => router.replace("/forgot-password")}
              >
                <Text style={styles.requestLinkButtonText}>Go to Forgot Password</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>New Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                value={newPassword}
                onChangeText={(text) => {
                  setNewPassword(text);
                  setError("");
                }}
                placeholder="Enter new password"
                placeholderTextColor={Colors.dark.subtext}
                secureTextEntry={!showNewPassword}
                autoCapitalize="none"
                autoComplete="new-password"
              />
              <TouchableOpacity
                onPress={() => setShowNewPassword(!showNewPassword)}
                style={styles.eyeButton}
              >
                {showNewPassword ? (
                  <EyeOff size={20} color={Colors.dark.subtext} />
                ) : (
                  <Eye size={20} color={Colors.dark.subtext} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Confirm New Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  setError("");
                }}
                placeholder="Confirm new password"
                placeholderTextColor={Colors.dark.subtext}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                autoComplete="new-password"
              />
              <TouchableOpacity
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.eyeButton}
              >
                {showConfirmPassword ? (
                  <EyeOff size={20} color={Colors.dark.subtext} />
                ) : (
                  <Eye size={20} color={Colors.dark.subtext} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Password Requirements */}
          {newPassword.length > 0 && (
            <View style={styles.passwordRequirements}>
              <Text style={styles.requirementsTitle}>Password Requirements:</Text>
              <View style={styles.requirementItem}>
                <Text
                  style={[
                    styles.requirementText,
                    passwordValidation.minLength && styles.requirementMet,
                  ]}
                >
                  • At least 8 characters
                </Text>
              </View>
              <View style={styles.requirementItem}>
                <Text
                  style={[
                    styles.requirementText,
                    passwordValidation.hasUpperCase && styles.requirementMet,
                  ]}
                >
                  • One uppercase letter
                </Text>
              </View>
              <View style={styles.requirementItem}>
                <Text
                  style={[
                    styles.requirementText,
                    passwordValidation.hasLowerCase && styles.requirementMet,
                  ]}
                >
                  • One lowercase letter
                </Text>
              </View>
              <View style={styles.requirementItem}>
                <Text
                  style={[
                    styles.requirementText,
                    passwordValidation.hasNumbers && styles.requirementMet,
                  ]}
                >
                  • One number
                </Text>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.resetButton,
              (isLoading ||
                !passwordValidation.isValid ||
                newPassword !== confirmPassword ||
                !newPassword ||
                !confirmPassword ||
                !email ||
                !code) &&
                styles.resetButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={
              isLoading ||
              !passwordValidation.isValid ||
              newPassword !== confirmPassword ||
              !newPassword ||
              !confirmPassword ||
              !email ||
              !code
            }
            activeOpacity={0.7}
          >
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={Colors.dark.text} style={styles.loadingSpinner} />
                <Text style={styles.resetButtonText}>Updating...</Text>
              </View>
            ) : (
              <Text
                style={[
                  styles.resetButtonText,
                  (!passwordValidation.isValid ||
                    newPassword !== confirmPassword ||
                    !newPassword ||
                    !confirmPassword ||
                    !email ||
                    !code) &&
                    styles.resetButtonTextDisabled,
                ]}
              >
                Update Password
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },
  logoContainer: {
    alignItems: "center",
    marginTop: 20,
    marginBottom: 40,
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
    fontSize: 24,
    fontWeight: "bold",
    color: Colors.dark.text,
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 22,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.dark.text,
    marginBottom: 8,
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  passwordInput: {
    flex: 1,
    padding: 12,
    color: Colors.dark.text,
    fontSize: 16,
  },
  eyeButton: {
    padding: 12,
  },
  passwordRequirements: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: 8,
  },
  requirementItem: {
    marginBottom: 4,
  },
  requirementText: {
    fontSize: 13,
    color: Colors.dark.subtext,
  },
  requirementMet: {
    color: Colors.dark.primary,
    fontWeight: "500",
  },
  resetButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
    marginBottom: 20,
  },
  resetButtonDisabled: {
    backgroundColor: Colors.dark.subtext,
    opacity: 0.5,
  },
  resetButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "600",
  },
  resetButtonTextDisabled: {
    color: Colors.dark.subtext,
    opacity: 0.5,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingSpinner: {
    marginRight: 8,
  },
  signinButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },
  signinButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "600",
  },
  successContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  successIcon: {
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: Colors.dark.text,
    textAlign: "center",
    marginBottom: 16,
  },
  successMessage: {
    fontSize: 16,
    color: Colors.dark.text,
    textAlign: "center",
    lineHeight: 22,
  },
  errorContainer: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#ff4444",
  },
  errorText: {
    color: "#ff4444",
    fontSize: 14,
    lineHeight: 20,
  },
  infoBox: {
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  infoText: {
    fontSize: 14,
    color: Colors.dark.text,
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 20,
  },
  requestLinkButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  requestLinkButtonText: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: "600",
  },
});
