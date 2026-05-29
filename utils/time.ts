export const formatRelativeUploadTime = (value: unknown): string | null => {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(String(value));
  const time = date.getTime();

  if (!Number.isFinite(time)) return null;

  const diffMs = Date.now() - time;
  const absDiffMs = Math.max(0, diffMs);

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (absDiffMs < minuteMs) return 'just now';

  if (absDiffMs < hourMs) {
    const minutes = Math.floor(absDiffMs / minuteMs);
    return `${minutes}m ago`;
  }

  if (absDiffMs < dayMs) {
    const hours = Math.floor(absDiffMs / hourMs);
    return `${hours}h ago`;
  }

  if (absDiffMs < 7 * dayMs) {
    const days = Math.floor(absDiffMs / dayMs);
    return `${days}d ago`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};
