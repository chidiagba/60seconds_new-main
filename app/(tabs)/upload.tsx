import { resolveCurrentVenueSelection, venueCoordinates } from '@/utils/venue-location';
import { logger } from '@/lib/logger';
import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  KeyboardAvoidingView,
  ActivityIndicator,
  PanResponder,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { Audio } from "expo-av";
import { Image } from "expo-image";
import { Video as ExpoVideo, ResizeMode } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Camera, X, MapPin, Tag, Upload, Check, Map, Clock, Plus, Calendar } from "lucide-react-native";

import Colors from "@/constants/colors";
import { useVideoStore } from "@/store/video-store";
import { useAuth } from "@/lib/auth";
import { videoService, storageService, productService, eventService } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import UserSearchModal from "@/components/UserSearchModal";
import { getCurrentLocation } from "@/utils/location";
import { readUriAsArrayBuffer } from "@/utils/media-upload";
import { startVideoWatermarkAfterUpload } from "@/utils/video-watermark-processing";
import { videoEditService, type FrameStyle, type EffectStyle } from "@/utils/video-editing";
import { assessUploadNetwork, getUploadNetworkTaskMessage, type UploadNetworkHint } from "@/utils/upload-network";
import { ProductCreationModal } from "@/components/ProductCreationModal";
import { User, Video, Product } from "@/types";
import { useProductStore } from "@/store/product-store";
import { useUploadTaskStore } from "@/store/upload-task-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveCurrencyFromCountry, resolveEventCurrency } from "@/utils/country-currency";
import { generateEventThumbnail } from "@/utils/event-thumbnail";

const MIN_EVENT_VIDEO_SECONDS = 5;
const MAX_EVENT_VIDEO_SECONDS = 60;
const VIDEO_DURATION_TOLERANCE_MS = 1200;
const MIN_EVENT_END_OFFSET_MS = 60 * 1000;
const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;
const VIDEO_FILE_EXTENSIONS = ["mp4", "mov", "m4v", "webm"] as const;
const IMAGE_FILE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic"] as const;
const MAX_UPLOAD_ATTEMPTS = 4;
const UPLOAD_ATTEMPT_TIMEOUT_MS = 480000;
const RECORD_PROGRESS_RADIUS = 46;
const RECORD_PROGRESS_CIRCUMFERENCE = 2 * Math.PI * RECORD_PROGRESS_RADIUS;
const FRAME_STYLE_OPTIONS: Array<{ label: string; value: FrameStyle }> = [
  { label: "Neon", value: "neon" },
  { label: "Classic", value: "classic" },
  { label: "Cinema", value: "cinema" },
  { label: "Minimal", value: "minimal" },
  { label: "Gold", value: "gold" },
];
const EFFECT_STYLE_OPTIONS: Array<{ label: string; value: EffectStyle }> = [
  { label: "Noir", value: "noir" },
  { label: "Vivid", value: "vivid" },
  { label: "Warm", value: "warm" },
  { label: "Sepia", value: "sepia" },
  { label: "Cool", value: "cool" },
  { label: "Retro", value: "retro" },
];

type DraftProduct = {
  name: string;
  price: number;
  available_quantity: number;
  image?: string;
  currency?: string;
  type?: 'ticket' | 'drink' | 'reservation' | 'merchandise';
};

const buildFallbackEventTitle = () => `Untitled Video ${new Date().toISOString().slice(0, 10)}`;

const normalizeDurationMs = (rawDuration: number | null | undefined) => {
  if (typeof rawDuration !== "number" || Number.isNaN(rawDuration) || rawDuration <= 0) {
    return null;
  }

  // Camera APIs may return seconds while gallery APIs usually return milliseconds.
  return rawDuration < 1000 ? rawDuration * 1000 : rawDuration;
};

const formatDurationLabel = (durationMs: number | null) => {
  if (!durationMs) return null;

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
};

const isVideoTooShort = (durationMs: number | null) => {
  return !!durationMs && durationMs < MIN_EVENT_VIDEO_SECONDS * 1000;
};

const isVideoTooLong = (durationMs: number | null) => {
  return !!durationMs && durationMs > MAX_EVENT_VIDEO_SECONDS * 1000 + VIDEO_DURATION_TOLERANCE_MS;
};

const getVideoPickerMediaTypes = () => {
  const pickerApi = ImagePicker as any;

  if (pickerApi?.MediaType) {
    const mediaType = pickerApi.MediaType.videos ?? pickerApi.MediaType.Videos;
    if (mediaType != null) {
      return [mediaType];
    }
  }

  const legacyMediaType = pickerApi?.MediaTypeOptions?.Videos ?? pickerApi?.MediaTypeOptions?.videos;
  return legacyMediaType;
};

