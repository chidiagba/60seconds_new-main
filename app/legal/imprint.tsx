import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import Colors from "@/constants/colors";

export default function ImprintScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Imprint</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h}>Legal Owner</Text>
        <Text style={styles.p}>Company/Owner Name: 60Seconds Technologies</Text>
        <Text style={styles.p}> </Text>

        <Text style={styles.h}>Contact</Text>
        <Text style={styles.p}>Email: support@60secondsapp.io</Text>
        <Text style={styles.p}>Phone: +41798013544</Text>

        <Text style={styles.h}>Business Registration</Text>
        <Text style={styles.p}>Registration / VAT (if applicable): (Add details)</Text>

        <Text style={styles.note}>
          Apple reviewers commonly ask for “Imprint” or legal contact availability. Add your real legal details here.
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
  p: { color: Colors.dark.subtext, fontSize: 14, lineHeight: 22, marginBottom: 6 },
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
