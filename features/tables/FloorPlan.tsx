import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { VenueTable } from './types';
import { money } from './format';
import { s } from './ui';
type MapTable = Pick<VenueTable, 'id' | 'name' | 'map_x' | 'map_y' | 'map_color' | 'minimum_spend' | 'currency' | 'max_guests'>;
export function FloorPlan({ tables, selected, unavailable = [], onSelect, onPlace }: {
  tables: MapTable[]; selected?: string; unavailable?: string[];
  onSelect?: (table: MapTable) => void; onPlace?: (x: number, y: number) => void;
}) {
  const [size, setSize] = React.useState({ width: 1, height: 1 });
  return <View>
    <Pressable accessibilityLabel={onPlace ? 'Tap to position your table' : 'Venue floor plan'}
      onLayout={e => setSize(e.nativeEvent.layout)}
      onPress={onPlace ? e => onPlace(Math.max(8, Math.min(92, e.nativeEvent.locationX / size.width * 100)), Math.max(6, Math.min(94, e.nativeEvent.locationY / size.height * 100))) : undefined}
      style={{ height: 490, backgroundColor: '#08080c', borderRadius: 20, borderWidth: 1, borderColor: '#30303b', overflow: 'hidden' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 25, right: 14, padding: 16, borderWidth: 2, borderColor: '#dd5adb', borderRadius: 20 }}><Text style={{ color: '#f390eb' }}>BAR</Text></View>
      <View pointerEvents="none" style={{ position: 'absolute', top: '38%', left: 2, width: 42, height: 105, borderRadius: 18, backgroundColor: '#24242e', justifyContent: 'center' }}><Text style={{ color: '#aaa', textAlign: 'center' }}>DJ</Text></View>
      <Text pointerEvents="none" style={{ position: 'absolute', top: '51%', alignSelf: 'center', color: '#656575', letterSpacing: 3 }}>DANCE FLOOR</Text>
      <Text pointerEvents="none" style={{ position: 'absolute', bottom: 8, alignSelf: 'center', color: '#888' }}>ENTRANCE</Text>
      {tables.map(t => {
        const disabled = unavailable.includes(t.id);
        return <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`${t.name}, up to ${t.max_guests} guests, ${money(t.minimum_spend, t.currency) ?? 'no minimum spend'}${disabled ? ', unavailable' : ''}`}
          accessibilityState={{ selected: selected === t.id, disabled }} disabled={disabled || !!onPlace}
          onPress={() => onSelect?.(t)} pointerEvents={onPlace ? 'none' : 'auto'}
          style={{ position: 'absolute', left: `${t.map_x}%`, top: `${t.map_y}%`, width: 52, height: 48, marginLeft: -26, marginTop: -24, borderRadius: 9, backgroundColor: disabled ? '#444451' : t.map_color, borderWidth: selected === t.id ? 3 : 1, borderColor: selected === t.id ? '#fff' : '#ffffff44', justifyContent: 'center', alignItems: 'center' }}>
          <Text numberOfLines={1} style={{ color: disabled ? '#bbb' : '#16131b', fontWeight: '800', fontSize: 12 }}>{t.name}</Text>
          <Text style={{ fontSize: 10, color: disabled ? '#bbb' : '#16131b' }}>{disabled ? 'Booked' : `${t.max_guests} guests`}</Text>
        </Pressable>;
      })}
    </Pressable>
    <Text style={[s.muted, { marginTop: 10 }]}>Tap a table to select it · Grey = unavailable</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 10 }}>
      {Array.from(new Map(tables.map(t => [`${t.map_color}-${t.currency}-${t.minimum_spend}`, t])).values()).map(t => <Text key={`${t.map_color}-${t.currency}-${t.minimum_spend}`} style={{ color: t.map_color }}>{'●'} {money(t.minimum_spend, t.currency) ?? 'No minimum'} min.</Text>)}
    </View>
  </View>;
}
