import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { Share2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { Video } from '@/types';
import { useVideoStore } from '@/store/video-store';
import ShareModal from './ShareModal';

interface ShareButtonProps {
  video: Video;
  size?: number;
  color?: string;
}

export default function ShareButton({ video, size = 24, color = Colors.dark.text }: ShareButtonProps) {
  const [showShareModal, setShowShareModal] = useState(false);
  const { shareVideo } = useVideoStore();

  const handleShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setShowShareModal(true);
  };

  return (
    <>
      <TouchableOpacity onPress={handleShare}>
        <Share2 size={size} color={color} />
      </TouchableOpacity>

      <ShareModal
        visible={showShareModal}
        onClose={() => setShowShareModal(false)}
        video={video}
      />
    </>
  );
}