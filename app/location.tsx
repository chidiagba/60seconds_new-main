import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Search, MapPin, Check } from "lucide-react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";

import Colors from "@/constants/colors";
import { getCurrentLocation } from "@/utils/location";

type LatLng = { latitude: number; longitude: number };

const DEFAULT_DELTA = { latitudeDelta: 0.02, longitudeDelta: 0.02 };

// --- Native-only lazy require (prevents web crashes / undefined component errors)
function useNativeMaps() {
  return useMemo(() => {
    if (Platform.OS === "web") return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const maps = require("react-native-maps");
      return {
        MapView: maps.default,
        Marker: maps.Marker,
        PROVIDER_GOOGLE: maps.PROVIDER_GOOGLE,
      };
    } catch {
      return null;
    }
  }, []);
}

export default function LocationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ from?: string; lat?: string; lng?: string; name?: string; eventName?: string }>();

  // View mode: when lat/lng are passed, show the event pin (no picker UI)
  const viewLat = params.lat ? Number(params.lat) : null;
  const viewLng = params.lng ? Number(params.lng) : null;
  const isViewMode = viewLat !== null && Number.isFinite(viewLat) && viewLng !== null && Number.isFinite(viewLng);
  const viewEventName = params.eventName || params.name || "Event Location";

  const maps = useNativeMaps();

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LatLng | null>(null);
  const [locationName, setLocationName] = useState("");

  // ✅ store city/country for upload screen
  const [locationMeta, setLocationMeta] = useState<{ city?: string; country?: string }>({});

  const [results, setResults] = useState<
    { id: string; name: string; address: string; coords: LatLng }[]
  >([]);

  const mapRef = useRef<any>(null);

  const region = useMemo(() => {
    const base = selectedLocation || currentLocation;
    if (!base) return null;
    return { ...base, ...DEFAULT_DELTA };
  }, [selectedLocation, currentLocation]);

  const buildPrettyAddress = useCallback((a: Location.LocationGeocodedAddress) => {
    return [a.name, a.street, a.city, a.region, a.country].filter(Boolean).join(", ");
  }, []);

  const reverseToName = useCallback(
    async (coords: LatLng) => {
      try {
        const geocode = await Location.reverseGeocodeAsync(coords);
        if (geocode?.length) {
          const a = geocode[0];
          const pretty = buildPrettyAddress(a);
          setLocationName(pretty);

          setLocationMeta({
            city: a.city || a.region || "",
            country: a.country || "",
          });
        } else {
          setLocationName(`(${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)})`);
          setLocationMeta({});
        }
      } catch {
        setLocationName(`(${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)})`);
        setLocationMeta({});
      }
    },
    [buildPrettyAddress]
  );

  // Initial setup
  useEffect(() => {
    if (isViewMode) {
      // View mode: pin the event location
      const eventCoords = { latitude: viewLat!, longitude: viewLng! };
      setSelectedLocation(eventCoords);
      setLocationName(params.name || viewEventName);
      return;
    }

    // Picker mode: resolve user's current location
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      try {
        const loc = await getCurrentLocation();
        if (!loc) return;

        const coords = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };

        setCurrentLocation(coords);
        setSelectedLocation(coords);
        await reverseToName(coords);
      } catch (e) {
        console.error("Error getting location:", e);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUseCurrent = useCallback(async () => {
    Keyboard.dismiss();
    try {
      const loc = await getCurrentLocation();
      if (!loc) return;

      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };

      setSelectedLocation(coords);
      await reverseToName(coords);

      if (mapRef.current?.animateToRegion) {
        mapRef.current.animateToRegion({ ...coords, ...DEFAULT_DELTA }, 450);
      }
    } catch (e) {
      console.error("Error using current location:", e);
    }
  }, [reverseToName]);

  // Search using Expo Location (no Google Places needed)
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;

    Keyboard.dismiss();
    setIsSearching(true);
    setResults([]);

    try {
      const geocoded = await Location.geocodeAsync(q);
      if (!geocoded?.length) {
        setResults([]);
        return;
      }

      const next = geocoded.slice(0, 6).map((g, idx) => {
        const coords = { latitude: g.latitude, longitude: g.longitude };
        return {
          id: String(idx + 1),
          name: q,
          address: `${g.latitude.toFixed(4)}, ${g.longitude.toFixed(4)}`,
          coords,
        };
      });

      setResults(next);
    } catch (e) {
      console.error("Search error:", e);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const selectResult = useCallback(
    async (item: { coords: LatLng }) => {
      setResults([]);
      setSelectedLocation(item.coords);
      await reverseToName(item.coords);

      if (mapRef.current?.animateToRegion) {
        mapRef.current.animateToRegion({ ...item.coords, ...DEFAULT_DELTA }, 450);
      }
    },
    [reverseToName]
  );

  const onMapPress = useCallback(
    async (e: any) => {
      const coords = e?.nativeEvent?.coordinate as LatLng | undefined;
      if (!coords) return;
      setSelectedLocation(coords);
      await reverseToName(coords);
    },
    [reverseToName]
  );

  const onMarkerDragEnd = useCallback(
    async (e: any) => {
      const coords = e?.nativeEvent?.coordinate as LatLng | undefined;
      if (!coords) return;
      setSelectedLocation(coords);
      await reverseToName(coords);
    },
    [reverseToName]
  );

  // ✅ CONFIRM: send location back to Upload using router.replace + params
  const handleConfirm = useCallback(() => {
    if (!selectedLocation) return;

    const backTo = typeof params.from === "string" && params.from.length ? params.from : "/upload";

    router.replace({
      pathname: backTo,
      params: {
        locationName: locationName || "",
        latitude: String(selectedLocation.latitude),
        longitude: String(selectedLocation.longitude),
        city: locationMeta.city || "",
        country: locationMeta.country || "",
      },
    });
  }, [router, selectedLocation, params.from, locationName, locationMeta.city, locationMeta.country]);

  const MapViewComp = maps?.MapView;
  const MarkerComp = maps?.Marker;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Select Location</Text>

          <View style={styles.headerRight} />
        </View>

        {/* Search — only shown in picker mode */}
        {!isViewMode && (
        <View style={styles.searchContainer}>
          <View style={styles.searchInputContainer}>
            <Search size={20} color={Colors.dark.subtext} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search for a location"
              placeholderTextColor={Colors.dark.subtext}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
          </View>

          <TouchableOpacity style={styles.currentLocationButton} onPress={handleUseCurrent}>
            <MapPin size={20} color={Colors.dark.primary} />
            <Text style={styles.currentLocationText}>Use Current</Text>
          </TouchableOpacity>
        </View>
        )}

        {/* Results or Map */}
        {isSearching ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.dark.primary} />
            <Text style={styles.loadingText}>Searching...</Text>
          </View>
        ) : results.length > 0 ? (
          <View style={styles.resultsContainer}>
            {results.map((r) => (
              <TouchableOpacity key={r.id} style={styles.resultItem} onPress={() => selectResult(r)}>
                <MapPin size={20} color={Colors.dark.primary} style={styles.resultIcon} />
                <View style={styles.resultTextContainer}>
                  <Text style={styles.resultName}>{r.name}</Text>
                  <Text style={styles.resultAddress}>{r.address}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.mapWrap}>
            {/* Web placeholder */}
            {Platform.OS === "web" || !MapViewComp || !MarkerComp || !region ? (
              <View style={styles.webMapPlaceholder}>
                <Text style={styles.webMapText}>Map View</Text>
                <Text style={styles.webMapSubtext}>
                  {selectedLocation
                    ? `Selected: ${selectedLocation.latitude.toFixed(6)}, ${selectedLocation.longitude.toFixed(6)}`
                    : "Select a location"}
                </Text>
              </View>
            ) : (
              <MapViewComp
                ref={mapRef}
                style={StyleSheet.absoluteFill}
                provider={Platform.OS === "android" ? maps.PROVIDER_GOOGLE : undefined}
                initialRegion={region}
                region={region}
                onPress={isViewMode ? undefined : onMapPress}
              >
                {(selectedLocation || currentLocation) && (
                  <MarkerComp
                    coordinate={(selectedLocation || currentLocation)!}
                    draggable={!isViewMode}
                    onDragEnd={isViewMode ? undefined : onMarkerDragEnd}
                    title={isViewMode ? viewEventName : undefined}
                  />
                )}
              </MapViewComp>
            )}

            {/* Bottom floating panel */}
            <View style={[styles.bottomPanel, { paddingBottom: Math.max(12, insets.bottom + 10) }]}>
              <View style={styles.selectedRow}>
                <MapPin size={22} color={Colors.dark.primary} style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.selectedLabel}>{isViewMode ? "Event Location" : "Selected Location"}</Text>
                  <Text style={styles.selectedName} numberOfLines={2}>
                    {locationName ||
                      (selectedLocation
                        ? `(${selectedLocation.latitude.toFixed(4)}, ${selectedLocation.longitude.toFixed(4)})`
                        : "—")}
                  </Text>
                  {selectedLocation && (
                    <Text style={styles.coordsText}>
                      {selectedLocation.latitude.toFixed(6)}, {selectedLocation.longitude.toFixed(6)}
                    </Text>
                  )}
                </View>
              </View>

              {!isViewMode && (
              <TouchableOpacity
                style={[styles.confirmButton, { opacity: selectedLocation ? 1 : 0.5 }]}
                disabled={!selectedLocation}
                onPress={handleConfirm}
              >
                <Check size={20} color="#fff" />
                <Text style={styles.confirmButtonText}>Confirm</Text>
              </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.dark.background },
  container: { flex: 1, backgroundColor: Colors.dark.background },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
  headerRight: { width: 40 },

  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginRight: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 40, color: Colors.dark.text, fontSize: 16 },
  currentLocationButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(138, 43, 226, 0.1)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  currentLocationText: { color: Colors.dark.primary, marginLeft: 4, fontSize: 14 },

  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 16, color: Colors.dark.text, fontSize: 16 },

  resultsContainer: { flex: 1, padding: 16 },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  resultIcon: { marginRight: 12 },
  resultTextContainer: { flex: 1 },
  resultName: { fontSize: 16, fontWeight: "500", color: Colors.dark.text, marginBottom: 4 },
  resultAddress: { fontSize: 14, color: Colors.dark.subtext },

  mapWrap: { flex: 1 },
  webMapPlaceholder: {
    flex: 1,
    backgroundColor: "#2c2c2c",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  webMapText: { color: Colors.dark.text, fontSize: 20, fontWeight: "bold", marginBottom: 12 },
  webMapSubtext: { color: Colors.dark.subtext, textAlign: "center", fontSize: 16 },

  bottomPanel: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: Colors.dark.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dark.divider,
  },
  selectedRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  selectedLabel: { fontSize: 13, color: Colors.dark.subtext, marginBottom: 4 },
  selectedName: { fontSize: 15, fontWeight: "600", color: Colors.dark.text },
  coordsText: { marginTop: 4, fontSize: 12, color: Colors.dark.subtext },

  confirmButton: {
    backgroundColor: Colors.dark.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
  },
  confirmButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold", marginLeft: 8 },
});













