import { NativeModules, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

let FFmpegKit: any = null;
let ReturnCode: any = null;
let ffmpegModuleLoadAttempted = false;

function loadFFmpegKitFromPackage(packageName: string) {
  if (packageName === "ffmpeg-kit-react-native") {
    return require("ffmpeg-kit-react-native");
  }

  return null;
}

function ensureFFmpegModuleLoaded() {
  if (ffmpegModuleLoadAttempted) {
    return;
  }

  ffmpegModuleLoadAttempted = true;

  const nativeModule = NativeModules.FFmpegKitReactNativeModule as Record<string, unknown> | undefined;
  const hasCallableNativeModule = !!nativeModule && typeof nativeModule.ffmpegSession === "function";

  if (!hasCallableNativeModule) {
    return;
  }

  const packageCandidates = ["ffmpeg-kit-react-native"];

  for (const packageName of packageCandidates) {
    try {
      const m = loadFFmpegKitFromPackage(packageName);
      if (m?.FFmpegKit && m?.ReturnCode) {
        FFmpegKit = m.FFmpegKit;
        ReturnCode = m.ReturnCode;
        return;
      }
    } catch {
      // Try next package candidate.
    }
  }
}

type FlipDirection = "horizontal" | "vertical";
type FrameStyle = "neon" | "classic" | "cinema" | "minimal" | "gold";
type EffectStyle = "noir" | "vivid" | "warm" | "sepia" | "cool" | "retro";

type CompressForUploadOptions = {
  durationMs?: number | null;
  maxDimension?: number;
};

type CompressForUploadResult = {
  uri: string;
  didCompress: boolean;
  originalSizeBytes: number | null;
  outputSizeBytes: number | null;
};

class VideoEditService {
  isSupported(): boolean {
    ensureFFmpegModuleLoaded();
    return Platform.OS !== "web" && !!FFmpegKit && !!ReturnCode;
  }

  private async getFileSizeBytes(uri: string): Promise<number | null> {
    try {
      const fileInfo = await FileSystem.getInfoAsync(uri);
      return fileInfo.exists && typeof fileInfo.size === "number" ? fileInfo.size : null;
    } catch {
      return null;
    }
  }

  private async ensureLocalFile(inputUri: string, filePrefix: string): Promise<string> {
    if (inputUri.startsWith("file://")) {
      return inputUri;
    }

    const cleaned = inputUri.split("?")[0];
    const extension = cleaned.split(".").pop()?.toLowerCase() || "mp4";
    const outputUri = `${FileSystem.cacheDirectory}${filePrefix}_${Date.now()}.${extension}`;

    // Library pickers on Android/iOS often return local content URIs, not network URLs.
    if (
      inputUri.startsWith("content://") ||
      inputUri.startsWith("ph://") ||
      inputUri.startsWith("assets-library://")
    ) {
      await FileSystem.copyAsync({ from: inputUri, to: outputUri });
      return outputUri;
    }

    const { uri, status } = await FileSystem.downloadAsync(inputUri, outputUri);
    if (status !== 200) {
      throw new Error(`Failed to download remote file (${status})`);
    }
    return uri;
  }

  private async runFilter(
    inputUri: string,
    filterChain: string,
    options?: { fast?: boolean }
  ): Promise<string> {
    if (!this.isSupported()) {
      throw new Error("Video editing is not available on this device build.");
    }

    const localVideoUri = await this.ensureLocalFile(inputUri, "edit_src");
    const inputPath = localVideoUri.replace(/^file:\/\//, "");
    const outputUri = `${FileSystem.cacheDirectory}edit_out_${Date.now()}.mp4`;
    const outputPath = outputUri.replace(/^file:\/\//, "");
    const qValue = options?.fast ? "8" : "5";

    const session = await FFmpegKit.executeWithArguments([
      "-y",
      "-i",
      inputPath,
      "-vf",
      filterChain,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "mpeg4",
      "-q:v",
      qValue,
      "-threads",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    const rc = await session.getReturnCode();
    if (ReturnCode.isSuccess(rc)) {
      return outputUri;
    }

    const logs = await session.getAllLogsAsString();
    throw new Error(`FFmpeg failed (${rc}): ${(logs ?? "").slice(-600)}`);
  }

  async trimVideo(inputUri: string, durationSeconds: number): Promise<string> {
    if (!this.isSupported()) {
      throw new Error("Video editing is not available on this device build.");
    }

    const localVideoUri = await this.ensureLocalFile(inputUri, "trim_src");
    const inputPath = localVideoUri.replace(/^file:\/\//, "");
    const outputUri = `${FileSystem.cacheDirectory}trim_out_${Date.now()}.mp4`;
    const outputPath = outputUri.replace(/^file:\/\//, "");

    const safeDuration = Math.max(1, Math.floor(durationSeconds));

    const session = await FFmpegKit.executeWithArguments([
      "-y",
      "-i",
      inputPath,
      "-ss",
      "0",
      "-t",
      String(safeDuration),
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "mpeg4",
      "-q:v",
      "5",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    const rc = await session.getReturnCode();
    if (ReturnCode.isSuccess(rc)) {
      return outputUri;
    }

    const logs = await session.getAllLogsAsString();
    throw new Error(`FFmpeg trim failed (${rc}): ${(logs ?? "").slice(-600)}`);
  }

  async flipVideo(inputUri: string, direction: FlipDirection): Promise<string> {
    const filter = direction === "horizontal" ? "hflip" : "vflip";
    return this.runFilter(inputUri, filter);
  }

  async addFrame(inputUri: string, style: FrameStyle): Promise<string> {
    const frameFilterMap: Record<FrameStyle, string> = {
      neon: "pad=iw+80:ih+80:40:40:color=#5B5BFF",
      classic: "pad=iw+64:ih+64:32:32:color=#F5E9D2",
      cinema: "pad=iw:ih+120:0:60:color=#000000",
      minimal: "pad=iw+36:ih+36:18:18:color=#FFFFFF",
      gold: "pad=iw+72:ih+72:36:36:color=#D4AF37",
    };

    return this.runFilter(inputUri, frameFilterMap[style]);
  }

  async applyEffect(inputUri: string, effect: EffectStyle): Promise<string> {
    const effectFilterMap: Record<EffectStyle, string> = {
      noir: "hue=s=0,eq=contrast=1.15:brightness=-0.03",
      vivid: "eq=saturation=1.35:contrast=1.1:brightness=0.02",
      warm: "colorbalance=rs=0.08:gs=0.02:bs=-0.04",
      sepia: "colorchannelmixer=.393:.769:.189:.349:.686:.168:.272:.534:.131",
      cool: "colorbalance=rs=-0.03:gs=0.02:bs=0.08,eq=contrast=1.04",
      retro: "eq=saturation=0.82:contrast=1.08:brightness=0.01,curves=preset=vintage",
    };

    return this.runFilter(inputUri, effectFilterMap[effect], { fast: true });
  }

  async compressForUpload(
    inputUri: string,
    options: CompressForUploadOptions = {}
  ): Promise<CompressForUploadResult> {
    const localVideoUri = await this.ensureLocalFile(inputUri, "upload_src");
    const originalSizeBytes = await this.getFileSizeBytes(localVideoUri);
    const shouldSkipCompression =
      Platform.OS === "web" ||
      Platform.OS === "android" ||
      !this.isSupported() ||
      (typeof originalSizeBytes === "number" && originalSizeBytes <= 8 * 1024 * 1024);

    if (shouldSkipCompression) {
      return {
        uri: localVideoUri,
        didCompress: false,
        originalSizeBytes,
        outputSizeBytes: originalSizeBytes,
      };
    }

    const maxDimension = Math.max(480, options.maxDimension ?? 720);
    const durationSeconds = Math.max(1, Math.ceil((options.durationMs ?? 0) / 1000));
    const targetVideoBitrateKbps = durationSeconds <= 15 ? 1600 : durationSeconds <= 30 ? 2200 : 2800;
    const inputPath = localVideoUri.replace(/^file:\/\//, "");
    const outputUri = `${FileSystem.cacheDirectory}upload_compressed_${Date.now()}.mp4`;
    const outputPath = outputUri.replace(/^file:\/\//, "");
    const scaleFilter = `scale='if(gt(iw,ih),min(${maxDimension},iw),-2)':'if(gt(iw,ih),-2,min(${maxDimension},ih))':force_original_aspect_ratio=decrease,fps=30`;

    const runCompression = async () => {
      const session = await FFmpegKit.executeWithArguments([
        "-y",
        "-i",
        inputPath,
        "-vf",
        scaleFilter,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "mpeg4",
        "-q:v",
        "7",
        "-threads",
        "0",
        "-b:v",
        `${targetVideoBitrateKbps}k`,
        "-maxrate",
        `${Math.round(targetVideoBitrateKbps * 1.2)}k`,
        "-bufsize",
        `${targetVideoBitrateKbps * 2}k`,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        outputPath,
      ]);

      const rc = await session.getReturnCode();
      if (ReturnCode.isSuccess(rc)) {
        return;
      }

      const logs = await session.getAllLogsAsString();
      throw new Error(`FFmpeg compression failed (${rc}): ${(logs ?? "").slice(-600)}`);
    };

    try {
      await runCompression();

      const outputSizeBytes = await this.getFileSizeBytes(outputUri);
      if (
        typeof originalSizeBytes === "number" &&
        typeof outputSizeBytes === "number" &&
        outputSizeBytes >= originalSizeBytes * 0.95
      ) {
        return {
          uri: localVideoUri,
          didCompress: false,
          originalSizeBytes,
          outputSizeBytes,
        };
      }

      return {
        uri: outputUri,
        didCompress: true,
        originalSizeBytes,
        outputSizeBytes,
      };
    } catch (error) {
      console.warn("[Upload] Compression skipped after FFmpeg failure:", error);
      return {
        uri: localVideoUri,
        didCompress: false,
        originalSizeBytes,
        outputSizeBytes: originalSizeBytes,
      };
    }
  }
}

export const videoEditService = new VideoEditService();
export type { FlipDirection, FrameStyle, EffectStyle, CompressForUploadOptions, CompressForUploadResult };
