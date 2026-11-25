import {normalizeDurationMs,formatDurationLabel,isVideoTooShort,isVideoTooLong,getVideoPickerMediaTypes} from '@/utils/upload-media';
import {uploadStyles as styles} from '@/components/upload/styles';
import { resolveCurrentVenueSelection, venueCoordinates } from '@/utils/venue-location';
import { logger } from '@/lib/logger';
import { EventCreationService } from '@/lib/event-creation-service';
import { uploadImageToSupabase } from '@/utils/image-upload';
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
import { useWalletStore } from "@/store/wallet-store";
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

const hasFiniteCoordinates = (lat: unknown, lng: unknown) => Number.isFinite(lat) && Number.isFinite(lng);

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
  const {
    businessBankAccount,
    fetchBusinessBankAccount,
    isLoading: isBankAccountLoading,
  } = useWalletStore();
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

  useEffect(() => {
    if (user?.user_type === "business") {
      void fetchBusinessBankAccount();
    }
  }, [user?.user_type, fetchBusinessBankAccount]);

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
      from: "/(tabsbusiness)/upload",
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
    setFlyerUri(null);
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
    setFlyerUri(null);
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
    const message = (error instanceof Error ? error.message : String(error)).trim();
    const lower = message.toLowerCase();

    if (lower.includes("unable to read media") || lower.includes("selected video file") || lower.includes("could not be read")) {
      return "The selected video could not be read. It may have been moved, deleted, or access may have expired. Select the video again and retry.";
    }

    if (lower.includes("timed out")) {
      return "The upload timed out before it completed. Check your connection and try again.";
    }

    if (lower.includes("network") || lower.includes("internet") || lower.includes("fetch")) {
      return "The upload could not reach the server. Check your internet connection and try again.";
    }

    if (lower.includes("permission") || lower.includes("not authorized") || lower.includes("unauthorized")) {
      return "The app does not have permission to upload this video. Check photo/video access and sign in again.";
    }

    if (lower.includes("size") || lower.includes("too large") || lower.includes("payload")) {
      return "The video file is too large for the server. Trim or compress it, then try again.";
    }

    if (lower.includes("format") || lower.includes("codec") || lower.includes("unsupported")) {
      return "The video's format or codec is not supported. Choose an MP4, MOV, M4V, or WebM video.";
    }

    const safeReason = message.replace(/https?:\/\/\S+/g, "the upload service").slice(0, 220);
    return safeReason && safeReason !== "[object Object]"
      ? `The upload failed because: ${safeReason}`
      : "The upload failed for an unknown reason. Please select the video again and retry.";
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

  const [flyerUri, setFlyerUri] = useState<string | null>(null);
  const chooseFlyer = async () => {
    if (user?.user_type !== 'business') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!result.canceled && result.assets[0]) {
      setFlyerUri(result.assets[0].uri);
      setThumbnailUri(result.assets[0].uri);
    }
  };

  const performUpload = async () => {
    if (uploadLaunchLockRef.current) {
      return;
    }

    if (!videoUri && !(flyerUri && user?.user_type === 'business')) {
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

    if (!eventName.trim()) {
      Alert.alert("Missing Information", "Please enter an event name");
      return;
    }

    if (!venueCoordinates(eventLocation)) {
      Alert.alert("Select Venue Location", "Select the exact venue on the map or use your current location before uploading.");
      return;
    }

    // Use picker Date values directly; the initial start can age while filling the form.
    const minimumStart = getCurrentMinimumStartDate();
    const resolvedStartDate = eventDate.getTime() < minimumStart.getTime() ? minimumStart : eventDate;
    const resolvedEndDate = eventEndDate && eventEndDate.getTime() > resolvedStartDate.getTime()
      ? eventEndDate
      : getDefaultEndDate(resolvedStartDate);

    if (resolvedStartDate.getTime() !== eventDate.getTime()) applyStartDate(resolvedStartDate);
    if (!eventEndDate || resolvedEndDate.getTime() !== eventEndDate.getTime()) applyEndDate(resolvedEndDate);

    if (!authUser || !user) {
      Alert.alert("Authentication Error", "You must be logged in to upload videos");
      return;
    }

    const requiresBankSetup = user.user_type === "business" && !businessBankAccount;

    if (requiresBankSetup && !isBankAccountLoading) {
      Alert.alert(
        "Bank Account Required",
        "Add your business bank account from Wallet before uploading events.",
        [
          {
            text: "Open Bank Setup",
            onPress: () => router.push("/bank-accounts"),
          },
          { text: "Cancel", style: "cancel" },
        ]
      );
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

    if (!videoUri && flyerUri && user.user_type === 'business') {
      uploadLaunchLockRef.current = true;
      setIsUploading(true);
      try {
        const eventCurrency = resolveEventCurrency(eventProducts, businessDefaultCurrency);
        const imageUrl = await uploadImageToSupabase(flyerUri, currentUser.id, 'event-flyers');
        const products = await Promise.all(eventProducts.map(async product => ({
          name: product.name, price: product.price, available_quantity: product.available,
          type: product.type || 'ticket' as const, currency: product.currency?.trim().toUpperCase() || eventCurrency,
          image_url: product.image ? await uploadImageToSupabase(product.image, currentUser.id, 'products') : undefined,
        })));
        const result = await EventCreationService.createEventWithRelations({ event: {
          event_name: eventName.trim(), description: eventDescription.trim(),
          start_date: resolvedStartDate.toISOString(), end_date: resolvedEndDate.toISOString(),
          location_name: eventLocation.name, location_city: eventLocation.city,
          currency: eventCurrency, image_url: imageUrl, is_public: true, status: 'published',
        }, products });
        if (!result.success) throw new Error(result.error || 'Event creation failed');
        clearUploadDraft();
        router.replace('/(tabsbusiness)/discover');
      } catch (error: any) { Alert.alert('Upload failed', error.message); }
      finally { uploadLaunchLockRef.current = false; setIsUploading(false); }
      return;
    }

    if (isEditMode && editVideoId) {
      setIsUploading(true);
      setUploadProgress(50);
      setUploadStatus("processing");

      try {
        const flyerUrl = flyerUri ? await uploadImageToSupabase(flyerUri, currentUser.id, 'event-flyers') : undefined;
        let replacementVideoUrl: string | undefined;
        if (videoUri && !/^https?:\/\//i.test(videoUri)) {
          const { arrayBuffer, extension } = await readUriAsArrayBuffer(videoUri, {
            allowedExtensions: ['mp4', 'mov', 'm4v'], fallbackExtension: 'mp4',
          });
          const upload = await storageService.uploadVideo(arrayBuffer, `${currentUser.id}/${Date.now()}_edited.${extension}`, extension === 'mov' ? 'video/quicktime' : 'video/mp4');
          replacementVideoUrl = await storageService.getVideoUrl(upload.path);
        }
        const hashtags = eventTags.filter((tag) => !tag.startsWith("@"));

        await videoService.updateVideo(editVideoId, {
          ...(replacementVideoUrl ? { video_url: replacementVideoUrl, watermarked_video_url: null } : {}),
          ...(flyerUrl ? { thumbnail_url: flyerUrl } : {}),
          title: eventName.trim(),
          description: eventDescription.trim(),
          location_name: eventLocation.name || "Location not specified",
          location_city: eventLocation.city || "",
          location_country: eventLocation.country || "",
          location_coordinates:
            hasFiniteCoordinates(eventLocation.latitude, eventLocation.longitude)
              ? `POINT(${eventLocation.longitude} ${eventLocation.latitude})`
              : undefined,
          event_name: eventName.trim(),
          event_date: resolvedStartDate.toISOString(),
          hashtags,
        });

        const { error: eventUpdateError } = await supabase
          .from("events")
          .update({
            ...(flyerUrl ? { image_url: flyerUrl } : {}),
            event_name: eventName.trim(),
            description: eventDescription.trim() || "Event created with video",
            start_date: resolvedStartDate.toISOString(),
            end_date: resolvedEndDate.toISOString(),
            location_name: eventLocation.name || "Location not specified",
            location_city: eventLocation.city || "",
            location_country: eventLocation.country || "",
            location_latitude: Number.isFinite(eventLocation.latitude) ? eventLocation.latitude : null,
            location_longitude: Number.isFinite(eventLocation.longitude) ? eventLocation.longitude : null,
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
      thumbnailUri: flyerUri || thumbnailUri,
      eventName: eventName.trim(),
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
      requiresBankSetup,
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

              const preparedUpload = await videoEditService.compressForUpload(uploadSnapshot.videoUri!, {
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
                const thumbnailUpload = await storageService.uploadImage(thumbnailBuffer, thumbnailPath, thumbnailExtension === "png" ? "image/png" : thumbnailExtension === "webp" ? "image/webp" : "image/jpeg", "images");
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
                title: uploadSnapshot.eventName,
                description: uploadSnapshot.description,
                location_name: uploadSnapshot.location.name || "Location not specified",
                location_city: uploadSnapshot.location.city || "",
                location_country: uploadSnapshot.location.country || "",
                location_coordinates:
                  hasFiniteCoordinates(uploadSnapshot.location.latitude, uploadSnapshot.location.longitude)
                    ? `POINT(${uploadSnapshot.location.longitude} ${uploadSnapshot.location.latitude})`
                    : undefined,
                event_name: uploadSnapshot.eventName,
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
                event_name: uploadSnapshot.eventName,
                description: uploadSnapshot.description || "Event created with video",
                start_date: uploadSnapshot.resolvedStartDate.toISOString(),
                end_date: uploadSnapshot.resolvedEndDate.toISOString(),
                location_name: uploadSnapshot.location.name || "Location not specified",
                location_city: uploadSnapshot.location.city || "",
                location_latitude: Number.isFinite(uploadSnapshot.location.latitude) ? uploadSnapshot.location.latitude : null,
                location_longitude: Number.isFinite(uploadSnapshot.location.longitude) ? uploadSnapshot.location.longitude : null,
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
                eventName: uploadSnapshot.eventName,
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
          return;
        }
      }
    };

    const launchManagedUpload = (initialHint: UploadNetworkHint) => {
      clearUploadDraft();
      router.replace("/(tabsbusiness)");

      void startManagedUpload(initialHint).catch((error) => {
        uploadLaunchLockRef.current = false;
        setIsUploading(false);
        useUploadTaskStore.getState().markError(useUploadTaskStore.getState().taskId || "", {
          message: getUploadFailureMessage(error),
          retryAction: () => startManagedUpload("unknown"),
        });
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
        {!permission?.granted && <TouchableOpacity onPress={requestPermission} style={{ padding: 16 }}><Text style={{ color: '#fff' }}>Enable camera to record a video</Text></TouchableOpacity>}
        {user?.user_type === 'business' && <View style={{ padding: 16 }}>
          <TouchableOpacity onPress={chooseFlyer} style={{ padding: 14, backgroundColor: '#333', borderRadius: 8 }}>
            <Text style={{ color: '#fff' }}>{flyerUri ? 'Change event flyer' : 'Add event image / flyer (video optional)'}</Text>
          </TouchableOpacity>
          {flyerUri && <Image source={{ uri: flyerUri }} style={{ height: 180, marginTop: 12, borderRadius: 8 }} contentFit="contain" />}
        </View>}
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
            <Text style={styles.inputLabel}>Event Name</Text>
            <TextInput
              style={styles.textInput}
              value={eventName}
              onChangeText={setEventName}
              placeholder="Enter event name"
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

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Start Date & Time</Text>
            <View style={styles.dateTimeRow}>
              <TouchableOpacity style={styles.dateTimeButton} onPress={() => openDateTimePicker("start-date")}>
                <Calendar size={18} color={Colors.dark.primary} />
                <Text style={styles.dateTimeButtonText}>{formatPickerDateLabel(eventDate)}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.dateTimeButton} onPress={() => openDateTimePicker("start-time")}>
                <Clock size={18} color={Colors.dark.primary} />
                <Text style={styles.dateTimeButtonText}>{formatPickerTimeLabel(eventDate)}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>End Date & Time</Text>
            <View style={styles.dateTimeRow}>
              <TouchableOpacity style={styles.dateTimeButton} onPress={() => openDateTimePicker("end-date")}>
                <Calendar size={18} color={Colors.dark.primary} />
                <Text style={styles.dateTimeButtonText}>{formatPickerDateLabel(eventEndDate)}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.dateTimeButton} onPress={() => openDateTimePicker("end-time")}>
                <Clock size={18} color={Colors.dark.primary} />
                <Text style={styles.dateTimeButtonText}>{formatPickerTimeLabel(eventEndDate)}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {activeDatePicker && Platform.OS === "ios" && (
            <View>
              <View style={styles.pickerDoneRow}>
                <TouchableOpacity onPress={handlePickerCancel} style={styles.pickerActionButton}>
                  <Text style={styles.pickerCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handlePickerDone} style={styles.pickerActionButton}>
                  <Text style={styles.pickerDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerInitialValue}
                mode={activeDatePicker.endsWith("date") ? "date" : "time"}
                display="spinner"
                is24Hour={false}
                onChange={handleDateTimePickerChange}
                minimumDate={
                  activeDatePicker === "start-date"
                    ? getCurrentMinimumStartDate()
                    : activeDatePicker === "end-date"
                    ? getMinimumEndDate(eventDate)
                    : undefined
                }
              />
            </View>
          )}

          {user?.user_type === "business" && !businessBankAccount && !isBankAccountLoading && (
            <View style={styles.bankSetupSection}>
              <Text style={styles.bankSetupTitle}>Link Bank Account</Text>
              <Text style={styles.bankSetupSubtitle}>
                Required once before your first business event upload. We will use your linked wallet bank account for event payouts.
              </Text>

              <TouchableOpacity
                style={styles.locationButton}
                onPress={() => router.push("/bank-accounts")}
                activeOpacity={0.85}
              >
                <Text style={styles.locationButtonText}>Open Bank Account Setup</Text>
              </TouchableOpacity>
            </View>
          )}

          {user?.user_type === "business" && !!businessBankAccount && (
            <View style={styles.bankSetupSection}>
              <Text style={styles.bankSetupTitle}>Linked Bank Account</Text>
              <Text style={styles.bankLinkedSummary}>{businessBankAccount.bankName} · {businessBankAccount.accountName}</Text>
              <Text style={styles.bankLinkedDetails}>
                Account ending {(businessBankAccount.iban || businessBankAccount.accountNumber || "").slice(-4) || "N/A"}
              </Text>
              <Text style={styles.bankLinkedDetails}>
                Status: {businessBankAccount.verificationStatus || (businessBankAccount.isVerified ? 'verified' : 'pending')}
              </Text>
              {!!businessBankAccount.verificationReason && (
                <Text style={styles.bankLinkedDetails}>Reason: {businessBankAccount.verificationReason}</Text>
              )}
            </View>
          )}

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
