import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { ArrowLeft, ScanLine, X } from "lucide-react-native";
import Colors from "@/constants/colors";
import { CameraView, Camera } from "expo-camera";
import * as Linking from "expo-linking";

export default function ScanQRScreen() {
  const router = useRouter();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(true);

  const checkPermission = async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    setHasPermission(status === "granted");
  };

  // Run once on mount
  useEffect(() => {
    checkPermission();
  }, []);

  // Run again when screen comes back into focus
  useFocusEffect(
    React.useCallback(() => {
      checkPermission();
    }, [])
  );

  const handleBarCodeScanned = ({
    type,
    data,
  }: {
    type: string;
    data: string;
  }) => {
    setScanned(true);
    setScanning(false);

    try {
      const qrData = JSON.parse(data);

      if (!qrData.recipientId) {
        Alert.alert(
          "Invalid QR Code",
          "This QR code does not contain valid payment information."
        );
        return;
      }

      router.push({
        pathname: "/send-money",
        params: {
          recipientId: qrData.recipientId,
          amount: qrData.amount || "",
          note: qrData.note || "",
          fromQR: "true",
        },
      });
    } catch (error) {
      Alert.alert(
        "Invalid QR Code",
        "The scanned QR code is not in the correct format for payments.",
        [
          {
            text: "Try Again",
            onPress: () => {
              setScanned(false);
              setScanning(true);
            },
          },
        ]
      );
    }
  };

  const handleCancel = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/wallet');
  };

  const handleScanAgain = () => {
    setScanned(false);
    setScanning(true);
  };

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
        <Text style={styles.permissionText}>
          Requesting camera permission...
        </Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>
          Camera access is required to scan QR codes
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => Linking.openSettings()}
        >
          <Text style={styles.buttonText}>Open Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={handleCancel}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleCancel}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Scan to Pay</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Scanner */}
      <View style={styles.scannerContainer}>
        <CameraView
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ["qr", "pdf417"] }}
          style={styles.scanner}
        />

        <View style={styles.overlay}>
          <View style={styles.scanWindow}>
            <View style={styles.cornerTL} />
            <View style={styles.cornerTR} />
            <View style={styles.cornerBL} />
            <View style={styles.cornerBR} />
          </View>

          {scanning && (
            <View style={styles.scanLineContainer}>
              <ScanLine
                size={24}
                color={Colors.dark.primary}
                style={styles.scanLine}
              />
            </View>
          )}

          <Text style={styles.instructions}>
            Align the QR code within the frame to scan
          </Text>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        {scanned && (
          <TouchableOpacity
            style={styles.scanAgainButton}
            onPress={handleScanAgain}
          >
            <Text style={styles.scanAgainText}>Scan Again</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
          <X size={20} color={Colors.dark.text} />
          <Text style={styles.cancelText}>Cancel</Text>
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
    marginTop: 40,
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
  scannerContainer: {
    flex: 1,
    position: "relative",
  },
  scanner: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  scanWindow: {
    width: 250,
    height: 250,
    borderRadius: 12,
    backgroundColor: "transparent",
    position: "relative",
  },
  cornerTL: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 30,
    height: 30,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: Colors.dark.primary,
    borderTopLeftRadius: 12,
  },
  cornerTR: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 30,
    height: 30,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: Colors.dark.primary,
    borderTopRightRadius: 12,
  },
  cornerBL: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 30,
    height: 30,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: Colors.dark.primary,
    borderBottomLeftRadius: 12,
  },
  cornerBR: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: Colors.dark.primary,
    borderBottomRightRadius: 12,
  },
  scanLineContainer: {
    position: "absolute",
    alignItems: "center",
  },
  scanLine: {
    width: 230,
    height: 2,
  },
  instructions: {
    color: Colors.dark.text,
    fontSize: 16,
    textAlign: "center",
    position: "absolute",
    bottom: 100,
    left: 20,
    right: 20,
  },
  footer: {
    padding: 20,
    alignItems: "center",
  },
  scanAgainButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginBottom: 16,
  },
  scanAgainText: {
    color: Colors.dark.text,
    fontWeight: "bold",
    fontSize: 16,
  },
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  cancelText: {
    color: Colors.dark.text,
    marginLeft: 8,
    fontSize: 16,
  },
  permissionText: {
    color: Colors.dark.text,
    fontSize: 16,
    marginTop: 16,
    textAlign: "center",
  },
  button: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 16,
  },
  buttonText: {
    color: Colors.dark.text,
    fontWeight: "bold",
    fontSize: 16,
  },
});
