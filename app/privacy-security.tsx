import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Trash2, Shield, Eye, Lock } from "lucide-react-native";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { trpc } from "@/lib/trpc";

export default function PrivacySecurityScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const deleteAccountMutation = trpc.account.deleteAccount.useMutation();


  const handleDeleteAccount = () => {
    if (!user) {
      Alert.alert("Delete Account", "You need to be signed in to delete your account.");
      return;
    }

    Alert.alert(
      "Delete Account",
      "This will permanently delete your account, including videos, orders, and payment methods. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Confirm Deletion",
              "Are you absolutely sure? This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Yes, Delete",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      if (!user?.id) {
                        throw new Error("Missing user information.");
                      }

                      const response = await deleteAccountMutation.mutateAsync({
                        userId: user.id,
                        email: user.email ?? "",
                      });

                      if (!response.success) {
                        throw new Error(response.message || "Failed to delete account.");
                      }

                      Alert.alert(
                        "Account Deleted",
                        "Your account has been deleted successfully.",
                        [
                          {
                            text: "OK",
                            onPress: async () => {
                              await signOut();
                              router.replace('/');
                            },
                          },
                        ]
                      );
                    } catch (error: any) {
                      Alert.alert("Delete Failed", error.message || "Please try again.");
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: Math.max(40, insets.bottom + 20) }}
    >
      {/* Header */}
      <View style={[styles.header, { marginTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy & Security</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Privacy Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy</Text>
        <TouchableOpacity style={styles.item} onPress={() => Alert.alert("Privacy Policy", "Privacy policy coming soon")}>
          <View style={styles.itemLeft}>
            <Eye size={18} color={Colors.dark.text} />
            <Text style={styles.itemLabel}>Privacy Policy</Text>
          </View>
          <ChevronLeft size={18} color={Colors.dark.subtext} style={{ transform: [{ rotate: "180deg" }] }} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.item} onPress={() => Alert.alert("Data Usage", "Data usage settings coming soon")}>
          <View style={styles.itemLeft}>
            <Shield size={18} color={Colors.dark.text} />
            <Text style={styles.itemLabel}>Data Usage</Text>
          </View>
          <ChevronLeft size={18} color={Colors.dark.subtext} style={{ transform: [{ rotate: "180deg" }] }} />
        </TouchableOpacity>
      </View>

      {/* Security Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <TouchableOpacity style={styles.item} onPress={() => Alert.alert("Two-Factor Authentication", "2FA settings coming soon")}>
          <View style={styles.itemLeft}>
            <Lock size={18} color={Colors.dark.text} />
            <Text style={styles.itemLabel}>Two-Factor Authentication</Text>
          </View>
          <ChevronLeft size={18} color={Colors.dark.subtext} style={{ transform: [{ rotate: "180deg" }] }} />
        </TouchableOpacity>
      </View>

      {/* Danger Zone */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Danger Zone</Text>
        <TouchableOpacity
          style={[styles.deleteButton, deleteAccountMutation.isPending && styles.disabledButton]}
          onPress={handleDeleteAccount}
          disabled={deleteAccountMutation.isPending}
        >
          {deleteAccountMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Trash2 size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.deleteButtonText}>Delete Account</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    padding: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dark.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
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
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#B91C1C",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
  },
  deleteButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  disabledButton: {
    opacity: 0.6,
  },
});
