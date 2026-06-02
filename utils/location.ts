import * as Location from 'expo-location';
import { Platform } from 'react-native';

interface GetCurrentLocationOptions {
  requestPermission?: boolean;
  maxCacheAgeMs?: number;
}

interface LiveLocationOptions {
  requestPermission?: boolean;
  minUpdateIntervalMs?: number;
  minUpdateDistanceMeters?: number;
}

type LocationListener = (location: Location.LocationObject) => void;

let cachedLocation: Location.LocationObject | null = null;
let cachedLocationAt = 0;
let inFlightLocationRequest: Promise<Location.LocationObject | null> | null = null;
let liveLocationSubscription: Location.LocationSubscription | null = null;
let liveLocationStartPromise: Promise<boolean> | null = null;
let lastLiveBroadcastAt = 0;
let lastLiveBroadcastLocation: Location.LocationObject | null = null;
const liveLocationListeners = new Set<LocationListener>();

const calculateDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const notifyLiveLocationListeners = (
  location: Location.LocationObject,
  options: Required<Pick<LiveLocationOptions, 'minUpdateIntervalMs' | 'minUpdateDistanceMeters'>>
) => {
  const now = Date.now();

  const hasEnoughTimePassed = now - lastLiveBroadcastAt >= options.minUpdateIntervalMs;
  const hasEnoughDistanceChanged = !lastLiveBroadcastLocation ||
    calculateDistanceKm(
      lastLiveBroadcastLocation.coords.latitude,
      lastLiveBroadcastLocation.coords.longitude,
      location.coords.latitude,
      location.coords.longitude
    ) * 1000 >= options.minUpdateDistanceMeters;

  // Always emit first value, then throttle to meaningful movement/time.
  if (lastLiveBroadcastLocation && !hasEnoughTimePassed && !hasEnoughDistanceChanged) {
    return;
  }

  lastLiveBroadcastAt = now;
  lastLiveBroadcastLocation = location;

  liveLocationListeners.forEach((listener) => {
    try {
      listener(location);
    } catch {
      // Keep listener failures isolated.
    }
  });
};

const stopLiveLocationUpdatesIfIdle = () => {
  if (liveLocationListeners.size > 0) return;
  if (!liveLocationSubscription) return;

  liveLocationSubscription.remove();
  liveLocationSubscription = null;
  liveLocationStartPromise = null;
  lastLiveBroadcastAt = 0;
  lastLiveBroadcastLocation = null;
};

const ensureLiveLocationUpdates = async (
  options: LiveLocationOptions = {}
): Promise<boolean> => {
  if (Platform.OS === 'web') {
    return false;
  }

  if (liveLocationSubscription) {
    return true;
  }

  if (liveLocationStartPromise) {
    return liveLocationStartPromise;
  }

  const requestPermission = options.requestPermission ?? true;
  const minUpdateIntervalMs = options.minUpdateIntervalMs ?? 15000;
  const minUpdateDistanceMeters = options.minUpdateDistanceMeters ?? 100;

  liveLocationStartPromise = (async () => {
    try {
      const permission = requestPermission
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();

      if (permission.status !== 'granted') {
        return false;
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        return false;
      }

      liveLocationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: minUpdateIntervalMs,
          distanceInterval: minUpdateDistanceMeters,
          mayShowUserSettingsDialog: false,
        },
        (location) => {
          cachedLocation = location;
          cachedLocationAt = Date.now();
          notifyLiveLocationListeners(location, {
            minUpdateIntervalMs,
            minUpdateDistanceMeters,
          });
        }
      );

      return true;
    } catch {
      return false;
    } finally {
      liveLocationStartPromise = null;
    }
  })();

  return liveLocationStartPromise;
};

/** Returns the last known location from the in-memory cache — synchronous, no permissions needed. */
export const getCachedLocation = (): Location.LocationObject | null => cachedLocation;

