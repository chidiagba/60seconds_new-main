import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Alert,
  Modal,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Image } from "expo-image";
import Colors from "@/constants/colors";
import { OtpInput } from "@/components/OtpInput";
import { supabase } from "@/lib/supabase";

const C = Colors.dark;

export default function VerifyOtpScreen() {
  const router = useRouter();
  const { email = "", user_id = "", pin_sent = "" } = useLocalSearchParams<{ email: string; user_id?: string; pin_sent?: string }>();
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpVerified, setOtpVerified] = useState(false);
  const [statusUid, setStatusUid] = useState<string>(user_id || "");
  const [lastStatusCheckAt, setLastStatusCheckAt] = useState<string>("");
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCongratsModal, setShowCongratsModal] = useState(false);
  const hasAutoSentPinRef = useRef(false);

  const normalizedEmail = (email || "").trim().toLowerCase();

  const sendSignupPin = useCallback(async (uid?: string) => {
    const effectiveUid = uid || statusUid || user_id || undefined;

    const { data: sendData, error: sendErr } = await supabase.functions.invoke("send-otp", {
      body: {
        email: normalizedEmail,
        type: "signup",
        user_id: effectiveUid,
      },
    });

    if (!sendErr && sendData?.success) {
      return { ok: true as const, source: "edge" as const };
    }

    const reason = (sendData as any)?.message || sendErr?.message || "Failed to send PIN code";
    return { ok: false as const, reason };
  }, [normalizedEmail, statusUid, user_id]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const loadVerificationStatus = useCallback(async () => {
    if (!normalizedEmail) {
      setError("Missing email. Please sign up again.");
      return false;
    }

    setCheckingStatus(true);
    try {
      const { data, error: statusErr } = await supabase.functions.invoke("get-uid-by-email", {
        body: { email: normalizedEmail },
      });

      if (statusErr) {
        setError(statusErr.message || "Failed to check email verification status.");
        return false;
      }

      const isOtpVerified = data?.otp_verified === true;

      setOtpVerified(isOtpVerified);
      setStatusUid((data?.uid as string | undefined) || user_id || "");
      setLastStatusCheckAt(new Date().toLocaleTimeString());

      setError("");
      return true;
    } catch {
      setError("Could not verify status. Please try again.");
      return false;
    } finally {
      setCheckingStatus(false);
    }
  }, [normalizedEmail, user_id]);

  useEffect(() => {
    if (!normalizedEmail) {
      return;
    }

    if (hasAutoSentPinRef.current) {
      void loadVerificationStatus();
      return;
    }

    if (pin_sent === "1") {
      hasAutoSentPinRef.current = true;
      return;
    }

    hasAutoSentPinRef.current = true;
    void (async () => {
      const statusOk = await loadVerificationStatus();
      if (!statusOk) {
        return;
      }

      setResendLoading(true);
      try {
        const sendResult = await sendSignupPin();
        if (!sendResult.ok) {
          setError(`${sendResult.reason}. Check SMTP settings in Supabase Auth Email and spam folder.`);
          return;
        }

        setResendCooldown(60);
        setOtp("");
        Alert.alert("PIN sent", "Enter this 6 digit pin to confirm you email.");
      } catch {
        setError("Could not send PIN code. Please try again.");
      } finally {
        setResendLoading(false);
      }
    })();
  }, [normalizedEmail, loadVerificationStatus, pin_sent]);

  const handleResend = useCallback(async () => {
    if (!normalizedEmail) {
      setError("Cannot resend: missing email or user. Please sign up again.");
      return;
    }
    setError("");
    setResendLoading(true);
    try {
      const sendResult = await sendSignupPin();
      if (!sendResult.ok) {
        setError(`${sendResult.reason}. Check SMTP settings in Supabase Auth Email and spam folder.`);
        return;
      }
      setResendCooldown(60);
      setOtp("");
    } catch (e) {
      setError("Could not resend. Try again.");
    } finally {
      setResendLoading(false);
    }
  }, [normalizedEmail]);

  const handleVerify = useCallback(async () => {
    if (otp.length !== 6 || !normalizedEmail) return;
    setError("");
    setVerifyLoading(true);
    try {
      const verifiedUid = statusUid || user_id;
      let finalized = false;

      // Try Supabase SMTP-verified flow first (signup_email_otp)
      const { data: smtpVerifyData, error: smtpVerifyErr } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: otp,
        type: "email",
      });

      if (!smtpVerifyErr && smtpVerifyData?.session?.access_token) {
        const { data: markData, error: markErr } = await supabase.functions.invoke("verify-otp", {
          body: {
            type: "signup_email_otp",
            user_id: verifiedUid || smtpVerifyData.user?.id || smtpVerifyData.session?.user?.id,
            email: normalizedEmail,
          },
          headers: {
            Authorization: `Bearer ${smtpVerifyData.session.access_token}`,
          },
        });

        if (!markErr && markData?.success) {
          finalized = true;
        }
      }

      // Fallback: use OTP table-based verification (for signup or recovery)
      if (!finalized) {
        const { data, error: markErr } = await supabase.functions.invoke("verify-otp", {
          body: {
            type: "signup",
            code: otp,
            user_id: verifiedUid,
            email: normalizedEmail,
          },
        });

        if (markErr || !data?.success) {
          setError((data as any)?.error || markErr?.message || smtpVerifyErr?.message || "Invalid or expired code");
          return;
        }
      }

      setOtpVerified(true);
      setLastStatusCheckAt(new Date().toLocaleTimeString());

      try {
        await supabase.auth.signOut();
      } catch (signOutErr) {
        console.warn("Failed to clear session after PIN verification:", signOutErr);
      }

      setShowCongratsModal(true);
    } catch (e) {
      console.error("Verification error:", e);
      setError("Verification failed. Try again.");
    } finally {
      setVerifyLoading(false);
    }
  }, [otp, normalizedEmail, statusUid, user_id]);

  if (!normalizedEmail) {
    return (
      <View style={styles.container}>
        <Text style={styles.plainText}>Invalid link. Please sign up again.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace("/signup")}>
          <Text style={styles.backBtnText}>Go to Sign Up</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace("/signin")} style={styles.backButton}>
            <ArrowLeft size={24} color={C.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.logoContainer}>
          <View style={styles.logoImageContainer}>
            <Image
              source={require("../assets/images/second.png")}
              style={styles.logoImage}
              contentFit="contain"
            />
          </View>
          <Text style={styles.logoText}>60Seconds</Text>
        </View>
        <View style={styles.form}>
          <Text style={styles.title}>Verify your email</Text>
          <Text style={styles.subtitle}>
            {`Enter this 6 digit pin to confirm you email. The PIN was sent to ${normalizedEmail}.`}
          </Text>

          <View style={styles.debugPanel}>
            <View style={styles.debugPanelHeaderRow}>
              <Text style={styles.debugPanelTitle}>Verification status (debug)</Text>
              <TouchableOpacity onPress={loadVerificationStatus} disabled={checkingStatus}>
                <Text style={styles.debugRefreshText}>
                  {checkingStatus ? "Checking..." : "Refresh"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.debugRow}>PIN verified: {otpVerified ? "YES" : "NO"}</Text>
            <Text style={styles.debugRow}>User ID: {statusUid || "unknown"}</Text>
            <Text style={styles.debugTimestamp}>
              Last checked: {lastStatusCheckAt || "not checked yet"}
            </Text>
          </View>

          <OtpInput
            value={otp}
            onChange={(v) => {
              setOtp(v);
              setError("");
            }}
            onResend={handleResend}
            onVerify={handleVerify}
            resendCooldown={resendCooldown}
            isLoading={resendLoading}
            isVerifyLoading={verifyLoading}
            error={error}
            verifyButtonText="Verify PIN & continue"
          />

          <TouchableOpacity onPress={() => router.replace("/signin")} style={styles.signInLink}>
            <Text style={styles.signInLinkText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Congratulations Modal ── */}
      <Modal
        visible={showCongratsModal}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEmoji}>🎉</Text>
            <Text style={styles.modalTitle}>Registration Successful!</Text>
            <Text style={styles.modalBody}>
              Your email has been confirmed and PIN verified.{"\n"}{"\n"}✨ A welcome email from CEO Coolman Chidiagba is being sent to your inbox.{"\n"}{"\n"}Your registration is complete. You can now log in.
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => {
                setShowCongratsModal(false);
                router.replace("/signin");
              }}
            >
              <Text style={styles.modalButtonText}>Go to Login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scroll: { flexGrow: 1, paddingBottom: 40 },
  plainText: { color: C.text, textAlign: "center", marginTop: 60 },
  backBtn: { marginTop: 16, alignSelf: "center" },
  backBtnText: { color: C.primary, fontSize: 16, fontWeight: "600" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.card,
    justifyContent: "center",
    alignItems: "center",
  },
  logoContainer: { alignItems: "center", marginTop: 20, marginBottom: 32 },
  logoImageContainer: {
    width: 100,
    height: 100,
    borderRadius: 80,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: C.primary,
    marginBottom: 12,
  },
  logoImage: { width: "100%", height: "100%" },
  logoText: { fontSize: 24, fontWeight: "bold", color: C.text },
  form: { paddingHorizontal: 24 },
  title: { fontSize: 22, fontWeight: "bold", color: C.text, textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 15, color: C.subtext, textAlign: "center", marginBottom: 24, lineHeight: 22 },
  debugPanel: {
    borderWidth: 1,
    borderColor: C.divider,
    borderRadius: 10,
    backgroundColor: C.card,
    padding: 12,
    marginBottom: 14,
  },
  debugPanelHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  debugPanelTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: "700",
  },
  debugRefreshText: {
    color: C.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  debugRow: {
    color: C.subtext,
    fontSize: 13,
    marginBottom: 2,
  },
  debugTimestamp: {
    color: C.subtext,
    opacity: 0.8,
    fontSize: 12,
    marginTop: 4,
  },
  resendConfirmButton: {
    alignSelf: "center",
    marginTop: 6,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.primary,
  },
  resendConfirmButtonDisabled: {
    opacity: 0.6,
  },
  resendConfirmButtonText: {
    color: C.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  signInLink: { alignSelf: "center", marginTop: 8 },
  signInLinkText: { color: C.primary, fontSize: 14, fontWeight: "500" },
  // Congratulations modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  modalCard: {
    backgroundColor: C.card,
    borderRadius: 20,
    paddingVertical: 36,
    paddingHorizontal: 28,
    alignItems: "center",
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  modalEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  modalTitle: {
    color: C.text,
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 12,
  },
  modalBody: {
    color: C.subtext,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  modalButton: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: "center",
    width: "100%",
  },
  modalButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
