import React from "react";
import { TouchableOpacity, Text, StyleSheet, View } from "react-native";
import { ShoppingCart } from "lucide-react-native";
import Colors from "@/constants/colors";
import { useProductStore } from "@/store/product-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface CartButtonProps {
  onPress: () => void;
  variant?: "floating" | "stacked";
}

export default function CartButton({ onPress, variant = "floating" }: CartButtonProps) {
  const itemCount = useProductStore((state) =>
    state.cart.reduce((count, item) => count + item.quantity, 0)
  );
  const insets = useSafeAreaInsets();


  return (
    <TouchableOpacity
      style={[
        styles.container,
        variant === "floating"
          ? { bottom: insets.bottom + 92 }
          : styles.stackedContainer,
      ]}
      onPress={onPress}
    >
      <ShoppingCart size={24} color="#FFFFFF" />
      {itemCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{itemCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.dark.primary,
    justifyContent: "center",
    alignItems: "center",
    position: "absolute",
    right: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 9999,
  },
  stackedContainer: {
    position: "relative",
    right: 0,
  },
  badge: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: Colors.dark.accent,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: "bold",
  },
});