// import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   TextInput,
//   Platform,
//   ActivityIndicator,
//   Keyboard,
// } from "react-native";
// import { useRouter } from "expo-router";
// import { ArrowLeft, Search, MapPin, Check } from "lucide-react-native";
// import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
// import * as Location from "expo-location";

// import Colors from "@/constants/colors";
// import { getCurrentLocation } from "@/utils/location";

// type LatLng = { latitude: number; longitude: number };

// const DEFAULT_DELTA = { latitudeDelta: 0.02, longitudeDelta: 0.02 };

// // --- Native-only lazy require (prevents web crashes / undefined component errors)
// function useNativeMaps() {
//   return useMemo(() => {
//     if (Platform.OS === "web") return null;
//     try {
//       // eslint-disable-next-line @typescript-eslint/no-var-requires
//       const maps = require("react-native-maps");
//       return {
//         MapView: maps.default,
//         Marker: maps.Marker,
//         PROVIDER_GOOGLE: maps.PROVIDER_GOOGLE,
//       };
//     } catch {
//       return null;
//     }
//   }, []);
// }

// export default function LocationScreen() {
//   const router = useRouter();
//   const insets = useSafeAreaInsets();

//   const maps = useNativeMaps();

//   const [searchQuery, setSearchQuery] = useState("");
//   const [isSearching, setIsSearching] = useState(false);

