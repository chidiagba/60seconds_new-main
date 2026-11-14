import { logger } from '@/lib/logger';
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Share,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft, Copy, Share2 } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import Colors from "@/constants/colors";
import { useAuthStore } from "@/store/auth-store";
import QRCode from "react-native-qrcode-svg";
import { useWalletStore } from "@/store/wallet-store";
import { formatCurrency, getCurrencySymbol } from "@/constants/currencies";

export default function ReceiveMoneyScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const selectedCurrency = useWalletStore((state) => state.selectedCurrency);

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [qrValue, setQrValue] = useState<string | null>(null);
  const currencySymbol = getCurrencySymbol(selectedCurrency);
  const formattedAmount = amount ? formatCurrency(parseFloat(amount), selectedCurrency) : formatCurrency(0, selectedCurrency);

  const qrRef = useRef(null);

  // Generate QR code data
  React.useEffect(() => {
    if (!user) {
      setQrValue(null);
      return;
    }

    const qrData = {
      recipientId: user.id,
      amount: amount ? parseFloat(amount) : undefined,
      note: note || undefined,
    };

    setQrValue(JSON.stringify(qrData));
  }, [user, amount, note]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/wallet');
  };

  const handleAmountChange = (text: string) => {
    const regex = /^\d*\.?\d{0,2}$/;
    if (regex.test(text)) {
      setAmount(text);
    }
  };

  const handleCopyUsername = async () => {
    if (!user) return;

    await Clipboard.setStringAsync(`@${user.username}`);
    alert("Username copied to clipboard");
  };

  const handleShare = async () => {
    try {
      const message = `Send me money on EventApp!\n\n${
        amount ? `Amount: ${formattedAmount}\n` : ""
      }${note ? `Note: ${note}\n` : ""}`;

      await Share.share({
        message,
        title: "Request Money",
      });
    } catch (error) {
      logger.error("Error sharing:", error);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Receive Money</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      <ScrollView style={styles.content}>
        <View style={styles.qrContainer}>
          <View style={styles.qrCode}>
            {qrValue ? (
              <QRCode
                value={qrValue}
                size={200}
                color={Colors.dark.text}
                backgroundColor={Colors.dark.card}
                logoBackgroundColor={Colors.dark.card}
                ref={qrRef}
              />
            ) : (
              <Text style={{ color: Colors.dark.subtext }}>
                QR code not available
              </Text>
            )}
          </View>

          <Text style={styles.scanInstructions}>
            Have the sender scan this QR code to send you money
          </Text>
        </View>

        {/* Username */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Username</Text>
          <View style={styles.usernameContainer}>
            <Text style={styles.username}>@{user?.username || "username"}</Text>
            <TouchableOpacity
              style={styles.copyButton}
              onPress={handleCopyUsername}
            >
              <Copy size={20} color={Colors.dark.primary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.usernameHelp}>
            Share your username with others so they can find and pay you
          </Text>
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Request Amount (Optional)</Text>
          <View style={styles.amountInputContainer}>
            <Text style={styles.currencySymbol}>{currencySymbol}</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor={Colors.dark.subtext}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={handleAmountChange}
            />
          </View>

          <View style={styles.quickAmounts}>
            {[5, 10, 20, 50].map((quickAmount) => (
              <TouchableOpacity
                key={quickAmount}
                style={styles.quickAmountButton}
                onPress={() => setAmount(quickAmount.toString())}
              >
                <Text style={styles.quickAmountText}>{currencySymbol}{quickAmount}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Note */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Add a Note (Optional)</Text>
          <TextInput
            style={styles.noteInput}
            placeholder="What's this for?"
            placeholderTextColor={Colors.dark.subtext}
            value={note}
            onChangeText={setNote}
            multiline
          />
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
          <Share2 size={20} color={Colors.dark.text} />
          <Text style={styles.shareButtonText}>Share Payment Request</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
    marginTop:40
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  qrContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  qrCode: {
    padding: 16,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    marginBottom: 16,
  },
  scanInstructions: {
    fontSize: 14,
    color: Colors.dark.subtext,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.dark.text,
    marginBottom: 12,
  },
  usernameContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  username: {
    flex: 1,
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
  },
  copyButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(138, 43, 226, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  usernameHelp: {
    fontSize: 14,
    color: Colors.dark.subtext,
    marginTop: 8,
  },
  amountInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  currencySymbol: {
    fontSize: 24,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    color: Colors.dark.text,
  },
  quickAmounts: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  quickAmountButton: {
    backgroundColor: Colors.dark.card,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  quickAmountText: {
    color: Colors.dark.text,
    fontWeight: "500",
  },
  noteInput: {
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    color: Colors.dark.text,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: "top",
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    marginBottom:10
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    padding: 16,
  },
  shareButtonText: {
    color: Colors.dark.text,
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 8,
  },
});
