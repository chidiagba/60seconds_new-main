import React from "react";
import { Redirect, Tabs } from "expo-router";
import {
  Home,
  PlusSquare,
  User,
  Compass,
  Wallet,
  Search,
  MessageCircle,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import FloatingUploadIndicator from "@/components/FloatingUploadIndicator";
import { LinearGradient } from "expo-linear-gradient";
import { View, StyleSheet, Platform, ActivityIndicator, Text } from "react-native";
import { useAuth } from "@/lib/auth";
import { useMessageUnreadStore } from '@/store/message-unread-store';

import { TabBarIcon, tabStyles, sharedTabOptions } from '@/components/SharedTabs';

export default function TabLayout() {
  const { user: supabaseUser, profile, loading } = useAuth();
  const unreadCount = useMessageUnreadStore((state) => state.unreadCount);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={Colors.dark.primary} />
        <Text style={styles.loadingText}>Loading your business feed...</Text>
      </View>
    );
  }

  const isBusinessUser = (profile?.user_type || supabaseUser?.user_metadata?.user_type) === "business";
  if (!supabaseUser) {
    return <Redirect href="/signin" />;
  }

  if (!isBusinessUser) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <>
        <Tabs
          detachInactiveScreens={false}
          screenOptions={{ ...sharedTabOptions, lazy: false, freezeOnBlur: false, }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: "",
              href: "/(tabsbusiness)",
              headerTitle: "NightLife",
              tabBarIcon: ({ focused, color, size }) => (
                <TabBarIcon
                  focused={focused}
                  color={color}
                  size={size}
                  Icon={Home}
                />
              ),
            }}
          />

          <Tabs.Screen
            name="discover"
            options={{
              title: "",
              href: "/(tabsbusiness)/discover",
              headerTitle: "Discover",
              tabBarIcon: ({ focused, color, size }) => (
                <TabBarIcon
                  focused={focused}
                  color={color}
                  size={size}
                  Icon={Compass}
                />
              ),
            }}
          />

          <Tabs.Screen
            name="search"
            options={{
              title: "",
              href: "/(tabsbusiness)/search",
              headerTitle: "Search",
              tabBarIcon: ({ focused, color, size }) => (
                <TabBarIcon
                  focused={focused}
                  color={color}
                  size={size}
                  Icon={Search}
                />
              ),
            }}
          />

          <Tabs.Screen
            name="upload"
            options={{
              title: "",
              href: "/(tabsbusiness)/upload",
              headerTitle: "Upload",
              tabBarIcon: ({ size }) => (
                <View style={styles.uploadIconContainer}>
                  {Platform.OS !== "web" ? (
                    <LinearGradient
                      colors={Colors.dark.gradients.primary as [string, string]}
                      style={styles.uploadIconBackground}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <PlusSquare size={size} color={Colors.dark.text} />
                    </LinearGradient>
                  ) : (
                    <View
                      style={[
                        styles.uploadIconBackground,
                        { backgroundColor: Colors.dark.primary },
                      ]}
                    >
                      <PlusSquare size={size} color={Colors.dark.text} />
                    </View>
                  )}
                </View>
              ),
            }}
          />

          <Tabs.Screen
            name="messages"
            options={{
              title: "",
              href: "/(tabsbusiness)/messages",
              headerTitle: "Messages",
              tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
              tabBarBadgeStyle: {
                backgroundColor: '#EF4444',
                color: '#fff',
                fontSize: 11,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                marginTop: 2,
              },
              tabBarIcon: ({ focused, color, size }) => (
                <TabBarIcon
                  focused={focused}
                  color={color}
                  size={size}
                  Icon={MessageCircle}
                />
              ),
            }}
          />

          <Tabs.Screen
            name="wallet"
            options={{
              title: "",
              href: "/(tabsbusiness)/wallet",
              headerTitle: "Wallet",
              tabBarIcon: ({ focused, color, size }) => (
                <TabBarIcon
                  focused={focused}
                  color={color}
                  size={size}
                  Icon={Wallet}
                />
              ),
            }}
          />

          <Tabs.Screen
            name="profile"
            options={{
              title: "",
              href: "/(tabsbusiness)/profile",
              headerTitle: supabaseUser ? "Profile" : "Sign In",
              tabBarIcon: ({ focused, color, size }) => (
                <TabBarIcon
                  focused={focused}
                  color={color}
                  size={size}
                  Icon={User}
                />
              ),
            }}
          />
        </Tabs>
        <FloatingUploadIndicator />
      </>
  );
}

const styles = StyleSheet.create({
  ...tabStyles,
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: Colors.dark.subtext,
    fontSize: 13,
  },
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
