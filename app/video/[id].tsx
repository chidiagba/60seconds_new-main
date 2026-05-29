import { Redirect, useLocalSearchParams } from 'expo-router';

export default function CanonicalVideoShareRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!id) {
    return <Redirect href="/+not-found" />;
  }

  return <Redirect href={{ pathname: '/web-video/[id]', params: { id } }} />;
}