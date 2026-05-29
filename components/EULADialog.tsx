import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import Colors from "@/constants/colors";
import { LinearGradient } from "expo-linear-gradient";

const EULA_TEXT = `
END USER LICENSE AGREEMENT (EULA)

Last Updated: February 2025

1. ACCEPTANCE OF TERMS
By downloading, installing, or using the 60Seconds application ("App"), you agree to be bound by this End User License Agreement ("EULA"). If you do not agree to these terms, do not use the App.

2. LICENSE GRANT
Subject to your compliance with this EULA, we grant you a limited, non-exclusive, non-transferable, revocable license to access and use the App for your personal, non-commercial use.

3. USER CONTENT
You retain ownership of content you create and share. By posting content, you grant us a license to use, display, and distribute it in connection with the App. You are responsible for ensuring your content does not violate any laws or third-party rights.

4. PROHIBITED CONDUCT
You agree not to:
- Post illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable content
- Impersonate any person or entity
- Violate any applicable laws or regulations
- Interfere with or disrupt the App or servers
- Use the App for any commercial purpose without our consent

5. CONTENT MODERATION
We reserve the right to remove, hide, or restrict access to content that violates our policies. Users may report content and we will review reports in accordance with our moderation guidelines.

6. PRIVACY
Your use of the App is also governed by our Privacy Policy. By using the App, you consent to the collection and use of information as described in our Privacy Policy.

7. DISCLAIMER
The App is provided "as is" without warranties of any kind. We do not guarantee uninterrupted or error-free operation.

8. LIMITATION OF LIABILITY
To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages.

9. CHANGES
We may modify this EULA at any time. Continued use of the App after changes constitutes acceptance of the modified terms.

10. CONTACT
For questions about this EULA, please contact us through the App's support or legal section.
`;

interface EULADialogProps {
  visible: boolean;
  onAccept: () => void;
}

export default function EULADialog({ visible, onAccept }: EULADialogProps) {
  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.container}>
        <Text style={styles.title}>End User License Agreement</Text>
        <Text style={styles.subtitle}>
          Please read and accept the terms to continue
        </Text>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <Text style={styles.eulaText}>{EULA_TEXT.trim()}</Text>
        </ScrollView>

        <TouchableOpacity
          style={styles.acceptButton}
          onPress={onAccept}
          activeOpacity={0.9}
        >
          {Platform.OS !== "web" ? (
            <LinearGradient
              colors={Colors.dark.gradients.primary as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradientButton}
            >
              <Text style={styles.acceptButtonText}>I Accept</Text>
            </LinearGradient>
          ) : (
            <View
              style={[
                styles.gradientButton,
                { backgroundColor: Colors.dark.primary },
              ]}
            >
              <Text style={styles.acceptButtonText}>I Accept</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  container: {
    width: "100%",
    maxWidth: 400,
    maxHeight: "90%",
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 20,
    overflow: "hidden",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.dark.text,
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.subtext,
    textAlign: "center",
    marginBottom: 16,
  },
  scrollView: {
    maxHeight: 320,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
    borderRadius: 12,
    backgroundColor: Colors.dark.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  eulaText: {
    fontSize: 13,
    lineHeight: 22,
    color: Colors.dark.subtext,
  },
  acceptButton: {
    borderRadius: 12,
    overflow: "hidden",
    elevation: 4,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  gradientButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: "600",
  },
});
