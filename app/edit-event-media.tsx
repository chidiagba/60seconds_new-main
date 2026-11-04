import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { uploadImageToSupabase } from '@/utils/image-upload';
import { readUriAsArrayBuffer } from '@/utils/media-upload';
import { generateEventThumbnail } from '@/utils/event-thumbnail';

export default function EditEventMedia() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [event, setEvent] = useState<any>(null);
  const [image, setImage] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setEvent(null); setImage(null); setVideo(null); setDuration(null); setError('');
    (async () => {
      if (!user?.id) return;
      const { data: profile, error: profileError } = await supabase.from('profiles').select('user_type').eq('id', user.id).single();
      if (profileError || profile?.user_type !== 'business') throw new Error('Only business accounts can edit event media.');
      const { data, error } = await supabase.from('events').select('*,video:videos(video_url,thumbnail_url)').eq('id', id).single();
      if (error) throw error;
      if (![data.user_id, data.business_id].includes(user.id)) throw new Error('You can only edit your own events.');
      if (active) { setEvent(data); setImage(data.image_url); setVideo(data.video?.video_url || null); }
    })().catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, user?.id]);
  const pick = async (kind: 'images' | 'videos') => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: [kind], quality: 0.85, videoMaxDuration: 60 });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (kind === 'images') setImage(asset.uri);
      else {
        if (!asset.duration || asset.duration > 60000) throw new Error('Choose a video between 1 and 60 seconds.');
        setVideo(asset.uri); setDuration(asset.duration / 1000);
      }
      setError('');
    } catch (e: any) { setError(e.message); }
  };
  const save = async () => {
    if (busy || !event || !user) return;
    if (!image && !video) { setError('Keep an event image or video.'); return; }
    setBusy(true); setError('');
    try {
      const imageUrl = image && image !== event.image_url ? await uploadImageToSupabase(image, user.id, 'event-flyers') : image;
      let videoUrl = video;
      let thumbnail = event.video?.thumbnail_url || null;
      if (video && video !== event.video?.video_url) {
        const { arrayBuffer, extension } = await readUriAsArrayBuffer(video, { allowedExtensions: ['mp4', 'mov', 'm4v'], fallbackExtension: 'mp4' });
        const path = `${user.id}/${Date.now()}_event.${extension}`;
        const { error } = await supabase.storage.from('videos').upload(path, arrayBuffer, { contentType: extension === 'mov' ? 'video/quicktime' : 'video/mp4' });
        if (error) throw error;
        videoUrl = supabase.storage.from('videos').getPublicUrl(path).data.publicUrl;
        const preview = await generateEventThumbnail(video);
        thumbnail = preview ? await uploadImageToSupabase(preview, user.id, 'thumbnails') : null;
      }
      const { error } = await supabase.rpc('save_event_media', { event_key: id, image_url_value: imageUrl || (!image && videoUrl ? thumbnail : null), video_url_value: videoUrl, thumbnail_url_value: thumbnail, duration_value: duration });
      if (error) throw error;
      router.back();
    } catch (e: any) { setError(e.message || 'Unable to save event media.'); }
    finally { setBusy(false); }
  };
  const button = { padding: 16, backgroundColor: '#5d56ee', borderRadius: 8, marginTop: 16 };
  return <ScrollView style={{ flex: 1, backgroundColor: '#111' }} contentContainerStyle={{ padding: 24, paddingTop: 60, paddingBottom: 80 }}>
    <Text style={{ color: '#fff', fontSize: 26 }}>Event images & video</Text>
    <Text style={{ color: '#ccc', marginTop: 12 }}>Use an image, a video, or both. The event image appears on newly issued tickets.</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#ff9999', marginTop: 16 }}>{error}</Text>}
    {!event && !error && <ActivityIndicator />}
    {event && <>
      {!!image && <Image source={{ uri: image }} style={{ width: '100%', height: 240, marginTop: 16 }} resizeMode="contain" />}
      <TouchableOpacity disabled={busy} style={button} onPress={() => pick('images')}><Text style={{ color: '#fff' }}>{image ? 'Replace image / flyer' : 'Add image / flyer'}</Text></TouchableOpacity>
      {!!image && <TouchableOpacity disabled={busy} style={button} onPress={() => setImage(null)}><Text style={{ color: '#fff' }}>Remove image</Text></TouchableOpacity>}
      <Text style={{ color: '#ccc', marginTop: 16 }}>{video ? 'Video selected' : 'No video selected'}</Text>
      <TouchableOpacity disabled={busy} style={button} onPress={() => pick('videos')}><Text style={{ color: '#fff' }}>{video ? 'Replace video' : 'Add video'}</Text></TouchableOpacity>
      {!!video && <TouchableOpacity disabled={busy} style={button} onPress={() => { setVideo(null); setDuration(null); }}><Text style={{ color: '#fff' }}>Remove event video</Text></TouchableOpacity>}
      <TouchableOpacity disabled={busy} style={button} onPress={save}><Text style={{ color: '#fff' }}>{busy ? 'Saving…' : 'Save media'}</Text></TouchableOpacity>
    </>}
    <TouchableOpacity disabled={busy} style={button} onPress={() => router.back()}><Text style={{ color: '#fff' }}>Back</Text></TouchableOpacity>
  </ScrollView>;
}
