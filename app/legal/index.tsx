import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { FileText, Shield, Info, BadgeDollarSign, ArrowLeft } from "lucide-react-native";
import Colors from "@/constants/colors";

export default function LegalIndexScreen() {
  const router = useRouter();

  const Item = ({
    title,
    subtitle,
    icon,
    onPress,
  }: {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    onPress: () => void;
  }) => (
    <TouchableOpacity style={styles.item} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.iconBox}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemSubtitle}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Legal & Info</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.card}>
        <Item
          title="Terms & Conditions"
          subtitle="Rules and usage terms for the app"
          icon={<FileText size={22} color={Colors.dark.primary} />}
          onPress={() => router.push("/legal/terms")}
        />
        <Item
          title="Privacy Policy"
          subtitle="How we handle data and permissions"
          icon={<Shield size={22} color={Colors.dark.primary} />}
          onPress={() => router.push("/legal/privacy")}
        />
        <Item
          title="Imprint"
          subtitle="Company / owner legal information"
          icon={<Info size={22} color={Colors.dark.primary} />}
          onPress={() => router.push("/legal/imprint")}
        />
        <Item
          title="Pricing & Product"
          subtitle="Paid features, prices, and what users get"
          icon={<BadgeDollarSign size={22} color={Colors.dark.primary} />}
          onPress={() => router.push("/legal/pricing")}
        />
      </View>

      <View style={styles.footer}>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background, paddingTop: 50, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: Colors.dark.text, fontSize: 18, fontWeight: "700" },
  card: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    overflow: "hidden",
  },
  item: { flexDirection: "row", gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.dark.divider },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(99,102,241,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  itemTitle: { color: Colors.dark.text, fontSize: 16, fontWeight: "700", marginBottom: 4 },
  itemSubtitle: { color: Colors.dark.subtext, fontSize: 13, lineHeight: 18 },
  footer: { marginTop: 16 },
  cta: { borderRadius: 14, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  ctaText: { color: Colors.dark.text, fontSize: 16, fontWeight: "700" },
});