//   const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
//   const [selectedLocation, setSelectedLocation] = useState<LatLng | null>(null);
//   const [locationName, setLocationName] = useState("");

//   const [results, setResults] = useState<
//     { id: string; name: string; address: string; coords: LatLng }[]
//   >([]);

//   const mapRef = useRef<any>(null);

//   const region = useMemo(() => {
//     const base = selectedLocation || currentLocation;
//     if (!base) return null;
//     return { ...base, ...DEFAULT_DELTA };
//   }, [selectedLocation, currentLocation]);

//   const buildPrettyAddress = useCallback((a: Location.LocationGeocodedAddress) => {
//     return [a.name, a.street, a.city, a.region, a.country].filter(Boolean).join(", ");
//   }, []);

//   const reverseToName = useCallback(
//     async (coords: LatLng) => {
//       try {
//         const geocode = await Location.reverseGeocodeAsync(coords);
//         if (geocode?.length) {
//           setLocationName(buildPrettyAddress(geocode[0]));
//         } else {
//           setLocationName(`(${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)})`);
//         }
//       } catch {
//         setLocationName(`(${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)})`);
//       }
//     },
//     [buildPrettyAddress]
//   );

//   // Initial: permission + current location
//   useEffect(() => {
//     (async () => {
//       const { status } = await Location.requestForegroundPermissionsAsync();
//       if (status !== "granted") return;

//       try {
//         const loc = await getCurrentLocation();
//         if (!loc) return;

//         const coords = {
//           latitude: loc.coords.latitude,
//           longitude: loc.coords.longitude,
//         };

