export type UploadNetworkHint = "online" | "weak" | "offline" | "unknown";

export interface UploadNetworkAssessment {
  hint: UploadNetworkHint;
  latencyMs: number | null;
}

const NETWORK_CHECK_URL = "https://www.gstatic.com/generate_204";

export const assessUploadNetwork = async (timeoutMs = 3500): Promise<UploadNetworkAssessment> => {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const startedAt = Date.now();

  const timeoutId = setTimeout(() => {
    controller?.abort();
  }, timeoutMs);

  try {
    const response = await fetch(NETWORK_CHECK_URL, {
      method: "GET",
      cache: "no-store",
      signal: controller?.signal,
    });

    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startedAt;
    if (!response.ok && response.status !== 204) {
      return { hint: "unknown", latencyMs };
    }

    if (latencyMs >= 1700) {
      return { hint: "weak", latencyMs };
    }

    return { hint: "online", latencyMs };
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error?.name === "AbortError") {
      return { hint: "weak", latencyMs: timeoutMs };
    }

    return { hint: "offline", latencyMs: null };
  }
};

export const getUploadNetworkTaskMessage = (
  hint: UploadNetworkHint,
  attempt: number,
  maxAttempts: number
): string => {
  if (hint === "offline") {
    return "No internet detected. Waiting to retry upload...";
  }

  if (hint === "weak") {
    return attempt === 1
      ? "Weak internet detected. Upload may be slower than usual."
      : `Weak internet detected. Retrying upload (${attempt}/${maxAttempts})...`;
  }

  if (hint === "online") {
    return attempt === 1
      ? "Your upload is running in the background."
      : `Retrying upload in the background (${attempt}/${maxAttempts}).`;
  }

  return attempt === 1
    ? "Checking internet quality while uploading..."
    : `Retrying upload in the background (${attempt}/${maxAttempts}).`;
};
