export function venueCoordinates(location: { latitude?: unknown; longitude?: unknown } | null | undefined): { latitude: number; longitude: number } | null {
  const coordinate = (value: unknown) => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  const latitude = coordinate(location?.latitude);
  const longitude = coordinate(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}

export type VenueSelection = {
  name: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
};

/** Resolve a device venue only when permission is already granted. */
export async function resolveCurrentVenueSelection(dependencies: {
  getPermission: () => Promise<{ status: string }>;
  getPosition: () => Promise<{ coords?: { latitude?: unknown; longitude?: unknown } } | null>;
  reverseGeocode: (coordinates: { latitude: number; longitude: number }) => Promise<Array<{
    name?: string | null;
    street?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
  }>>;
}): Promise<VenueSelection | null> {
  const permission = await dependencies.getPermission();
  if (permission.status !== 'granted') return null;

  const position = await dependencies.getPosition();
  const coordinates = venueCoordinates(position?.coords);
  if (!coordinates) return null;

  let address: Awaited<ReturnType<typeof dependencies.reverseGeocode>> = [];
  try {
    address = await dependencies.reverseGeocode(coordinates);
  } catch {
    // Valid coordinates remain selectable even if reverse geocoding is unavailable.
  }
  const first = address[0];
  const name = [first?.name, first?.street, first?.city, first?.region, first?.country]
    .filter(Boolean)
    .join(', ');

  return {
    ...coordinates,
    name: name || `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`,
    city: first?.city || first?.region || '',
    country: first?.country || '',
  };
}

/** PostgreSQL point and WKT use longitude first; the UI uses latitude first. */
export function videoVenueCoordinates(row: { location_coordinates?: unknown; location_latitude?: unknown; location_longitude?: unknown }) {
  const point = typeof row.location_coordinates === 'string'
    ? row.location_coordinates.match(/^(?:POINT\s*)?\(\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*\)$/i)
    : null;
  return point
    ? venueCoordinates({ longitude: point[1], latitude: point[2] })
    : venueCoordinates({ latitude: row.location_latitude, longitude: row.location_longitude });
}
