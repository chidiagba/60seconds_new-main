import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import Colors from '@/constants/colors';
// Custom tab bar icon with indicator
export function TabBarIcon({
  focused,
  color,
  size,
  Icon,
}: {
  focused: boolean;
  color: string;
  size: number;
  Icon: LucideIcon;
}) {
  return (
    <View style={tabStyles.iconContainer}>
      <Icon size={size} color={color} />
      {focused && <View style={tabStyles.indicator} />}
    </View>
  );
}

export const tabStyles = StyleSheet.create({
  iconContainer: {
    alignItems: "center",
    justifyContent: "center",
    height: 48,
  },
  indicator: {
    position: "absolute",
    bottom: -8,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.primary,
  },
  uploadIconContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  uploadIconBackground: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});

export const sharedTabOptions: BottomTabNavigationOptions = {
            lazy: true,
            tabBarStyle: {
              backgroundColor: Colors.dark.background,
              borderTopColor: "transparent",
              height: 80,
              borderTopWidth: 0,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
              elevation: 8,
            },
            sceneStyle: {
              backgroundColor: Colors.dark.background,
            },
            tabBarHideOnKeyboard: true,
            tabBarActiveTintColor: Colors.dark.primary,
            tabBarInactiveTintColor: Colors.dark.inactive,
            headerStyle: {
              backgroundColor: Colors.dark.background,
              shadowColor: "transparent",
              elevation: 0,
              borderBottomWidth: 0,
            },
            headerTintColor: Colors.dark.text,
            headerTitleStyle: {
              fontWeight: "600",
              fontSize: 18,
            },
            headerShown: false,
            tabBarShowLabel: false,
            tabBarBackground: () =>
              Platform.OS !== "web" ? (
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(10, 10, 15, 0.8)", "rgba(10, 10, 15, 0.95)"]}
                  style={StyleSheet.absoluteFill}
                />
              ) : (
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: Colors.dark.background },
                  ]}
                />
              ),
};