export default function UploadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ✅ read params coming from /location confirm
  const params = useLocalSearchParams<{
    locationName?: string;
    latitude?: string;
    longitude?: string;
    city?: string;
    country?: string;
    editVideoId?: string;
  }>();

  const editVideoId = typeof params.editVideoId === "string" ? params.editVideoId : null;
  const isEditMode = !!editVideoId;

  const { user: authUser, profile } = useAuth();
  const user = profile;

  const { uploadVideo, fetchVideos } = useVideoStore();
  const { addProduct } = useProductStore();
  const [permission, requestPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();

  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const [eventName, setEventName] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventDate, setEventDate] = useState(new Date());
  const [eventEndDate, setEventEndDate] = useState<Date | null>(null);
  const [startDateText, setStartDateText] = useState("");
  const [endDateText, setEndDateText] = useState("");
  const [activeDatePicker, setActiveDatePicker] = useState<null | "start-date" | "start-time" | "end-date" | "end-time">(null);
  const [pickerInitialValue, setPickerInitialValue] = useState<Date>(new Date());
  const pickerTempValueRef = useRef<Date>(new Date());
  const [currentOfferingType, setCurrentOfferingType] = useState<'ticket' | 'drink' | 'other'>('ticket');

  const [eventLocation, setEventLocation] = useState<any>({
    name: "",
    latitude: null,
    longitude: null,
    city: "",
    country: "",
  });

  const [eventTags, setEventTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<"uploading" | "processing" | "complete" | "error">(
    "uploading"
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [isLoadingEditPayload, setIsLoadingEditPayload] = useState(false);
  const [eventProducts, setEventProducts] = useState<
    Omit<Product, "id" | "videoId" | "createdAt">[]
  >([]);
  const [editingProductIndex, setEditingProductIndex] = useState<number | null>(null);
  const [editingProduct, setEditingProduct] = useState<DraftProduct | null>(null);

  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [showFullScreenCamera, setShowFullScreenCamera] = useState(false);
  const [pendingVideoUri, setPendingVideoUri] = useState<string | null>(null);
  const [isReopeningTrimPicker, setIsReopeningTrimPicker] = useState(false);
  const [isPickingVideo, setIsPickingVideo] = useState(false);
  const [galleryLoadingMessage, setGalleryLoadingMessage] = useState("Opening gallery...");
  const [isEditingVideo, setIsEditingVideo] = useState(false);
  const [activeEditPanel, setActiveEditPanel] = useState<null | "trim" | "frame" | "effects">(null);
  const [trimEndSeconds, setTrimEndSeconds] = useState(MAX_EVENT_VIDEO_SECONDS);
  const [trimTrackWidth, setTrimTrackWidth] = useState(0);

  const cameraRef = useRef<any>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingReachedLimitRef = useRef(false);
  const trimDragStartRatioRef = useRef(1);
  const uploadLaunchLockRef = useRef(false);
  const preparingUploadRef = useRef(false);
  const [isPreparingUpload, setIsPreparingUpload] = useState(false);

  const commitRecordedVideo = (recordedUri: string, durationMs: number | null) => {
    setVideoUri(recordedUri);
    setVideoDurationMs(durationMs);
    setThumbnailUri(null);
    void generateEventThumbnail(recordedUri).then(setThumbnailUri);
    setPendingVideoUri(null);
    setShowFullScreenCamera(false);
    setIsRecording(false);
    setRecordingDuration(0);
    setCameraReady(false);
  };

  const businessDefaultCurrency = useMemo(
    () =>
      resolveCurrencyFromCountry({
        country: user?.country,
        countryCode: user?.country_code,
        fallbackCurrency: "USD",
      }),
    [user?.country, user?.country_code]
  );
  const recordingProgress = Math.min(recordingDuration / MAX_EVENT_VIDEO_SECONDS, 1);
  const recordingProgressOffset = RECORD_PROGRESS_CIRCUMFERENCE * (1 - recordingProgress);
  const currentDurationSeconds = useMemo(() => {
    const duration = videoDurationMs ? Math.max(1, Math.floor(videoDurationMs / 1000)) : MAX_EVENT_VIDEO_SECONDS;
    return Math.min(duration, MAX_EVENT_VIDEO_SECONDS);
  }, [videoDurationMs]);
  const maxTrimRangeSeconds = Math.max(0, currentDurationSeconds - MIN_EVENT_VIDEO_SECONDS);
  const trimProgressRatio =
    maxTrimRangeSeconds === 0
      ? 1
      : Math.max(0, Math.min(1, (trimEndSeconds - MIN_EVENT_VIDEO_SECONDS) / maxTrimRangeSeconds));

  useEffect(() => {
    if (!videoUri) {
      setActiveEditPanel(null);
      return;
    }

    setTrimEndSeconds(Math.max(MIN_EVENT_VIDEO_SECONDS, Math.min(currentDurationSeconds, MAX_EVENT_VIDEO_SECONDS)));
  }, [videoUri, currentDurationSeconds]);

  const trimHandlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          trimDragStartRatioRef.current = trimProgressRatio;
        },
        onPanResponderMove: (_, gestureState) => {
          if (trimTrackWidth <= 0 || maxTrimRangeSeconds <= 0) {
            return;
          }

          const nextRatio = Math.max(
            0,
            Math.min(1, trimDragStartRatioRef.current + gestureState.dx / trimTrackWidth)
          );
          const nextSeconds = Math.round(MIN_EVENT_VIDEO_SECONDS + nextRatio * maxTrimRangeSeconds);
          setTrimEndSeconds(Math.max(MIN_EVENT_VIDEO_SECONDS, Math.min(currentDurationSeconds, nextSeconds)));
        },
      }),
    [currentDurationSeconds, maxTrimRangeSeconds, trimProgressRatio, trimTrackWidth]
  );

  // ✅ Apply selected location from LocationScreen
  useEffect(() => {
    const lat = params.latitude ? parseFloat(params.latitude) : null;
    const lng = params.longitude ? parseFloat(params.longitude) : null;
    const coordinates = venueCoordinates({ latitude: lat, longitude: lng });

    if (coordinates) {
      const name =
        (typeof params.locationName === "string" && params.locationName.length
          ? params.locationName
          : `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`) || "";

      setEventLocation({
        name,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        city: (typeof params.city === "string" ? params.city : "") || "",
        country: (typeof params.country === "string" ? params.country : "") || "",
      });
      setIsResolvingLocation(false);
    }
  }, [params.latitude, params.longitude, params.locationName, params.city, params.country]);

  useEffect(() => {
    if (Platform.OS === "web" || isEditMode || params.latitude || params.longitude || eventLocation.name) return;

    let active = true;
    void resolveCurrentVenueSelection({
      getPermission: () => Location.getForegroundPermissionsAsync(),
      getPosition: () => getCurrentLocation({ requestPermission: false, maxCacheAgeMs: 60_000 }),
      reverseGeocode: (coordinates) => Location.reverseGeocodeAsync(coordinates),
    }).then((selection) => {
      if (!active || !selection) return;
      setEventLocation((current: typeof eventLocation) =>
        current.name || venueCoordinates(current) ? current : selection
      );
    }).catch((error) => {
      logger.debug("Current venue auto-fill unavailable:", error);
    });

    return () => { active = false; };
  }, [isEditMode, params.latitude, params.longitude, eventLocation.name]);

  useFocusEffect(
    React.useCallback(() => {
      if (!isResolvingLocation) {
        return;
      }

      const releaseTimer = setTimeout(() => {
        setIsResolvingLocation(false);
      }, 1800);

      return () => clearTimeout(releaseTimer);
    }, [isResolvingLocation])
  );

  useEffect(() => {
    if (!isEditMode || !editVideoId || !authUser?.id) {
      return;
    }

    let mounted = true;

    const loadEditPayload = async () => {
      setIsLoadingEditPayload(true);
      try {
        const existingVideo = await videoService.getVideo(editVideoId);

        if (!mounted) return;

        if (!existingVideo || existingVideo.user_id !== authUser.id) {
          Alert.alert("Not Allowed", "You can only edit your own videos.", [
            { text: "OK", onPress: () => router.push("/profile") },
          ]);
          return;
        }

        setVideoUri(existingVideo.video_url || null);
        setThumbnailUri(existingVideo.thumbnail_url || null);
        setEventName(existingVideo.event_name || existingVideo.title || "");
        setEventDescription(existingVideo.description || "");
        setEventTags(Array.isArray(existingVideo.hashtags) ? existingVideo.hashtags : []);
        setVideoDurationMs(null);

        const { data: linkedEvent } = await supabase
          .from("events")
          .select(
            "event_name, description, start_date, end_date, location_name, location_city, location_country, location_latitude, location_longitude"
          )
          .eq("video_id", editVideoId)
          .eq("user_id", authUser.id)
          .maybeSingle();

        if (!mounted) return;

        if (linkedEvent) {
          setEventName(linkedEvent.event_name || existingVideo.event_name || existingVideo.title || "");
          setEventDescription(linkedEvent.description || existingVideo.description || "");
          const sd = linkedEvent.start_date ? new Date(linkedEvent.start_date) : new Date();
          setEventDate(sd);
          setStartDateText(formatDateForInput(sd));
          if (linkedEvent.end_date) {
            const ed = new Date(linkedEvent.end_date);
            setEventEndDate(ed);
            setEndDateText(formatDateForInput(ed));
          }
          setEventLocation({
            name: linkedEvent.location_name || existingVideo.location_name || "",
            latitude: linkedEvent.location_latitude ?? null,
            longitude: linkedEvent.location_longitude ?? null,
            city: linkedEvent.location_city || existingVideo.location_city || "",
            country: linkedEvent.location_country || existingVideo.location_country || "",
          });
        } else {
          setEventDate(existingVideo.event_date ? new Date(existingVideo.event_date) : new Date());
          setEventLocation({
            name: existingVideo.location_name || "",
            latitude: null,
            longitude: null,
            city: existingVideo.location_city || "",
            country: existingVideo.location_country || "",
          });
        }
      } catch (error) {
        logger.error("Failed to load video for edit:", error);
        if (mounted) {
          Alert.alert("Edit Error", "Could not load this video for editing.", [
            { text: "OK", onPress: () => router.push("/profile") },
          ]);
        }
      } finally {
        if (mounted) {
          setIsLoadingEditPayload(false);
        }
      }
    };

    void loadEditPayload();

    return () => {
      mounted = false;
    };
  }, [isEditMode, editVideoId, authUser?.id, router]);

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }

    // Read current permission states without prompting on screen mount to avoid UI stalls.
    void Location.getForegroundPermissionsAsync();
    void Audio.getPermissionsAsync();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      const resetCamera = () => {
        setCameraKey((prev) => prev + 1);
        setIsRecording(false);
        setRecordingDuration(0);
        setCameraReady(false);
        setShowFullScreenCamera(false);

        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
      };

      resetCamera();

      return () => {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
      };
    }, [])
  );

  const handleStartRecording = async () => {
    if (!cameraRef.current) {
      Alert.alert("Camera Error", "Camera is not ready. Please try again.");
      return;
    }

    if (!cameraReady) {
      Alert.alert("Camera Error", "Camera is still initializing. Please wait a moment and try again.");
      return;
    }

    if (Platform.OS === "web") {
      Alert.alert("Not Supported", "Video recording is not supported on web. Please use the gallery option.");
      return;
    }

    if (!permission?.granted) {
      Alert.alert("Permission Required", "Camera permission is required to record videos");
      return;
    }

    if (!microphonePermission?.granted) {
      const requested = await requestMicrophonePermission();
      if (!requested.granted) {
        Alert.alert("Permission Required", "Microphone permission is required to record videos.");
        return;
      }
    }

    const { status: audioStatus } = await Audio.getPermissionsAsync();
    if (audioStatus !== "granted") {
      Alert.alert("Permission Required", "Audio recording permission is required for video recording");
      return;
    }

    setIsRecording(true);
    setRecordingDuration(0);
    recordingReachedLimitRef.current = false;

    recordingTimerRef.current = setInterval(() => {
      setRecordingDuration((prev) => {
        const next = prev + 1;
        if (next >= MAX_EVENT_VIDEO_SECONDS) {
          recordingReachedLimitRef.current = true;
          cameraRef.current?.stopRecording();
          return MAX_EVENT_VIDEO_SECONDS;
        }
        return next;
      });
    }, 1000);

    try {
      const video = await cameraRef.current.recordAsync({
        mute: false,
      });

      if (video && video.uri) {
        const normalizedDuration = normalizeDurationMs(video.duration);
        const reachedMaxDuration =
          recordingReachedLimitRef.current ||
          typeof normalizedDuration === "number" &&
          normalizedDuration >= MAX_EVENT_VIDEO_SECONDS * 1000 - 1000;

        if (reachedMaxDuration) {
          commitRecordedVideo(video.uri, normalizedDuration);
        } else {
          setPendingVideoUri(video.uri);
          setVideoDurationMs(normalizedDuration);
        }
      }
    } catch (error) {
      logger.error("Recording error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to record video. Please try again.";
      Alert.alert("Recording Error", errorMessage);
    } finally {
      recordingReachedLimitRef.current = false;
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const handleStopRecording = async () => {
    if (!cameraRef.current || !isRecording) return;

    try {
      recordingReachedLimitRef.current = false;
      cameraRef.current.stopRecording();

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      setIsRecording(false);
    } catch (error) {
      logger.error("Stop recording error:", error);
      Alert.alert("Recording Error", "Failed to stop recording. Please try again.");
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const handleSaveVideo = () => {
    if (pendingVideoUri) {
      commitRecordedVideo(pendingVideoUri, videoDurationMs);
    }
  };

  const handleDiscardVideo = () => {
    setPendingVideoUri(null);
    setIsRecording(false);
    setRecordingDuration(0);
  };

  const handlePickVideo = async () => {
    if (isReopeningTrimPicker || isPickingVideo) {
      return;
    }

    setGalleryLoadingMessage("Opening gallery...");
    setIsPickingVideo(true);

    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert("Permission Required", "Media library permission is required to select videos.");
        return;
      }

      const pickAndValidate = async (enforceTrim: boolean) => {
        setIsReopeningTrimPicker(enforceTrim);
        setGalleryLoadingMessage("Opening gallery...");
        const mediaTypes = getVideoPickerMediaTypes();
        const result = await ImagePicker.launchImageLibraryAsync({
          ...(mediaTypes != null ? { mediaTypes } : {}),
          ...(Platform.OS === "android" ? { legacy: true } : {}),
          allowsEditing: enforceTrim,
          allowsMultipleSelection: false,
          selectionLimit: 1,
          videoMaxDuration: MAX_EVENT_VIDEO_SECONDS,
          quality: 0.8,
        });

        setIsReopeningTrimPicker(false);

        if (result.canceled || !result.assets || result.assets.length === 0) {
          return;
        }

        const selected = result.assets[0];
        setGalleryLoadingMessage("Fetching video from gallery to show...");
        if (!selected?.uri) {
          Alert.alert("Selection Error", "Could not read the selected video. Please try another video.");
          return;
        }

        const selectedDuration = normalizeDurationMs(selected.duration);

        if (isVideoTooLong(selectedDuration)) {
          Alert.alert(
            "Trim Required",
            "This video is longer than 60 seconds. Please edit and trim it before upload.",
            [
              {
                text: "Edit & Trim",
                onPress: () => {
                  setIsReopeningTrimPicker(true);
                  setTimeout(() => {
                    void pickAndValidate(true);
                  }, 350);
                },
              },
              { text: "Choose Another", style: "cancel" },
            ]
          );
          return;
        }

        setVideoUri(selected.uri);
        setVideoDurationMs(selectedDuration);
        setThumbnailUri(await generateEventThumbnail(selected.uri));
      };

      await pickAndValidate(false);
    } catch (error) {
      logger.error("Video picker error:", error);
      Alert.alert("Selection Error", "Could not open your gallery. Please try again.");
      setIsReopeningTrimPicker(false);
    } finally {
      setIsPickingVideo(false);
      setGalleryLoadingMessage("Opening gallery...");
    }
  };

  const applyVideoEdit = async (
    label: string,
    editAction: (sourceUri: string) => Promise<string>,
    nextDurationMs?: number
  ) => {
    if (!videoUri) {
      Alert.alert("Missing Video", "Please select a video first.");
      return;
    }

    if (Platform.OS === "web" || !videoEditService.isSupported()) {
      Alert.alert(
        "Editing Not Available",
        "Trim, flip, frame, and effects require a native build with FFmpeg support."
      );
      return;
    }

    try {
      setIsEditingVideo(true);
      const editedUri = await editAction(videoUri);
      setVideoUri(editedUri);
      if (typeof nextDurationMs === "number") {
        setVideoDurationMs(nextDurationMs);
      }
      Alert.alert("Video Updated", `${label} applied successfully.`);
    } catch (error) {
      logger.error(`${label} failed`, error);
      Alert.alert("Edit Failed", "Could not apply that edit. Please try another option.");
    } finally {
      setIsEditingVideo(false);
    }
  };

  const handleTrimVideo = () => {
    if (!videoUri) {
      Alert.alert("Missing Video", "Please select a video first.");
      return;
    }

    if (Platform.OS === "web" || !videoEditService.isSupported()) {
      Alert.alert(
        "Editing Not Available",
        "Trim, flip, frame, and effects require a native build with FFmpeg support."
      );
      return;
    }

    setTrimEndSeconds(Math.max(MIN_EVENT_VIDEO_SECONDS, Math.min(currentDurationSeconds, MAX_EVENT_VIDEO_SECONDS)));
    setActiveEditPanel("trim");
  };

  const handleApplyTrimSelection = () => {
    const seconds = Math.max(MIN_EVENT_VIDEO_SECONDS, Math.min(currentDurationSeconds, trimEndSeconds));
    setActiveEditPanel(null);
    void applyVideoEdit(`Trim to ${seconds}s`, (uri) => videoEditService.trimVideo(uri, seconds), seconds * 1000);
  };

  const handleFlipVideo = () => {
    Alert.alert("Flip Video", "Choose how to flip the video.", [
      {
        text: "Horizontal",
        onPress: () => {
          void applyVideoEdit("Horizontal flip", (uri) => videoEditService.flipVideo(uri, "horizontal"));
        },
      },
      {
        text: "Vertical",
        onPress: () => {
          void applyVideoEdit("Vertical flip", (uri) => videoEditService.flipVideo(uri, "vertical"));
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleAddFrame = () => {
    if (!videoUri) {
      Alert.alert("Missing Video", "Please select a video first.");
      return;
    }

    if (Platform.OS === "web" || !videoEditService.isSupported()) {
      Alert.alert(
        "Editing Not Available",
        "Trim, flip, frame, and effects require a native build with FFmpeg support."
      );
      return;
    }

    setActiveEditPanel("frame");
  };

  const handleApplyFrameStyle = (style: FrameStyle, label: string) => {
    setActiveEditPanel(null);
    void applyVideoEdit(`${label} frame`, (uri) => videoEditService.addFrame(uri, style));
  };

  const handleApplyEffect = () => {
    if (!videoUri) {
      Alert.alert("Missing Video", "Please select a video first.");
      return;
    }

    if (Platform.OS === "web" || !videoEditService.isSupported()) {
      Alert.alert(
        "Editing Not Available",
        "Trim, flip, frame, and effects require a native build with FFmpeg support."
      );
      return;
    }

    setActiveEditPanel("effects");
  };

  const handleApplyEffectStyle = (style: EffectStyle, label: string) => {
    setActiveEditPanel(null);
    void applyVideoEdit(`${label} effect`, (uri) => videoEditService.applyEffect(uri, style));
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !eventTags.includes(tagInput.trim())) {
      setEventTags([...eventTags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setEventTags(eventTags.filter((t) => t !== tag));
  };

  const handleUserTagSelected = (u: User) => {
    if (!eventTags.includes(`@${u.username}`)) {
      setEventTags([...eventTags, `@${u.username}`]);
    }
    setShowTagModal(false);
  };

  const handleUseCurrentLocation = async () => {
    setIsResolvingLocation(true);
    try {
      const location = await getCurrentLocation();
      if (location) {
        const geocode = await Location.reverseGeocodeAsync({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });

        if (geocode && geocode.length > 0) {
          const address = geocode[0];
          const locationName = [address.name, address.street, address.city, address.region, address.country]
            .filter(Boolean)
            .join(", ");

          setEventLocation({
            name: locationName,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            city: address.city || address.region || "",
            country: address.country || "",
          });
        } else {
          setEventLocation({
            name: `${location.coords.latitude.toFixed(6)}, ${location.coords.longitude.toFixed(6)}`,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            city: "",
            country: "",
          });
        }
      } else {
        Alert.alert("Location unavailable", "Allow location access in Settings, or search for and select the venue on the map.");
      }
    } catch (error) {
      logger.error("Current location lookup failed:", error);
      Alert.alert("Location Error", "Could not fetch your current location. Please try again.");
    } finally {
      setIsResolvingLocation(false);
    }
  };

  // ✅ Open map and tell it to return to /upload
  const handleOpenMap = () => {
    setIsResolvingLocation(true);
    const coordinates = venueCoordinates(eventLocation);
    router.push({ pathname: "/location", params: {
      from: "/(tabs)/upload",
      initialName: eventLocation.name || "",
      ...(coordinates ? { initialLatitude: String(coordinates.latitude), initialLongitude: String(coordinates.longitude) } : {}),
      initialCity: eventLocation.city || "",
      initialCountry: eventLocation.country || "",
    } });
  };

  const formatDateForInput = (date: Date): string => {
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${mo}-${d} ${h}:${mi}`;
  };

  const parseEventDate = (text: string): Date | null => {
    if (!text.trim()) return null;
    const d = new Date(text.trim());
    return isNaN(d.getTime()) ? null : d;
  };

  const formatPickerDateLabel = (date: Date | null) => {
    if (!date) return "Select date";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatPickerTimeLabel = (date: Date | null) => {
    if (!date) return "Select time";
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const mergeDatePart = (baseDate: Date, selectedDate: Date) => {
    const nextDate = new Date(baseDate);
    nextDate.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    return nextDate;
  };

  const mergeTimePart = (baseDate: Date, selectedTime: Date) => {
    const nextDate = new Date(baseDate);
    nextDate.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
    return nextDate;
  };

  const getCurrentMinimumStartDate = () => {
    const now = new Date();
    now.setSeconds(0, 0);
    return now;
  };

  const getMinimumEndDate = (startDate: Date) => new Date(startDate.getTime() + MIN_EVENT_END_OFFSET_MS);

  const getDefaultEndDate = (startDate: Date) => new Date(startDate.getTime() + DEFAULT_EVENT_DURATION_MS);

  const normalizeStartDate = (candidate: Date) => {
    const minimumStart = getCurrentMinimumStartDate();
    return candidate.getTime() < minimumStart.getTime() ? minimumStart : candidate;
  };

  const normalizeEndDate = (candidate: Date, startDate: Date) => {
    const minimumEnd = getMinimumEndDate(startDate);
    return candidate.getTime() < minimumEnd.getTime() ? minimumEnd : candidate;
  };

  const applyStartDate = (nextDate: Date) => {
    const normalizedStart = normalizeStartDate(nextDate);

    setEventDate(normalizedStart);
    setStartDateText(formatDateForInput(normalizedStart));

    const nextEndDate = !eventEndDate || eventEndDate.getTime() <= normalizedStart.getTime()
      ? getDefaultEndDate(normalizedStart)
      : normalizeEndDate(eventEndDate, normalizedStart);

    setEventEndDate(nextEndDate);
    setEndDateText(formatDateForInput(nextEndDate));
  };

  const applyEndDate = (nextDate: Date) => {
    const normalizedEnd = normalizeEndDate(nextDate, eventDate);
    setEventEndDate(normalizedEnd);
    setEndDateText(formatDateForInput(normalizedEnd));

    if (normalizedEnd.getTime() !== nextDate.getTime()) {
      Alert.alert("Invalid End Time", "End date and time must be after the start date and time.");
    }
  };

  const applyCurrentPicker = (type: "start-date" | "start-time" | "end-date" | "end-time", value: Date) => {
    if (type === "start-date") {
      applyStartDate(mergeDatePart(eventDate, value));
    } else if (type === "start-time") {
      applyStartDate(mergeTimePart(eventDate, value));
    } else if (type === "end-date") {
      applyEndDate(mergeDatePart(eventEndDate || eventDate, value));
    } else if (type === "end-time") {
      applyEndDate(mergeTimePart(eventEndDate || eventDate, value));
    }
  };

  const handleDateTimePickerChange = (event: any, selectedValue?: Date) => {
    if (!activeDatePicker) {
      return;
    }

    const resolvedSelectedValue =
      selectedValue ??
      (typeof event?.nativeEvent?.timestamp === "number" ? new Date(event.nativeEvent.timestamp) : undefined);

    if (resolvedSelectedValue) {
      pickerTempValueRef.current = resolvedSelectedValue;
    }
  };

  const handlePickerDone = () => {
    if (activeDatePicker) {
      applyCurrentPicker(activeDatePicker, pickerTempValueRef.current);
    }
    setActiveDatePicker(null);
  };

  const handlePickerCancel = () => {
    setActiveDatePicker(null);
  };

  const openDateTimePicker = (pickerType: "start-date" | "start-time" | "end-date" | "end-time") => {
    const initVal =
      pickerType === "start-date" || pickerType === "start-time"
        ? eventDate
        : eventEndDate || getDefaultEndDate(eventDate);

    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: initVal,
        mode: pickerType.endsWith("date") ? "date" : "time",
        is24Hour: false,
        minimumDate:
          pickerType === "start-date"
            ? getCurrentMinimumStartDate()
            : pickerType === "end-date"
            ? getMinimumEndDate(eventDate)
            : undefined,
        onChange: (event, selectedValue) => {
          const resolvedSelectedValue =
            selectedValue ??
            (typeof event?.nativeEvent?.timestamp === "number"
              ? new Date(event.nativeEvent.timestamp)
              : undefined);

          if (event.type !== "dismissed" && resolvedSelectedValue) {
            applyCurrentPicker(pickerType, resolvedSelectedValue);
          }
        },
      });
      return;
    }

    if (activeDatePicker === pickerType) {
      setActiveDatePicker(null);
      return;
    }
    pickerTempValueRef.current = initVal;
    setPickerInitialValue(initVal);
    setActiveDatePicker(pickerType);
  };

  const handleOpenOfferingModal = (type: 'ticket' | 'drink' | 'other') => {
    setCurrentOfferingType(type);
    setEditingProductIndex(null);
    setEditingProduct(null);
    setShowProductModal(true);
  };

  const handleProductSaved = (product: { name: string; price: number; available_quantity: number; image?: string; currency?: string }) => {
    const typeMap: Record<'ticket' | 'drink' | 'other', 'ticket' | 'drink' | 'reservation'> = {
      ticket: 'ticket',
      drink: 'drink',
      other: 'reservation',
    };
    const eventProduct = {
      name: product.name,
      description: "",
      price: product.price,
      image: product.image || "",
      type: typeMap[currentOfferingType],
      available: product.available_quantity,
      currency: product.currency || businessDefaultCurrency,
    };

    setEventProducts((prev) => {
      if (editingProductIndex == null) {
        return [...prev, eventProduct];
      }

      return prev.map((item, index) => (index === editingProductIndex ? eventProduct : item));
    });

    setEditingProductIndex(null);
    setEditingProduct(null);
    setShowProductModal(false);
  };

  const handleEditProduct = (productIndex: number) => {
    const product = eventProducts[productIndex];
    if (!product) return;

    const productOfferingType: 'ticket' | 'drink' | 'other' =
      product.type === 'drink' ? 'drink' : product.type === 'ticket' ? 'ticket' : 'other';

    setCurrentOfferingType(productOfferingType);
    setEditingProductIndex(productIndex);
    setEditingProduct({
      name: product.name,
      price: product.price,
      available_quantity: product.available,
      image: product.image || undefined,
      currency: product.currency,
      type: product.type,
    });
    setShowProductModal(true);
  };

  const resetCamera = () => {
    setActiveEditPanel(null);
    setVideoUri(null);
    setThumbnailUri(null);
    setPendingVideoUri(null);
    setRecordingDuration(0);
    setIsRecording(false);
    setCameraReady(false);
    setShowFullScreenCamera(false);
    setCameraKey((prev) => prev + 1);

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const handleOpenFullScreenCamera = () => setShowFullScreenCamera(true);

  const clearUploadDraft = () => {
    resetCamera();
    setEventName("");
    setEventDescription("");
    setEventDate(new Date());
    setEventEndDate(null);
    setStartDateText("");
    setEndDateText("");
    setVideoDurationMs(null);
    setEventLocation({ name: "", latitude: null, longitude: null, city: "", country: "" });
    setEventTags([]);
    setEventProducts([]);
    setUploadProgress(0);
    setUploadStatus("uploading");
    setIsUploading(false);
  };

  const startFloatingProgressTimer = (taskId: string) => {
    const timer = setInterval(() => {
      const store = useUploadTaskStore.getState();
      if (store.taskId !== taskId || store.status === "success" || store.status === "error") {
        clearInterval(timer);
        return;
      }

      const ceiling = store.status === "processing" ? 92 : 68;
      const nextProgress = Math.min(store.progress + Math.random() * 7, ceiling);
      store.updateTask(taskId, { progress: nextProgress });
    }, 550);

    return () => clearInterval(timer);
  };

  const withUploadTimeout = async <T,>(promise: Promise<T>) => {
    return await new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Upload timed out. Please upload again."));
      }, UPLOAD_ATTEMPT_TIMEOUT_MS);

      promise
        .then((value) => {
          clearTimeout(timeoutId);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  };

  const getUploadFailureMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    if (lower.includes("unable to read media") || lower.includes("selected video file")) {
      return "The selected video could not be read. Upload again.";
    }

    if (lower.includes("timed out")) {
      return "Upload timed out. Upload again.";
    }

    return "Upload failed after 4 attempts. Upload again.";
  };

  const handleCloseFullScreenCamera = () => {
    if (pendingVideoUri) {
      Alert.alert("Discard Recording?", "You have an unsaved recording. Do you want to discard it?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            setPendingVideoUri(null);
            setShowFullScreenCamera(false);
            setIsRecording(false);
            setRecordingDuration(0);
            setCameraReady(false);
            if (recordingTimerRef.current) {
              clearInterval(recordingTimerRef.current);
              recordingTimerRef.current = null;
            }
          },
        },
      ]);
    } else {
      setShowFullScreenCamera(false);
      setIsRecording(false);
      setRecordingDuration(0);
      setCameraReady(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const performUpload = async () => {
    if (uploadLaunchLockRef.current) {
      return;
    }

    if (!videoUri) {
      Alert.alert("Missing Video", "Please record or select a video first");
      return;
    }

    if (isVideoTooShort(videoDurationMs)) {
      Alert.alert("Video Too Short", `Videos must be at least ${MIN_EVENT_VIDEO_SECONDS} seconds long.`);
      return;
    }

    if (isVideoTooLong(videoDurationMs)) {
      Alert.alert("Video Too Long", `Only videos up to ${MAX_EVENT_VIDEO_SECONDS} seconds are allowed.`);
      return;
    }

    if (!eventLocation.name) {
      Alert.alert("Missing Location", "Please set an event location");
      return;
    }
    if (!venueCoordinates(eventLocation)) {
      Alert.alert("Select Venue Location", "Select the exact venue on the map or use your current location before uploading.");
      return;
    }


    const resolvedTitle = eventName.trim() || buildFallbackEventTitle();
    const minimumStart = getCurrentMinimumStartDate();
    const resolvedStartDate = eventDate.getTime() < minimumStart.getTime() ? minimumStart : eventDate;
    const resolvedEndDate = eventEndDate && eventEndDate.getTime() > resolvedStartDate.getTime()
      ? eventEndDate
      : getDefaultEndDate(resolvedStartDate);

    if (resolvedStartDate.getTime() !== eventDate.getTime()) {
      applyStartDate(resolvedStartDate);
    }

    if (!eventEndDate || resolvedEndDate.getTime() !== eventEndDate.getTime()) {
      applyEndDate(resolvedEndDate);
    }

    if (!authUser || !user) {
      Alert.alert("Authentication Error", "You must be logged in to upload videos");
      return;
    }

    const {
      data: { user: currentUser },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !currentUser) {
      logger.error("Authentication error:", userError);
      Alert.alert("Authentication Error", "Please log in to upload videos");
      return;
    }

    if (isEditMode && editVideoId) {
      setIsUploading(true);
      setUploadProgress(50);
      setUploadStatus("processing");

      try {
        const hashtags = eventTags.filter((tag) => !tag.startsWith("@"));

        await videoService.updateVideo(editVideoId, {
          title: resolvedTitle,
          description: eventDescription.trim(),
          location_name: eventLocation.name,
          location_city: eventLocation.city || "",
          location_country: eventLocation.country || "",
          location_coordinates:
            venueCoordinates(eventLocation)
              ? `POINT(${eventLocation.longitude} ${eventLocation.latitude})`
              : undefined,
          event_name: resolvedTitle,
          event_date: resolvedStartDate.toISOString(),
          hashtags,
        });

        const { error: eventUpdateError } = await supabase
          .from("events")
          .update({
            event_name: resolvedTitle,
            description: eventDescription.trim() || "Event created with video",
            start_date: resolvedStartDate.toISOString(),
            end_date: resolvedEndDate.toISOString(),
            location_name: eventLocation.name,
            location_city: eventLocation.city || "",
            location_country: eventLocation.country || "",
            location_latitude: eventLocation.latitude ?? null,
            location_longitude: eventLocation.longitude ?? null,
            hashtags,
            updated_at: new Date().toISOString(),
          })
          .eq("video_id", editVideoId)
          .eq("user_id", currentUser.id);

        if (eventUpdateError) {
          logger.warn("Linked event update failed:", eventUpdateError);
        }

        await fetchVideos();

        setUploadProgress(100);
        setUploadStatus("complete");

        Alert.alert("Success", "Video updated successfully.", [
          {
            text: "OK",
            onPress: () => {
              setIsUploading(false);
              setUploadProgress(0);
              router.push("/profile");
            },
          },
        ]);
      } catch (error) {
        logger.error("Video update failed:", error);
        setIsUploading(false);
        setUploadStatus("error");
        setUploadProgress(0);
        Alert.alert("Update Failed", "Could not update this video. Please try again.");
      }

      return;
    }

    const eventCurrency = resolveEventCurrency(eventProducts, businessDefaultCurrency);
    const uploadSnapshot = {
      currency: eventCurrency,
      currentUserId: currentUser.id,
      videoUri,
      durationMs: videoDurationMs,
      thumbnailUri,
      resolvedTitle,
      resolvedStartDate: new Date(resolvedStartDate),
      resolvedEndDate: new Date(resolvedEndDate),
      description: eventDescription.trim(),
      location: { ...eventLocation },
      tags: [...eventTags],
      products: eventProducts.map((product) => ({ ...product, currency: product.currency?.trim().toUpperCase() || eventCurrency })),
      profile: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
        user_type: user.user_type,
        followers_count: user.followers_count,
        following_count: user.following_count,
        bio: user.bio,
        business_name: user.business_name,
        business_type: user.business_type,
      },
    };

    const startManagedUpload = async (initialNetworkHint: UploadNetworkHint = "unknown") => {
      const taskId = useUploadTaskStore.getState().startTask({
        title: "Uploading Event",
        message: getUploadNetworkTaskMessage(initialNetworkHint, 1, MAX_UPLOAD_ATTEMPTS),
        maxAttempts: MAX_UPLOAD_ATTEMPTS,
        retryAction: () => startManagedUpload(initialNetworkHint),
      });

      for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
        const stopProgressTimer = startFloatingProgressTimer(taskId);
        const networkAssessment = await assessUploadNetwork();
        const networkHint = networkAssessment.hint;

        useUploadTaskStore.getState().updateTask(taskId, {
          attempt,
          status: "uploading",
          progress: 4,
          message: getUploadNetworkTaskMessage(networkHint, attempt, MAX_UPLOAD_ATTEMPTS),
        });

        if (networkHint === "offline") {
          stopProgressTimer();
          if (attempt < MAX_UPLOAD_ATTEMPTS) {
            continue;
          }

          const offlineMessage = "No internet connection. Reconnect and try upload again.";
          useUploadTaskStore.getState().markError(taskId, {
            message: offlineMessage,
            retryAction: () => startManagedUpload("unknown"),
          });
          Alert.alert("Upload Paused", offlineMessage);
          return;
        }

        try {
          await withUploadTimeout(
            (async () => {
              useUploadTaskStore.getState().updateTask(taskId, {
                status: "uploading",
                progress: 12,
                message: "Optimizing your video for faster upload...",
              });

              const preparedUpload = await videoEditService.compressForUpload(uploadSnapshot.videoUri, {
                durationMs: uploadSnapshot.durationMs,
                maxDimension: 720,
              });
              const uploadSourceUri = preparedUpload.uri;

              logger.debug("[Upload] Prepared video for upload:", {
                originalSizeBytes: preparedUpload.originalSizeBytes,
                outputSizeBytes: preparedUpload.outputSizeBytes,
                didCompress: preparedUpload.didCompress,
              });

              useUploadTaskStore.getState().updateTask(taskId, {
                status: "uploading",
                progress: preparedUpload.didCompress ? 24 : 18,
                message: preparedUpload.didCompress
                  ? "Uploading optimized video..."
                  : "Uploading your video...",
              });

              const { arrayBuffer, extension: fileExt } = await readUriAsArrayBuffer(uploadSourceUri, {
                allowedExtensions: VIDEO_FILE_EXTENSIONS,
                fallbackExtension: "mp4",
              });
              const videoMimeMap: Record<string, string> = {
                mp4: "video/mp4",
                mov: "video/quicktime",
                m4v: "video/x-m4v",
                webm: "video/webm",
              };
              const fileName = `${uploadSnapshot.currentUserId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

              const contentType = videoMimeMap[fileExt] || "video/mp4";
              const uploadResult = await storageService.uploadVideo(arrayBuffer, fileName, contentType);
              const videoUrl = await storageService.getVideoUrl(uploadResult.path);

              const effectiveThumbnailUri =
                uploadSnapshot.thumbnailUri || (await generateEventThumbnail(uploadSourceUri));
              let thumbnailUrl: string | undefined;
              if (effectiveThumbnailUri) {
                const { arrayBuffer: thumbnailBuffer, extension: thumbnailExtension } = await readUriAsArrayBuffer(
                  effectiveThumbnailUri,
                  { allowedExtensions: IMAGE_FILE_EXTENSIONS, fallbackExtension: "jpg" }
                );
                const thumbnailPath = `thumbnails/${uploadSnapshot.currentUserId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${thumbnailExtension}`;
                const thumbnailUpload = await storageService.uploadImage(thumbnailBuffer, thumbnailPath, "image/jpeg", "images");
                thumbnailUrl = await storageService.getImageUrl(thumbnailUpload.path, "images");
              }

              useUploadTaskStore.getState().updateTask(taskId, {
                status: "processing",
                progress: 58,
                message: "Finalizing your event...",
              });

              const videoData = {
                user_id: uploadSnapshot.currentUserId,
                video_url: videoUrl,
                thumbnail_url: thumbnailUrl,
                title: uploadSnapshot.resolvedTitle,
                description: uploadSnapshot.description,
                location_name: uploadSnapshot.location.name,
                location_city: uploadSnapshot.location.city || "",
                location_country: uploadSnapshot.location.country || "",
                location_coordinates:
                  venueCoordinates(uploadSnapshot.location)
                    ? `POINT(${uploadSnapshot.location.longitude} ${uploadSnapshot.location.latitude})`
                    : undefined,
                event_name: uploadSnapshot.resolvedTitle,
                event_date: uploadSnapshot.resolvedStartDate.toISOString(),
                hashtags: uploadSnapshot.tags.filter((tag) => !tag.startsWith("@")),
              };

              const newVideo = await videoService.uploadVideo(videoData);

              if (!newVideo || !newVideo.id) {
                throw new Error("Failed to create video: No video ID returned");
              }

              startVideoWatermarkAfterUpload({
                videoId: newVideo.id,
                userId: uploadSnapshot.currentUserId,
                localSourceUri: uploadSourceUri,
                username: uploadSnapshot.profile.username,
              });

              const eventData = {
                user_id: uploadSnapshot.currentUserId,
                event_name: uploadSnapshot.resolvedTitle,
                description: uploadSnapshot.description || "Event created with video",
                start_date: uploadSnapshot.resolvedStartDate.toISOString(),
                end_date: uploadSnapshot.resolvedEndDate.toISOString(),
                location_name: uploadSnapshot.location.name || "Location not specified",
                location_city: uploadSnapshot.location.city || "",
                location_latitude: uploadSnapshot.location.latitude ?? null,
                location_longitude: uploadSnapshot.location.longitude ?? null,
                max_attendees: 100,
                current_attendees: 0,
                ticket_price: 0,
                currency: uploadSnapshot.currency,
                image_url: thumbnailUrl,
                category: "General",
                hashtags: uploadSnapshot.tags.filter((tag) => !tag.startsWith("@")) || [],
                is_public: true,
                status: "published" as const,
                video_id: newVideo.id,
                business_id: uploadSnapshot.profile.user_type === "business" ? uploadSnapshot.currentUserId : undefined,
              };

              let newEvent: any;
              try {
                newEvent = await eventService.createEvent(eventData);
                if (!newEvent || !newEvent.id) throw new Error("No event ID returned");
              } catch (eventError) {
                logger.error("Event creation failed:", eventError);
                newEvent = { id: "temp-event-id" };
              }

              if (uploadSnapshot.products.length > 0 && newEvent.id !== "temp-event-id") {
                try {
                  for (const product of uploadSnapshot.products) {
                    let imageUrl = product.image;

                    if (product.image) {
                      try {
                        const { arrayBuffer: imgBuffer, extension: fileExtImg } = await readUriAsArrayBuffer(product.image, {
                          allowedExtensions: IMAGE_FILE_EXTENSIONS,
                          fallbackExtension: "jpg",
                        });
                        const fileNameImg = `products/${uploadSnapshot.currentUserId}/${Date.now()}_${product.name.replace(
                          /[^a-zA-Z0-9]/g,
                          "_"
                        )}.${fileExtImg}`;

                        const imageMimeMap: Record<string, string> = {
                          jpg: "image/jpeg",
                          jpeg: "image/jpeg",
                          png: "image/png",
                          webp: "image/webp",
                          heic: "image/heic",
                        };

                        const uploadImg = await storageService.uploadImage(
                          imgBuffer,
                          fileNameImg,
                          imageMimeMap[fileExtImg] || "image/jpeg",
                          "images"
                        );

                        imageUrl = await storageService.getImageUrl(uploadImg.path, "images");
                      } catch {
                        imageUrl = "";
                      }
                    }

                    const productData = {
                      event_id: newEvent.id,
                      business_id: uploadSnapshot.currentUserId,
                      name: product.name,
                      description: product.description,
                      price: product.price,
                      currency: product.currency || uploadSnapshot.currency,
                      type: product.type,
                      available_quantity: product.available,
                      image_url: imageUrl,
                    };

                    const newProduct = await productService.createProduct(productData);
                    addProduct({
                      ...product,
                      id: newProduct.id,
                      videoId: newVideo.id,
                      image: imageUrl,
                      createdAt: newProduct.created_at,
                    });
                  }
                } catch (productError) {
                  logger.warn("Product creation warning after successful upload:", productError);
                }
              }

              const localVideo: Video = {
                id: newVideo.id,
                eventId: newEvent.id !== "temp-event-id" ? newEvent.id : undefined,
                userId: uploadSnapshot.currentUserId,
                user: {
                  id: uploadSnapshot.profile.id,
                  username: uploadSnapshot.profile.username,
                  name: uploadSnapshot.profile.full_name,
                  avatar:
                    uploadSnapshot.profile.avatar_url ||
                    '',
                  isBusinessAccount: uploadSnapshot.profile.user_type === "business",
                  followers: uploadSnapshot.profile.followers_count,
                  following: uploadSnapshot.profile.following_count,
                  bio: uploadSnapshot.profile.bio,
                  businessName: uploadSnapshot.profile.business_name,
                  businessType: uploadSnapshot.profile.business_type,
                },
                url: videoUrl,
                thumbnail:
                  thumbnailUrl || effectiveThumbnailUri || "",
                eventName: uploadSnapshot.resolvedTitle,
                description: uploadSnapshot.description,
                location: uploadSnapshot.location,
                eventDate: uploadSnapshot.resolvedStartDate.toISOString(),
                hashtags: uploadSnapshot.tags.filter((tag) => !tag.startsWith("@")),
                likes: newVideo.likes_count,
                comments: newVideo.comments_count,
                shares: newVideo.shares_count,
                rating: newVideo.rating,
                ratingCount: newVideo.rating_count,
                attendeeCount: 0,
                createdAt: newVideo.created_at,
              };

              uploadVideo(localVideo);

              useUploadTaskStore.getState().markSuccess(
                taskId,
                newEvent.id !== "temp-event-id" ? "Event uploaded successfully." : "Video uploaded. Event record needs review."
              );
            })()
          );

          stopProgressTimer();
          return;
        } catch (error) {
          stopProgressTimer();
          logger.error(`Upload attempt ${attempt} failed:`, error);

          const failureText = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (failureText.includes("timed out")) {
            useUploadTaskStore.getState().markError(taskId, {
              message: getUploadFailureMessage(error),
              retryAction: startManagedUpload,
            });
            Alert.alert("Upload Failed", getUploadFailureMessage(error));
            return;
          }

          if (attempt < MAX_UPLOAD_ATTEMPTS) {
            useUploadTaskStore.getState().updateTask(taskId, {
              status: "uploading",
              progress: 6,
              message: `Retrying upload (${attempt + 1}/${MAX_UPLOAD_ATTEMPTS})...`,
            });
            continue;
          }

          useUploadTaskStore.getState().markError(taskId, {
            message: getUploadFailureMessage(error),
            retryAction: startManagedUpload,
          });
          Alert.alert("Upload Failed", getUploadFailureMessage(error));
          return;
        }
      }
    };

    const launchManagedUpload = (initialHint: UploadNetworkHint) => {
      clearUploadDraft();
      router.replace("/(tabs)");

      void startManagedUpload(initialHint).catch((error) => {
        uploadLaunchLockRef.current = false;
        setIsUploading(false);
        const failureMessage = getUploadFailureMessage(error);
        Alert.alert("Upload Failed", failureMessage);
        useUploadTaskStore.getState().dismissTask();
      }).finally(() => {
        uploadLaunchLockRef.current = false;
        setIsUploading(false);
      });
    };

    uploadLaunchLockRef.current = true;
    setIsUploading(true);

    const preflightNetwork = await assessUploadNetwork();
    if (preflightNetwork.hint === "offline") {
      uploadLaunchLockRef.current = false;
      setIsUploading(false);
      Alert.alert("No Internet Connection", "Reconnect to the internet and try upload again.");
      return;
    }

    if (preflightNetwork.hint === "weak") {
      Alert.alert(
        "Slow Internet Detected",
        "Your upload can continue in the background, but it may take longer than usual.",
        [
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => {
              uploadLaunchLockRef.current = false;
              setIsUploading(false);
            },
          },
          {
            text: "Upload Anyway",
            onPress: () => launchManagedUpload("weak"),
          },
        ]
      );
      return;
    }

    launchManagedUpload(preflightNetwork.hint);
  };

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>We need your permission to use the camera</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleUpload = async () => {
    if (preparingUploadRef.current || uploadLaunchLockRef.current || isUploading) return;
    preparingUploadRef.current = true;
    setIsPreparingUpload(true);
    try {
      await performUpload();
    } catch (error) {
      uploadLaunchLockRef.current = false;
      setIsUploading(false);
      Alert.alert("Upload Failed", getUploadFailureMessage(error));
    } finally {
      preparingUploadRef.current = false;
      setIsPreparingUpload(false);
    }
  };

  if (isLoadingEditPayload) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
        <Text style={styles.loadingText}>Loading video editor...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? Math.max(insets.top + 24, 72) : 0}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 96, 110) }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      >
        {!videoUri ? (
          <View style={styles.mediaSelectionContainer}>
            <View style={styles.mediaSelectionHeader}>
              <Text style={styles.mediaSelectionTitle}>{isEditMode ? "Edit Your Event" : "Create Your Event"}</Text>
              <Text style={styles.mediaSelectionSubtitle}>
                {isEditMode ? "Load a new video or keep the current one" : "Record or select a video (max 60 seconds)"}
              </Text>
            </View>

            <View style={styles.mediaOptionsContainer}>
              <TouchableOpacity
                style={styles.mediaOptionCard}
                onPress={handleOpenFullScreenCamera}
                activeOpacity={0.8}
              >
                <View style={styles.mediaOptionIconContainer}>
                  <View style={styles.cameraIconBackground}>
                    <Camera size={32} color="#fff" />
                  </View>
                </View>
                <Text style={styles.mediaOptionTitle}>Record Video</Text>
                <Text style={styles.mediaOptionDescription}>Capture a new video for your event</Text>
                <View style={styles.mediaOptionBadge}>
                  <Text style={styles.mediaOptionBadgeText}>RECORD</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.mediaOptionCard, isPickingVideo && styles.mediaOptionCardDisabled]}
                onPress={handlePickVideo}
                activeOpacity={0.8}
                disabled={isPickingVideo}
              >
                <View style={styles.mediaOptionIconContainer}>
                  <View style={styles.galleryIconBackground}>
                    <Image
                      source={{
                        uri: "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=100&q=80",
                      }}
                      style={styles.galleryIconImage}
                    />
                    <View style={styles.galleryIconOverlay}>
                      <Text style={styles.galleryIconText}>📁</Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.mediaOptionTitle}>Select from Gallery</Text>
                <Text style={styles.mediaOptionDescription}>Choose an existing video from your device</Text>
                <View style={styles.mediaOptionBadge}>
                  <Text style={styles.mediaOptionBadgeText}>GALLERY</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.mediaSelectionFooter}>
              <View style={styles.mediaSelectionTip}>
                <Text style={styles.mediaSelectionTipIcon}>💡</Text>
                <Text style={styles.mediaSelectionTipText}>
                  
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.previewContainer}>
            <ExpoVideo source={{ uri: videoUri }} style={styles.videoPreview} useNativeControls resizeMode={ResizeMode.CONTAIN} />

            {formatDurationLabel(videoDurationMs) ? (
              <View style={[styles.videoDurationBadge, { top: Math.max(insets.top + 52, 68) }]}>
                <Clock size={14} color="#fff" />
                <Text style={styles.videoDurationBadgeText}>{formatDurationLabel(videoDurationMs)}</Text>
              </View>
            ) : null}


            <TouchableOpacity style={[styles.resetButton, { top: Math.max(insets.top + 52, 68) }]} onPress={resetCamera}>
              <X size={20} color="#fff" />
            </TouchableOpacity>

            <View style={styles.videoEditToolbar}>
              <TouchableOpacity style={styles.videoEditButton} onPress={handleTrimVideo} disabled={isEditingVideo}>
                <Text style={styles.videoEditButtonText}>Trim</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.videoEditButton} onPress={handleFlipVideo} disabled={isEditingVideo}>
                <Text style={styles.videoEditButtonText}>Flip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.videoEditButton} onPress={handleAddFrame} disabled={isEditingVideo}>
                <Text style={styles.videoEditButtonText}>Frame</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.videoEditButton} onPress={handleApplyEffect} disabled={isEditingVideo}>
                <Text style={styles.videoEditButtonText}>Effects</Text>
              </TouchableOpacity>
            </View>

            {activeEditPanel === "trim" ? (
              <View style={styles.videoEditPanel}>
                <View style={styles.videoEditPanelHeader}>
                  <Text style={styles.videoEditPanelTitle}>Trim Video</Text>
                  <TouchableOpacity onPress={() => setActiveEditPanel(null)}>
                    <X size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.videoEditPanelSubtext}>Drag the handle to pick the final duration.</Text>
                <View
                  style={styles.trimTrackContainer}
                  onLayout={(event) => setTrimTrackWidth(event.nativeEvent.layout.width)}
                >
                  <View style={styles.trimTrackBase} />
                  <View style={[styles.trimTrackActive, { width: `${Math.max(0, Math.min(1, trimProgressRatio)) * 100}%` }]} />
                  <View
                    style={[styles.trimHandle, { left: `${Math.max(0, Math.min(1, trimProgressRatio)) * 100}%` }]}
                    {...trimHandlePanResponder.panHandlers}
                  />
                </View>
                <Text style={styles.trimRangeText}>0s - {trimEndSeconds}s</Text>
                <View style={styles.videoEditPanelActions}>
                  <TouchableOpacity style={styles.videoEditPanelButton} onPress={() => setActiveEditPanel(null)}>
                    <Text style={styles.videoEditPanelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.videoEditPanelButtonPrimary} onPress={handleApplyTrimSelection}>
                    <Text style={styles.videoEditPanelButtonPrimaryText}>Apply</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {activeEditPanel === "frame" ? (
              <View style={styles.videoEditPanel}>
                <View style={styles.videoEditPanelHeader}>
                  <Text style={styles.videoEditPanelTitle}>Add Frame</Text>
                  <TouchableOpacity onPress={() => setActiveEditPanel(null)}>
                    <X size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.videoEditPanelSubtext}>Choose a style and apply it instantly.</Text>
                <View style={styles.frameOptionList}>
                  {FRAME_STYLE_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={styles.frameOptionButton}
                      onPress={() => handleApplyFrameStyle(option.value, option.label)}
                      disabled={isEditingVideo}
                    >
                      <Text style={styles.frameOptionButtonText}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.videoEditPanelActions}>
                  <TouchableOpacity style={styles.videoEditPanelButton} onPress={() => setActiveEditPanel(null)}>
                    <Text style={styles.videoEditPanelButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {activeEditPanel === "effects" ? (
              <View style={styles.videoEditPanel}>
                <View style={styles.videoEditPanelHeader}>
                  <Text style={styles.videoEditPanelTitle}>Video Effects</Text>
                  <TouchableOpacity onPress={() => setActiveEditPanel(null)}>
                    <X size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.videoEditPanelSubtext}>Pick an effect. Faster processing is applied automatically.</Text>
                <View style={styles.frameOptionList}>
                  {EFFECT_STYLE_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={styles.frameOptionButton}
                      onPress={() => handleApplyEffectStyle(option.value, option.label)}
                      disabled={isEditingVideo}
                    >
                      <Text style={styles.frameOptionButtonText}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.videoEditPanelActions}>
                  <TouchableOpacity style={styles.videoEditPanelButton} onPress={() => setActiveEditPanel(null)}>
                    <Text style={styles.videoEditPanelButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {isEditingVideo ? (
              <View style={styles.videoEditingOverlay}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.videoEditingOverlayText}>Applying edit...</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.formContainer}>
          <Text style={styles.formTitle}>Event Details</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Title (Optional)</Text>
            <TextInput
              style={styles.textInput}
              value={eventName}
              onChangeText={setEventName}
              placeholder="Add a title if you want"
              placeholderTextColor={Colors.dark.subtext}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={eventDescription}
              onChangeText={setEventDescription}
              placeholder="Describe your event"
              placeholderTextColor={Colors.dark.subtext}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.inputGroup}>
            <View style={styles.locationLabelRow}>
              <Text style={styles.inputLabel}>Location</Text>
              {isResolvingLocation ? (
                <View style={styles.locationInlineLoader}>
                  <ActivityIndicator size="small" color={Colors.dark.primary} />
                  <Text style={styles.locationInlineLoaderText}>Resolving...</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.locationContainer}>
              <TextInput
                style={[styles.textInput, styles.locationInput]}
                value={eventLocation.name}
                onChangeText={(text) => setEventLocation({ ...eventLocation, name: text, latitude: null, longitude: null })}
                placeholder="Event Location"
                placeholderTextColor={Colors.dark.subtext}
              />

              <View style={styles.locationButtons}>
                <TouchableOpacity
                  style={[styles.locationButton, isResolvingLocation && styles.locationButtonDisabled]}
                  onPress={handleUseCurrentLocation}
                  disabled={isResolvingLocation}
                >
                  {isResolvingLocation ? (
                    <ActivityIndicator size="small" color={Colors.dark.primary} />
                  ) : (
                    <MapPin size={20} color={Colors.dark.primary} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.locationButton, isResolvingLocation && styles.locationButtonDisabled]}
                  onPress={handleOpenMap}
                  disabled={isResolvingLocation}
                >
                  {isResolvingLocation ? (
                    <ActivityIndicator size="small" color={Colors.dark.primary} />
                  ) : (
                    <Map size={20} color={Colors.dark.primary} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Tags</Text>
            <View style={styles.tagsContainer}>
              <View style={styles.tagInputContainer}>
                <TextInput
                  style={[styles.textInput, styles.tagInput]}
                  value={tagInput}
                  onChangeText={setTagInput}
                  placeholder="Add tags"
                  placeholderTextColor={Colors.dark.subtext}
                  onSubmitEditing={handleAddTag}
                />

                <TouchableOpacity style={styles.addTagButton} onPress={handleAddTag}>
                  <Check size={20} color={Colors.dark.text} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.tagUserButton} onPress={() => setShowTagModal(true)}>
                  <Tag size={20} color={Colors.dark.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.tagsList}>
                {eventTags.map((tag, index) => (
                  <View key={index} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                    <TouchableOpacity style={styles.removeTagButton} onPress={() => handleRemoveTag(tag)}>
                      <X size={12} color={Colors.dark.text} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {user?.user_type === "business" && (
            <View style={styles.businessSection}>
              <Text style={styles.businessSectionTitle}>Event Offerings</Text>
              <Text style={styles.businessSectionSubtitle}>Add tickets, drinks, and other offers for attendees to purchase</Text>

              {/* Tickets */}
              <View style={styles.offeringCategory}>
                <View style={styles.offeringCategoryHeader}>
                  <Text style={styles.offeringCategoryTitle}>🎫 Tickets</Text>
                  <TouchableOpacity style={styles.offeringAddButton} onPress={() => handleOpenOfferingModal('ticket')}>
                    <Plus size={16} color={Colors.dark.primary} />
                    <Text style={styles.offeringAddText}>Add Ticket</Text>
                  </TouchableOpacity>
                </View>
                {eventProducts.filter(p => p.type === 'ticket').map((product, idx) => {
                  const globalIdx = eventProducts.indexOf(product);
                  return (
                    <View key={idx} style={styles.productItem}>
                      {product.image ? <Image source={{ uri: product.image }} style={styles.productPreviewImage} /> : null}
                      <View style={styles.productInfo}>
                        <Text style={styles.productName}>{product.name}</Text>
                        <Text style={styles.productPrice}>{`${product.currency || businessDefaultCurrency} ${product.price}`} / ticket</Text>
                        <Text style={styles.productQuantity}>Qty available: {product.available}</Text>
                      </View>
                      <View style={styles.productActionButtons}>
                        <TouchableOpacity style={styles.editProductButton} onPress={() => handleEditProduct(globalIdx)}>
                          <Text style={styles.editProductText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.removeProductButton} onPress={() => setEventProducts(prev => prev.filter((_, i) => i !== globalIdx))}>
                          <Text style={styles.removeProductText}>×</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Drinks */}
              <View style={styles.offeringCategory}>
                <View style={styles.offeringCategoryHeader}>
                  <Text style={styles.offeringCategoryTitle}>🍹 Drinks</Text>
                  <TouchableOpacity style={styles.offeringAddButton} onPress={() => handleOpenOfferingModal('drink')}>
                    <Plus size={16} color={Colors.dark.primary} />
                    <Text style={styles.offeringAddText}>Add Drink</Text>
                  </TouchableOpacity>
                </View>
                {eventProducts.filter(p => p.type === 'drink').map((product, idx) => {
                  const globalIdx = eventProducts.indexOf(product);
                  return (
                    <View key={idx} style={styles.productItem}>
                      {product.image ? <Image source={{ uri: product.image }} style={styles.productPreviewImage} /> : null}
                      <View style={styles.productInfo}>
                        <Text style={styles.productName}>{product.name}</Text>
                        <Text style={styles.productPrice}>{`${product.currency || businessDefaultCurrency} ${product.price}`} / item</Text>
                        <Text style={styles.productQuantity}>Qty available: {product.available}</Text>
                      </View>
                      <View style={styles.productActionButtons}>
                        <TouchableOpacity style={styles.editProductButton} onPress={() => handleEditProduct(globalIdx)}>
                          <Text style={styles.editProductText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.removeProductButton} onPress={() => setEventProducts(prev => prev.filter((_, i) => i !== globalIdx))}>
                          <Text style={styles.removeProductText}>×</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Other Offers */}
              <View style={styles.offeringCategory}>
                <View style={styles.offeringCategoryHeader}>
                  <Text style={styles.offeringCategoryTitle}>✨ Other Offers</Text>
                  <TouchableOpacity style={styles.offeringAddButton} onPress={() => handleOpenOfferingModal('other')}>
                    <Plus size={16} color={Colors.dark.primary} />
                    <Text style={styles.offeringAddText}>Add Offer</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.offeringCategoryHint}>Tables, VIP packages, meet & greet — name it freely</Text>
                {eventProducts.filter(p => p.type === 'reservation').map((product, idx) => {
                  const globalIdx = eventProducts.indexOf(product);
                  return (
                    <View key={idx} style={styles.productItem}>
                      {product.image ? <Image source={{ uri: product.image }} style={styles.productPreviewImage} /> : null}
                      <View style={styles.productInfo}>
                        <Text style={styles.productName}>{product.name}</Text>
                        <Text style={styles.productPrice}>{`${product.currency || businessDefaultCurrency} ${product.price}`} / item</Text>
                        <Text style={styles.productQuantity}>Qty available: {product.available}</Text>
                      </View>
                      <View style={styles.productActionButtons}>
                        <TouchableOpacity style={styles.editProductButton} onPress={() => handleEditProduct(globalIdx)}>
                          <Text style={styles.editProductText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.removeProductButton} onPress={() => setEventProducts(prev => prev.filter((_, i) => i !== globalIdx))}>
                          <Text style={styles.removeProductText}>×</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.uploadButton,
              (isUploading || isPreparingUpload) && styles.uploadButtonDisabled,
            ]}
            onPress={handleUpload}
            disabled={isUploading || isPreparingUpload}
            accessibilityRole="button"
            accessibilityState={{ busy: isUploading || isPreparingUpload }}
          >
            <Upload size={20} color="#fff" style={styles.uploadIcon} />
            <Text style={styles.uploadButtonText}>{isPreparingUpload ? "Preparing…" : isUploading ? "Uploading…" : isEditMode ? "Save Changes" : "Upload Event"}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {showTagModal && (
        <UserSearchModal
          visible={showTagModal}
          onClose={() => setShowTagModal(false)}
          onSelectUser={handleUserTagSelected}
          selectedUsers={[]}
        />
      )}

      {showProductModal && (
        <ProductCreationModal
          visible={showProductModal}
          onClose={() => {
            setShowProductModal(false);
            setEditingProductIndex(null);
            setEditingProduct(null);
          }}
          onSave={handleProductSaved}
          offeringType={currentOfferingType}
          defaultCurrency={businessDefaultCurrency}
          initialProduct={editingProduct}
          submitLabel={editingProductIndex != null ? "Update" : "Save"}
        />
      )}

      {showFullScreenCamera && (
        <View style={styles.fullScreenCameraContainer}>
          {Platform.OS !== "web" ? (
            <View style={styles.fullScreenCameraStage}>
              <CameraView
                key={cameraKey}
                ref={cameraRef}
                style={styles.fullScreenCamera}
                facing="back"
                mode="video"
                videoQuality={Platform.OS === "ios" ? "720p" : "480p"}
                onCameraReady={() => setCameraReady(true)}
                onMountError={(event) => {
                  const message =
                    (event as any)?.message ||
                    (event as any)?.nativeEvent?.message ||
                    "Failed to initialize camera.";
                  logger.error("Camera mount error:", message);
                  Alert.alert("Camera Error", message);
                }}
              />

              <View style={styles.cameraOverlayLayer} pointerEvents="box-none">
                {isRecording && (
                  <View style={[styles.timerContainer, { top: Math.max(insets.top + 12, 24) }]}>
                    <View style={styles.timerBackground}>
                      <Clock size={16} color="#fff" />
                      <Text style={styles.timerText}>
                        {Math.floor(recordingDuration / 60).toString().padStart(2, "0")}:
                        {(recordingDuration % 60).toString().padStart(2, "0")}
                      </Text>
                    </View>
                    {recordingDuration < 5 && <Text style={styles.minDurationText}>Record for at least 5 seconds (minimum)</Text>}
                  </View>
                )}

                <View style={[styles.cameraHeader, { paddingTop: Math.max(insets.top + 10, 20) }]}>
                  <TouchableOpacity style={styles.closeCameraButton} onPress={handleCloseFullScreenCamera}>
                    <X size={24} color="#fff" />
                  </TouchableOpacity>
                  <View style={styles.cameraHeaderInfo}>
                    <Text style={styles.cameraHeaderTitle}>
                      {pendingVideoUri ? "Review Recording" : isRecording ? "Recording" : "Camera"}
                    </Text>
                    <Text style={styles.cameraHeaderSubtitle}>
                      {pendingVideoUri
                        ? "Save or discard your recording"
                        : isRecording
                        ? "Tap to stop recording"
                        : "Tap to start recording"}
                    </Text>
                  </View>
                  <View style={styles.cameraHeaderSpacer} />
                </View>

                <View style={[styles.fullScreenCameraControls, { paddingBottom: Math.max(insets.bottom + 24, 40) }]}>
                  {pendingVideoUri ? (
                    <View style={styles.saveControlsContainer}>
                      <TouchableOpacity style={styles.discardButton} onPress={handleDiscardVideo}>
                        <X size={20} color="#fff" />
                        <Text style={styles.discardButtonText}>Discard</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.saveButton} onPress={handleSaveVideo}>
                        <Check size={20} color="#fff" />
                        <Text style={styles.saveButtonText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.cameraControlsContainer}>
                      {isRecording ? (
                        <View style={styles.recordButtonProgressContainer}>
                          <Svg
                            width={104}
                            height={104}
                            style={styles.recordProgressRing}
                            viewBox="0 0 104 104"
                          >
                            <Circle
                              cx="52"
                              cy="52"
                              r={RECORD_PROGRESS_RADIUS}
                              stroke="rgba(255,255,255,0.28)"
                              strokeWidth="6"
                              fill="none"
                            />
                            <Circle
                              cx="52"
                              cy="52"
                              r={RECORD_PROGRESS_RADIUS}
                              stroke="#3ddc84"
                              strokeWidth="6"
                              fill="none"
                              strokeDasharray={`${RECORD_PROGRESS_CIRCUMFERENCE} ${RECORD_PROGRESS_CIRCUMFERENCE}`}
                              strokeDashoffset={recordingProgressOffset}
                              strokeLinecap="round"
                              rotation="-90"
                              origin="52, 52"
                            />
                          </Svg>
                          <TouchableOpacity style={[styles.recordButton, styles.recordingButton]} onPress={handleStopRecording}>
                            <View style={styles.recordingIndicator} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity style={styles.recordButton} onPress={handleStartRecording}>
                          <View style={styles.recordButtonInner} />
                        </TouchableOpacity>
                      )}
                      <Text style={styles.recordButtonLabel}>{isRecording ? "Stop Recording" : "Start Recording"}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.webCameraPlaceholder}>
              <Text style={styles.webCameraText}>Camera recording not available on web</Text>
              <Text style={styles.webCameraSubtext}>Please select a video from your gallery</Text>
              <TouchableOpacity style={styles.closeCameraButton} onPress={handleCloseFullScreenCamera}>
                <X size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {isPickingVideo ? (
        <View style={styles.galleryLoadingOverlay} pointerEvents="none">
          <View style={styles.galleryLoadingCard}>
            <ActivityIndicator size="small" color={Colors.dark.primary} />
            <Text style={styles.galleryLoadingText}>{galleryLoadingMessage}</Text>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  scrollView: { flex: 1, backgroundColor: Colors.dark.background },
  scrollContent: { flexGrow: 1, backgroundColor: Colors.dark.background },

  permissionContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  permissionText: { fontSize: 16, color: Colors.dark.text, textAlign: "center", marginBottom: 20 },
  permissionButton: { backgroundColor: Colors.dark.primary, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  permissionButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, backgroundColor: Colors.dark.background },
  loadingText: { marginTop: 12, fontSize: 15, color: Colors.dark.subtext },

  mediaSelectionContainer: { padding: 20, paddingTop: 40 },
  mediaSelectionHeader: { alignItems: "center", marginBottom: 32 },
  mediaSelectionTitle: { fontSize: 28, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8, textAlign: "center" },
  mediaSelectionSubtitle: { fontSize: 16, color: Colors.dark.subtext, textAlign: "center", lineHeight: 22 },

  mediaOptionsContainer: { flexDirection: "row", justifyContent: "space-between", marginBottom: 32, gap: 16 },
  mediaOptionCard: {
    flex: 1,
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "transparent",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  mediaOptionCardDisabled: { opacity: 0.6 },
  mediaOptionIconContainer: { marginBottom: 16 },
  cameraIconBackground: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.dark.primary,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  galleryIconBackground: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: "hidden",
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  galleryIconImage: { width: "100%", height: "100%" },
  galleryIconOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  galleryIconText: { fontSize: 24 },

  mediaOptionTitle: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8, textAlign: "center" },
  mediaOptionDescription: { fontSize: 14, color: Colors.dark.subtext, textAlign: "center", lineHeight: 20, marginBottom: 16 },

  mediaOptionBadge: { backgroundColor: "rgba(138, 43, 226, 0.1)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: "rgba(138, 43, 226, 0.3)" },
  mediaOptionBadgeText: { fontSize: 12, fontWeight: "bold", color: Colors.dark.primary, letterSpacing: 0.5 },

  mediaSelectionFooter: { alignItems: "center" },
  mediaSelectionTip: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(138, 43, 226, 0.1)", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(138, 43, 226, 0.2)", maxWidth: "90%" },
  mediaSelectionTipIcon: { fontSize: 16, marginRight: 8 },
  mediaSelectionTipText: { fontSize: 14, color: Colors.dark.subtext, flex: 1, lineHeight: 20 },

  galleryLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(10, 10, 20, 0.24)",
  },
  galleryLoadingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(15, 15, 26, 0.92)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(138, 43, 226, 0.28)",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  galleryLoadingText: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: "600",
  },

  previewContainer: { height: 300, width: "100%", position: "relative" },
  videoPreview: { flex: 1 },
  videoDurationBadge: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  videoDurationBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  resetButton: { position: "absolute", top: 16, right: 16, backgroundColor: "rgba(0,0,0,0.6)", width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center" },
  videoEditToolbar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  videoEditButton: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  videoEditButtonText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  videoEditPanel: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 62,
    backgroundColor: "rgba(10,10,16,0.94)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    padding: 12,
    gap: 8,
  },
  videoEditPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  videoEditPanelTitle: { color: "#fff", fontSize: 14, fontWeight: "700" },
  videoEditPanelSubtext: { color: "rgba(255,255,255,0.72)", fontSize: 12 },
  trimTrackContainer: {
    height: 30,
    justifyContent: "center",
  },
  trimTrackBase: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  trimTrackActive: {
    position: "absolute",
    left: 0,
    height: 6,
    borderRadius: 999,
    backgroundColor: Colors.dark.primary,
  },
  trimHandle: {
    position: "absolute",
    marginLeft: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: Colors.dark.primary,
  },
  trimRangeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  videoEditPanelActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  videoEditPanelButton: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  videoEditPanelButtonText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  videoEditPanelButtonPrimary: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  videoEditPanelButtonPrimaryText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  frameOptionList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  frameOptionButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  frameOptionButtonText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  videoEditingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  videoEditingOverlayText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  formContainer: { padding: 20 },
  formTitle: { fontSize: 20, fontWeight: "bold", color: Colors.dark.text, marginBottom: 20 },

  inputGroup: { marginBottom: 20 },
  inputLabel: { fontSize: 16, color: Colors.dark.text, marginBottom: 8 },
  locationLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  locationInlineLoader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  locationInlineLoaderText: { color: Colors.dark.subtext, fontSize: 12, marginLeft: 6 },
  textInput: { backgroundColor: Colors.dark.card, borderRadius: 8, padding: 12, color: Colors.dark.text, fontSize: 16 },
  dateTimeRow: { flexDirection: "row", gap: 12 },
  dateTimeButton: {
    flex: 1,
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dateTimeButtonText: { color: Colors.dark.text, fontSize: 15, flexShrink: 1 },
  pickerDoneRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  pickerActionButton: { paddingHorizontal: 12, paddingVertical: 6 },
  pickerCancelText: { color: Colors.dark.subtext, fontSize: 16 },
  pickerDoneText: { color: Colors.dark.primary, fontSize: 16, fontWeight: "600" as const },
  textArea: { minHeight: 100, textAlignVertical: "top" },

  locationContainer: { flexDirection: "row", alignItems: "center" },
  locationInput: { flex: 1, marginRight: 8 },
  locationButtons: { flexDirection: "row" },
  locationButton: { backgroundColor: Colors.dark.card, width: 44, height: 44, borderRadius: 8, justifyContent: "center", alignItems: "center", marginLeft: 8 },
  locationButtonDisabled: { opacity: 0.75 },

  tagsContainer: { width: "100%" },
  tagInputContainer: { flexDirection: "row", alignItems: "center" },
  tagInput: { flex: 1, marginRight: 8 },
  addTagButton: { backgroundColor: Colors.dark.card, width: 44, height: 44, borderRadius: 8, justifyContent: "center", alignItems: "center", marginRight: 8 },
  tagUserButton: { backgroundColor: Colors.dark.card, width: 44, height: 44, borderRadius: 8, justifyContent: "center", alignItems: "center" },

  tagsList: { flexDirection: "row", flexWrap: "wrap", marginTop: 12 },
  tag: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.dark.card, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8, marginBottom: 8 },
  tagText: { color: Colors.dark.text, marginRight: 6 },
  removeTagButton: { width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.1)", justifyContent: "center", alignItems: "center" },

  uploadButton: { backgroundColor: Colors.dark.primary, borderRadius: 8, flexDirection: "row", justifyContent: "center", alignItems: "center", paddingVertical: 14, marginTop: 10 },
  uploadButtonDisabled: { backgroundColor: "rgba(138, 43, 226, 0.5)" },
  uploadIcon: { marginRight: 8 },
  uploadButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },

  businessSection: { backgroundColor: Colors.dark.card, borderRadius: 12, padding: 16, marginBottom: 20 },
  businessSectionTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 4 },
  businessSectionSubtitle: { fontSize: 13, color: Colors.dark.subtext, marginBottom: 16, lineHeight: 18 },
  offeringCategory: { marginBottom: 16, borderWidth: 1, borderColor: "rgba(138,43,226,0.2)", borderRadius: 10, padding: 12, backgroundColor: "rgba(138,43,226,0.05)" },
  offeringCategoryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  offeringCategoryTitle: { fontSize: 15, fontWeight: "700", color: Colors.dark.text },
  offeringCategoryHint: { fontSize: 12, color: Colors.dark.subtext, marginBottom: 8, fontStyle: "italic" },
  offeringAddButton: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(138,43,226,0.15)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "rgba(138,43,226,0.4)" },
  offeringAddText: { fontSize: 13, color: Colors.dark.primary, marginLeft: 4, fontWeight: "600" },
  addProductsButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 8, borderWidth: 1, borderColor: Colors.dark.primary, borderStyle: "dashed", backgroundColor: "rgba(138, 43, 226, 0.1)" },
  addProductsText: { fontSize: 14, color: Colors.dark.primary, marginLeft: 8, fontWeight: "500" },
  productsList: { marginTop: 12 },
  productItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(138, 43, 226, 0.1)", padding: 10, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: "rgba(138, 43, 226, 0.2)" },
  productPreviewImage: { width: 40, height: 40, borderRadius: 6, marginRight: 12 },
  productInfo: { flex: 1 },
  productActionButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  editProductButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.primary },
  editProductText: { color: Colors.dark.primary, fontWeight: "600" },
  productName: { fontSize: 14, fontWeight: "600", color: Colors.dark.text, marginBottom: 2 },
  productPrice: { fontSize: 12, color: Colors.dark.primary, fontWeight: "500" },
  productQuantity: { fontSize: 10, color: Colors.dark.subtext, marginTop: 2 },
  removeProductButton: { backgroundColor: "#ff3b30", width: 24, height: 24, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  removeProductText: { color: "#fff", fontSize: 16, fontWeight: "bold" },

  fullScreenCameraContainer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", zIndex: 1000 },
  fullScreenCameraStage: { flex: 1 },
  fullScreenCamera: { flex: 1 },
  cameraOverlayLayer: {
    ...StyleSheet.absoluteFillObject,
  },

  cameraHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    zIndex: 10,
  },
  closeCameraButton: { backgroundColor: "rgba(0,0,0,0.6)", width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.2)" },
  cameraHeaderInfo: { flex: 1, alignItems: "center" },
  cameraHeaderTitle: { color: "#fff", fontSize: 18, fontWeight: "bold", marginBottom: 2 },
  cameraHeaderSubtitle: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  cameraHeaderSpacer: { width: 44 },

  fullScreenCameraControls: { position: "absolute", bottom: 0, left: 0, right: 0, paddingBottom: 40, paddingHorizontal: 20, alignItems: "center" },
  cameraControlsContainer: { alignItems: "center" },

  recordButtonProgressContainer: { width: 104, height: 104, justifyContent: "center", alignItems: "center" },
  recordProgressRing: { position: "absolute" },
  recordButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(255,255,255,0.2)", borderWidth: 4, borderColor: "#fff", justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  recordButtonInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#f44336", shadowColor: "#f44336", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 4 },
  recordingButton: { backgroundColor: "rgba(244, 67, 54, 0.2)", borderColor: "#f44336" },
  recordingIndicator: { width: 32, height: 32, borderRadius: 6, backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4 },
  recordButtonLabel: { color: "#fff", fontSize: 16, fontWeight: "600", marginTop: 16, textAlign: "center", textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },

  timerContainer: { position: "absolute", top: 20, left: 20, right: 20, alignItems: "center" },
  timerBackground: { backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" },
  timerText: { color: "#fff", fontSize: 18, fontWeight: "bold", marginLeft: 6, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  minDurationText: { color: "#fff", fontSize: 12, marginTop: 4, textAlign: "center", opacity: 0.8 },

  saveControlsContainer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", paddingHorizontal: 40, paddingBottom: 50, gap: 20 },
  saveButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#10B981", paddingVertical: 16, paddingHorizontal: 24, borderRadius: 12, shadowColor: "#10B981", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold", marginLeft: 8 },
  discardButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.2)", paddingVertical: 16, paddingHorizontal: 24, borderRadius: 12, borderWidth: 2, borderColor: "rgba(255,255,255,0.3)" },
  discardButtonText: { color: "#fff", fontSize: 16, fontWeight: "600", marginLeft: 8 },

  webCameraPlaceholder: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Colors.dark.card },
  webCameraText: { color: Colors.dark.text, fontSize: 18, fontWeight: "bold", marginBottom: 8 },
  webCameraSubtext: { color: Colors.dark.subtext, fontSize: 14, textAlign: "center" },

  watermarkPreviewContainer: {
    position: "absolute",
    top: "70%",
    left: 50,
    right: 0,
    borderRadius: 100,
    bottom: 10,
    pointerEvents: "none",
  },
});














// import React, { useState, useRef, useEffect } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TextInput,
//   TouchableOpacity,
//   ScrollView,
//   Platform,
//   Alert,
//   KeyboardAvoidingView,
// } from "react-native";
// import { useRouter, useFocusEffect } from "expo-router";
// import { CameraView, useCameraPermissions } from "expo-camera";
// import { Audio } from "expo-av";
// import { Image } from "expo-image";
// import { Video as ExpoVideo, ResizeMode } from "expo-av";
// import * as ImagePicker from "expo-image-picker";
// import * as Location from "expo-location";
// import {
//   Camera,
//   X,
//   MapPin,
//   Calendar,
//   Tag,
//   Upload,
//   Check,
//   Map,
//   Clock,
//   Plus,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { useVideoStore } from "@/store/video-store";
// import { useAuth } from "@/lib/auth";
// import {
//   videoService,
//   storageService,
//   productService,
//   eventService,
// } from "@/lib/database";
// import { supabase } from "@/lib/supabase";
// import UploadProgress from "@/components/UploadProgress";
// import UserSearchModal from "@/components/UserSearchModal";
// import { getCurrentLocation } from "@/utils/location";
// import { videoWatermarkService } from "@/utils/video-watermark";
// import VideoWatermark from "@/components/VideoWatermark";
// import { ProductCreationModal } from "@/components/ProductCreationModal";
// import { User, AttendanceStatus, Video, Product } from "@/types";
// import { useProductStore } from "@/store/product-store";

// export default function UploadScreen() {
//   const router = useRouter();
//   const { user: authUser, profile } = useAuth();
//   const user = profile;
//   const { uploadVideo } = useVideoStore();
//   const { addProduct } = useProductStore();
//   const [permission, requestPermission] = useCameraPermissions();

//   const [isRecording, setIsRecording] = useState(false);
//   const [recordingDuration, setRecordingDuration] = useState(0);
//   const [videoUri, setVideoUri] = useState<string | null>(null);
//   const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
//   const [eventName, setEventName] = useState("");
//   const [eventDescription, setEventDescription] = useState("");
//   const [eventDate, setEventDate] = useState(new Date());
//   const [eventLocation, setEventLocation] = useState<any>({
//     name: "",
//     latitude: null,
//     longitude: null,
//   });
//   const [eventTags, setEventTags] = useState<string[]>([]);
//   const [tagInput, setTagInput] = useState("");
//   const [uploadProgress, setUploadProgress] = useState(0);
//   const [uploadStatus, setUploadStatus] = useState<
//     "uploading" | "processing" | "complete" | "error"
//   >("uploading");
//   const [isUploading, setIsUploading] = useState(false);
//   const [showTagModal, setShowTagModal] = useState(false);
//   const [showLocationPicker, setShowLocationPicker] = useState(false);
//   const [showProductModal, setShowProductModal] = useState(false);
//   const [eventProducts, setEventProducts] = useState<
//     Omit<Product, "id" | "videoId" | "createdAt">[]
//   >([]);
//   const [cameraKey, setCameraKey] = useState(0); // Add key to force camera re-render
//   const [cameraReady, setCameraReady] = useState(false); // Track camera ready state
//   const [showFullScreenCamera, setShowFullScreenCamera] = useState(false); // Track full screen camera state
//   const [pendingVideoUri, setPendingVideoUri] = useState<string | null>(null); // Track video waiting to be saved

//   const cameraRef = useRef<any>(null);
//   const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

//   useEffect(() => {
//     (async () => {
//       if (Platform.OS !== "web") {
//         if (!permission?.granted) {
//           await requestPermission();
//         }
//       }

//       // Request location permission
//       const { status } = await Location.requestForegroundPermissionsAsync();
//       if (status !== "granted") {
//         // Don't show alert on web as it's expected
//         if (Platform.OS !== "web") {
//           Alert.alert(
//             "Permission Denied",
//             "Permission to access location was denied"
//           );
//         }
//       }

//       // Request audio recording permission for Android
//       if (Platform.OS === "android") {
//         const { status: audioStatus } = await Audio.requestPermissionsAsync();
//         if (audioStatus !== "granted") {
//           Alert.alert(
//             "Permission Required",
//             "Audio recording permission is required for video recording"
//           );
//         }
//       }
//     })();
//   }, [permission, requestPermission]);

//   // Reset camera when screen comes into focus
//   useFocusEffect(
//     React.useCallback(() => {
//       const resetCamera = () => {
//         // Reset camera state when screen comes into focus
//         setCameraKey((prev) => prev + 1);
//         setIsRecording(false);
//         setRecordingDuration(0);
//         setCameraReady(false);
//         setVideoUri(null);
//         setThumbnailUri(null);
//         setPendingVideoUri(null);
//         setShowFullScreenCamera(false);

//         // Clear any existing timer
//         if (recordingTimerRef.current) {
//           clearInterval(recordingTimerRef.current);
//           recordingTimerRef.current = null;
//         }
//       };

//       // Reset camera immediately when screen focuses
//       resetCamera();

//       // Add a small delay to ensure camera reinitializes properly
//       setTimeout(() => {
//         // Camera reinitialization delay completed
//       }, 500);

//       // Cleanup function
//       return () => {
//         if (recordingTimerRef.current) {
//           clearInterval(recordingTimerRef.current);
//           recordingTimerRef.current = null;
//         }
//       };
//     }, [])
//   );

//   const handleStartRecording = async () => {
//     if (!cameraRef.current) {
//       Alert.alert("Camera Error", "Camera is not ready. Please try again.");
//       return;
//     }

//     if (!cameraReady) {
//       Alert.alert(
//         "Camera Error",
//         "Camera is still initializing. Please wait a moment and try again."
//       );
//       return;
//     }

//     if (Platform.OS === "web") {
//       Alert.alert(
//         "Not Supported",
//         "Video recording is not supported on web. Please use the gallery option."
//       );
//       return;
//     }

//     // Check camera permissions
//     if (!permission?.granted) {
//       Alert.alert(
//         "Permission Required",
//         "Camera permission is required to record videos"
//       );
//       return;
//     }

//     // Check audio permissions for Android
//     if (Platform.OS === "android") {
//       const { status: audioStatus } = await Audio.getPermissionsAsync();
//       if (audioStatus !== "granted") {
//         Alert.alert(
//           "Permission Required",
//           "Audio recording permission is required for video recording"
//         );
//         return;
//       }
//     }

//     setIsRecording(true);
//     setRecordingDuration(0);

//     // Start timer with more frequent updates for better accuracy
//     recordingTimerRef.current = setInterval(() => {
//       setRecordingDuration((prev) => {
//         const newDuration = prev + 1;
//         return newDuration;
//       });
//     }, 1000);

//     // Wait longer to ensure camera is fully ready
//     await new Promise((resolve) => setTimeout(resolve, 1000));

//     // Double-check camera ref is still available
//     if (!cameraRef.current) {
//       setIsRecording(false);
//       return;
//     }

//     try {
//       const video = await cameraRef.current.recordAsync({
//         quality: Platform.OS === "ios" ? "720p" : "480p", // Use lower quality on Android for better compatibility
//         maxDuration: 60, // 60 seconds max
//         mute: false,
//         codec: Platform.OS === "ios" ? "h264" : undefined, // Specify codec for iOS
//       });

//       // Check if video was actually recorded - set as pending (wait for save button)
//       if (video && video.uri) {
//         setPendingVideoUri(video.uri);
//       }
//     } catch (error) {
//       logger.error("Recording error:", error);
//       Alert.alert(
//         "Recording Error",
//         "Failed to record video. Please try again."
//       );
//     } finally {
//       setIsRecording(false);
//       if (recordingTimerRef.current) {
//         clearInterval(recordingTimerRef.current);
//         recordingTimerRef.current = null;
//       }
//     }
//   };

//   const handleStopRecording = async () => {
//     if (!cameraRef.current || !isRecording) return;

//     try {
//       const video = await cameraRef.current.stopRecording();

//       // Clear timer
//       if (recordingTimerRef.current) {
//         clearInterval(recordingTimerRef.current);
//         recordingTimerRef.current = null;
//       }

//       // Set pending video URI (don't save yet - wait for user to confirm)
//       if (video && video.uri) {
//         setPendingVideoUri(video.uri);
//         setIsRecording(false);
//       }
//     } catch (error) {
//       logger.error("Stop recording error:", error);
//       Alert.alert(
//         "Recording Error",
//         "Failed to stop recording. Please try again."
//       );
//       setIsRecording(false);
//       if (recordingTimerRef.current) {
//         clearInterval(recordingTimerRef.current);
//         recordingTimerRef.current = null;
//       }
//     }
//   };

//   const handleSaveVideo = () => {
//     if (pendingVideoUri) {
//       setVideoUri(pendingVideoUri);
//       // Generate thumbnail (in a real app, you'd extract a frame from the video)
//       setThumbnailUri(
//         "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80"
//       );
//       setPendingVideoUri(null);
//       setShowFullScreenCamera(false);
//       setIsRecording(false);
//       setRecordingDuration(0);
//       setCameraReady(false);
//     }
//   };

//   const handleDiscardVideo = () => {
//     setPendingVideoUri(null);
//     setIsRecording(false);
//     setRecordingDuration(0);
//     // Allow user to record again
//   };

//   const handlePickVideo = async () => {
//     const result = await ImagePicker.launchImageLibraryAsync({
//       mediaTypes: ImagePicker.MediaTypeOptions.Videos,
//       allowsEditing: true,
//       quality: 1,
//     });

//     if (!result.canceled && result.assets && result.assets.length > 0) {
//       setVideoUri(result.assets[0].uri);
//       // Generate thumbnail (in a real app, you'd extract a frame from the video)
//       setThumbnailUri(
//         "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80"
//       );
//     }
//   };

//   const handleAddTag = () => {
//     if (tagInput.trim() && !eventTags.includes(tagInput.trim())) {
//       setEventTags([...eventTags, tagInput.trim()]);
//       setTagInput("");
//     }
//   };

//   const handleRemoveTag = (tag: string) => {
//     setEventTags(eventTags.filter((t) => t !== tag));
//   };

//   const handleUserTagSelected = (user: User) => {
//     if (!eventTags.includes(`@${user.username}`)) {
//       setEventTags([...eventTags, `@${user.username}`]);
//     }
//     setShowTagModal(false);
//   };

//   const handleUseCurrentLocation = async () => {
//     const location = await getCurrentLocation();
//     if (location) {
//       // Get address from coordinates
//       const geocode = await Location.reverseGeocodeAsync({
//         latitude: location.coords.latitude,
//         longitude: location.coords.longitude,
//       });

//       if (geocode && geocode.length > 0) {
//         const address = geocode[0];
//         const locationName = [
//           address.name,
//           address.street,
//           address.city,
//           address.region,
//           address.country,
//         ]
//           .filter(Boolean)
//           .join(", ");

//         setEventLocation({
//           name: locationName,
//           latitude: location.coords.latitude,
//           longitude: location.coords.longitude,
//         });
//       } else {
//         setEventLocation({
//           name: `${location.coords.latitude.toFixed(
//             6
//           )}, ${location.coords.longitude.toFixed(6)}`,
//           latitude: location.coords.latitude,
//           longitude: location.coords.longitude,
//         });
//       }
//     }
//   };

//   const handleOpenMap = () => {
//     // Navigate to map screen for location selection
//     router.push("/location");
//   };

//   const handleProductSaved = (product: {
//     name: string;
//     price: number;
//     available_quantity: number;
//     image?: string;
//   }) => {
//     // Convert to the format expected by eventProducts
//     const eventProduct = {
//       name: product.name,
//       description: "", // No description field in simplified version
//       price: product.price,
//       image: product.image || "", // Use the uploaded image
//       type: "ticket" as const, // Default type since we removed the picker
//       available: product.available_quantity,
//     };

//     setEventProducts((prev) => [...prev, eventProduct]);
//     setShowProductModal(false);
//   };

//   const resetCamera = () => {
//     setVideoUri(null);
//     setThumbnailUri(null);
//     setPendingVideoUri(null);
//     setRecordingDuration(0);
//     setIsRecording(false);
//     setCameraReady(false);
//     setShowFullScreenCamera(false);
//     setCameraKey((prev) => prev + 1); // Force camera re-render

//     // Clear any existing timer
//     if (recordingTimerRef.current) {
//       clearInterval(recordingTimerRef.current);
//       recordingTimerRef.current = null;
//     }
//   };

//   const handleOpenFullScreenCamera = () => {
//     setShowFullScreenCamera(true);
//   };

//   const handleCloseFullScreenCamera = () => {
//     // If there's a pending video, ask user to confirm
//     if (pendingVideoUri) {
//       Alert.alert(
//         "Discard Recording?",
//         "You have an unsaved recording. Do you want to discard it?",
//         [
//           {
//             text: "Cancel",
//             style: "cancel",
//           },
//           {
//             text: "Discard",
//             style: "destructive",
//             onPress: () => {
//               setPendingVideoUri(null);
//               setShowFullScreenCamera(false);
//               setIsRecording(false);
//               setRecordingDuration(0);
//               setCameraReady(false);

//               // Clear any existing timer
//               if (recordingTimerRef.current) {
//                 clearInterval(recordingTimerRef.current);
//                 recordingTimerRef.current = null;
//               }
//             },
//           },
//         ]
//       );
//     } else {
//       setShowFullScreenCamera(false);
//       setIsRecording(false);
//       setRecordingDuration(0);
//       setCameraReady(false);

//       // Clear any existing timer
//       if (recordingTimerRef.current) {
//         clearInterval(recordingTimerRef.current);
//         recordingTimerRef.current = null;
//       }
//     }
//   };

//   const handleUpload = async () => {
//     if (!videoUri) {
//       Alert.alert("Missing Video", "Please record or select a video first");
//       return;
//     }

//     if (!eventName.trim()) {
//       Alert.alert("Missing Information", "Please enter an event name");
//       return;
//     }

//     if (!eventLocation.name) {
//       Alert.alert("Missing Location", "Please set an event location");
//       return;
//     }

//     if (!authUser || !user) {
//       Alert.alert(
//         "Authentication Error",
//         "You must be logged in to upload videos"
//       );
//       return;
//     }

//     // Get current user from Supabase
//     const {
//       data: { user: currentUser },
//       error: userError,
//     } = await supabase.auth.getUser();
//     if (userError || !currentUser) {
//       logger.error("Authentication error:", userError);
//       Alert.alert("Authentication Error", "Please log in to upload videos");
//       return;
//     }

//     setIsUploading(true);
//     setUploadStatus("uploading");

//     // Simulate upload progress
//     const progressInterval = setInterval(() => {
//       setUploadProgress((prev) => {
//         const newProgress = prev + Math.random() * 10;
//         return newProgress >= 100 ? 100 : newProgress;
//       });
//     }, 500);

//     // Add timeout to prevent infinite uploading
//     const uploadTimeout = setTimeout(() => {
//       clearInterval(progressInterval);
//       setIsUploading(false);
//       setUploadStatus("error");
//       Alert.alert(
//         "Upload Timeout",
//         "Upload is taking too long. Please try again."
//       );
//     }, 60000); // 60 seconds timeout

//     try {
//       // Validate required fields before proceeding
//       if (!eventName.trim()) {
//         throw new Error("Event name is required");
//       }
//       if (!eventLocation.name) {
//         throw new Error("Event location is required");
//       }
//       if (!currentUser.id) {
//         throw new Error("User authentication is required");
//       }

//       logger.debug("Starting upload process for user:", currentUser.id);
//       logger.debug("Event name:", eventName.trim());
//       logger.debug("Event location:", eventLocation.name);

//       // Initialize watermark service
//       await videoWatermarkService.preloadWatermark();

//         // Apply watermark to video (centered on the video)
//         const watermarkedVideoUri =
//           await videoWatermarkService.addWatermarkToVideo(videoUri, {
//             position: "center",
//             opacity: 0.8,
//             scale: 0.4,
//           });

//       // Convert video URI to ArrayBuffer
//       const response = await fetch(watermarkedVideoUri);
//       const arrayBuffer = await response.arrayBuffer();

//       // Get file extension from URI
//       const fileExt = videoUri.split(".").pop()?.toLowerCase() ?? "mp4";
//       const fileName = `${currentUser.id}/${Date.now()}.${fileExt}`;

//       // Upload video to Supabase Storage
//       const uploadResult = await storageService.uploadVideo(
//         arrayBuffer,
//         fileName,
//         `video/${fileExt}`
//       );

//       // Get public URL for the uploaded video
//       const videoUrl = await storageService.getVideoUrl(uploadResult.path);

//       // Create video record in database with watermark metadata
//       const videoData = {
//         user_id: currentUser.id,
//         video_url: videoUrl, // Store the full public URL
//         thumbnail_url: thumbnailUri || undefined,
//         title: eventName.trim(),
//         description: eventDescription.trim(),
//         location_name: eventLocation.name,
//         location_city: eventLocation.city || "",
//         location_country: eventLocation.country || "",
//         location_coordinates:
//           venueCoordinates(eventLocation)
//             ? `POINT(${eventLocation.longitude} ${eventLocation.latitude})`
//             : undefined,
//         event_name: eventName.trim(),
//         event_date: eventDate.toISOString(),
//         hashtags: eventTags.filter((tag) => !tag.startsWith("@")),
//       };

//       logger.debug("Creating video with data:", videoData);
//       const newVideo = await videoService.uploadVideo(videoData);
//       logger.debug("Video created successfully:", newVideo);

//       if (!newVideo || !newVideo.id) {
//         throw new Error("Failed to create video: No video ID returned");
//       }

//       // Always create an event record for the video
//       const eventData = {
//         user_id: currentUser.id,
//         event_name: eventName.trim(),
//         description: eventDescription.trim() || "Event created with video",
//         start_date: eventDate.toISOString(),
//         location_name: eventLocation.name || "Location not specified",
//         location_city: eventLocation.city || "",
//         location_latitude: eventLocation.latitude ?? null,
//         location_longitude: eventLocation.longitude ?? null,
//         max_attendees: 100,
//         current_attendees: 0,
//         ticket_price: 0,
//         currency: "USD",
//         image_url: thumbnailUri || undefined,
//         category: "General",
//         hashtags: eventTags.filter((tag) => !tag.startsWith("@")) || [],
//         is_public: true,
//         status: "published" as const,
//         video_id: newVideo.id,
//         business_id: user.user_type === "business" ? currentUser.id : undefined,
//       };

//       logger.debug("Creating event with data:", eventData);
//       let newEvent;
//       try {
//         newEvent = await eventService.createEvent(eventData);
//         logger.debug("Event created successfully:", newEvent);

//         if (!newEvent || !newEvent.id) {
//           throw new Error("Failed to create event: No event ID returned");
//         }
//       } catch (eventError) {
//         logger.error("Event creation failed:", eventError);
//         // Continue with video creation even if event creation fails
//         // The video will still be uploaded and available
//         Alert.alert(
//           "Event Creation Warning",
//           "Your video was uploaded successfully, but there was an issue creating the event record. The video is still available in your profile.",
//           [{ text: "OK" }]
//         );
//         // Create a minimal event object to continue the flow
//         newEvent = { id: "temp-event-id" };
//       }

//       // Create products for this event if any were added and event was created successfully
//       if (eventProducts.length > 0 && newEvent.id !== "temp-event-id") {
//         try {
//           for (const product of eventProducts) {
//             let imageUrl = product.image;

//             // Upload product image to Supabase storage if provided
//             if (product.image && product.image.startsWith("file://")) {
//               try {
//                 // Convert image URI to ArrayBuffer
//                 const response = await fetch(product.image);
//                 const arrayBuffer = await response.arrayBuffer();

//                 // Get file extension from URI
//                 const fileExt =
//                   product.image.split(".").pop()?.toLowerCase() ?? "jpg";
//                 const fileName = `products/${
//                   currentUser.id
//                 }/${Date.now()}_${product.name.replace(
//                   /[^a-zA-Z0-9]/g,
//                   "_"
//                 )}.${fileExt}`;

//                 // Upload image to Supabase Storage using the correct image upload function
//                 const uploadResult = await storageService.uploadImage(
//                   arrayBuffer,
//                   fileName,
//                   `image/${fileExt}`,
//                   "images" // Use images bucket instead of videos bucket
//                 );

//                 // Get public URL for the uploaded image
//                 imageUrl = await storageService.getImageUrl(
//                   uploadResult.path,
//                   "images"
//                 );
//               } catch (imageError) {
//                 // Continue without image if upload fails
//                 imageUrl = "";
//               }
//             }

//             const productData = {
//               event_id: newEvent.id,
//               business_id: currentUser.id,
//               name: product.name,
//               description: product.description,
//               price: product.price,
//               currency: "USD",
//               type: product.type,
//               available_quantity: product.available,
//               image_url: imageUrl,
//             };

//             const newProduct = await productService.createProduct(productData);

//             // Also add to local product store for immediate UI update
//             const productWithIds = {
//               ...product,
//               id: newProduct.id,
//               videoId: newVideo.id,
//               image: imageUrl, // Use the uploaded image URL
//               createdAt: newProduct.created_at,
//             };
//             addProduct(productWithIds);
//           }
//         } catch (productError) {
//           Alert.alert(
//             "Products Not Added",
//             "Your event was created successfully, but products could not be added due to database permissions. The event is still available for viewing.",
//             [{ text: "OK" }]
//           );
//         }
//       }

//       // Also add to local store for immediate UI update
//       const localVideo: Video = {
//         id: newVideo.id,
//         userId: currentUser.id,
//         user: {
//           id: user.id,
//           username: user.username,
//           name: user.full_name,
//           avatar:
//             user.avatar_url ||
//             '',
//           isBusinessAccount: user.user_type === "business",
//           followers: user.followers_count,
//           following: user.following_count,
//           bio: user.bio,
//           businessName: user.business_name,
//           businessType: user.business_type,
//         },
//         url: videoUrl,
//         thumbnail:
//           thumbnailUri ||
//           "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=300&q=80",
//         eventName: eventName.trim(),
//         description: eventDescription.trim(),
//         location: eventLocation,
//         eventDate: eventDate.toISOString(),
//         hashtags: eventTags.filter((tag) => !tag.startsWith("@")),
//         likes: newVideo.likes_count,
//         comments: newVideo.comments_count,
//         shares: newVideo.shares_count,
//         rating: newVideo.rating,
//         ratingCount: newVideo.rating_count,
//         attendeeCount: 0,
//         createdAt: newVideo.created_at,
//       };

//       uploadVideo(localVideo);

//       clearInterval(progressInterval);
//       clearTimeout(uploadTimeout);
//       setUploadProgress(100);
//       setUploadStatus("complete");

//       // Reset form after successful upload
//       setTimeout(() => {
//         const successMessage =
//           newEvent.id !== "temp-event-id"
//             ? "Your event and video have been uploaded successfully!"
//             : "Your video has been uploaded successfully! (Event creation had issues)";

//         Alert.alert("Success", successMessage, [
//           { text: "OK", onPress: () => router.push("/") },
//         ]);

//         resetCamera();
//         setEventName("");
//         setEventDescription("");
//         setEventDate(new Date());
//         setEventLocation({ name: "", latitude: null, longitude: null });
//         setEventTags([]);
//         setEventProducts([]);
//         setIsUploading(false);
//         setUploadProgress(0);
//       }, 1000);
//     } catch (error) {
//       clearInterval(progressInterval);
//       clearTimeout(uploadTimeout);
//       logger.error("Upload error:", error);
//       setIsUploading(false);
//       setUploadStatus("error");
//       Alert.alert(
//         "Upload Failed",
//         "Something went wrong during upload. Please try again."
//       );
//     }
//   };

//   if (!permission) {
//     return <View />;
//   }

//   if (!permission.granted) {
//     return (
//       <View style={styles.permissionContainer}>
//         <Text style={styles.permissionText}>
//           We need your permission to use the camera
//         </Text>
//         <TouchableOpacity
//           style={styles.permissionButton}
//           onPress={requestPermission}
//         >
//           <Text style={styles.permissionButtonText}>Grant Permission</Text>
//         </TouchableOpacity>
//       </View>
//     );
//   }

//   if (isUploading) {
//     return (
//       <UploadProgress
//         progress={uploadProgress}
//         status={uploadStatus}
//         onCancel={() => {
//           setIsUploading(false);
//           setUploadStatus("error");
//           setUploadProgress(0);
//         }}
//       />
//     );
//   }

//   return (
//     <KeyboardAvoidingView
//       style={styles.container}
//       behavior={Platform.OS === "ios" ? "padding" : "height"}
//       keyboardVerticalOffset={100}
//     >
//       <ScrollView contentContainerStyle={styles.scrollContent}>
//         {!videoUri ? (
//           <View style={styles.mediaSelectionContainer}>
//             <View style={styles.mediaSelectionHeader}>
//               <Text style={styles.mediaSelectionTitle}>Create Your Event</Text>
//               <Text style={styles.mediaSelectionSubtitle}>
//                 Record a video or select from your gallery
//               </Text>
//             </View>

//             <View style={styles.mediaOptionsContainer}>
//               <TouchableOpacity
//                 style={styles.mediaOptionCard}
//                 onPress={handleOpenFullScreenCamera}
//                 activeOpacity={0.8}
//               >
//                 <View style={styles.mediaOptionIconContainer}>
//                   <View style={styles.cameraIconBackground}>
//                     <Camera size={32} color="#fff" />
//                   </View>
//                 </View>
//                 <Text style={styles.mediaOptionTitle}>Record Video</Text>
//                 <Text style={styles.mediaOptionDescription}>
//                   Capture a new video for your event
//                 </Text>
//                 <View style={styles.mediaOptionBadge}>
//                   <Text style={styles.mediaOptionBadgeText}>RECORD</Text>
//                 </View>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={styles.mediaOptionCard}
//                 onPress={handlePickVideo}
//                 activeOpacity={0.8}
//               >
//                 <View style={styles.mediaOptionIconContainer}>
//                   <View style={styles.galleryIconBackground}>
//                     <Image
//                       source={{
//                         uri: "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=100&q=80",
//                       }}
//                       style={styles.galleryIconImage}
//                     />
//                     <View style={styles.galleryIconOverlay}>
//                       <Text style={styles.galleryIconText}>📁</Text>
//                     </View>
//                   </View>
//                 </View>
//                 <Text style={styles.mediaOptionTitle}>Select from Gallery</Text>
//                 <Text style={styles.mediaOptionDescription}>
//                   Choose an existing video from your device
//                 </Text>
//                 <View style={styles.mediaOptionBadge}>
//                   <Text style={styles.mediaOptionBadgeText}>GALLERY</Text>
//                 </View>
//               </TouchableOpacity>
//             </View>

//             <View style={styles.mediaSelectionFooter}>
//               <View style={styles.mediaSelectionTip}>
//                 <Text style={styles.mediaSelectionTipIcon}>💡</Text>
//                 <Text style={styles.mediaSelectionTipText}>
//                   Record up to 60 seconds of video content for your event
//                 </Text>
//               </View>
//             </View>
//           </View>
//         ) : (
//           <View style={styles.previewContainer}>
//             <ExpoVideo
//               source={{ uri: videoUri }}
//               style={styles.videoPreview}
//               useNativeControls
//               resizeMode={ResizeMode.CONTAIN}
//             />

//             {/* Watermark Preview Overlay */}
//             <View style={styles.watermarkPreviewContainer}>
//               <VideoWatermark
//                 visible={true}
//                 position="center"
//                 opacity={0.8}
//                 size={{ width: 50, height: 50 }}
//               />
//             </View>

//             <TouchableOpacity style={styles.resetButton} onPress={resetCamera}>
//               <X size={20} color="#fff" />
//             </TouchableOpacity>
//           </View>
//         )}

//         <View style={styles.formContainer}>
//           <Text style={styles.formTitle}>Event Details</Text>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Event Name</Text>
//             <TextInput
//               style={styles.textInput}
//               value={eventName}
//               onChangeText={setEventName}
//               placeholder="Enter event name"
//               placeholderTextColor={Colors.dark.subtext}
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Description</Text>
//             <TextInput
//               style={[styles.textInput, styles.textArea]}
//               value={eventDescription}
//               onChangeText={setEventDescription}
//               placeholder="Describe your event"
//               placeholderTextColor={Colors.dark.subtext}
//               multiline
//               numberOfLines={4}
//             />
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Location</Text>
//             <View style={styles.locationContainer}>
//               <TextInput
//                 style={[styles.textInput, styles.locationInput]}
//                 value={eventLocation.name}
//                 onChangeText={(text) =>
//                   setEventLocation({ ...eventLocation, name: text, latitude: null, longitude: null })
//                 }
//                 placeholder="Event location"
//                 placeholderTextColor={Colors.dark.subtext}
//               />

//               <View style={styles.locationButtons}>
//                 <TouchableOpacity
//                   style={styles.locationButton}
//                   onPress={handleUseCurrentLocation}
//                 >
//                   <MapPin size={20} color={Colors.dark.primary} />
//                 </TouchableOpacity>

//                 <TouchableOpacity
//                   style={styles.locationButton}
//                   onPress={handleOpenMap}
//                 >
//                   <Map size={20} color={Colors.dark.primary} />
//                 </TouchableOpacity>
//               </View>
//             </View>
//           </View>

//           <View style={styles.inputGroup}>
//             <Text style={styles.inputLabel}>Tags</Text>
//             <View style={styles.tagsContainer}>
//               <View style={styles.tagInputContainer}>
//                 <TextInput
//                   style={[styles.textInput, styles.tagInput]}
//                   value={tagInput}
//                   onChangeText={setTagInput}
//                   placeholder="Add tags"
//                   placeholderTextColor={Colors.dark.subtext}
//                   onSubmitEditing={handleAddTag}
//                 />

//                 <TouchableOpacity
//                   style={styles.addTagButton}
//                   onPress={handleAddTag}
//                 >
//                   <Check size={20} color={Colors.dark.text} />
//                 </TouchableOpacity>

//                 <TouchableOpacity
//                   style={styles.tagUserButton}
//                   onPress={() => setShowTagModal(true)}
//                 >
//                   <Tag size={20} color={Colors.dark.text} />
//                 </TouchableOpacity>
//               </View>

//               <View style={styles.tagsList}>
//                 {eventTags.map((tag, index) => (
//                   <View key={index} style={styles.tag}>
//                     <Text style={styles.tagText}>{tag}</Text>
//                     <TouchableOpacity
//                       style={styles.removeTagButton}
//                       onPress={() => handleRemoveTag(tag)}
//                     >
//                       <X size={12} color={Colors.dark.text} />
//                     </TouchableOpacity>
//                   </View>
//                 ))}
//               </View>
//             </View>
//           </View>

//           {/* Products & Services Section - Only for business accounts */}
//           {user?.user_type === "business" && (
//             <View style={styles.businessSection}>
//               <Text style={styles.businessSectionTitle}>Products & Services</Text>
//               <TouchableOpacity
//                 style={styles.addProductsButton}
//                 onPress={() => setShowProductModal(true)}
//               >
//                 <Plus size={20} color={Colors.dark.primary} />
//                 <Text style={styles.addProductsText}>
//                   {eventProducts.length > 0
//                     ? `${eventProducts.length} Products Added`
//                     : "Add Products & Services"}
//                 </Text>
//               </TouchableOpacity>
//               {eventProducts.length > 0 && (
//                 <View style={styles.productsList}>
//                   {eventProducts.map((product, index) => (
//                     <View key={index} style={styles.productItem}>
//                       {product.image && (
//                         <Image
//                           source={{ uri: product.image }}
//                           style={styles.productPreviewImage}
//                         />
//                       )}
//                       <View style={styles.productInfo}>
//                         <Text style={styles.productName}>{product.name}</Text>
//                         <Text style={styles.productPrice}>${product.price}</Text>
//                         <Text style={styles.productQuantity}>
//                           Qty: {product.available}
//                         </Text>
//                       </View>
//                       <TouchableOpacity
//                         style={styles.removeProductButton}
//                         onPress={() => {
//                           const newProducts = eventProducts.filter(
//                             (_, i) => i !== index
//                           );
//                           setEventProducts(newProducts);
//                         }}
//                       >
//                         <Text style={styles.removeProductText}>×</Text>
//                       </TouchableOpacity>
//                     </View>
//                   ))}
//                 </View>
//               )}
//             </View>
//           )}

//           <TouchableOpacity
//             style={[
//               styles.uploadButton,
//               (!videoUri || !eventName.trim() || !eventLocation.name) &&
//                 styles.uploadButtonDisabled,
//             ]}
//             onPress={handleUpload}
//             disabled={!videoUri || !eventName.trim() || !eventLocation.name}
//           >
//             <Upload size={20} color="#fff" style={styles.uploadIcon} />
//             <Text style={styles.uploadButtonText}>Upload Event</Text>
//           </TouchableOpacity>
//         </View>
//       </ScrollView>

//       {showTagModal && (
//         <UserSearchModal
//           visible={showTagModal}
//           onClose={() => setShowTagModal(false)}
//           onSelectUser={handleUserTagSelected}
//           selectedUsers={[]}
//         />
//       )}

//       {showProductModal && (
//         <ProductCreationModal
//           visible={showProductModal}
//           onClose={() => setShowProductModal(false)}
//           onSave={handleProductSaved}
//         />
//       )}

//       {/* Full Screen Camera Modal */}
//       {showFullScreenCamera && (
//         <View style={styles.fullScreenCameraContainer}>
//           {Platform.OS !== "web" ? (
//             <CameraView
//               key={cameraKey}
//               ref={cameraRef}
//               style={styles.fullScreenCamera}
//               facing="back"
//               mode="video"
//               onCameraReady={() => {
//                 setCameraReady(true);
//               }}
//             >
//               {isRecording && (
//                 <View style={styles.timerContainer}>
//                   <View style={styles.timerBackground}>
//                     <Clock size={16} color="#fff" />
//                     <Text style={styles.timerText}>
//                       {Math.floor(recordingDuration / 60)
//                         .toString()
//                         .padStart(2, "0")}
//                       :{(recordingDuration % 60).toString().padStart(2, "0")}
//                     </Text>
//                   </View>
//                   {recordingDuration < 3 && (
//                     <Text style={styles.minDurationText}>
//                       Record for at least 3 seconds
//                     </Text>
//                   )}
//                 </View>
//               )}

//               {/* Header with close button */}
//               <View style={styles.cameraHeader}>
//                 <TouchableOpacity
//                   style={styles.closeCameraButton}
//                   onPress={handleCloseFullScreenCamera}
//                 >
//                   <X size={24} color="#fff" />
//                 </TouchableOpacity>
//                 <View style={styles.cameraHeaderInfo}>
//                   <Text style={styles.cameraHeaderTitle}>
//                     {pendingVideoUri
//                       ? "Review Recording"
//                       : isRecording
//                       ? "Recording"
//                       : "Camera"}
//                   </Text>
//                   <Text style={styles.cameraHeaderSubtitle}>
//                     {pendingVideoUri
//                       ? "Save or discard your recording"
//                       : isRecording
//                       ? "Tap to stop recording"
//                       : "Tap to start recording"}
//                   </Text>
//                 </View>
//                 <View style={styles.cameraHeaderSpacer} />
//               </View>

//               <View style={styles.fullScreenCameraControls}>
//                 {pendingVideoUri ? (
//                   // Show save/discard buttons after recording
//                   <View style={styles.saveControlsContainer}>
//                     <TouchableOpacity
//                       style={styles.discardButton}
//                       onPress={handleDiscardVideo}
//                     >
//                       <X size={20} color="#fff" />
//                       <Text style={styles.discardButtonText}>Discard</Text>
//                     </TouchableOpacity>

//                     <TouchableOpacity
//                       style={styles.saveButton}
//                       onPress={handleSaveVideo}
//                     >
//                       <Check size={20} color="#fff" />
//                       <Text style={styles.saveButtonText}>Save</Text>
//                     </TouchableOpacity>
//                   </View>
//                 ) : (
//                   // Show record button when not recording
//                   <View style={styles.cameraControlsContainer}>
//                     {isRecording ? (
//                       <TouchableOpacity
//                         style={[styles.recordButton, styles.recordingButton]}
//                         onPress={handleStopRecording}
//                       >
//                         <View style={styles.recordingIndicator} />
//                       </TouchableOpacity>
//                     ) : (
//                       <TouchableOpacity
//                         style={styles.recordButton}
//                         onPress={handleStartRecording}
//                       >
//                         <View style={styles.recordButtonInner} />
//                       </TouchableOpacity>
//                     )}
//                     <Text style={styles.recordButtonLabel}>
//                       {isRecording ? "Stop Recording" : "Start Recording"}
//                     </Text>
//                   </View>
//                 )}
//               </View>
//             </CameraView>
//           ) : (
//             <View style={styles.webCameraPlaceholder}>
//               <Text style={styles.webCameraText}>
//                 Camera recording not available on web
//               </Text>
//               <Text style={styles.webCameraSubtext}>
//                 Please select a video from your gallery
//               </Text>
//               <TouchableOpacity
//                 style={styles.closeCameraButton}
//                 onPress={handleCloseFullScreenCamera}
//               >
//                 <X size={24} color="#fff" />
//               </TouchableOpacity>
//             </View>
//           )}
//         </View>
//       )}
//     </KeyboardAvoidingView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   scrollContent: {
//     paddingBottom: 90,
//   },
//   permissionContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   permissionText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     textAlign: "center",
//     marginBottom: 20,
//   },
//   permissionButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 8,
//   },
//   permissionButtonText: {
//     color: "#fff",
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   mediaSelectionContainer: {
//     padding: 20,
//     paddingTop: 40,
//   },
//   mediaSelectionHeader: {
//     alignItems: "center",
//     marginBottom: 32,
//   },
//   mediaSelectionTitle: {
//     fontSize: 28,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//     textAlign: "center",
//   },
//   mediaSelectionSubtitle: {
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//     lineHeight: 22,
//   },
//   mediaOptionsContainer: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 32,
//     gap: 16,
//   },
//   mediaOptionCard: {
//     flex: 1,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 20,
//     padding: 24,
//     alignItems: "center",
//     borderWidth: 2,
//     borderColor: "transparent",
//     shadowColor: "#000",
//     shadowOffset: {
//       width: 0,
//       height: 4,
//     },
//     shadowOpacity: 0.1,
//     shadowRadius: 8,
//     elevation: 4,
//   },
//   mediaOptionIconContainer: {
//     marginBottom: 16,
//   },
//   cameraIconBackground: {
//     width: 80,
//     height: 80,
//     borderRadius: 40,
//     backgroundColor: Colors.dark.primary,
//     justifyContent: "center",
//     alignItems: "center",
//     shadowColor: Colors.dark.primary,
//     shadowOffset: {
//       width: 0,
//       height: 4,
//     },
//     shadowOpacity: 0.3,
//     shadowRadius: 8,
//     elevation: 6,
//   },
//   galleryIconBackground: {
//     width: 80,
//     height: 80,
//     borderRadius: 40,
//     overflow: "hidden",
//     position: "relative",
//     shadowColor: "#000",
//     shadowOffset: {
//       width: 0,
//       height: 4,
//     },
//     shadowOpacity: 0.2,
//     shadowRadius: 8,
//     elevation: 6,
//   },
//   galleryIconImage: {
//     width: "100%",
//     height: "100%",
//   },
//   galleryIconOverlay: {
//     position: "absolute",
//     top: 0,
//     left: 0,
//     right: 0,
//     bottom: 0,
//     backgroundColor: "rgba(0, 0, 0, 0.6)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   galleryIconText: {
//     fontSize: 24,
//   },
//   mediaOptionTitle: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//     textAlign: "center",
//   },
//   mediaOptionDescription: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//     lineHeight: 20,
//     marginBottom: 16,
//   },
//   mediaOptionBadge: {
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     paddingHorizontal: 12,
//     paddingVertical: 6,
//     borderRadius: 12,
//     borderWidth: 1,
//     borderColor: "rgba(138, 43, 226, 0.3)",
//   },
//   mediaOptionBadgeText: {
//     fontSize: 12,
//     fontWeight: "bold",
//     color: Colors.dark.primary,
//     letterSpacing: 0.5,
//   },
//   mediaSelectionFooter: {
//     alignItems: "center",
//   },
//   mediaSelectionTip: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     paddingHorizontal: 16,
//     paddingVertical: 12,
//     borderRadius: 16,
//     borderWidth: 1,
//     borderColor: "rgba(138, 43, 226, 0.2)",
//     maxWidth: "90%",
//   },
//   mediaSelectionTipIcon: {
//     fontSize: 16,
//     marginRight: 8,
//   },
//   mediaSelectionTipText: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     flex: 1,
//     lineHeight: 20,
//   },
//   fullScreenCameraContainer: {
//     position: "absolute",
//     top: 0,
//     left: 0,
//     right: 0,
//     bottom: 0,
//     backgroundColor: "#000",
//     zIndex: 1000,
//   },
//   fullScreenCamera: {
//     flex: 1,
//     justifyContent: "space-between",
//     alignItems: "center",
//   },
//   cameraHeader: {
//     position: "absolute",
//     top: 0,
//     left: 0,
//     right: 0,
//     flexDirection: "row",
//     alignItems: "center",
//     paddingTop: 50,
//     paddingHorizontal: 20,
//     paddingBottom: 20,
//     backgroundColor: "rgba(0, 0, 0, 0.3)",
//     zIndex: 10,
//   },
//   closeCameraButton: {
//     backgroundColor: "rgba(0, 0, 0, 0.6)",
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     justifyContent: "center",
//     alignItems: "center",
//     borderWidth: 2,
//     borderColor: "rgba(255, 255, 255, 0.2)",
//   },
//   cameraHeaderInfo: {
//     flex: 1,
//     alignItems: "center",
//   },
//   cameraHeaderTitle: {
//     color: "#fff",
//     fontSize: 18,
//     fontWeight: "bold",
//     marginBottom: 2,
//   },
//   cameraHeaderSubtitle: {
//     color: "rgba(255, 255, 255, 0.8)",
//     fontSize: 14,
//   },
//   cameraHeaderSpacer: {
//     width: 44,
//   },
//   fullScreenCameraControls: {
//     position: "absolute",
//     bottom: 0,
//     left: 0,
//     right: 0,
//     paddingBottom: 40,
//     paddingHorizontal: 20,
//     alignItems: "center",
//   },
//   cameraControlsContainer: {
//     alignItems: "center",
//   },
//   recordButtonLabel: {
//     color: "#fff",
//     fontSize: 16,
//     fontWeight: "600",
//     marginTop: 16,
//     textAlign: "center",
//     textShadowColor: "rgba(0, 0, 0, 0.5)",
//     textShadowOffset: { width: 0, height: 1 },
//     textShadowRadius: 2,
//   },
//   camera: {
//     flex: 1,
//     justifyContent: "flex-end",
//     alignItems: "center",
//     padding: 20,
//   },
//   cameraControls: {
//     flexDirection: "row",
//     justifyContent: "center",
//     alignItems: "center",
//     width: "100%",
//     marginBottom: 20,
//   },
//   recordButton: {
//     width: 80,
//     height: 80,
//     borderRadius: 40,
//     backgroundColor: "rgba(255, 255, 255, 0.2)",
//     borderWidth: 4,
//     borderColor: "#fff",
//     justifyContent: "center",
//     alignItems: "center",
//     shadowColor: "#000",
//     shadowOffset: {
//       width: 0,
//       height: 4,
//     },
//     shadowOpacity: 0.3,
//     shadowRadius: 8,
//     elevation: 8,
//   },
//   recordButtonInner: {
//     width: 56,
//     height: 56,
//     borderRadius: 28,
//     backgroundColor: "#f44336",
//     shadowColor: "#f44336",
//     shadowOffset: {
//       width: 0,
//       height: 2,
//     },
//     shadowOpacity: 0.4,
//     shadowRadius: 4,
//     elevation: 4,
//   },
//   recordingButton: {
//     backgroundColor: "rgba(244, 67, 54, 0.2)",
//     borderColor: "#f44336",
//   },
//   recordingIndicator: {
//     width: 32,
//     height: 32,
//     borderRadius: 6,
//     backgroundColor: "#fff",
//     shadowColor: "#000",
//     shadowOffset: {
//       width: 0,
//       height: 2,
//     },
//     shadowOpacity: 0.3,
//     shadowRadius: 4,
//     elevation: 4,
//   },
//   webCameraPlaceholder: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//   },
//   webCameraText: {
//     color: Colors.dark.text,
//     fontSize: 18,
//     fontWeight: "bold",
//     marginBottom: 8,
//   },
//   webCameraSubtext: {
//     color: Colors.dark.subtext,
//     fontSize: 14,
//     textAlign: "center",
//   },
//   galleryButton: {
//     backgroundColor: "rgba(0, 0, 0, 0.7)",
//     padding: 12,
//     alignItems: "center",
//   },
//   galleryButtonText: {
//     color: "#fff",
//     fontSize: 16,
//   },
//   previewContainer: {
//     height: 300,
//     width: "100%",
//     position: "relative",
//   },
//   videoPreview: {
//     flex: 1,
//   },
//   resetButton: {
//     position: "absolute",
//     top: 16,
//     right: 16,
//     backgroundColor: "rgba(0, 0, 0, 0.6)",
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   formContainer: {
//     padding: 20,
//   },
//   formTitle: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 20,
//   },
//   inputGroup: {
//     marginBottom: 20,
//   },
//   inputLabel: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   textInput: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//     color: Colors.dark.text,
//     fontSize: 16,
//   },
//   textArea: {
//     minHeight: 100,
//     textAlignVertical: "top",
//   },
//   locationContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   locationInput: {
//     flex: 1,
//     marginRight: 8,
//   },
//   locationButtons: {
//     flexDirection: "row",
//   },
//   locationButton: {
//     backgroundColor: Colors.dark.card,
//     width: 44,
//     height: 44,
//     borderRadius: 8,
//     justifyContent: "center",
//     alignItems: "center",
//     marginLeft: 8,
//   },
//   tagsContainer: {
//     width: "100%",
//   },
//   tagInputContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   tagInput: {
//     flex: 1,
//     marginRight: 8,
//   },
//   addTagButton: {
//     backgroundColor: Colors.dark.card,
//     width: 44,
//     height: 44,
//     borderRadius: 8,
//     justifyContent: "center",
//     alignItems: "center",
//     marginRight: 8,
//   },
//   tagUserButton: {
//     backgroundColor: Colors.dark.card,
//     width: 44,
//     height: 44,
//     borderRadius: 8,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   tagsList: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     marginTop: 12,
//   },
//   tag: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 16,
//     paddingVertical: 6,
//     paddingHorizontal: 12,
//     marginRight: 8,
//     marginBottom: 8,
//   },
//   tagText: {
//     color: Colors.dark.text,
//     marginRight: 6,
//   },
//   removeTagButton: {
//     width: 16,
//     height: 16,
//     borderRadius: 8,
//     backgroundColor: "rgba(255, 255, 255, 0.1)",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   uploadButton: {
//     backgroundColor: Colors.dark.primary,
//     borderRadius: 8,
//     flexDirection: "row",
//     justifyContent: "center",
//     alignItems: "center",
//     paddingVertical: 14,
//     marginTop: 10,
//   },
//   uploadButtonDisabled: {
//     backgroundColor: "rgba(138, 43, 226, 0.5)",
//   },
//   uploadIcon: {
//     marginRight: 8,
//   },
//   uploadButtonText: {
//     color: "#fff",
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   timerContainer: {
//     position: "absolute",
//     top: 20,
//     left: 20,
//     right: 20,
//     alignItems: "center",
//   },
//   timerBackground: {
//     backgroundColor: "rgba(0, 0, 0, 0.7)",
//     borderRadius: 20,
//     paddingVertical: 8,
//     paddingHorizontal: 16,
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   timerText: {
//     color: "#fff",
//     fontSize: 18,
//     fontWeight: "bold",
//     marginLeft: 6,
//     fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
//   },
//   minDurationText: {
//     color: "#fff",
//     fontSize: 12,
//     marginTop: 4,
//     textAlign: "center",
//     opacity: 0.8,
//   },
//   businessSection: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     padding: 16,
//     marginBottom: 20,
//   },
//   businessSectionTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 12,
//   },
//   addProductsButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     padding: 12,
//     borderRadius: 8,
//     borderWidth: 1,
//     borderColor: Colors.dark.primary,
//     borderStyle: "dashed",
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//   },
//   addProductsText: {
//     fontSize: 14,
//     color: Colors.dark.primary,
//     marginLeft: 8,
//     fontWeight: "500",
//   },
//   productsPreview: {
//     fontSize: 12,
//     color: Colors.dark.subtext,
//     marginTop: 8,
//     fontStyle: "italic",
//   },
//   productsList: {
//     marginTop: 12,
//   },
//   productItem: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     padding: 12,
//     borderRadius: 8,
//     marginBottom: 8,
//     borderWidth: 1,
//     borderColor: "rgba(138, 43, 226, 0.2)",
//   },
//   productPreviewImage: {
//     width: 40,
//     height: 40,
//     borderRadius: 6,
//     marginRight: 12,
//   },
//   productInfo: {
//     flex: 1,
//   },
//   productName: {
//     fontSize: 14,
//     fontWeight: "600",
//     color: Colors.dark.text,
//     marginBottom: 2,
//   },
//   productPrice: {
//     fontSize: 12,
//     color: Colors.dark.primary,
//     fontWeight: "500",
//   },
//   productQuantity: {
//     fontSize: 10,
//     color: Colors.dark.subtext,
//     marginTop: 2,
//   },
//   removeProductButton: {
//     backgroundColor: "#ff3b30",
//     width: 24,
//     height: 24,
//     borderRadius: 12,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   removeProductText: {
//     color: "#fff",
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   saveControlsContainer: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     width: "100%",
//     paddingHorizontal: 40,
//     paddingBottom: 50,
//     gap: 20,
//   },
//   saveButton: {
//     flex: 1,
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: "#10B981",
//     paddingVertical: 16,
//     paddingHorizontal: 24,
//     borderRadius: 12,
//     shadowColor: "#10B981",
//     shadowOffset: {
//       width: 0,
//       height: 4,
//     },
//     shadowOpacity: 0.3,
//     shadowRadius: 8,
//     elevation: 8,
//   },
//   saveButtonText: {
//     color: "#fff",
//     fontSize: 16,
//     fontWeight: "bold",
//     marginLeft: 8,
//   },
//   discardButton: {
//     flex: 1,
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     backgroundColor: "rgba(255, 255, 255, 0.2)",
//     paddingVertical: 16,
//     paddingHorizontal: 24,
//     borderRadius: 12,
//     borderWidth: 2,
//     borderColor: "rgba(255, 255, 255, 0.3)",
//   },
//   discardButtonText: {
//     color: "#fff",
//     fontSize: 16,
//     fontWeight: "600",
//     marginLeft: 8,
//   },
//   watermarkPreviewContainer: {
//     position: "absolute",
//     top: '70%',
//     left: 50,
//     right: 0,
//     borderRadius: 100,
//     bottom: 10,
//     // justifyContent: "center",
//     // alignItems: "center",
//     pointerEvents: "none",
//   },
// });
