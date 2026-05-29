import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Colors from "@/constants/colors";

export default function TestAuthScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Test Auth</Text>
      <Text style={styles.subtitle}>This screen is reserved for internal auth diagnostics.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.background,
    padding: 24,
  },
  title: {
    color: Colors.dark.text,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 10,
  },
  subtitle: {
    color: Colors.dark.subtext,
    fontSize: 14,
    textAlign: "center",
  },
});