//         setCurrentLocation(coords);
//         setSelectedLocation(coords);
//         await reverseToName(coords);
//       } catch (e) {
//         console.error("Error getting location:", e);
//       }
//     })();
//   }, [reverseToName]);

//   const handleUseCurrent = useCallback(async () => {
//     Keyboard.dismiss();
//     try {
//       const loc = await getCurrentLocation();
//       if (!loc) return;

//       const coords = {
//         latitude: loc.coords.latitude,
//         longitude: loc.coords.longitude,
//       };

//       setSelectedLocation(coords);
//       await reverseToName(coords);

//       // Move camera
//       if (mapRef.current?.animateToRegion) {
//         mapRef.current.animateToRegion({ ...coords, ...DEFAULT_DELTA }, 450);
//       }
//     } catch (e) {
//       console.error("Error using current location:", e);
//     }
//   }, [reverseToName]);

//   // Search using Expo Location (no Google Places needed)
//   const handleSearch = useCallback(async () => {
//     const q = searchQuery.trim();
//     if (!q) return;

//     Keyboard.dismiss();
//     setIsSearching(true);
//     setResults([]);

//     try {
//       const geocoded = await Location.geocodeAsync(q);
//       if (!geocoded?.length) {
//         setResults([]);
//         return;
//       }

//       const next = geocoded.slice(0, 6).map((g, idx) => {
//         const coords = { latitude: g.latitude, longitude: g.longitude };
//         return {
//           id: String(idx + 1),
//           name: q,
//           address: `${g.latitude.toFixed(4)}, ${g.longitude.toFixed(4)}`,
//           coords,
//         };
//       });

//       setResults(next);
//     } catch (e) {
//       console.error("Search error:", e);
//       setResults([]);
//     } finally {
//       setIsSearching(false);
//     }
//   }, [searchQuery]);

//   const selectResult = useCallback(
//     async (item: { coords: LatLng }) => {
//       setResults([]);
//       setSelectedLocation(item.coords);
//       await reverseToName(item.coords);

//       if (mapRef.current?.animateToRegion) {
//         mapRef.current.animateToRegion({ ...item.coords, ...DEFAULT_DELTA }, 450);
//       }
//     },
//     [reverseToName]
//   );

//   // Tap on map -> place marker
//   const onMapPress = useCallback(
//     async (e: any) => {
//       const coords = e?.nativeEvent?.coordinate as LatLng | undefined;
//       if (!coords) return;
//       setSelectedLocation(coords);
//       await reverseToName(coords);
//     },
//     [reverseToName]
//   );

//   // Drag marker -> update coords + name
//   const onMarkerDragEnd = useCallback(
//     async (e: any) => {
//       const coords = e?.nativeEvent?.coordinate as LatLng | undefined;
//       if (!coords) return;
//       setSelectedLocation(coords);
//       await reverseToName(coords);
//     },
//     [reverseToName]
//   );

//   const handleConfirm = useCallback(() => {
//     if (!selectedLocation) return;

//     // ✅ Here you can pass back params if you want (example):
//     // router.back(); // current behavior
//     // OR: router.replace({ pathname: "...", params: { lat: ..., lng: ..., name: ... } })

//     router.back();
//   }, [router, selectedLocation]);

//   const MapViewComp = maps?.MapView;
//   const MarkerComp = maps?.Marker;

//   return (
//     <SafeAreaView style={styles.safe} edges={["top"]}>
//       <View style={styles.container}>
//         {/* Header */}
//         <View style={styles.header}>
//           <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
//             <ArrowLeft size={24} color={Colors.dark.text} />
//           </TouchableOpacity>

//           <Text style={styles.headerTitle}>Select Location</Text>

//           <View style={styles.headerRight} />
//         </View>

//         {/* Search */}
//         <View style={styles.searchContainer}>
//           <View style={styles.searchInputContainer}>
//             <Search size={20} color={Colors.dark.subtext} style={styles.searchIcon} />
//             <TextInput
//               style={styles.searchInput}
//               value={searchQuery}
//               onChangeText={setSearchQuery}
//               placeholder="Search for a location"
//               placeholderTextColor={Colors.dark.subtext}
//               returnKeyType="search"
//               onSubmitEditing={handleSearch}
//             />
//           </View>

//           <TouchableOpacity style={styles.currentLocationButton} onPress={handleUseCurrent}>
//             <MapPin size={20} color={Colors.dark.primary} />
//             <Text style={styles.currentLocationText}>Use Current</Text>
//           </TouchableOpacity>
//         </View>

