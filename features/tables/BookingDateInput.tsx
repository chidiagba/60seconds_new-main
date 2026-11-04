import React, { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { s, colors } from './ui';

/** Also lets guests choose a date outside the nearby-day shortcuts. */
export default function BookingDateInput({ onChange }: { onChange: (day: Date) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  return <>
    <Text style={s.label}>Choose another date</Text>
    <TextInput accessibilityLabel="Booking date, YYYY-MM-DD" style={s.input} value={value} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted}
      onChangeText={text => {
        setValue(text); setError('');
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (!match) return;
        const [year, month, day] = match.slice(1).map(Number);
        const date = new Date(year, month - 1, day);
        const today = new Date(); today.setHours(0,0,0,0);
        if (date < today || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) { setError('Choose a valid date from today onward.'); return; }
        onChange(date);
      }} />
    {!!error && <Text accessibilityRole="alert" style={s.muted}>{error}</Text>}
  </>;
}
