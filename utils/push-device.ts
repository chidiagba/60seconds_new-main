import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
let currentToken: string | null = null;
export const setCurrentPushToken = async (token: string) => { currentToken = token; await AsyncStorage.setItem('push-device-token',token); };
export async function unregisterCurrentPushDevice() {
  currentToken ||= await AsyncStorage.getItem('push-device-token');
  if (!currentToken) return;
  const { error } = await supabase.from('push_devices').delete().eq('token', currentToken);
  if (error) throw error;
  currentToken = null;
  await AsyncStorage.removeItem('push-device-token');
}