//         {/* Results or Map */}
//         {isSearching ? (
//           <View style={styles.loadingContainer}>
//             <ActivityIndicator size="large" color={Colors.dark.primary} />
//             <Text style={styles.loadingText}>Searching...</Text>
//           </View>
//         ) : results.length > 0 ? (
//           <View style={styles.resultsContainer}>
//             {results.map((r) => (
//               <TouchableOpacity key={r.id} style={styles.resultItem} onPress={() => selectResult(r)}>
//                 <MapPin size={20} color={Colors.dark.primary} style={styles.resultIcon} />
//                 <View style={styles.resultTextContainer}>
//                   <Text style={styles.resultName}>{r.name}</Text>
//                   <Text style={styles.resultAddress}>{r.address}</Text>
//                 </View>
//               </TouchableOpacity>
//             ))}
//           </View>
//         ) : (
//           <View style={styles.mapWrap}>
//             {/* Web placeholder */}
//             {Platform.OS === "web" || !MapViewComp || !MarkerComp || !region ? (
//               <View style={styles.webMapPlaceholder}>
//                 <Text style={styles.webMapText}>Map View</Text>
//                 <Text style={styles.webMapSubtext}>
//                   {selectedLocation
//                     ? `Selected: ${selectedLocation.latitude.toFixed(6)}, ${selectedLocation.longitude.toFixed(
//                         6
//                       )}`
//                     : "Select a location"}
//                 </Text>
//               </View>
//             ) : (
//               <MapViewComp
//                 ref={mapRef}
//                 style={StyleSheet.absoluteFill}
//                 // ✅ Android uses Google Maps under the hood; API key required
//                 // Do NOT set provider on iOS if you want Apple Maps there.
//                 provider={Platform.OS === "android" ? maps.PROVIDER_GOOGLE : undefined}
//                 initialRegion={region}
//                 region={region}
//                 onPress={onMapPress}
//               >
//                 {(selectedLocation || currentLocation) && (
//                   <MarkerComp
//                     coordinate={(selectedLocation || currentLocation)!}
//                     draggable
//                     onDragEnd={onMarkerDragEnd}
//                   />
//                 )}
//               </MapViewComp>
//             )}

//             {/* Bottom floating panel (soft buttons se upar) */}
//             <View style={[styles.bottomPanel, { paddingBottom: Math.max(12, insets.bottom + 10) }]}>
//               <View style={styles.selectedRow}>
//                 <MapPin size={22} color={Colors.dark.primary} style={{ marginRight: 10 }} />
//                 <View style={{ flex: 1 }}>
//                   <Text style={styles.selectedLabel}>Selected Location</Text>
//                   <Text style={styles.selectedName} numberOfLines={2}>
//                     {locationName ||
//                       (selectedLocation
//                         ? `(${selectedLocation.latitude.toFixed(4)}, ${selectedLocation.longitude.toFixed(4)})`
//                         : "—")}
//                   </Text>
//                   {selectedLocation && (
//                     <Text style={styles.coordsText}>
//                       {selectedLocation.latitude.toFixed(6)}, {selectedLocation.longitude.toFixed(6)}
//                     </Text>
//                   )}
//                 </View>
//               </View>

//               <TouchableOpacity
//                 style={[
//                   styles.confirmButton,
//                   { opacity: selectedLocation ? 1 : 0.5 },
//                 ]}
//                 disabled={!selectedLocation}
//                 onPress={handleConfirm}
//               >
//                 <Check size={20} color="#fff" />
//                 <Text style={styles.confirmButtonText}>Confirm</Text>
//               </TouchableOpacity>
//             </View>
//           </View>
//         )}
//       </View>
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   safe: { flex: 1, backgroundColor: Colors.dark.background },
//   container: { flex: 1, backgroundColor: Colors.dark.background },

//   header: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "space-between",
//     paddingHorizontal: 16,
//     paddingVertical: 12,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   headerTitle: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text },
//   headerRight: { width: 40 },

//   searchContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     paddingHorizontal: 16,
//     paddingVertical: 12,
//   },
//   searchInputContainer: {
//     flex: 1,
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     paddingHorizontal: 12,
//     marginRight: 12,
//   },
//   searchIcon: { marginRight: 8 },
//   searchInput: { flex: 1, height: 40, color: Colors.dark.text, fontSize: 16 },
//   currentLocationButton: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: "rgba(138, 43, 226, 0.1)",
//     paddingHorizontal: 12,
//     paddingVertical: 8,
//     borderRadius: 8,
//   },
//   currentLocationText: { color: Colors.dark.primary, marginLeft: 4, fontSize: 14 },

//   loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
//   loadingText: { marginTop: 16, color: Colors.dark.text, fontSize: 16 },

