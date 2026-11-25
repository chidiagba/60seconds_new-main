import * as ImagePicker from 'expo-image-picker';
const MIN_EVENT_VIDEO_SECONDS=5, MAX_EVENT_VIDEO_SECONDS=60, VIDEO_DURATION_TOLERANCE_MS=1200;
export const normalizeDurationMs = (rawDuration: number | null | undefined) => {
  if (typeof rawDuration !== "number" || Number.isNaN(rawDuration) || rawDuration <= 0) {
    return null;
  }

  // Camera APIs may return seconds while gallery APIs usually return milliseconds.
  return rawDuration < 1000 ? rawDuration * 1000 : rawDuration;
};

export const formatDurationLabel = (durationMs: number | null) => {
  if (!durationMs) return null;

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
};

export const isVideoTooShort = (durationMs: number | null) => {
  return !!durationMs && durationMs < MIN_EVENT_VIDEO_SECONDS * 1000;
};

export const isVideoTooLong = (durationMs: number | null) => {
  return !!durationMs && durationMs > MAX_EVENT_VIDEO_SECONDS * 1000 + VIDEO_DURATION_TOLERANCE_MS;
};

export const getVideoPickerMediaTypes = () => {
  const pickerApi = ImagePicker as unknown as {MediaType?:{videos?:ImagePicker.MediaType;Videos?:ImagePicker.MediaType};MediaTypeOptions?:{Videos?:ImagePicker.MediaTypeOptions;videos?:ImagePicker.MediaTypeOptions}};

  if (pickerApi?.MediaType) {
    const mediaType = pickerApi.MediaType.videos ?? pickerApi.MediaType.Videos;
    if (mediaType != null) {
      return [mediaType];
    }
  }

  const legacyMediaType = pickerApi?.MediaTypeOptions?.Videos ?? pickerApi?.MediaTypeOptions?.videos;
  return legacyMediaType;
};

