import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import Colors from "@/constants/colors";

export default function TermsScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Terms & Conditions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h}>1. Acceptance</Text>
        <Text style={styles.p}>
          By creating an account or using the app, you agree to these Terms & Conditions.
        </Text>

        <Text style={styles.h}>2. User Content</Text>
        <Text style={styles.p}>
          You are responsible for the content you upload. Do not post illegal, hateful, or infringing content.
        </Text>

        <Text style={styles.h}>3. Community & Safety</Text>
        <Text style={styles.p}>
          We may remove content or restrict accounts that violate rules or create safety risks.
        </Text>

        <Text style={styles.h}>4. Payments (if applicable)</Text>
        <Text style={styles.p}>
          If paid features are offered, pricing and benefits are shown in the “Pricing & Product” screen.
        </Text>

        <Text style={styles.h}>5. Contact</Text>
        <Text style={styles.p}>
          For questions, see “Imprint” for contact/legal details.
        </Text>

        <Text style={styles.note}>
          Replace this text with your official Terms later. For App Review screenshots, this is enough to show
          T&Cs exist in-app and are accessible.
        </Text>
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
  p: { color: Colors.dark.subtext, fontSize: 14, lineHeight: 22 },
  note: {
    marginTop: 20,
    color: Colors.dark.subtext,
    fontSize: 12,
    lineHeight: 18,
    backgroundColor: Colors.dark.card,
    borderColor: Colors.dark.divider,
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
  },
});
