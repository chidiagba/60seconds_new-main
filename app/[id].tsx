import { Redirect, useLocalSearchParams } from 'expo-router';

export default function ShortVideoShareRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!id) {
    return <Redirect href="/+not-found" />;
  }

  return <Redirect href={{ pathname: '/video/[id]', params: { id } }} />;
}