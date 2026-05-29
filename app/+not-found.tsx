import { Link, Stack, usePathname } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function NotFoundScreen() {
  const pathname = usePathname();

  return (
    <>
      <Stack.Screen options={{ title: "Navigation Error" }} />
      <View style={styles.container}>
        <Text style={styles.title}>We could not open that screen.</Text>
        <Text style={styles.subtitle}>Requested route: {pathname || "unknown"}</Text>

        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go to Home Feed</Text>
        </Link>

        <Link href="/(tabs)/upload" style={styles.secondaryLink}>
          <Text style={styles.secondaryLinkText}>Return to Upload</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  subtitle: {
    marginTop: 10,
    fontSize: 14,
    opacity: 0.75,
    textAlign: "center",
  },
  link: {
    marginTop: 18,
    paddingVertical: 12,
  },
  linkText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2e78b7",
  },
  secondaryLink: {
    marginTop: 2,
    paddingVertical: 10,
  },
  secondaryLinkText: {
    fontSize: 14,
    color: "#5f7ea7",
  },
});
