import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import Colors from "@/constants/colors";
import { LinearGradient } from "expo-linear-gradient";

export default function PricingScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Pricing & Product</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h}>Free Features</Text>
        <Text style={styles.p}>• Browse events and videos</Text>
        <Text style={styles.p}>• Create an account and profile</Text>

        <Text style={styles.h}>Premium (Example)</Text>
        <Text style={styles.p}>• Featured placement for events</Text>
        <Text style={styles.p}>• Advanced analytics (business accounts)</Text>
        <Text style={styles.p}>• Extra promotional tools</Text>

        <Text style={styles.h}>Price</Text>
        <Text style={styles.p}>
          Display your real prices here (e.g., $4.99 / month). Apple reviewers want a clear “Price/Product” reference.
        </Text>

        <Text style={styles.note}>
          Replace with your actual monetization (IAP/subscription/tickets). For screenshots, this screen proves pricing/product info is accessible in-app.
        </Text>

        {Platform.OS !== "web" ? (
          <LinearGradient
            colors={Colors.dark.gradients.primary as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cta}
          >
            <Text style={styles.ctaText} onPress={() => router.back()}>
              Done
            </Text>
          </LinearGradient>
        ) : (
          <TouchableOpacity style={[styles.cta, { backgroundColor: Colors.dark.primary }]} onPress={() => router.back()}>
            <Text style={styles.ctaText}>Done</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background, paddingTop: 50 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.dark.card, alignItems: "center", justifyContent: "center" },
  title: { color: Colors.dark.text, fontSize: 18, fontWeight: "700" },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  h: { color: Colors.dark.text, fontSize: 16, fontWeight: "800", marginTop: 16, marginBottom: 8 },
  p: { color: Colors.dark.subtext, fontSize: 14, lineHeight: 22, marginBottom: 6 },
  note: {
    marginTop: 16,
    color: Colors.dark.subtext,
    fontSize: 12,
    lineHeight: 18,
    backgroundColor: Colors.dark.card,
    borderColor: Colors.dark.divider,
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
  },
  cta: { marginTop: 16, borderRadius: 14, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  ctaText: { color: Colors.dark.text, fontSize: 16, fontWeight: "700" },
});
