export const WATERMARK_VERSION = 'branded_v3_fixed_bottom_right';
export const WATERMARK_OPACITY = 0.72;
export const WATERMARK_SCALE = 0.28;

export function watermarkUsername(username: string): string {
  const value = username.trim().replace(/^@+/, '');
  if (!value || value.length > 64 || /[\s\x00-\x1f\x7f]/.test(value)) {
    throw new Error('The creator username is required to export this video');
  }
  return `@${value}`;
}

/** Normalized fixed position for the playback overlay (bottom-right). */
export function watermarkCorner(_seconds: number): { x: number; y: number } {
  return { x: 1, y: 1 };
}

export function watermarkWidth(shortSide: number, scale = WATERMARK_SCALE): number {
  return Math.round(Math.min(shortSide * 0.45, Math.max(160, shortSide * scale)));
}

export function watermarkFFmpegFilter(width: number, opacity = WATERMARK_OPACITY): string {
  const margin = Math.max(4, Math.round(width * 0.06));
  return `[1:v]scale=${width}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm];[0:v][wm]overlay=x='main_w-overlay_w-${margin}':y='main_h-overlay_h-${margin}':format=auto[v]`;
}