//   resultsContainer: { flex: 1, padding: 16 },
//   resultItem: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 16,
//     marginBottom: 12,
//   },
//   resultIcon: { marginRight: 12 },
//   resultTextContainer: { flex: 1 },
//   resultName: { fontSize: 16, fontWeight: "500", color: Colors.dark.text, marginBottom: 4 },
//   resultAddress: { fontSize: 14, color: Colors.dark.subtext },

//   mapWrap: { flex: 1 },
//   webMapPlaceholder: {
//     flex: 1,
//     backgroundColor: "#2c2c2c",
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   webMapText: { color: Colors.dark.text, fontSize: 20, fontWeight: "bold", marginBottom: 12 },
//   webMapSubtext: { color: Colors.dark.subtext, textAlign: "center", fontSize: 16 },

//   bottomPanel: {
//     position: "absolute",
//     left: 12,
//     right: 12,
//     bottom: 12,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 14,
//     padding: 14,
//     borderWidth: 1,
//     borderColor: Colors.dark.divider,
//   },
//   selectedRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
//   selectedLabel: { fontSize: 13, color: Colors.dark.subtext, marginBottom: 4 },
//   selectedName: { fontSize: 15, fontWeight: "600", color: Colors.dark.text },
//   coordsText: { marginTop: 4, fontSize: 12, color: Colors.dark.subtext },

//   confirmButton: {
//     backgroundColor: Colors.dark.primary,
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     paddingVertical: 12,
//     borderRadius: 10,
//   },
//   confirmButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold", marginLeft: 8 },
// });












// import React, { useState, useEffect } from 'react';
// import { View, Text, StyleSheet, TouchableOpacity, TextInput, Platform, ActivityIndicator } from 'react-native';
// import { useRouter } from 'expo-router';
// import { ArrowLeft, Search, MapPin, Check } from 'lucide-react-native';
// import Colors from '@/constants/colors';
// import * as Location from 'expo-location';
// import { getCurrentLocation } from '@/utils/location';

// // Web-compatible map component
// const MapComponent = ({ location, onLocationSelect }: any) => {
//   if (Platform.OS === 'web') {
//     // Simple placeholder for web
//     return (
//       <View style={styles.webMapPlaceholder}>
//         <Text style={styles.webMapText}>Map View</Text>
//         <Text style={styles.webMapSubtext}>
//           {location ? 
//             `Selected: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : 
//             'Select a location on the map'}
//         </Text>
//       </View>
//     );
//   }
  
//   // For native platforms, we would use react-native-maps
//   // But since we're avoiding native modules that don't work on web,
//   // we'll use a placeholder here too
//   return (
//     <View style={styles.mapPlaceholder}>
//       <MapPin size={32} color={Colors.dark.primary} />
//       <Text style={styles.mapPlaceholderText}>
//         {location ? 
//           `Selected: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : 
//           'Tap to select a location'}
//       </Text>
//     </View>
//   );
// };

// export default function LocationScreen() {
//   const router = useRouter();
//   const [searchQuery, setSearchQuery] = useState('');
//   const [isLoading, setIsLoading] = useState(false);
//   const [currentLocation, setCurrentLocation] = useState<any>(null);
//   const [selectedLocation, setSelectedLocation] = useState<any>(null);
//   const [searchResults, setSearchResults] = useState<any[]>([]);
//   const [locationName, setLocationName] = useState('');
  
//   useEffect(() => {
//     (async () => {
//       const { status } = await Location.requestForegroundPermissionsAsync();
//       if (status === 'granted') {
//         try {
//           const location = await getCurrentLocation();
//           if (location) {
//             setCurrentLocation({
//               latitude: location.coords.latitude,
//               longitude: location.coords.longitude,
//             });
            
//             // Get address from coordinates
//             const geocode = await Location.reverseGeocodeAsync({
//               latitude: location.coords.latitude,
//               longitude: location.coords.longitude,
//             });
            
//             if (geocode && geocode.length > 0) {
//               const address = geocode[0];
//               const locationName = [
//                 address.name,
//                 address.street,
//                 address.city,
//                 address.region,
//                 address.country
//               ].filter(Boolean).join(', ');
              
//               setLocationName(locationName);
//             }
//           }
//         } catch (error) {
//           console.error('Error getting location:', error);
//         }
//       }
//     })();
//   }, []);
  
//   const handleSearch = async () => {
//     if (!searchQuery.trim()) return;
    
//     setIsLoading(true);
//     try {
//       // In a real app, you would use a geocoding service
//       // For this mock, we'll simulate some results
//       await new Promise(resolve => setTimeout(resolve, 1000));
      
