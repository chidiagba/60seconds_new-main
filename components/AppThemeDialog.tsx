import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Info, X } from "lucide-react-native";
import Colors from "@/constants/colors";

type AppThemeDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  primaryLabel?: string;
  onPrimaryPress: () => void;
  onClose: () => void;
};

export default function AppThemeDialog({
  visible,
  title,
  message,
  primaryLabel = "Got it",
  onPrimaryPress,
  onClose,
}: AppThemeDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <X size={18} color={Colors.dark.text} />
          </TouchableOpacity>

          <View style={styles.iconWrap}>
            <Info size={18} color={Colors.dark.primary} />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <TouchableOpacity style={styles.primaryButton} onPress={onPrimaryPress}>
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: Colors.dark.card,
    padding: 20,
  },
  closeButton: {
    alignSelf: "flex-end",
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(99, 102, 241, 0.2)",
    marginBottom: 10,
  },
  title: {
    color: Colors.dark.text,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8,
  },
  message: {
    color: Colors.dark.subtext,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: Colors.dark.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: Colors.dark.text,
    fontWeight: "700",
    fontSize: 15,
  },
});
