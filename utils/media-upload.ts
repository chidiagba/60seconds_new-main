import * as FileSystem from "expo-file-system/legacy";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const stripUriDecoration = (uri: string) => uri.split("?")[0]?.split("#")[0] ?? uri;

export const getSafeFileExtension = (
  uri: string,
  allowedExtensions: readonly string[],
  fallbackExtension: string
) => {
  const cleanUri = stripUriDecoration(uri);
  const lastSegment = cleanUri.split("/").pop() ?? "";
  const match = lastSegment.match(/\.([a-z0-9]+)$/i);
  const extension = match?.[1]?.toLowerCase();

  if (extension && allowedExtensions.includes(extension)) {
    return extension;
  }

  return fallbackExtension;
};

const ensureReadableUri = async (uri: string, extension: string) => {
  if (
    !uri.startsWith("content://") &&
    !uri.startsWith("ph://") &&
    !uri.startsWith("assets-library://")
  ) {
    return uri;
  }

  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) {
    throw new Error("Local cache directory is unavailable.");
  }

  const targetUri = `${cacheDirectory}upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
  await FileSystem.copyAsync({ from: uri, to: targetUri });
  return targetUri;
};

const decodeBase64ToArrayBuffer = (value: string): ArrayBuffer => {
  const clean = value.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const byteLength = Math.max(0, (clean.length * 3) / 4 - padding);
  const bytes = new Uint8Array(byteLength);

  let byteIndex = 0;

  for (let index = 0; index < clean.length; index += 4) {
    const chunkA = BASE64_ALPHABET.indexOf(clean[index] ?? "A");
    const chunkB = BASE64_ALPHABET.indexOf(clean[index + 1] ?? "A");
    const chunkC = clean[index + 2] === "=" ? 0 : BASE64_ALPHABET.indexOf(clean[index + 2] ?? "A");
    const chunkD = clean[index + 3] === "=" ? 0 : BASE64_ALPHABET.indexOf(clean[index + 3] ?? "A");

    if (chunkA < 0 || chunkB < 0 || chunkC < 0 || chunkD < 0) {
      throw new Error("Invalid base64 media payload.");
    }

    const combined = (chunkA << 18) | (chunkB << 12) | (chunkC << 6) | chunkD;

    if (byteIndex < byteLength) {
      bytes[byteIndex++] = (combined >> 16) & 0xff;
    }

    if (clean[index + 2] !== "=" && byteIndex < byteLength) {
      bytes[byteIndex++] = (combined >> 8) & 0xff;
    }

    if (clean[index + 3] !== "=" && byteIndex < byteLength) {
      bytes[byteIndex++] = combined & 0xff;
    }
  }

  return bytes.buffer;
};

export const readUriAsArrayBuffer = async (
  uri: string,
  options: {
    allowedExtensions: readonly string[];
    fallbackExtension: string;
  }
) => {
  const extension = getSafeFileExtension(uri, options.allowedExtensions, options.fallbackExtension);
  const readableUri = await ensureReadableUri(uri, extension);

  try {
    const response = await fetch(readableUri);
    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    return {
      arrayBuffer: await response.arrayBuffer(),
      extension,
      readableUri,
    };
  } catch (fetchError) {
    try {
      const base64 = await FileSystem.readAsStringAsync(readableUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      return {
        arrayBuffer: decodeBase64ToArrayBuffer(base64),
        extension,
        readableUri,
      };
    } catch (fileSystemError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      const fallbackMessage =
        fileSystemError instanceof Error ? fileSystemError.message : String(fileSystemError);
      throw new Error(`Unable to read media for upload. ${message}. ${fallbackMessage}`);
    }
  }
};