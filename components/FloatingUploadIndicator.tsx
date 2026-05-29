import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Check, RefreshCcw, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useUploadTaskStore } from "@/store/upload-task-store";

const RING_SIZE = 42;
const STROKE_WIDTH = 4;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function FloatingUploadIndicator() {
  const insets = useSafeAreaInsets();
  const visible = useUploadTaskStore((state) => state.visible);
  const progress = useUploadTaskStore((state) => state.progress);
  const status = useUploadTaskStore((state) => state.status);
  const title = useUploadTaskStore((state) => state.title);
  const message = useUploadTaskStore((state) => state.message);
  const attempt = useUploadTaskStore((state) => state.attempt);
  const maxAttempts = useUploadTaskStore((state) => state.maxAttempts);
  const canRetry = useUploadTaskStore((state) => state.canRetry);

  useEffect(() => {
    if (status !== "success" && status !== "error") {
      return;
    }

    const delayMs = status === "success" ? 7000 : 9000;
    const timer = setTimeout(() => {
      useUploadTaskStore.getState().dismissTask();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [status]);

  if (!visible || status === "idle") {
    return null;
  }

  const normalizedProgress = Math.max(0, Math.min(100, progress));
  const dashOffset = CIRCUMFERENCE - (normalizedProgress / 100) * CIRCUMFERENCE;
  const isError = status === "error";
  const isSuccess = status === "success";
  const canDismiss = isError || isSuccess || attempt >= maxAttempts;
  const strokeColor = isError ? "#ff5a5f" : isSuccess ? "#36d399" : Colors.dark.primary;

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 12 }]}> 
      <View style={styles.card}>
        <View style={styles.ringWrap}>
          <Svg width={RING_SIZE} height={RING_SIZE}>
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={STROKE_WIDTH}
              fill="none"
            />
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              stroke={strokeColor}
              strokeWidth={STROKE_WIDTH}
              fill="none"
              strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              rotation="-90"
              origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
            />
          </Svg>

          <View style={styles.ringCenter}>
            {isSuccess ? <Check size={16} color="#36d399" /> : isError ? <RefreshCcw size={14} color="#ff5a5f" /> : <ActivityIndicator size="small" color={Colors.dark.primary} />}
          </View>
        </View>

        <View style={styles.copyWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message} numberOfLines={2}>{message}</Text>
          {!isSuccess ? <Text style={styles.attempt}>Attempt {attempt}/{maxAttempts}</Text> : null}
        </View>

        {canRetry ? (
          <Pressable style={styles.retryButton} onPress={() => void useUploadTaskStore.getState().retryCurrentTask()}>
            <Text style={styles.retryText}>Upload again</Text>
          </Pressable>
        ) : null}

        {isSuccess ? (
          <Pressable style={styles.successDismissButton} onPress={() => useUploadTaskStore.getState().dismissTask()}>
            <Text style={styles.successDismissText}>Dismiss</Text>
          </Pressable>
        ) : null}

        {canDismiss ? (
          <Pressable
            style={styles.dismissButton}
            onPress={() => useUploadTaskStore.getState().dismissTask()}
            accessibilityRole="button"
            accessibilityLabel="Dismiss upload status"
          >
            <X size={14} color="rgba(255,255,255,0.78)" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 999,
  },
  card: {
    alignSelf: "flex-start",
    maxWidth: 280,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "rgba(10, 10, 15, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
  ringCenter: {
    position: "absolute",
    inset: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  copyWrap: {
    flexShrink: 1,
    gap: 2,
  },
  title: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: "700",
  },
  message: {
    color: Colors.dark.subtext,
    fontSize: 11,
    lineHeight: 14,
  },
  attempt: {
    color: Colors.dark.primary,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  retryButton: {
    marginLeft: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,90,95,0.14)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  retryText: {
    color: "#ff8b90",
    fontSize: 11,
    fontWeight: "700",
  },
  successDismissButton: {
    marginLeft: 4,
    borderRadius: 999,
    backgroundColor: "rgba(54,211,153,0.18)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  successDismissText: {
    color: "#7ee8c4",
    fontSize: 11,
    fontWeight: "700",
  },
  dismissButton: {
    marginLeft: 2,
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
});