//       // Mock search results
//       const results = [
//         {
//           id: '1',
//           name: `${searchQuery} Convention Center`,
//           address: `123 Main St, ${searchQuery}, CA`,
//           latitude: 34.052235 + (Math.random() * 0.01),
//           longitude: -118.243683 + (Math.random() * 0.01),
//         },
//         {
//           id: '2',
//           name: `${searchQuery} Stadium`,
//           address: `456 Park Ave, ${searchQuery}, CA`,
//           latitude: 34.052235 + (Math.random() * 0.01),
//           longitude: -118.243683 + (Math.random() * 0.01),
//         },
//         {
//           id: '3',
//           name: `${searchQuery} Arena`,
//           address: `789 Broadway, ${searchQuery}, CA`,
//           latitude: 34.052235 + (Math.random() * 0.01),
//           longitude: -118.243683 + (Math.random() * 0.01),
//         },
//       ];
      
//       setSearchResults(results);
//     } catch (error) {
//       console.error('Error searching locations:', error);
//     } finally {
//       setIsLoading(false);
//     }
//   };
  
//   const handleSelectSearchResult = (result: any) => {
//     setSelectedLocation({
//       latitude: result.latitude,
//       longitude: result.longitude,
//     });
//     setLocationName(`${result.name}, ${result.address}`);
//     setSearchResults([]);
//   };
  
//   const handleMapPress = (event: any) => {
//     // In a real app with react-native-maps, you would get coordinates from the event
//     // For this mock, we'll just use the current location with a slight offset
//     if (currentLocation) {
//       const newLocation = {
//         latitude: currentLocation.latitude + (Math.random() * 0.01 - 0.005),
//         longitude: currentLocation.longitude + (Math.random() * 0.01 - 0.005),
//       };
      
//       setSelectedLocation(newLocation);
      
//       // Get address from coordinates (in a real app)
//       setLocationName(`Selected Location (${newLocation.latitude.toFixed(4)}, ${newLocation.longitude.toFixed(4)})`);
//     }
//   };
  
//   const handleUseCurrentLocation = async () => {
//     try {
//       const location = await getCurrentLocation();
//       if (location) {
//         setSelectedLocation({
//           latitude: location.coords.latitude,
//           longitude: location.coords.longitude,
//         });
        
//         // Get address from coordinates
//         const geocode = await Location.reverseGeocodeAsync({
//           latitude: location.coords.latitude,
//           longitude: location.coords.longitude,
//         });
        
//         if (geocode && geocode.length > 0) {
//           const address = geocode[0];
//           const locationName = [
//             address.name,
//             address.street,
//             address.city,
//             address.region,
//             address.country
//           ].filter(Boolean).join(', ');
          
//           setLocationName(locationName);
//         } else {
//           setLocationName(`Current Location (${location.coords.latitude.toFixed(4)}, ${location.coords.longitude.toFixed(4)})`);
//         }
//       }
//     } catch (error) {
//       console.error('Error getting current location:', error);
//     }
//   };
  
//   const handleConfirmLocation = () => {
//     if (selectedLocation && locationName) {
//       // Pass the selected location back to the upload screen
//       router.back();
//     }
//   };
  
//   return (
//     <View style={styles.container}>
//       <View style={styles.header}>
//         <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
//           <ArrowLeft size={24} color={Colors.dark.text} />
//         </TouchableOpacity>
//         <Text style={styles.headerTitle}>Select Location</Text>
//         <View style={styles.headerRight} />
//       </View>
      
//       <View style={styles.searchContainer}>
//         <View style={styles.searchInputContainer}>
//           <Search size={20} color={Colors.dark.subtext} style={styles.searchIcon} />
//           <TextInput
//             style={styles.searchInput}
//             value={searchQuery}
//             onChangeText={setSearchQuery}
//             placeholder="Search for a location"
//             placeholderTextColor={Colors.dark.subtext}
//             onSubmitEditing={handleSearch}
//           />
//         </View>
        
//         <TouchableOpacity 
//           style={styles.currentLocationButton}
//           onPress={handleUseCurrentLocation}
//         >
//           <MapPin size={20} color={Colors.dark.primary} />
//           <Text style={styles.currentLocationText}>Use Current</Text>
//         </TouchableOpacity>
//       </View>
      
//       {isLoading ? (
//         <View style={styles.loadingContainer}>
//           <ActivityIndicator size="large" color={Colors.dark.primary} />
//           <Text style={styles.loadingText}>Searching locations...</Text>
//         </View>
//       ) : searchResults.length > 0 ? (
//         <View style={styles.resultsContainer}>
//           {searchResults.map(result => (
//             <TouchableOpacity
//               key={result.id}
//               style={styles.resultItem}
//               onPress={() => handleSelectSearchResult(result)}
//             >
//               <MapPin size={20} color={Colors.dark.primary} style={styles.resultIcon} />
//               <View style={styles.resultTextContainer}>
//                 <Text style={styles.resultName}>{result.name}</Text>
//                 <Text style={styles.resultAddress}>{result.address}</Text>
//               </View>
//             </TouchableOpacity>
//           ))}
//         </View>
//       ) : (
//         <TouchableOpacity 
//           style={styles.mapContainer}
//           onPress={handleMapPress}
//           activeOpacity={0.9}
//         >
//           <MapComponent 
//             location={selectedLocation || currentLocation}
//             onLocationSelect={(location: any) => {
//               setSelectedLocation(location);
//               setLocationName(`Selected Location (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)})`);
//             }}
//           />
//         </TouchableOpacity>
//       )}
      
