import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CalendarDays, ChevronRight, LayoutGrid } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/lib/auth';
import Colors from '@/constants/colors';

const theme = Colors.dark;

export function ProfileTableActions() {
  const router = useRouter();
  const { user, profile } = useAuth();
  if (!user) return null;
  const links = [{ title: 'My reservations', path: 'mine', icon: CalendarDays }, ...(profile?.user_type === 'business' ? [{ title: 'Manage tables & availability', path: 'manage', icon: LayoutGrid }, { title: 'Table reservations', path: 'inbox', icon: CalendarDays }, { title: 'Book a table', path: 'venue', icon: CalendarDays }] : [])];
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <LinearGradient colors={['#22213E', '#181822']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heading}>
          <View style={styles.headingIcon}><LayoutGrid size={20} color={theme.primaryLight} /></View>
          <View style={styles.headingCopy}>
            <Text style={styles.title}>Tables & reservations</Text>
            <Text style={styles.subtitle}>Bookings and table availability</Text>
          </View>
        </LinearGradient>
        <View style={styles.links}>
          {links.map(({ title, path, icon: Icon }, index) => (
            <Pressable key={path} accessibilityRole="button" accessibilityLabel={title}
              onPress={() => router.push({ pathname: `/tables/${path}`, params: path === 'mine' ? {} : { venueId: user.id, venueName: profile?.business_name || profile?.full_name } } as any)}
              style={({ pressed }) => [styles.row, index > 0 && styles.divider, pressed && styles.pressed]}>
              <Icon size={19} color={theme.primaryLight} strokeWidth={1.8} />
              <Text style={styles.rowTitle}>{title}</Text>
              <ChevronRight size={17} color={theme.caption} />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, marginTop: 4, marginBottom: 24 },
  card: { backgroundColor: theme.card, borderRadius: 20, borderWidth: 1, borderColor: '#303044', overflow: 'hidden' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  headingIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(99,102,241,0.15)' },
  headingCopy: { flex: 1, gap: 4 },
  title: { color: theme.text, fontSize: 16, fontWeight: '700' },
  subtitle: { color: theme.subtext, fontSize: 12, lineHeight: 17 },
  links: { paddingHorizontal: 16 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
  pressed: { backgroundColor: 'rgba(99,102,241,0.09)' },
  rowTitle: { flex: 1, color: '#E4E4F0', fontSize: 14, fontWeight: '500' },
});
