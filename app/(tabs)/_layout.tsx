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

// Custom tab bar icon with indicator
function TabBarIcon({
  focused,
  color,
  size,
  Icon,
}: {
  focused: boolean;
  color: string;
  size: number;
  Icon: any;
}) {
  return (
    <View style={styles.iconContainer}>
      <Icon size={size} color={color} />
      {focused && <View style={styles.indicator} />}
    </View>
  );
}

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
          screenOptions={{
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
          }}
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

const styles = StyleSheet.create({
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




















// import React, { useEffect } from "react";
// import { Tabs, useRouter, useSegments } from "expo-router";
// import {
//   Home,
//   PlusSquare,
//   User,
//   Compass,
//   Wallet,
//   Search,
//   MessageCircle,
// } from "lucide-react-native";
// import { StripeProvider } from "@stripe/stripe-react-native";
// import Colors from "@/constants/colors";
// import { LinearGradient } from "expo-linear-gradient";
// import { View, StyleSheet, Platform } from "react-native";
// import { useAuth } from "@/lib/auth";
// import { useAuthStore } from "@/store/auth-store";

// // Custom tab bar icon with indicator
// function TabBarIcon({
//   focused,
//   color,
//   size,
//   Icon,
// }: {
//   focused: boolean;
//   color: string;
//   size: number;
//   Icon: any;
// }) {
//   return (
//     <View style={styles.iconContainer}>
//       <Icon size={size} color={color} />
//       {focused && <View style={styles.indicator} />}
//     </View>
//   );
// }

// function AuthGuard({ children }: { children: React.ReactNode }) {
//   const { user: supabaseUser, loading } = useAuth();
//   const { isAuthenticated } = useAuthStore();
//   const router = useRouter();
//   const segments = useSegments();

//   useEffect(() => {
//     if (loading) return;

//     const inTabsGroup = segments[0] === "(tabs)";

//     if (!supabaseUser && !isAuthenticated && inTabsGroup) {
//       router.replace("/signin");
//     }
//   }, [supabaseUser, isAuthenticated, loading, segments, router]);

//   if (loading) return null;

//   return <>{children}</>;
// }

// export default function TabLayout() {
//   return (
//     <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}>
//       <AuthGuard>
//         <Tabs
//           screenOptions={{
//             tabBarStyle: {
//               backgroundColor: Colors.dark.background,
//               borderTopColor: "transparent",
//               position: "absolute",
//               bottom: 0,
//               left: 0,
//               right: 0,
//               elevation: 0,
//               height: 80,
//               borderTopWidth: 0,
//               shadowColor: "#000",
//               shadowOffset: { width: 0, height: -4 },
//               shadowOpacity: 0.1,
//               shadowRadius: 4,
//             },
//             tabBarActiveTintColor: Colors.dark.primary,
//             tabBarInactiveTintColor: Colors.dark.inactive,
//             headerStyle: {
//               backgroundColor: Colors.dark.background,
//               shadowColor: "transparent",
//               elevation: 0,
//               borderBottomWidth: 0,
//             },
//             headerTintColor: Colors.dark.text,
//             headerTitleStyle: {
//               fontWeight: "600",
//               fontSize: 18,
//             },
//             headerShown: false,
//             tabBarShowLabel: false,
//             tabBarBackground: () =>
//               Platform.OS !== "web" ? (
//                 <LinearGradient
//                   colors={["rgba(10, 10, 15, 0.8)", "rgba(10, 10, 15, 0.95)"]}
//                   style={StyleSheet.absoluteFill}
//                 />
//               ) : (
//                 <View
//                   style={[
//                     StyleSheet.absoluteFill,
//                     { backgroundColor: Colors.dark.background },
//                   ]}
//                 />
//               ),
//           }}
//         >
//           <Tabs.Screen
//             name="index"
//             options={{
//               title: "NightLife",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Home}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="discover"
//             options={{
//               title: "Discover",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Compass}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="search"
//             options={{
//               title: "Search",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Search}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="upload"
//             options={{
//               title: "Upload",
//               tabBarIcon: ({ size }) => (
//                 <View style={styles.uploadIconContainer}>
//                   {Platform.OS !== "web" ? (
//                     <LinearGradient
//                       colors={Colors.dark.gradients.primary as [string, string]}
//                       style={styles.uploadIconBackground}
//                       start={{ x: 0, y: 0 }}
//                       end={{ x: 1, y: 1 }}
//                     >
//                       <PlusSquare size={size} color={Colors.dark.text} />
//                     </LinearGradient>
//                   ) : (
//                     <View
//                       style={[
//                         styles.uploadIconBackground,
//                         { backgroundColor: Colors.dark.primary },
//                       ]}
//                     >
//                       <PlusSquare size={size} color={Colors.dark.text} />
//                     </View>
//                   )}
//                 </View>
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="messages"
//             options={{
//               title: "Messages",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={MessageCircle}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="wallet"
//             options={{
//               title: "Wallet",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Wallet}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="profile"
//             options={{
//               title: "Profile",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={User}
//                 />
//               ),
//             }}
//           />
//         </Tabs>
//       </AuthGuard>
//     </StripeProvider>
//   );
// }

// const styles = StyleSheet.create({
//   iconContainer: {
//     alignItems: "center",
//     justifyContent: "center",
//     height: 48,
//   },
//   indicator: {
//     position: "absolute",
//     bottom: -8,
//     width: 4,
//     height: 4,
//     borderRadius: 2,
//     backgroundColor: Colors.dark.primary,
//   },
//   uploadIconContainer: {
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   uploadIconBackground: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     alignItems: "center",
//     justifyContent: "center",
//   },
// });


















// import React, { useEffect } from "react";
// import { Tabs, useRouter, useSegments } from "expo-router";
// import {
//   Home,
//   PlusSquare,
//   User,
//   Compass,
//   Wallet,
//   Search,
//   MessageCircle,
// } from "lucide-react-native";
// import { StripeProvider } from "@stripe/stripe-react-native";
// import Colors from "@/constants/colors";
// import { LinearGradient } from "expo-linear-gradient";
// import { View, StyleSheet, Platform } from "react-native";
// import { useAuth } from "@/lib/auth";
// import { useAuthStore } from "@/store/auth-store";

// // Custom tab bar icon with indicator
// function TabBarIcon({
//   focused,
//   color,
//   size,
//   Icon,
// }: {
//   focused: boolean;
//   color: string;
//   size: number;
//   Icon: any;
// }) {
//   return (
//     <View style={styles.iconContainer}>
//       <Icon size={size} color={color} />
//       {focused && <View style={styles.indicator} />}
//     </View>
//   );
// }

// function AuthGuard({ children }: { children: React.ReactNode }) {
//   const { user: supabaseUser, loading } = useAuth();
//   const { isAuthenticated } = useAuthStore();
//   const router = useRouter();
//   const segments = useSegments();

//   useEffect(() => {
//     if (loading) return;

//     const inTabsGroup = segments[0] === "(tabs)";

//     if (!supabaseUser && !isAuthenticated && inTabsGroup) {
//       router.replace("/signin");
//     }
//   }, [supabaseUser, isAuthenticated, loading, segments, router]);

//   if (loading) return null;

//   return <>{children}</>;
// }

// export default function TabLayout() {
//   return (
//     <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}>
//       <AuthGuard>
//         <Tabs
//           screenOptions={{
//             tabBarStyle: {
//               backgroundColor: Colors.dark.background,
//               borderTopColor: "transparent",
//               position: "absolute",
//               bottom: 0,
//               left: 0,
//               right: 0,
//               elevation: 0,
//               height: 80,
//               borderTopWidth: 0,
//               shadowColor: "#000",
//               shadowOffset: { width: 0, height: -4 },
//               shadowOpacity: 0.1,
//               shadowRadius: 4,
//             },
//             tabBarActiveTintColor: Colors.dark.primary,
//             tabBarInactiveTintColor: Colors.dark.inactive,
//             headerStyle: {
//               backgroundColor: Colors.dark.background,
//               shadowColor: "transparent",
//               elevation: 0,
//               borderBottomWidth: 0,
//             },
//             headerTintColor: Colors.dark.text,
//             headerTitleStyle: {
//               fontWeight: "600",
//               fontSize: 18,
//             },
//             headerShown: false,
//             tabBarShowLabel: false,
//             tabBarBackground: () =>
//               Platform.OS !== "web" ? (
//                 <LinearGradient
//                   colors={["rgba(10, 10, 15, 0.8)", "rgba(10, 10, 15, 0.95)"]}
//                   style={StyleSheet.absoluteFill}
//                 />
//               ) : (
//                 <View
//                   style={[
//                     StyleSheet.absoluteFill,
//                     { backgroundColor: Colors.dark.background },
//                   ]}
//                 />
//               ),
//           }}
//         >
//           <Tabs.Screen
//             name="index"
//             options={{
//               title: "NightLife",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Home}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="discover"
//             options={{
//               title: "Discover",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Compass}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="search"
//             options={{
//               title: "Search",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Search}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="upload"
//             options={{
//               title: "Upload",
//               tabBarIcon: ({ size }) => (
//                 <View style={styles.uploadIconContainer}>
//                   {Platform.OS !== "web" ? (
//                     <LinearGradient
//                       colors={Colors.dark.gradients.primary as [string, string]}
//                       style={styles.uploadIconBackground}
//                       start={{ x: 0, y: 0 }}
//                       end={{ x: 1, y: 1 }}
//                     >
//                       <PlusSquare size={size} color={Colors.dark.text} />
//                     </LinearGradient>
//                   ) : (
//                     <View
//                       style={[
//                         styles.uploadIconBackground,
//                         { backgroundColor: Colors.dark.primary },
//                       ]}
//                     >
//                       <PlusSquare size={size} color={Colors.dark.text} />
//                     </View>
//                   )}
//                 </View>
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="messages"
//             options={{
//               title: "Messages",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={MessageCircle}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="wallet"
//             options={{
//               title: "Wallet",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Wallet}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="profile"
//             options={{
//               title: "Profile",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={User}
//                 />
//               ),
//             }}
//           />
//         </Tabs>
//       </AuthGuard>
//     </StripeProvider>
//   );
// }

// const styles = StyleSheet.create({
//   iconContainer: {
//     alignItems: "center",
//     justifyContent: "center",
//     height: 48,
//   },
//   indicator: {
//     position: "absolute",
//     bottom: -8,
//     width: 4,
//     height: 4,
//     borderRadius: 2,
//     backgroundColor: Colors.dark.primary,
//   },
//   uploadIconContainer: {
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   uploadIconBackground: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     alignItems: "center",
//     justifyContent: "center",
//   },
// });

















// import React, { useEffect } from "react";
// import { Tabs, useRouter, useSegments } from "expo-router";
// import {
//   Home,
//   PlusSquare,
//   User,
//   Compass,
//   Wallet,
//   Search,
//   MessageCircle,
// } from "lucide-react-native";
// import { StripeProvider } from "@stripe/stripe-react-native";
// import Colors from "@/constants/colors";
// import { LinearGradient } from "expo-linear-gradient";
// import { View, StyleSheet, Platform } from "react-native";
// import { useAuth } from "@/lib/auth";
// import { useAuthStore } from "@/store/auth-store";

// // Custom tab bar icon with indicator
// function TabBarIcon({
//   focused,
//   color,
//   size,
//   Icon,
// }: {
//   focused: boolean;
//   color: string;
//   size: number;
//   Icon: any;
// }) {
//   return (
//     <View style={styles.iconContainer}>
//       <Icon size={size} color={color} />
//       {focused && <View style={styles.indicator} />}
//     </View>
//   );
// }

// function AuthGuard({ children }: { children: React.ReactNode }) {
//   const { user: supabaseUser, loading } = useAuth();
//   const { isAuthenticated } = useAuthStore();
//   const router = useRouter();
//   const segments = useSegments();

//   useEffect(() => {
//     if (loading) return;

//     const inTabsGroup = segments[0] === "(tabs)";

//     if (!supabaseUser && !isAuthenticated && inTabsGroup) {
//       router.replace("/signin");
//     }
//   }, [supabaseUser, isAuthenticated, loading, segments, router]);

//   if (loading) return null;

//   return <>{children}</>;
// }

// export default function TabLayout() {
//   return (
//     <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}>
//       <AuthGuard>
//         <Tabs
//           screenOptions={{
//             tabBarStyle: {
//               backgroundColor: Colors.dark.background,
//               borderTopColor: "transparent",
//               position: "absolute",
//               bottom: 0,
//               left: 0,
//               right: 0,
//               elevation: 0,
//               height: 80,
//               borderTopWidth: 0,
//               shadowColor: "#000",
//               shadowOffset: { width: 0, height: -4 },
//               shadowOpacity: 0.1,
//               shadowRadius: 4,
//             },
//             tabBarActiveTintColor: Colors.dark.primary,
//             tabBarInactiveTintColor: Colors.dark.inactive,
//             headerStyle: {
//               backgroundColor: Colors.dark.background,
//               shadowColor: "transparent",
//               elevation: 0,
//               borderBottomWidth: 0,
//             },
//             headerTintColor: Colors.dark.text,
//             headerTitleStyle: {
//               fontWeight: "600",
//               fontSize: 18,
//             },
//             headerShown: false,
//             tabBarShowLabel: false,
//             tabBarBackground: () =>
//               Platform.OS !== "web" ? (
//                 <LinearGradient
//                   colors={["rgba(10, 10, 15, 0.8)", "rgba(10, 10, 15, 0.95)"]}
//                   style={StyleSheet.absoluteFill}
//                 />
//               ) : (
//                 <View
//                   style={[
//                     StyleSheet.absoluteFill,
//                     { backgroundColor: Colors.dark.background },
//                   ]}
//                 />
//               ),
//           }}
//         >
//           <Tabs.Screen
//             name="index"
//             options={{
//               title: "NightLife",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Home}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="discover"
//             options={{
//               title: "Discover",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Compass}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="search"
//             options={{
//               title: "Search",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Search}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="upload"
//             options={{
//               title: "Upload",
//               tabBarIcon: ({ size }) => (
//                 <View style={styles.uploadIconContainer}>
//                   {Platform.OS !== "web" ? (
//                     <LinearGradient
//                       colors={Colors.dark.gradients.primary as [string, string]}
//                       style={styles.uploadIconBackground}
//                       start={{ x: 0, y: 0 }}
//                       end={{ x: 1, y: 1 }}
//                     >
//                       <PlusSquare size={size} color={Colors.dark.text} />
//                     </LinearGradient>
//                   ) : (
//                     <View
//                       style={[
//                         styles.uploadIconBackground,
//                         { backgroundColor: Colors.dark.primary },
//                       ]}
//                     >
//                       <PlusSquare size={size} color={Colors.dark.text} />
//                     </View>
//                   )}
//                 </View>
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="messages"
//             options={{
//               title: "Messages",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={MessageCircle}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="wallet"
//             options={{
//               title: "Wallet",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Wallet}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="profile"
//             options={{
//               title: "Profile",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={User}
//                 />
//               ),
//             }}
//           />
//         </Tabs>
//       </AuthGuard>
//     </StripeProvider>
//   );
// }

// const styles = StyleSheet.create({
//   iconContainer: {
//     alignItems: "center",
//     justifyContent: "center",
//     height: 48,
//   },
//   indicator: {
//     position: "absolute",
//     bottom: -8,
//     width: 4,
//     height: 4,
//     borderRadius: 2,
//     backgroundColor: Colors.dark.primary,
//   },
//   uploadIconContainer: {
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   uploadIconBackground: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     alignItems: "center",
//     justifyContent: "center",
//   },
// });





















// import React, { useEffect } from "react";
// import { Tabs, useRouter, useSegments } from "expo-router";
// import {
//   Home,
//   PlusSquare,
//   User,
//   Compass,
//   Wallet,
//   Search,
//   MessageCircle,
// } from "lucide-react-native";
// import { StripeProvider } from "@stripe/stripe-react-native";
// import Colors from "@/constants/colors";
// import { LinearGradient } from "expo-linear-gradient";
// import { View, StyleSheet, Platform } from "react-native";
// import { useAuth } from "@/lib/auth";
// import { useAuthStore } from "@/store/auth-store";

// // Custom tab bar icon with indicator
// function TabBarIcon({
//   focused,
//   color,
//   size,
//   Icon,
// }: {
//   focused: boolean;
//   color: string;
//   size: number;
//   Icon: any;
// }) {
//   return (
//     <View style={styles.iconContainer}>
//       <Icon size={size} color={color} />
//       {focused && <View style={styles.indicator} />}
//     </View>
//   );
// }

// function AuthGuard({ children }: { children: React.ReactNode }) {
//   const { user: supabaseUser, loading } = useAuth();
//   const { isAuthenticated } = useAuthStore();
//   const router = useRouter();
//   const segments = useSegments();

//   useEffect(() => {
//     if (loading) return;

//     const inTabsGroup = segments[0] === "(tabs)";

//     if (!supabaseUser && !isAuthenticated && inTabsGroup) {
//       router.replace("/signin");
//     }
//   }, [supabaseUser, isAuthenticated, loading, segments, router]);

//   if (loading) return null;

//   return <>{children}</>;
// }

// export default function TabLayout() {
//   return (
//     <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}>
//       <AuthGuard>
//         <Tabs
//           screenOptions={{
//             tabBarStyle: {
//               backgroundColor: Colors.dark.background,
//               borderTopColor: "transparent",
//               position: "absolute",
//               bottom: 0,
//               left: 0,
//               right: 0,
//               elevation: 0,
//               height: 80,
//               borderTopWidth: 0,
//               shadowColor: "#000",
//               shadowOffset: { width: 0, height: -4 },
//               shadowOpacity: 0.1,
//               shadowRadius: 4,
//             },
//             tabBarActiveTintColor: Colors.dark.primary,
//             tabBarInactiveTintColor: Colors.dark.inactive,
//             headerStyle: {
//               backgroundColor: Colors.dark.background,
//               shadowColor: "transparent",
//               elevation: 0,
//               borderBottomWidth: 0,
//             },
//             headerTintColor: Colors.dark.text,
//             headerTitleStyle: {
//               fontWeight: "600",
//               fontSize: 18,
//             },
//             headerShown: false,
//             tabBarShowLabel: false,
//             tabBarBackground: () =>
//               Platform.OS !== "web" ? (
//                 <LinearGradient
//                   colors={["rgba(10, 10, 15, 0.8)", "rgba(10, 10, 15, 0.95)"]}
//                   style={StyleSheet.absoluteFill}
//                 />
//               ) : (
//                 <View
//                   style={[
//                     StyleSheet.absoluteFill,
//                     { backgroundColor: Colors.dark.background },
//                   ]}
//                 />
//               ),
//           }}
//         >
//           <Tabs.Screen
//             name="index"
//             options={{
//               title: "NightLife",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Home}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="discover"
//             options={{
//               title: "Discover",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Compass}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="search"
//             options={{
//               title: "Search",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Search}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="upload"
//             options={{
//               title: "Upload",
//               tabBarIcon: ({ size }) => (
//                 <View style={styles.uploadIconContainer}>
//                   {Platform.OS !== "web" ? (
//                     <LinearGradient
//                       colors={Colors.dark.gradients.primary as [string, string]}
//                       style={styles.uploadIconBackground}
//                       start={{ x: 0, y: 0 }}
//                       end={{ x: 1, y: 1 }}
//                     >
//                       <PlusSquare size={size} color={Colors.dark.text} />
//                     </LinearGradient>
//                   ) : (
//                     <View
//                       style={[
//                         styles.uploadIconBackground,
//                         { backgroundColor: Colors.dark.primary },
//                       ]}
//                     >
//                       <PlusSquare size={size} color={Colors.dark.text} />
//                     </View>
//                   )}
//                 </View>
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="messages"
//             options={{
//               title: "Messages",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={MessageCircle}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="wallet"
//             options={{
//               title: "Wallet",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Wallet}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="profile"
//             options={{
//               title: "Profile",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={User}
//                 />
//               ),
//             }}
//           />
//         </Tabs>
//       </AuthGuard>
//     </StripeProvider>
//   );
// }

// const styles = StyleSheet.create({
//   iconContainer: {
//     alignItems: "center",
//     justifyContent: "center",
//     height: 48,
//   },
//   indicator: {
//     position: "absolute",
//     bottom: -8,
//     width: 4,
//     height: 4,
//     borderRadius: 2,
//     backgroundColor: Colors.dark.primary,
//   },
//   uploadIconContainer: {
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   uploadIconBackground: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     alignItems: "center",
//     justifyContent: "center",
//   },
// });
















/////////////////////////////////////////////////////////////      before    29   jan     2026

// import React, { useEffect } from "react";
// import { Tabs, useRouter, useSegments } from "expo-router";
// import {
//   Home,
//   PlusSquare,
//   User,
//   Compass,
//   Wallet,
//   Search,
//   MessageCircle,
// } from "lucide-react-native";
// import { StripeProvider } from "@stripe/stripe-react-native";
// import Colors from "@/constants/colors";
// import { LinearGradient } from "expo-linear-gradient";
// import { View, StyleSheet, Platform } from "react-native";
// import { useAuth } from "@/lib/auth";
// import { useAuthStore } from "@/store/auth-store";

// // Custom tab bar icon with indicator
// function TabBarIcon({
//   focused,
//   color,
//   size,
//   Icon,
// }: {
//   focused: boolean;
//   color: string;
//   size: number;
//   Icon: any;
// }) {
//   return (
//     <View style={styles.iconContainer}>
//       <Icon size={size} color={color} />
//       {focused && <View style={styles.indicator} />}
//     </View>
//   );
// }

// function AuthGuard({ children }: { children: React.ReactNode }) {
//   const { user: supabaseUser, loading } = useAuth();
//   const { isAuthenticated } = useAuthStore();
//   const router = useRouter();
//   const segments = useSegments();

//   useEffect(() => {
//     if (loading) return;

//     const inTabsGroup = segments[0] === "(tabs)";

//     if (!supabaseUser && !isAuthenticated && inTabsGroup) {
//       router.replace("/signin");
//     }
//   }, [supabaseUser, isAuthenticated, loading, segments, router]);

//   if (loading) return null;

//   return <>{children}</>;
// }

// export default function TabLayout() {
//   return (
//     <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}>
//       <AuthGuard>
//         <Tabs
//           screenOptions={{
//             tabBarStyle: {
//               backgroundColor: Colors.dark.background,
//               borderTopColor: "transparent",
//               position: "absolute",
//               bottom: 0,
//               left: 0,
//               right: 0,
//               elevation: 0,
//               height: 80,
//               borderTopWidth: 0,
//               shadowColor: "#000",
//               shadowOffset: { width: 0, height: -4 },
//               shadowOpacity: 0.1,
//               shadowRadius: 4,
//             },
//             tabBarActiveTintColor: Colors.dark.primary,
//             tabBarInactiveTintColor: Colors.dark.inactive,
//             headerStyle: {
//               backgroundColor: Colors.dark.background,
//               shadowColor: "transparent",
//               elevation: 0,
//               borderBottomWidth: 0,
//             },
//             headerTintColor: Colors.dark.text,
//             headerTitleStyle: {
//               fontWeight: "600",
//               fontSize: 18,
//             },
//             headerShown: false,
//             tabBarShowLabel: false,
//             tabBarBackground: () =>
//               Platform.OS !== "web" ? (
//                 <LinearGradient
//                   colors={["rgba(10, 10, 15, 0.8)", "rgba(10, 10, 15, 0.95)"]}
//                   style={StyleSheet.absoluteFill}
//                 />
//               ) : (
//                 <View
//                   style={[
//                     StyleSheet.absoluteFill,
//                     { backgroundColor: Colors.dark.background },
//                   ]}
//                 />
//               ),
//           }}
//         >
//           <Tabs.Screen
//             name="index"
//             options={{
//               title: "NightLife",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Home}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="discover"
//             options={{
//               title: "Discover",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Compass}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="search"
//             options={{
//               title: "Search",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Search}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="upload"
//             options={{
//               title: "Upload",
//               tabBarIcon: ({ size }) => (
//                 <View style={styles.uploadIconContainer}>
//                   {Platform.OS !== "web" ? (
//                     <LinearGradient
//                       colors={Colors.dark.gradients.primary as [string, string]}
//                       style={styles.uploadIconBackground}
//                       start={{ x: 0, y: 0 }}
//                       end={{ x: 1, y: 1 }}
//                     >
//                       <PlusSquare size={size} color={Colors.dark.text} />
//                     </LinearGradient>
//                   ) : (
//                     <View
//                       style={[
//                         styles.uploadIconBackground,
//                         { backgroundColor: Colors.dark.primary },
//                       ]}
//                     >
//                       <PlusSquare size={size} color={Colors.dark.text} />
//                     </View>
//                   )}
//                 </View>
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="messages"
//             options={{
//               title: "Messages",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={MessageCircle}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="wallet"
//             options={{
//               title: "Wallet",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={Wallet}
//                 />
//               ),
//             }}
//           />

//           <Tabs.Screen
//             name="profile"
//             options={{
//               title: "Profile",
//               tabBarIcon: ({ focused, color, size }) => (
//                 <TabBarIcon
//                   focused={focused}
//                   color={color}
//                   size={size}
//                   Icon={User}
//                 />
//               ),
//             }}
//           />
//         </Tabs>
//       </AuthGuard>
//     </StripeProvider>
//   );
// }

// const styles = StyleSheet.create({
//   iconContainer: {
//     alignItems: "center",
//     justifyContent: "center",
//     height: 48,
//   },
//   indicator: {
//     position: "absolute",
//     bottom: -8,
//     width: 4,
//     height: 4,
//     borderRadius: 2,
//     backgroundColor: Colors.dark.primary,
//   },
//   uploadIconContainer: {
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   uploadIconBackground: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     alignItems: "center",
//     justifyContent: "center",
//   },
// });












// Publishable key    pk_test_placeholder
// Secret key         sk_test_placeholder

// stripe connected account   acct_placeholder






// import React, { useEffect } from "react";
// import { Tabs, useRouter, useSegments } from "expo-router";
// import { Home, PlusSquare, User, Compass, Wallet, Search, MessageCircle } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { LinearGradient } from "expo-linear-gradient";
// import { View, StyleSheet, Platform } from "react-native";
// import { useAuth } from "@/lib/auth";
// import { useAuthStore } from "@/store/auth-store";

// // Custom tab bar icon with indicator
// function TabBarIcon({ focused, color, size, Icon }: { focused: boolean; color: string; size: number; Icon: any }) {
//   return (
//     <View style={styles.iconContainer}>
//       <Icon size={size} color={color} />
//       {focused && <View style={styles.indicator} />}
//     </View>
//   );
// }

// function AuthGuard({ children }: { children: React.ReactNode }) {
//   const { user: supabaseUser, loading } = useAuth();
//   const { isAuthenticated } = useAuthStore();
//   const router = useRouter();
//   const segments = useSegments();

//   useEffect(() => {
//     if (loading) return;

//     const inAuthGroup = segments[0] === '(tabs)';
    
//     if (!supabaseUser && !isAuthenticated && inAuthGroup) {
//       router.replace('/signin');
//     }
//   }, [supabaseUser, isAuthenticated, loading, segments]);

//   if (loading) {
//     return null;
//   }

//   return <>{children}</>;
// }

// export default function TabLayout() {
//   return (
//     <AuthGuard>
//       <Tabs
//         screenOptions={{
//           tabBarStyle: {
//             backgroundColor: Colors.dark.background,
//             borderTopColor: 'transparent',
//             position: 'absolute',
//             bottom: 0,
//             left: 0,
//             right: 0,
//             elevation: 0,
//             height: 80,
//             borderTopWidth: 0,
//             shadowColor: "#000",
            
//             shadowOffset: {
//               width: 0,
//               height: -4,
//             },
//             shadowOpacity: 0.1,
//             shadowRadius: 4,
//           },
//           tabBarActiveTintColor: Colors.dark.primary,
//           tabBarInactiveTintColor: Colors.dark.inactive,
//           headerStyle: {
//             backgroundColor: Colors.dark.background,
//             shadowColor: 'transparent',
//             elevation: 0,
//             borderBottomWidth: 0,
          
//           },

//           headerTintColor: Colors.dark.text,
//           headerTitleStyle: {
//             fontWeight: '600',
//             fontSize: 18,
//           },
//           headerShown: false, // Hide the header for full screen experience
//           tabBarShowLabel: false, // Hide labels for a cleaner look
//           tabBarBackground: () => (
//             Platform.OS !== 'web' ? (
//               <LinearGradient
//                 colors={['rgba(10, 10, 15, 0.8)', 'rgba(10, 10, 15, 0.95)']}
//                 style={StyleSheet.absoluteFill}
//               />
//             ) : (
//               <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.dark.background }]} />
//             )
//           ),
//         }}
//       >
//         <Tabs.Screen
//           name="index"
//           options={{
//             title: "NightLife",
//             tabBarIcon: ({ focused, color, size }) => (
//               <TabBarIcon focused={focused} color={color} size={size} Icon={Home} />
//             ),
//           }}
//         />
//         <Tabs.Screen
//           name="discover"
//           options={{
//             title: "Discover",
//             tabBarIcon: ({ focused, color, size }) => (
//               <TabBarIcon focused={focused} color={color} size={size} Icon={Compass} />
//             ),
//           }}
//         />
//         <Tabs.Screen
//           name="search"
//           options={{
//             title: "Search",
//             tabBarIcon: ({ focused, color, size }) => (
//               <TabBarIcon focused={focused} color={color} size={size} Icon={Search} />
//             ),
//           }}
//         />
//         <Tabs.Screen
//           name="upload"
//           options={{
//             title: "Upload",
//             tabBarIcon: ({ focused, color, size }) => (
//               <View style={styles.uploadIconContainer}>
//                 {Platform.OS !== 'web' ? (
//                   <LinearGradient
//                     colors={Colors.dark.gradients.primary as [string, string]}
//                     style={styles.uploadIconBackground}
//                     start={{ x: 0, y: 0 }}
//                     end={{ x: 1, y: 1 }}
//                   >
//                     <PlusSquare size={size} color={Colors.dark.text} />
//                   </LinearGradient>
//                 ) : (
//                   <View style={[styles.uploadIconBackground, { backgroundColor: Colors.dark.primary }]}>
//                     <PlusSquare size={size} color={Colors.dark.text} />
//                   </View>
//                 )}
//               </View>
//             ),
//           }}
//         />
//         <Tabs.Screen
//           name="messages"
//           options={{
//             title: "Messages",
//             tabBarIcon: ({ focused, color, size }) => (
//               <TabBarIcon focused={focused} color={color} size={size} Icon={MessageCircle} />
//             ),
//           }}
//         />
//         <Tabs.Screen
//           name="wallet"
//           options={{
//             title: "Wallet",
//             tabBarIcon: ({ focused, color, size }) => (
//               <TabBarIcon focused={focused} color={color} size={size} Icon={Wallet} />
//             ),
//           }}
//         />
//         <Tabs.Screen
//           name="profile"
//           options={{
//             title: "Profile",
//             tabBarIcon: ({ focused, color, size }) => (
//               <TabBarIcon focused={focused} color={color} size={size} Icon={User} />
//             ),
//           }}
//         />
//       </Tabs>
//     </AuthGuard>
//   );
// }

// const styles = StyleSheet.create({
//   iconContainer: {
//     alignItems: 'center',
//     justifyContent: 'center',
//     height: 48,
//   },
//   indicator: {
//     position: 'absolute',
//     bottom: -8,
//     width: 4,
//     height: 4,
//     borderRadius: 2,
//     backgroundColor: Colors.dark.primary,
//   },
//   uploadIconContainer: {
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   uploadIconBackground: {
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
// });