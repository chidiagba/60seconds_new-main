import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import Colors from "@/constants/colors";

const C = Colors.dark;

type OtpInputProps = {
  value: string;
  onChange: (v: string) => void;
  onResend: () => void;
  onVerify: () => void;
  resendCooldown: number;
  isLoading?: boolean;
  isVerifyLoading?: boolean;
  error?: string;
  label?: string;
  verifyButtonText?: string;
};

export function OtpInput({
  value,
  onChange,
  onResend,
  onVerify,
  resendCooldown,
  isLoading,
  isVerifyLoading,
  error,
  label = "Enter 6-digit code",
  verifyButtonText = "Verify",
}: OtpInputProps) {
  const canVerify = value.length === 6 && !isVerifyLoading;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        placeholderTextColor={C.placeholder}
        keyboardType="number-pad"
        maxLength={6}
        editable={!isVerifyLoading}
        autoComplete="one-time-code"
      />
      {error ? <Text style={styles.errText}>{error}</Text> : null}
      <TouchableOpacity
        style={[styles.verifyBtn, !canVerify && styles.verifyBtnDisabled]}
        onPress={onVerify}
        disabled={!canVerify}
      >
        {isVerifyLoading ? (
          <ActivityIndicator size="small" color={C.text} />
        ) : (
          <Text style={[styles.verifyBtnText, !canVerify && styles.verifyBtnTextDisabled]}>
            {verifyButtonText}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.resendBtn, (isLoading || resendCooldown > 0) && styles.resendBtnDisabled]}
        onPress={onResend}
        disabled={isLoading || resendCooldown > 0}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={C.primary} />
        ) : (
          <Text
            style={[
              styles.resendText,
              (isLoading || resendCooldown > 0) && styles.resendTextDisabled,
            ]}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 24 },
  label: { fontSize: 14, fontWeight: "500", color: C.text, marginBottom: 8 },
  input: {
    backgroundColor: C.card,
    borderRadius: 8,
    padding: 14,
    color: C.text,
    fontSize: 20,
    letterSpacing: 8,
    textAlign: "center",
    borderWidth: 1,
    borderColor: C.divider,
  },
  inputError: { borderColor: C.error },
  errText: { fontSize: 13, color: C.error, marginTop: 6, textAlign: "center" },
  verifyBtn: {
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },
  verifyBtnDisabled: { backgroundColor: C.inactive, opacity: 0.7 },
  verifyBtnText: { color: C.text, fontSize: 16, fontWeight: "600" },
  verifyBtnTextDisabled: { color: C.subtext },
  resendBtn: { alignItems: "center", marginTop: 16 },
  resendBtnDisabled: { opacity: 0.6 },
  resendText: { fontSize: 14, color: C.primary, fontWeight: "500" },
  resendTextDisabled: { color: C.subtext },
});
