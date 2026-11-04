import React from 'react';
import { ScrollView, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import EventTableManager from '@/features/event-tables/EventTableManager';
import { useAuth } from '@/lib/auth';
export default function EventTables() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  return <ScrollView style={{flex:1,backgroundColor:'#111'}} contentContainerStyle={{padding:16}}>
    <Stack.Screen options={{title:'Event tables & reservations'}} />
    {user && id ? <EventTableManager eventId={id} /> : <Text style={{color:'#fff'}}>Sign in and select an event from My Events to manage its tables.</Text>}
  </ScrollView>;
}
