import { SafeAreaView } from 'react-native-safe-area-context';
import React from 'react';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import type { TablesStackParamList } from './navigation';
import { useAuth } from '@/lib/auth';
import { Button, Loading, s } from './ui';
import { Text, View } from 'react-native';
const paths = { ManageTables: 'manage', TableEditor: 'edit', VenueReservations: 'inbox', VenueTables: 'venue', BookTable: 'book', MyReservations: 'mine' } as const;
type Navigation = {
  navigate: <K extends keyof TablesStackParamList>(name: K, params?: TablesStackParamList[K]) => void;
  replace: <K extends keyof TablesStackParamList>(name: K, params?: TablesStackParamList[K]) => void;
  goBack: () => void;
  setOptions: (options: Record<string, unknown>) => void;
};
export type NativeStackScreenProps<P, K extends keyof P> = { route: { params: P[K] }; navigation: Navigation };
export function tableRoute<K extends keyof TablesStackParamList>(Screen: React.ComponentType<NativeStackScreenProps<TablesStackParamList, K>>, name: K) {
  return function TableRoute() {
    const params = useLocalSearchParams();
    const router = useRouter();
    const native = useNavigation();
    const { user, profile, loading } = useAuth();
    const navigation = React.useMemo<Navigation>(() => ({
      navigate: (key, values) => router.push({ pathname: `/tables/${paths[key]}`, params: values } as any),
      replace: (key, values) => router.replace({ pathname: `/tables/${paths[key]}`, params: values } as any),
      goBack: () => router.canGoBack() ? router.back() : router.replace('/profile'),
      setOptions: (options) => native.setOptions(options),
    }), [router, native]);
    const business = ['ManageTables', 'TableEditor', 'VenueReservations'].includes(name);
    const requiresAuth = business || name === 'BookTable' || name === 'MyReservations';
    React.useLayoutEffect(() => {
      native.setOptions({ headerShown: true, title: name === 'MyReservations' ? 'My reservations' : name === 'ManageTables' ? 'Table settings' : 'Tables', headerStyle: { backgroundColor: '#111118' }, headerTintColor: '#fff' });
    }, [native]);
    if (loading && requiresAuth) return <Loading />;
    if (requiresAuth && !user) return <View style={[s.screen, s.pad]}><Text style={s.h2}>Sign in to reserve a table</Text><Button title="Sign in" onPress={() => router.push('/signin')} /></View>;
    if (business && ((profile?.user_type ?? user?.user_metadata?.user_type) !== 'business' || params.venueId !== user?.id)) return <View style={[s.screen, s.pad]}><Text style={s.h2}>Only the venue owner can manage these tables.</Text></View>;
    if ((name === 'BookTable' && typeof params.tableId !== 'string') || (name !== 'BookTable' && name !== 'MyReservations' && typeof params.venueId !== 'string')) return <View style={[s.screen, s.pad]}><Text style={s.h2}>Missing table or venue.</Text></View>;
    return <SafeAreaView style={s.screen} edges={['bottom']}><Screen route={{ params: params as TablesStackParamList[K] }} navigation={navigation} /></SafeAreaView>;
  };
}
