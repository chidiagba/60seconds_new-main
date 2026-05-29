import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import Colors from "@/constants/colors";

export default function PrivacyScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h}>Location (“Address request”)</Text>
        <Text style={styles.p}>
          If you allow location access, we use it to show nearby events and improve discovery. You can deny
          permission and still browse content (where available).
        </Text>

        <Text style={styles.h}>Camera / Microphone / Photos</Text>
        <Text style={styles.p}>
          These permissions are used only when you upload or record videos and media.
        </Text>

        <Text style={styles.h}>Account Data</Text>
        <Text style={styles.p}>
          Your account data is stored securely (e.g., email, username, profile). We do not sell personal data.
        </Text>

        <Text style={styles.h}>Contact</Text>
        <Text style={styles.p}>
          For legal contact, see “Imprint”.
        </Text>

        <Text style={styles.note}>
          Replace this with your official Privacy Policy later. For App Review screenshots, this screen
          proves your app has an accessible privacy explanation in-app.
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
