import { ProfileTableActions } from '@/features/tables/ProfileTableActions';
import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronRight, User, Bell, Shield, LogOut, Info, HelpCircle, Lock } from "lucide-react-native";
import Colors from "@/constants/colors";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "@/lib/auth";

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  let presentApplePay: ((params: {
    cartItems: { label: string; amount: string }[];
    country: string;
    currency: string;
  }) => Promise<{ error?: { message?: string } }>) | null = null;
  let isApplePaySupported = false;

  if (typeof Platform !== "undefined" && Platform.OS === "ios") {
    try {
      const { useStripe } = require("@stripe/stripe-react-native");
      const stripe = useStripe();
      presentApplePay = stripe.presentApplePay;
      isApplePaySupported = stripe.isApplePaySupported;
    } catch (error) {
      console.warn("Stripe native module unavailable in settings screen", error);
    }
  }
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const withTimeout = <T,>(promise: Promise<T>, ms: number, message: string) =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);


  const handleLogout = () => {
    if (isLoggingOut) return;

    Alert.alert(
      "Log Out",
      "Are you sure you want to log out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Out",
          style: "destructive",
          onPress: async () => {
            try {
              setIsLoggingOut(true);
              const { error } = await withTimeout(
                signOut(),
                12000,
                "Logout is taking too long. Please check your connection and try again."
              );

              if (error) {
                throw error;
              }
              router.replace("/");
            } catch (error: any) {
              Alert.alert("Logout Failed", error.message || "Please try again.");
            } finally {
              setIsLoggingOut(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: Math.max(40, insets.bottom + 20) }}>
      <Text style={styles.headerTitle}>Settings</Text>

      <ProfileTableActions />

      {/* Account Section */}
      <SettingsSection title="Account">
        <SettingsItem
          icon={<User size={18} color={Colors.dark.text} />}
          label="Edit Profile"
          onPress={() => router.push("/edit-profile")}
        />
        <SettingsItem
          icon={<Bell size={18} color={Colors.dark.text} />}
          label="Notifications"
          onPress={() => Alert.alert('Notifications', 'Notifications screen coming soon')}
        />
      </SettingsSection>

      {/* Security Section */}
      <SettingsSection title="Security">
        <SettingsItem
          icon={<Lock size={18} color={Colors.dark.text} />}
          label="Reset Password"
          onPress={() => router.push(`/forgot-password${user?.email ? `?email=${encodeURIComponent(user.email)}` : ""}`)}
        />
        <SettingsItem
          icon={<Shield size={18} color={Colors.dark.text} />}
          label="Privacy & Security"
          onPress={() => router.push("/privacy-security")}
        />
      </SettingsSection>

      {/* Help Section */}
      <SettingsSection title="Help & Info">
        <SettingsItem
          icon={<HelpCircle size={18} color={Colors.dark.text} />}
          label="Help Center"
          onPress={() => Alert.alert('Help', 'Help center coming soon')}
        />
        <SettingsItem
          icon={<Info size={18} color={Colors.dark.text} />}
          label="About"
          onPress={() => Alert.alert('About', 'About screen coming soon')}
        />
      </SettingsSection>

      {/* Testing Section (for reviewers) */}
      {Platform.OS === 'ios' && isApplePaySupported && (
        <SettingsSection title="Developer/Test">
          <SettingsItem
            icon={<Info size={18} color={Colors.dark.text} />}
            label="Try Apple Pay"
            onPress={async () => {
              if (!presentApplePay) {
                Alert.alert('Apple Pay', 'Apple Pay is not available in this build.');
                return;
              }
              try {
                const { error } = await presentApplePay({
                  cartItems: [{ label: 'Demo item', amount: '0.01' }],
                  country: 'US',
                  currency: 'USD',
                });
                if (error) {
                  Alert.alert('Apple Pay error', error.message || 'Please check your wallet');
                }
              } catch (e) {
                Alert.alert('Apple Pay', "Couldn't open sheet, see console for details.");
                console.warn('Apple Pay demo error', e);
              }
            }}
          />
        </SettingsSection>
      )}

      {/* Logout Button */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} disabled={isLoggingOut}>
        <LinearGradient
          colors={Colors.dark.gradients.primary as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradientButton}
        >
          {isLoggingOut ? (
            <>
              <ActivityIndicator size="small" color={Colors.dark.text} style={styles.logoutSpinner} />
              <Text style={styles.logoutButtonText}>Logging Out...</Text>
            </>
          ) : (
            <>
              <LogOut size={18} color={Colors.dark.text} style={styles.logoutIcon} />
              <Text style={styles.logoutButtonText}>Log Out</Text>
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );
}

// Settings Section Component
function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// Settings Item Component
function SettingsItem({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.item} onPress={onPress}>
      <View style={styles.itemLeft}>
        {icon}
        <Text style={styles.itemLabel}>{label}</Text>
      </View>
      <ChevronRight size={18} color={Colors.dark.subtext} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    padding: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 20,
    marginTop: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginBottom: 12,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    justifyContent: "space-between",
  },
  itemLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  itemLabel: {
    fontSize: 15,
    color: Colors.dark.text,
    marginLeft: 10,
  },
  logoutButton: {
    marginTop: 10,
    borderRadius: 12,
    overflow: "hidden",
  },
  gradientButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  logoutButtonText: {
    color: Colors.dark.text,
    fontWeight: "600",
    fontSize: 16,
  },
  logoutIcon: {
    marginRight: 8,
  },
  logoutSpinner: {
    marginRight: 10,
  },
});
