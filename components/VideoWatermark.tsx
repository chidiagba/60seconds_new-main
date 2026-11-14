import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { WATERMARK_OPACITY } from '@/utils/watermark-layout';

interface VideoWatermarkProps {
  username: string;
  seconds: number;
  visible?: boolean;
}

export default function VideoWatermark({ username, seconds, visible = true }: VideoWatermarkProps) {
  void seconds;
  if (!visible || !username) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.brand}>
        <Image source={require('../assets/images/second.png')} style={styles.logo} contentFit="contain" />
        <View style={styles.text}>
          <Text style={styles.name}>60Seconds</Text>
          <Text style={styles.username} numberOfLines={1}>@{username.replace(/^@+/, '')}</Text>
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  brand: { position: 'absolute', right: 12, bottom: 12, width: 144, height: 44, flexDirection: 'row', alignItems: 'center', opacity: WATERMARK_OPACITY },
  logo: { width: 32, height: 32, marginRight: 5 },
  text: { flex: 1 },
  name: { color: 'white', fontWeight: '800', fontSize: 15, textShadowColor: '#000', textShadowRadius: 3, textShadowOffset: { width: 1, height: 1 } },
  username: { color: 'white', fontWeight: '600', fontSize: 11, textShadowColor: '#000', textShadowRadius: 3, textShadowOffset: { width: 1, height: 1 } },
});
