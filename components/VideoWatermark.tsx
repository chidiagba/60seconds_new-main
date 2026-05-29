import React from "react";
import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";

interface VideoWatermarkProps {
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  opacity?: number;
  size?: { width: number; height: number };
  visible?: boolean;
}

export default function VideoWatermark({
  position = "bottom-right",
  opacity = 0.45,
  // Make the watermark icon circular by default
  size = { width: 36, height: 36 },
  visible = true,
}: VideoWatermarkProps) {
  if (!visible) {
    return null;
  }

  const getPositionStyle = () => {
    if (position === "center") {
      return {
        position: "absolute" as const,
        top: "50%",
        left: "50%",
        transform: [{ translateX: -size.width / 2 }, { translateY: -size.height / 2 }],
        zIndex: 10,
      };
    }

    const baseStyle = {
      position: "absolute" as const,
      zIndex: 10,
    };

    switch (position) {
      case "top-left":
        return { ...baseStyle, top: 20, left: 20 };
      case "top-right":
        return { ...baseStyle, top: 20, right: 20 };
      case "bottom-left":
        return { ...baseStyle, bottom: 20, left: 20 };
      case "bottom-right":
        return { ...baseStyle, bottom: 20, right: 20 };
      default:
        return { ...baseStyle, bottom: 20, right: 20 };
    }
  };

  // Ensure the watermark image is always rendered as a circle
  const circleSize = Math.min(size.width, size.height);
  const borderRadius = circleSize / 2;

  return (
    <View style={getPositionStyle()}>
      <Image
        source={require("../assets/images/second.png")}
        style={[
          styles.watermarkImage,
          {
            width: circleSize,
            height: circleSize,
            borderRadius,
          },
          { opacity },
        ]}
        contentFit="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  watermarkImage: {
    width: "100%",
    height: "100%",
  },
});