//       {selectedLocation && (
//         <View style={styles.selectedLocationContainer}>
//           <View style={styles.selectedLocationContent}>
//             <MapPin size={24} color={Colors.dark.primary} style={styles.selectedLocationIcon} />
//             <View style={styles.selectedLocationTextContainer}>
//               <Text style={styles.selectedLocationLabel}>Selected Location</Text>
//               <Text style={styles.selectedLocationName}>{locationName}</Text>
//             </View>
//           </View>
          
//           <TouchableOpacity 
//             style={styles.confirmButton}
//             onPress={handleConfirmLocation}
//           >
//             <Check size={20} color="#fff" />
//             <Text style={styles.confirmButtonText}>Confirm</Text>
//           </TouchableOpacity>
//         </View>
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   header: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'space-between',
//     paddingHorizontal: 16,
//     paddingVertical: 12,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//     marginTop:40
//   },
//   backButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   headerTitle: {
//     fontSize: 18,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//   },
//   headerRight: {
//     width: 40,
//   },
//   searchContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     paddingHorizontal: 16,
//     paddingVertical: 12,
//   },
//   searchInputContainer: {
//     flex: 1,
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     paddingHorizontal: 12,
//     marginRight: 12,
//   },
//   searchIcon: {
//     marginRight: 8,
//   },
//   searchInput: {
//     flex: 1,
//     height: 40,
//     color: Colors.dark.text,
//     fontSize: 16,
//   },
//   currentLocationButton: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: 'rgba(138, 43, 226, 0.1)',
//     paddingHorizontal: 12,
//     paddingVertical: 8,
//     borderRadius: 8,
//   },
//   currentLocationText: {
//     color: Colors.dark.primary,
//     marginLeft: 4,
//     fontSize: 14,
//   },
//   loadingContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   loadingText: {
//     marginTop: 16,
//     color: Colors.dark.text,
//     fontSize: 16,
//   },
//   resultsContainer: {
//     flex: 1,
//     padding: 16,
//   },
//   resultItem: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 16,
//     marginBottom: 12,
//   },
//   resultIcon: {
//     marginRight: 12,
//   },
//   resultTextContainer: {
//     flex: 1,
//   },
//   resultName: {
//     fontSize: 16,
//     fontWeight: '500',
//     color: Colors.dark.text,
//     marginBottom: 4,
//   },
//   resultAddress: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//   },
//   mapContainer: {
//     flex: 1,
//     overflow: 'hidden',
//   },
//   mapPlaceholder: {
//     flex: 1,
//     backgroundColor: '#2c2c2c',
//     justifyContent: 'center',
//     alignItems: 'center',
//     padding: 20,
//   },
//   mapPlaceholderText: {
//     color: Colors.dark.text,
//     marginTop: 12,
//     textAlign: 'center',
//     fontSize: 16,
//   },
//   webMapPlaceholder: {
//     flex: 1,
//     backgroundColor: '#2c2c2c',
//     justifyContent: 'center',
//     alignItems: 'center',
//     padding: 20,
//   },
//   webMapText: {
//     color: Colors.dark.text,
//     fontSize: 20,
//     fontWeight: 'bold',
//     marginBottom: 12,
//   },
//   webMapSubtext: {
//     color: Colors.dark.subtext,
//     textAlign: 'center',
//     fontSize: 16,
//   },
//   selectedLocationContainer: {
//     backgroundColor: Colors.dark.card,
//     padding: 16,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//   },
//   selectedLocationContent: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     marginBottom: 16,
//   },
//   selectedLocationIcon: {
//     marginRight: 12,
//   },
//   selectedLocationTextContainer: {
//     flex: 1,
//   },
//   selectedLocationLabel: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginBottom: 4,
//   },
//   selectedLocationName: {
//     fontSize: 16,
//     fontWeight: '500',
//     color: Colors.dark.text,
//   },
//   confirmButton: {
//     backgroundColor: Colors.dark.primary,
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'center',
//     paddingVertical: 12,
//     borderRadius: 8,
//   },
//   confirmButtonText: {
//     color: '#fff',
//     fontSize: 16,
//     fontWeight: 'bold',
//     marginLeft: 8,
//   },
// });