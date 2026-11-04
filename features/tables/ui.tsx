// Small UI kit for the tables feature. Swap `colors` for your app's theme.
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { ReservationStatus, TableImage } from './types';

export const colors = {
  bg: '#0E0E12',
  card: '#1A1A22',
  border: '#2A2A36',
  text: '#F4F4F7',
  muted: '#9A9AAB',
  accent: '#FF3B6B',
  accentText: '#FFFFFF',
  success: '#2BC48A',
  warning: '#F5B942',
  danger: '#FF5A5A',
};

export function Button(props: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { title, onPress, variant = 'primary', disabled, loading, style } = props;
  const bg = variant === 'primary' ? colors.accent : 'transparent';
  const fg = variant === 'primary' ? colors.accentText : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: bg, borderColor: variant === 'primary' ? bg : colors.border },
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Chip(props: { label: string; selected?: boolean; disabled?: boolean; onPress?: () => void }) {
  const { label, selected, disabled, onPress } = props;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ selected, disabled }}
      style={[
        s.chip,
        selected && { backgroundColor: colors.accent, borderColor: colors.accent },
        disabled && { opacity: 0.35 },
      ]}
    >
      <Text style={[s.chipText, selected && { color: colors.accentText }, disabled && s.strike]}>{label}</Text>
    </Pressable>
  );
}

export function Stepper(props: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const { value, min, max, onChange } = props;
  return (
    <View style={s.stepper}>
      <Pressable style={s.stepBtn} disabled={value <= min} onPress={() => onChange(value - 1)}>
        <Text style={[s.stepText, value <= min && { opacity: 0.3 }]}>−</Text>
      </Pressable>
      <Text style={s.stepValue}>{value}</Text>
      <Pressable style={s.stepBtn} disabled={value >= max} onPress={() => onChange(value + 1)}>
        <Text style={[s.stepText, value >= max && { opacity: 0.3 }]}>+</Text>
      </Pressable>
    </View>
  );
}

const STATUS_COLOR: Record<ReservationStatus, string> = {
  pending: colors.warning,
  confirmed: colors.success,
  declined: colors.danger,
  cancelled: colors.muted,
  completed: colors.muted,
  no_show: colors.danger,
};

export function StatusBadge({ status, label }: { status: ReservationStatus; label: string }) {
  const c = STATUS_COLOR[status];
  return (
    <View style={[s.badge, { borderColor: c }]}>
      <Text style={[s.badgeText, { color: c }]}>{label}</Text>
    </View>
  );
}

/** Swipeable photo strip; shows a placeholder when a table has no photos. */
export function ImageCarousel({ images, height = 220 }: { images: TableImage[]; height?: number }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = React.useState(0);
  if (!images.length) {
    return (
      <View style={[s.placeholder, { height }]}>
        <Text style={s.muted}>No photos yet</Text>
      </View>
    );
  }
  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {images.map((img) => (
          <Image key={img.id} source={{ uri: img.url }} style={{ width, height }} resizeMode="cover" />
        ))}
      </ScrollView>
      {images.length > 1 && (
        <View style={s.dots}>
          {images.map((img, i) => (
            <View key={img.id} style={[s.dot, i === index && { backgroundColor: colors.text }]} />
          ))}
        </View>
      )}
    </View>
  );
}

export function Loading() {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={s.center}>
      <Text style={s.h2}>{title}</Text>
      {body ? <Text style={[s.muted, { textAlign: 'center', marginTop: 6 }]}>{body}</Text> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  h1: { color: colors.text, fontSize: 24, fontWeight: '700' },
  h2: { color: colors.text, fontSize: 18, fontWeight: '700' },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 20, textTransform: 'uppercase', letterSpacing: 0.5 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 14 },
  strike: { textDecorationLine: 'line-through' },
  card: { backgroundColor: colors.card, borderRadius: 14, overflow: 'hidden', marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  button: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, paddingHorizontal: 18 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginRight: 8, marginBottom: 8, backgroundColor: colors.card },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' },
  stepBtn: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: 22, fontWeight: '600' },
  stepValue: { color: colors.text, fontSize: 17, fontWeight: '700', minWidth: 36, textAlign: 'center' },
  badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  placeholder: { backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)', marginHorizontal: 3 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
});
