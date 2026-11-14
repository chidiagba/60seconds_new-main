import React from "react";
import { Redirect, Tabs } from "expo-router";
import {
  Home,
  PlusSquare,
  User,
  Compass,
  Search,
  MessageCircle,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import FloatingUploadIndicator from "@/components/FloatingUploadIndicator";
import { LinearGradient } from "expo-linear-gradient";
import { View, StyleSheet, Platform } from "react-native";
import { useAuth } from "@/lib/auth";
import { useMessageUnreadStore } from '@/store/message-unread-store';

import { TabBarIcon, tabStyles, sharedTabOptions } from '@/components/SharedTabs';

export default function TabLayout() {
  const { user: supabaseUser, profile } = useAuth();
  const unreadCount = useMessageUnreadStore((state) => state.unreadCount);
  const isSignedIn = Boolean(supabaseUser);

  const isBusinessUser = (profile?.user_type || supabaseUser?.user_metadata?.user_type) === "business";
  if (supabaseUser && isBusinessUser) {
    return <Redirect href="/(tabsbusiness)" />;
  }

  return (
    <>
        <Tabs
          screenOptions={{ ...sharedTabOptions,  }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: "NightLife",
              href: "/(tabs)",
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
              title: "Discover",
              href: isSignedIn ? "/(tabs)/discover" : "/signin",
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
              title: "Search",
              href: isSignedIn ? "/(tabs)/search" : "/signin",
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
              title: "Upload",
              href: isSignedIn ? "/(tabs)/upload" : "/signin",
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
              title: "Messages",
              href: isSignedIn ? "/(tabs)/messages" : "/signin",
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
            name="profile"
            options={{
              title: supabaseUser ? "Profile" : "Sign In",
              href: isSignedIn ? "/(tabs)/profile" : "/signin",
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

          <Tabs.Screen
            name="wallet"
            options={{
              href: null,
            }}
          />
        </Tabs>
        <FloatingUploadIndicator />
      </>
  );
}

const styles = tabStyles;