export const getCurrentLocation = async (
  options: GetCurrentLocationOptions = {}
): Promise<Location.LocationObject | null> => {
  const requestPermission = options.requestPermission ?? true;
  const maxCacheAgeMs = options.maxCacheAgeMs ?? 120000;

  const now = Date.now();
  if (cachedLocation && now - cachedLocationAt <= maxCacheAgeMs) {
    return cachedLocation;
  }

  if (inFlightLocationRequest) {
    return inFlightLocationRequest;
  }

  inFlightLocationRequest = (async () => {
  try {
    const permission = requestPermission
      ? await Location.requestForegroundPermissionsAsync()
      : await Location.getForegroundPermissionsAsync();
    const { status } = permission;
    
    if (status !== 'granted') {
      console.log('Location permission not granted');
      return null;
    }

    if (Platform.OS !== 'web') {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        return null;
      }
    }

    const lastKnownLocation = await Location.getLastKnownPositionAsync({
      maxAge: maxCacheAgeMs,
    });
    if (lastKnownLocation) {
      cachedLocation = lastKnownLocation;
      cachedLocationAt = Date.now();
      return lastKnownLocation;
    }

    // Add 3-second timeout so the call never hangs indefinitely
    const positionPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 3000)
    );
    const location = (await Promise.race([positionPromise, timeoutPromise])) as Location.LocationObject | null;
    if (!location) return null;

    cachedLocation = location;
    cachedLocationAt = Date.now();
    
    return location;
  } catch (error: any) {
    console.log('ℹ️ Error getting location (handled):', error.message || error);
    return null;
  } finally {
    inFlightLocationRequest = null;
  }
  })();

  return inFlightLocationRequest;
};

export const subscribeToLocationUpdates = (
  listener: LocationListener,
  options: LiveLocationOptions = {}
): (() => void) => {
  liveLocationListeners.add(listener);

  // Emit cached value immediately so UI can render a distance without waiting.
  if (cachedLocation) {
    try {
      listener(cachedLocation);
    } catch {
      // Keep listener failures isolated.
    }
  }

  void ensureLiveLocationUpdates(options);

  return () => {
    liveLocationListeners.delete(listener);
    stopLiveLocationUpdatesIfIdle();
  };
};

export const getAddressFromCoordinates = async (
  latitude: number,
  longitude: number
): Promise<string | null> => {
  try {
    const geocode = await Location.reverseGeocodeAsync({
      latitude,
      longitude,
    });
    
    if (geocode && geocode.length > 0) {
      const address = geocode[0];
      const locationName = [
        address.name,
        address.street,
        address.city,
        address.region,
        address.country
      ].filter(Boolean).join(', ');
      
      return locationName;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting address from coordinates:', error);
    return null;
  }
};

export const getCoordinatesFromAddress = async (
  address: string
): Promise<Location.LocationGeocodedLocation | null> => {
  // Wrap geocodeAsync with a hard 5-second timeout so Android never hangs for 10+ seconds.
  const GEOCODE_TIMEOUT_MS = 5000;
  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), GEOCODE_TIMEOUT_MS)
    );
    const geocodePromise = Location.geocodeAsync(address).then((results) =>
      results && results.length > 0 ? results[0] : null
    );
    const result = await Promise.race([geocodePromise, timeoutPromise]);
    return result;
  } catch (error) {
    // Suppress noisy Android DEADLINE_EXCEEDED logs — callers treat null as "unavailable".
    return null;
  }
};

export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const coords = [lat1, lon1, lat2, lon2];
  if (coords.some((coord) => !Number.isFinite(coord))) {
    return Number.NaN;
  }

  // Haversine formula to calculate distance between two points on Earth
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in km
  
  return distance;
};

export const formatDistance = (distance: number): string => {
  if (!Number.isFinite(distance) || distance < 0) {
    return '';
  }

  // Show distances in whole KM (no decimal), like Google Maps directions.
  // For distances under 1 km, show in meters (rounded to nearest 10 m).
  if (distance < 1) {
    const meters = Math.round(distance * 100) * 10;
    return `${meters} m`;
  }

  return `${Math.round(distance)} km`;
};

// In-memory cache: "lat1,lon1,lat2,lon2" → road distance in km
const roadDistanceCache = new Map<string, number>();

/**
 * Returns the road/driving distance in km between two coordinates using the
 * OSRM public routing engine (OpenStreetMap data, no API key required).
 * Falls back to Haversine straight-line distance if the route cannot be
 * resolved or the request fails.
 */
export const calculateRoadDistance = async (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): Promise<number> => {
  const coords = [lat1, lon1, lat2, lon2];
  if (coords.some((c) => !Number.isFinite(c))) {
    return Number.NaN;
  }

  // Round to ~100 m precision for cache key to avoid near-duplicate fetches.
  const cacheKey = [lat1, lon1, lat2, lon2]
    .map((v) => v.toFixed(3))
    .join(',');

  const cached = roadDistanceCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.code === 'Ok' && typeof data?.routes?.[0]?.distance === 'number') {
        const distanceKm = data.routes[0].distance / 1000;
        roadDistanceCache.set(cacheKey, distanceKm);
        return distanceKm;
      }
    }
  } catch {
    // Network error or timeout — fall through to Haversine fallback.
  }

  // Fallback: straight-line Haversine distance.
  const fallback = calculateDistance(lat1, lon1, lat2, lon2);
  roadDistanceCache.set(cacheKey, fallback);
  return fallback;
};