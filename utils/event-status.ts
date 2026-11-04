export type EventLifecycleStatus = 'open' | 'closed';

type EventTimingSource = {
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  eventDate?: string | null;
};

const normalizeStatus = (status?: string | null) => String(status || '').trim().toLowerCase();

const resolveCloseAt = (source: EventTimingSource): Date | null => {
  const closeAtValue = source.endDate || source.startDate || source.eventDate;
  if (!closeAtValue) {
    return null;
  }

  const closeAt = new Date(closeAtValue);
  return Number.isNaN(closeAt.getTime()) ? null : closeAt;
};

export const getEventLifecycleStatus = (
  source: EventTimingSource,
  now: Date = new Date()
): EventLifecycleStatus => {
  const status = normalizeStatus(source.status);

  if (['closed', 'cancelled', 'completed', 'ended'].includes(status)) {
    return 'closed';
  }

  const closeAt = resolveCloseAt(source);
  if (!closeAt) {
    return 'open';
  }

  return closeAt.getTime() <= now.getTime() ? 'closed' : 'open';
};

export const isEventClosed = (source: EventTimingSource, now: Date = new Date()) => {
  return getEventLifecycleStatus(source, now) === 'closed';
};
