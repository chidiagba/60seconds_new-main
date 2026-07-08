import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Modal,
  Dimensions,
  Platform,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  Search,
  X,
  MapPin,
  Hash,
  Calendar,
  Clock,
  Filter,
  Sliders,
  Users,
  Video,
  Calendar as CalendarIcon,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import { useSearchStore } from "@/store/search-store";
import { useAuthStore } from "@/store/auth-store";
import { SearchFilters } from "@/types";
import * as Location from "expo-location";
import { getCurrentLocation } from "@/utils/location";
import SearchResultItem from "@/components/SearchResultItem";
import EventClosedDialog from "@/components/EventClosedDialog";
import { isEventClosed } from "@/utils/event-status";

const { width } = Dimensions.get("window");

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ query?: string; filter?: string }>();
  const { followVersion } = useAuthStore();

  const {
    searchQuery,
    searchHistory,
    activeFilter,
    searchResults,
    isLoading,
    error,
    setSearchQuery,
    addToSearchHistory,
    clearSearchQuery,
    setActiveFilter,
    performSearch,
    clearSearchResults,
  } = useSearchStore();

  const [showFilters, setShowFilters] = useState(false);
  const [showMapView, setShowMapView] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [userLocation, setUserLocation] =
    useState<Location.LocationObject | null>(null);
  const [advancedFilters, setAdvancedFilters] = useState<SearchFilters>({});
  const [closedEvent, setClosedEvent] = useState<any | null>(null);
  const [mapRegion, setMapRegion] = useState({
    latitude: 40.7128,
    longitude: -74.006,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  });

  const filterOptions = useMemo(
    () => [
      { id: "all", label: "All", icon: Filter },
      { id: "events", label: "Events", icon: CalendarIcon },
      { id: "videos", label: "Videos", icon: Video },
      { id: "users", label: "Users", icon: Users },
      { id: "location", label: "Location", icon: MapPin },
      { id: "hashtag", label: "Hashtags", icon: Hash },
      { id: "recent", label: "Recent", icon: Clock },
      { id: "map", label: "Map View", icon: MapPin },
    ],
    []
  );

  // Initialize search from URL params
  useEffect(() => {
    if (params.query) {
      setSearchQuery(params.query);
      addToSearchHistory(params.query);
    }

    if (
      params.filter &&
      filterOptions.some((option) => option.id === params.filter)
    ) {
      setActiveFilter(params.filter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.query, params?.filter]);

  // Get user location
  useEffect(() => {
    (async () => {
      if (Platform.OS === "web") return;

      try {
        const location = await getCurrentLocation({ requestPermission: true });
        if (location) {
          setUserLocation(location);

          setMapRegion({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.1,
            longitudeDelta: 0.1,
          });
        }
      } catch (e) {
        console.log("Location unavailable on this device/session");
      }
    })();
  }, []);

  // Perform search when query or filter changes
  useEffect(() => {
    if (searchQuery.trim() === "") {
      clearSearchResults();
      return;
    }

    const run = async () => {
      const filters: any = { ...advancedFilters };

      if (activeFilter === "location") filters.location = searchQuery;
      if (activeFilter === "hashtag") filters.hashtag = searchQuery;
      if (activeFilter === "events") filters.category = searchQuery;
      if (activeFilter === "users") filters.userType = searchQuery;

      await performSearch(searchQuery, filters);
    };

    run();
  }, [searchQuery, activeFilter, advancedFilters, clearSearchResults, performSearch, followVersion]);

  const handleSearch = () => {
    if (searchQuery.trim()) addToSearchHistory(searchQuery);
  };

  const handleSelectSearchHistory = (query: string) => {
    setSearchQuery(query);
    addToSearchHistory(query);
  };

  const handleResultPress = (id: string, type: string, data?: any) => {
    if (!id) return;

    const openHomeVideo = (videoId: string) => {
      router.push({ pathname: "/(tabsbusiness)" as any, params: { selectedVideoId: videoId } });
    };

    if (type === "event") {
      const videoId = data?.video_id;

      if (isEventClosed({
        status: data?.status,
        startDate: data?.start_date,
        endDate: data?.end_date,
        eventDate: data?.event_date,
      })) {
        setClosedEvent(data);
        return;
      }

      if (videoId) {
        openHomeVideo(videoId);
        return;
      }

      Alert.alert(
        "No Video Yet",
        "This event is available, but it does not have a video uploaded yet.",
        [{ text: "OK", style: "default" }]
      );
      return;
    }

    if (type === "video") {
      openHomeVideo(id);
      return;
    }

    if (type === "user") {
      // ✅ this route MUST exist: app/profile/[userId].tsx
      router.push({
        pathname: "/ProfileUserScreen" as any,
        params: { userId: id },
      });
      return;
    }
  };

  const handleFilterPress = (filterId: string) => {
    if (filterId === "map") {
      setShowMapView((v) => !v);
    } else {
      setActiveFilter(filterId);
      setShowMapView(false);
    }
  };

  const handleApplyAdvancedFilters = () => {
    setShowAdvancedFilters(false);
  };

  const renderSearchSection = (
    title: string,
    data: any[],
    type: "event" | "video" | "user",
    IconComponent: any
  ) => {
    if (!data || data.length === 0) return null;

    return (
      <View style={styles.sectionContainer}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <IconComponent size={20} color={Colors.dark.primary} />
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionCount}>({data.length})</Text>
          </View>
        </View>

        <FlatList
          data={data}
          renderItem={({ item }) => (
            <SearchResultItem
              type={type}
              data={item}
              onPress={handleResultPress}
            />
          )}
          keyExtractor={(item) => `${type}-${item.id}`}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
        />
      </View>
    );
  };

  const renderFilterOption = ({ item }: { item: (typeof filterOptions)[0] }) => {
    const Icon = item.icon || Filter;
    const isActive = item.id === "map" ? showMapView : activeFilter === item.id;

    return (
      <TouchableOpacity
        style={[styles.filterOption, isActive && styles.activeFilterOption]}
        onPress={() => handleFilterPress(item.id)}
      >
        <Icon
          size={16}
          color={isActive ? Colors.dark.text : Colors.dark.subtext}
        />
        <Text style={[styles.filterText, isActive && styles.activeFilterText]}>
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <Search size={20} color={Colors.dark.subtext} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search events, locations, hashtags..."
            placeholderTextColor={Colors.dark.subtext}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={clearSearchQuery} style={styles.clearButton}>
              <X size={20} color={Colors.dark.subtext} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.searchButtons}>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowFilters((v) => !v)}
          >
            <Filter size={20} color={Colors.dark.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.advancedFilterButton}
            onPress={() => setShowAdvancedFilters(true)}
          >
            <Sliders size={20} color={Colors.dark.text} />
          </TouchableOpacity>
        </View>
      </View>

      {showFilters && (
        <FlatList
          data={filterOptions}
          renderItem={renderFilterOption}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersContainer}
        />
      )}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.primary} />
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error: {error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => performSearch(searchQuery, advancedFilters)}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : searchQuery.length === 0 ? (
        <ScrollView contentContainerStyle={{ marginBottom: 300 }} style={styles.historyContainer}>
          <Text style={styles.sectionTitle}>Recent Searches</Text>
          {searchHistory.length > 0 ? (
            searchHistory.map((q, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.historyItem}
                onPress={() => handleSelectSearchHistory(q)}
              >
                <Clock size={16} color={Colors.dark.subtext} />
                <Text style={styles.historyText}>{q}</Text>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.emptyText}>No recent searches</Text>
          )}

          <Text style={styles.sectionTitle}>Popular Searches</Text>
          {["Nightclubs", "Live Music", "Rooftop Bars"].map((q) => (
            <TouchableOpacity
              key={q}
              style={styles.historyItem}
              onPress={() => handleSelectSearchHistory(q)}
            >
              <Hash size={16} color={Colors.dark.subtext} />
              <Text style={styles.historyText}>{q}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : showMapView ? (
        <View style={styles.mapViewContainer}>
          <View style={styles.webMapPlaceholder}>
            <Text style={styles.webMapText}>
              Map view is not available. Please use the list view to see search results.
            </Text>
            <Image
              source={{
                uri: "https://images.unsplash.com/photo-1569336415962-a4bd9f69c07b?q=80&w=2069&auto=format&fit=crop",
              }}
              style={styles.webMapImage}
              contentFit="cover"
            />
          </View>

          <View style={styles.mapResultsOverlay}>
            <Text style={styles.mapResultsTitle}>
              {searchResults?.totalResults || 0}{" "}
              {(searchResults?.totalResults || 0) === 1 ? "Result" : "Results"}
            </Text>

            {searchResults?.events?.slice(0, 2).map((item) => (
              <SearchResultItem
                key={`event-${item.id}`}
                type="event"
                data={item}
                onPress={handleResultPress}
              />
            ))}
            {searchResults?.videos?.slice(0, 2).map((item) => (
              <SearchResultItem
                key={`video-${item.id}`}
                type="video"
                data={item}
                onPress={handleResultPress}
              />
            ))}

            {(searchResults?.totalResults || 0) > 4 && (
              <TouchableOpacity
                style={styles.viewAllButton}
                onPress={() => setShowMapView(false)}
              >
                <Text style={styles.viewAllText}>View All Results</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : searchResults && searchResults.totalResults > 0 ? (
        <ScrollView
          style={styles.resultsContainer}
          contentContainerStyle={styles.resultsContentContainer}
          showsVerticalScrollIndicator={false}
        >
          {activeFilter === "all" && (
            <>
              {renderSearchSection("Events", searchResults.events, "event", CalendarIcon)}
              {renderSearchSection("Videos", searchResults.videos, "video", Video)}
              {renderSearchSection("Users", searchResults.users, "user", Users)}
            </>
          )}

          {activeFilter === "events" &&
            renderSearchSection("Events", searchResults.events, "event", CalendarIcon)}
          {activeFilter === "videos" &&
            renderSearchSection("Videos", searchResults.videos, "video", Video)}
          {activeFilter === "users" &&
            renderSearchSection("Users", searchResults.users, "user", Users)}

          {activeFilter === "location" && (
            <>
              {renderSearchSection("Events", searchResults.events, "event", CalendarIcon)}
              {renderSearchSection("Videos", searchResults.videos, "video", Video)}
              {renderSearchSection("Users", searchResults.users, "user", Users)}
            </>
          )}

          {activeFilter === "hashtag" &&
            renderSearchSection("Videos", searchResults.videos, "video", Video)}
          {activeFilter === "recent" && (
            <>
              {renderSearchSection("Events", searchResults.events, "event", CalendarIcon)}
              {renderSearchSection("Videos", searchResults.videos, "video", Video)}
              {renderSearchSection("Users", searchResults.users, "user", Users)}
            </>
          )}
        </ScrollView>
      ) : (
        <View style={styles.noResultsContainer}>
          <Text style={styles.noResultsText}>No results found for "{searchQuery}"</Text>
          <Text style={styles.noResultsSubtext}>Try different keywords or filters</Text>
        </View>
      )}

      {/* Advanced Filters Modal */}
      <Modal
        visible={showAdvancedFilters}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAdvancedFilters(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Advanced Filters</Text>
              <TouchableOpacity
                style={styles.closeModalButton}
                onPress={() => setShowAdvancedFilters(false)}
              >
                <X size={24} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Location</Text>
                <View style={styles.filterInputContainer}>
                  <MapPin size={20} color={Colors.dark.primary} />
                  <TextInput
                    style={styles.filterInput}
                    placeholder="Filter by location..."
                    placeholderTextColor={Colors.dark.subtext}
                    value={advancedFilters.location || ""}
                    onChangeText={(text) =>
                      setAdvancedFilters({ ...advancedFilters, location: text })
                    }
                  />
                </View>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Event Type</Text>
                <View style={styles.filterInputContainer}>
                  <Calendar size={20} color={Colors.dark.primary} />
                  <TextInput
                    style={styles.filterInput}
                    placeholder="Filter by event name..."
                    placeholderTextColor={Colors.dark.subtext}
                    value={(advancedFilters as any).eventName || ""}
                    onChangeText={(text) =>
                      setAdvancedFilters({ ...(advancedFilters as any), eventName: text } as any)
                    }
                  />
                </View>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Hashtags</Text>
                <View style={styles.filterInputContainer}>
                  <Hash size={20} color={Colors.dark.primary} />
                  <TextInput
                    style={styles.filterInput}
                    placeholder="Filter by hashtag..."
                    placeholderTextColor={Colors.dark.subtext}
                    value={advancedFilters.hashtag || ""}
                    onChangeText={(text) =>
                      setAdvancedFilters({ ...advancedFilters, hashtag: text })
                    }
                  />
                </View>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Distance</Text>
                <View style={styles.rangeContainer}>
                  <Text style={styles.rangeLabel}>Within 30km</Text>
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.resetButton}
                onPress={() => setAdvancedFilters({})}
              >
                <Text style={styles.resetButtonText}>Reset</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.applyButton}
                onPress={handleApplyAdvancedFilters}
              >
                <Text style={styles.applyButtonText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <EventClosedDialog
        visible={!!closedEvent}
        event={closedEvent}
        onClose={() => setClosedEvent(null)}
        onWatchVideo={closedEvent?.video_id ? () => {
          const videoId = closedEvent.video_id;
          setClosedEvent(null);
          router.push({ pathname: "/(tabsbusiness)" as any, params: { selectedVideoId: videoId } });
        } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },

  searchContainer: {
    flexDirection: "row",
    padding: 16,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
    marginTop: 40,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: Colors.dark.text, fontSize: 16, height: "100%" },
  clearButton: { padding: 4 },

  searchButtons: { flexDirection: "row" },
  filterButton: {
    marginLeft: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },
  advancedFilterButton: {
    marginLeft: 8,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },

  filtersContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  filterOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    marginRight: 10,
    height: 50,
  },
  activeFilterOption: { backgroundColor: Colors.dark.primary },
  filterText: { color: Colors.dark.subtext, marginLeft: 6, fontSize: 14 },
  activeFilterText: { color: Colors.dark.text, fontWeight: "500" },

  historyContainer: { flex: 1, padding: 16 },
  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  historyText: { color: Colors.dark.text, marginLeft: 12, fontSize: 16 },
  emptyText: { color: Colors.dark.subtext, textAlign: "center", marginTop: 20, fontSize: 16 },

  resultsContainer: { flex: 1 },
  resultsContentContainer: { padding: 16, paddingBottom: 100 },

  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  noResultsContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  noResultsText: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.dark.text,
    marginBottom: 8,
    textAlign: "center",
  },
  noResultsSubtext: { fontSize: 16, color: Colors.dark.subtext, textAlign: "center" },

  mapViewContainer: { flex: 1, position: "relative" },
  webMapPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.dark.card,
    padding: 20,
  },
  webMapText: { color: Colors.dark.text, textAlign: "center", fontSize: 16, marginBottom: 20 },
  webMapImage: { width: "100%", height: 200, borderRadius: 12 },
  mapResultsOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  mapResultsTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: "bold", marginBottom: 12 },
  viewAllButton: { backgroundColor: Colors.dark.primary, borderRadius: 8, padding: 12, alignItems: "center", marginTop: 8 },
  viewAllText: { color: Colors.dark.text, fontWeight: "bold", fontSize: 16 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)", justifyContent: "flex-end" },
  modalContent: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: "70%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: Colors.dark.text },
  closeModalButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.card,
    justifyContent: "center",
    alignItems: "center",
  },
  modalBody: { flex: 1, padding: 16 },
  filterSection: { marginBottom: 20 },
  filterSectionTitle: { fontSize: 16, fontWeight: "bold", color: Colors.dark.text, marginBottom: 8 },
  filterInputContainer: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.dark.card, borderRadius: 8, padding: 12 },
  filterInput: { flex: 1, color: Colors.dark.text, marginLeft: 8, fontSize: 16 },
  rangeContainer: { backgroundColor: Colors.dark.card, borderRadius: 8, padding: 12 },
  rangeLabel: { color: Colors.dark.text, fontSize: 16, textAlign: "center" },
  modalFooter: { flexDirection: "row", padding: 16, borderTopWidth: 1, borderTopColor: Colors.dark.divider },
  resetButton: { flex: 1, backgroundColor: Colors.dark.card, borderRadius: 8, padding: 16, alignItems: "center", marginRight: 8 },
  resetButtonText: { color: Colors.dark.text, fontWeight: "bold", fontSize: 16 },
  applyButton: { flex: 1, backgroundColor: Colors.dark.primary, borderRadius: 8, padding: 16, alignItems: "center", marginLeft: 8 },
  applyButtonText: { color: Colors.dark.text, fontWeight: "bold", fontSize: 16 },

  // Sections
  sectionContainer: { marginBottom: 24 },
  sectionHeader: { marginBottom: 12, paddingHorizontal: 16 },
  sectionTitleContainer: { flexDirection: "row", alignItems: "center" },
  sectionTitle: { fontSize: 18, fontWeight: "bold", color: Colors.dark.text, marginLeft: 8 },
  sectionCount: { fontSize: 14, color: Colors.dark.subtext, marginLeft: 8 },

  // Error
  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  errorText: { fontSize: 16, color: Colors.dark.text, textAlign: "center", marginBottom: 16 },
  retryButton: { backgroundColor: Colors.dark.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  retryButtonText: { color: Colors.dark.text, fontWeight: "bold", fontSize: 16 },
});










// import React, { useState, useEffect } from "react";
// import {
//   View,
//   Text,
//   StyleSheet,
//   TextInput,
//   TouchableOpacity,
//   FlatList,
//   ScrollView,
//   ActivityIndicator,
//   Modal,
//   Dimensions,
//   Platform,
// } from "react-native";
// import { Image } from "expo-image";
// import { useRouter, useLocalSearchParams } from "expo-router";
// import {
//   Search,
//   X,
//   MapPin,
//   Hash,
//   Calendar,
//   Clock,
//   Filter,
//   ChevronDown,
//   Sliders,
//   Users,
//   Video,
//   Calendar as CalendarIcon,
// } from "lucide-react-native";
// import Colors from "@/constants/colors";
// import { useSearchStore } from "@/store/search-store";
// import { SearchFilters } from "@/types";
// import * as Location from "expo-location";
// import { formatDistance } from "@/utils/location";
// import SearchResultItem from "@/components/SearchResultItem";

// const { width } = Dimensions.get("window");

// export default function SearchScreen() {
//   const router = useRouter();
//   const params = useLocalSearchParams<{ query?: string; filter?: string }>();
//   const {
//     searchQuery,
//     searchHistory,
//     activeFilter,
//     searchResults,
//     isLoading,
//     error,
//     setSearchQuery,
//     addToSearchHistory,
//     clearSearchQuery,
//     setActiveFilter,
//     performSearch,
//     clearSearchResults,
//   } = useSearchStore();

//   const [showFilters, setShowFilters] = useState(false);
//   const [showMapView, setShowMapView] = useState(false);
//   const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
//   const [userLocation, setUserLocation] =
//     useState<Location.LocationObject | null>(null);
//   const [advancedFilters, setAdvancedFilters] = useState<SearchFilters>({});
//   const [mapRegion, setMapRegion] = useState({
//     latitude: 40.7128,
//     longitude: -74.006,
//     latitudeDelta: 0.1,
//     longitudeDelta: 0.1,
//   });

//   const filterOptions = [
//     { id: "all", label: "All", icon: Filter },
//     { id: "events", label: "Events", icon: CalendarIcon },
//     { id: "videos", label: "Videos", icon: Video },
//     { id: "users", label: "Users", icon: Users },
//     { id: "location", label: "Location", icon: MapPin },
//     { id: "hashtag", label: "Hashtags", icon: Hash },
//     { id: "recent", label: "Recent", icon: Clock },
//     { id: "map", label: "Map View", icon: MapPin },
//   ];

//   // Initialize search from URL params
//   useEffect(() => {
//     if (params.query) {
//       setSearchQuery(params.query);
//       addToSearchHistory(params.query);
//     }

//     if (
//       params.filter &&
//       filterOptions.some((option) => option.id === params.filter)
//     ) {
//       setActiveFilter(params.filter);
//     }
//   }, [params]);

//   // Get user location
//   useEffect(() => {
//     (async () => {
//       if (Platform.OS === "web") {
//         // Skip location request on web
//         return;
//       }

//       try {
//         const { status } = await Location.requestForegroundPermissionsAsync();
//         if (status === "granted") {
//           const location = await Location.getCurrentPositionAsync({});
//           setUserLocation(location);

//           // Update map region to user location
//           setMapRegion({
//             latitude: location.coords.latitude,
//             longitude: location.coords.longitude,
//             latitudeDelta: 0.1,
//             longitudeDelta: 0.1,
//           });
//         }
//       } catch (error) {
//         console.error("Error getting location:", error);
//       }
//     })();
//   }, []);

//   // Perform search when query or filter changes
//   useEffect(() => {
//     if (searchQuery.trim() === "") {
//       clearSearchResults();
//       return;
//     }

//     const searchWithFilters = async () => {
//       const filters: any = { ...advancedFilters };

//       if (activeFilter === "location") {
//         filters.location = searchQuery;
//       } else if (activeFilter === "hashtag") {
//         filters.hashtag = searchQuery;
//       } else if (activeFilter === "events") {
//         // Only search events
//         filters.category = searchQuery;
//       } else if (activeFilter === "users") {
//         // Only search users
//         filters.userType = searchQuery;
//       }

//       await performSearch(searchQuery, filters);
//     };

//     searchWithFilters();
//   }, [searchQuery, activeFilter, advancedFilters]);

//   const handleSearch = () => {
//     if (searchQuery.trim()) {
//       addToSearchHistory(searchQuery);
//     }
//   };

//   const handleSelectSearchHistory = (query: string) => {
//     setSearchQuery(query);
//     addToSearchHistory(query);
//   };

//   const handleResultPress = (id: string, type: string) => {
//     if (type === 'event') {
//       router.push(`/event/${id}` as any);
//     } else if (type === 'video') {
//       router.push(`/event/${id}` as any);
//     } else if (type === 'user') {
//       router.push(`/profile/${id}` as any);
//     }
//   };

//   const handleFilterPress = (filterId: string) => {
//     if (filterId === "map") {
//       setShowMapView(!showMapView);
//     } else {
//       setActiveFilter(filterId);
//       setShowMapView(false);
//     }
//   };

//   const handleMarkerPress = (videoId: string) => {
//     router.push(`/event/${videoId}`);
//   };

//   const handleApplyAdvancedFilters = () => {
//     setShowAdvancedFilters(false);
//     // The search will be triggered by the useEffect when advancedFilters changes
//   };

//   const renderSearchHistoryItem = ({ item }: { item: string }) => (
//     <TouchableOpacity
//       style={styles.historyItem}
//       onPress={() => handleSelectSearchHistory(item)}
//     >
//       <Clock size={16} color={Colors.dark.subtext} />
//       <Text style={styles.historyText}>{item}</Text>
//     </TouchableOpacity>
//   );

//   const renderSearchSection = (title: string, data: any[], type: 'event' | 'video' | 'user', IconComponent: any) => {
//     if (!data || data.length === 0) return null;

//     return (
//       <View style={styles.sectionContainer}>
//         <View style={styles.sectionHeader}>
//           <View style={styles.sectionTitleContainer}>
//             <IconComponent size={20} color={Colors.dark.primary} />
//             <Text style={styles.sectionTitle}>{title}</Text>
//             <Text style={styles.sectionCount}>({data.length})</Text>
//           </View>
//         </View>
//         <FlatList
//           data={data}
//           renderItem={({ item }) => (
//             <SearchResultItem
//               type={type}
//               data={item}
//               onPress={handleResultPress}
//             />
//           )}
//           keyExtractor={(item) => `${type}-${item.id}`}
//           scrollEnabled={false}
//           showsVerticalScrollIndicator={false}
//         />
//       </View>
//     );
//   };

//   const renderFilterOption = ({
//     item,
//   }: {
//     item: (typeof filterOptions)[0];
//   }) => {
//     const Icon = item.icon || Filter;
//     const isActive = item.id === "map" ? showMapView : activeFilter === item.id;

//     return (
//       <TouchableOpacity
//         style={[styles.filterOption, isActive && styles.activeFilterOption]}
//         onPress={() => handleFilterPress(item.id)}
//       >
//         <Icon
//           size={16}
//           color={isActive ? Colors.dark.text : Colors.dark.subtext}
//         />
//         <Text style={[styles.filterText, isActive && styles.activeFilterText]}>
//           {item.label}
//         </Text>
//       </TouchableOpacity>
//     );
//   };

//   return (
//     <View style={styles.container}>
//       <View style={styles.searchContainer}>
//         <View style={styles.searchInputContainer}>
//           <Search
//             size={20}
//             color={Colors.dark.subtext}
//             style={styles.searchIcon}
//           />
//           <TextInput
//             style={styles.searchInput}
//             placeholder="Search events, locations, hashtags..."
//             placeholderTextColor={Colors.dark.subtext}
//             value={searchQuery}
//             onChangeText={setSearchQuery}
//             onSubmitEditing={handleSearch}
//             returnKeyType="search"
//           />
//           {searchQuery.length > 0 && (
//             <TouchableOpacity
//               onPress={clearSearchQuery}
//               style={styles.clearButton}
//             >
//               <X size={20} color={Colors.dark.subtext} />
//             </TouchableOpacity>
//           )}
//         </View>

//         <View style={styles.searchButtons}>
//           <TouchableOpacity
//             style={styles.filterButton}
//             onPress={() => setShowFilters(!showFilters)}
//           >
//             <Filter size={20} color={Colors.dark.text} />
//           </TouchableOpacity>

//           <TouchableOpacity
//             style={styles.advancedFilterButton}
//             onPress={() => setShowAdvancedFilters(true)}
//           >
//             <Sliders size={20} color={Colors.dark.text} />
//           </TouchableOpacity>
//         </View>
//       </View>

//       <View>
//         {showFilters && (
//           <FlatList
//             data={filterOptions}
//             renderItem={renderFilterOption}
//             keyExtractor={(item) => item.id}
//             horizontal
//             showsHorizontalScrollIndicator={false}
//             contentContainerStyle={styles.filtersContainer}
//           />
//         )}
//       </View>

//       {isLoading ? (
//         <View style={styles.loadingContainer}>
//           <ActivityIndicator size="large" color={Colors.dark.primary} />
//         </View>
//       ) : error ? (
//         <View style={styles.errorContainer}>
//           <Text style={styles.errorText}>Error: {error}</Text>
//           <TouchableOpacity
//             style={styles.retryButton}
//             onPress={() => performSearch(searchQuery, advancedFilters)}
//           >
//             <Text style={styles.retryButtonText}>Retry</Text>
//           </TouchableOpacity>
//         </View>
//       ) : searchQuery.length === 0 ? (
//         <ScrollView contentContainerStyle={{marginBottom: 300}} style={styles.historyContainer}>
//           <Text style={styles.sectionTitle}>Recent Searches</Text>
//           {searchHistory.length > 0 ? (
//             searchHistory.map((query, index) => (
//               <TouchableOpacity
//                 key={index}
//                 style={styles.historyItem}
//                 onPress={() => handleSelectSearchHistory(query)}
//               >
//                 <Clock size={16} color={Colors.dark.subtext} />
//                 <Text style={styles.historyText}>{query}</Text>
//               </TouchableOpacity>
//             ))
//           ) : (
//             <Text style={styles.emptyText}>No recent searches</Text>
//           )}

//           <Text style={styles.sectionTitle}>Popular Searches</Text>
//           <TouchableOpacity
//             style={styles.historyItem}
//             onPress={() => handleSelectSearchHistory("Nightclubs")}
//           >
//             <Hash size={16} color={Colors.dark.subtext} />
//             <Text style={styles.historyText}>Nightclubs</Text>
//           </TouchableOpacity>
//           <TouchableOpacity
//             style={styles.historyItem}
//             onPress={() => handleSelectSearchHistory("Live Music")}
//           >
//             <Hash size={16} color={Colors.dark.subtext} />
//             <Text style={styles.historyText}>Live Music</Text>
//           </TouchableOpacity>
//           <TouchableOpacity
//             style={styles.historyItem}
//             onPress={() => handleSelectSearchHistory("Rooftop Bars")}
//           >
//             <Hash size={16} color={Colors.dark.subtext} />
//             <Text style={styles.historyText}>Rooftop Bars</Text>
//           </TouchableOpacity>
//         </ScrollView>
//       ) : showMapView ? (
//         <View style={styles.mapViewContainer}>
//           <View style={styles.webMapPlaceholder}>
//             <Text style={styles.webMapText}>
//               Map view is not available. Please use the list view to see search
//               results.
//             </Text>
//             <Image
//               source={{
//                 uri: "https://images.unsplash.com/photo-1569336415962-a4bd9f69c07b?q=80&w=2069&auto=format&fit=crop",
//               }}
//               style={styles.webMapImage}
//               contentFit="cover"
//             />
//           </View>

//           <View style={styles.mapResultsOverlay}>
//             <Text style={styles.mapResultsTitle}>
//               {searchResults?.totalResults || 0}{" "}
//               {(searchResults?.totalResults || 0) === 1 ? "Result" : "Results"}
//             </Text>
//             {/* Show first few results in map overlay */}
//             {searchResults?.events?.slice(0, 2).map((item) => (
//               <SearchResultItem
//                 key={`event-${item.id}`}
//                 type="event"
//                 data={item}
//                 onPress={handleResultPress}
//               />
//             ))}
//             {searchResults?.videos?.slice(0, 2).map((item) => (
//               <SearchResultItem
//                 key={`video-${item.id}`}
//                 type="video"
//                 data={item}
//                 onPress={handleResultPress}
//               />
//             ))}
//             {(searchResults?.totalResults || 0) > 4 && (
//               <TouchableOpacity
//                 style={styles.viewAllButton}
//                 onPress={() => setShowMapView(false)}
//               >
//                 <Text style={styles.viewAllText}>View All Results</Text>
//               </TouchableOpacity>
//             )}
//           </View>
//         </View>
//       ) : searchResults && searchResults.totalResults > 0 ? (
//         <ScrollView 
//           style={styles.resultsContainer}
//           contentContainerStyle={styles.resultsContentContainer}
//           showsVerticalScrollIndicator={false}
//         >
//           {/* Show filtered results based on active filter */}
//           {activeFilter === "all" && (
//             <>
//               {renderSearchSection("Events", searchResults.events, "event", CalendarIcon)}
//               {renderSearchSection("Videos", searchResults.videos, "video", Video)}
//               {renderSearchSection("Users", searchResults.users, "user", Users)}
//             </>
//           )}
//           {activeFilter === "events" && renderSearchSection("Events", searchResults.events, "event", CalendarIcon)}
//           {activeFilter === "videos" && renderSearchSection("Videos", searchResults.videos, "video", Video)}
//           {activeFilter === "users" && renderSearchSection("Users", searchResults.users, "user", Users)}
//           {activeFilter === "location" && (
//             <>
//               {renderSearchSection("Events", searchResults.events, "event", CalendarIcon)}
//               {renderSearchSection("Videos", searchResults.videos, "video", Video)}
//             </>
//           )}
//           {activeFilter === "hashtag" && renderSearchSection("Videos", searchResults.videos, "video", Video)}
//         </ScrollView>
//       ) : (
//         <View style={styles.noResultsContainer}>
//           <Text style={styles.noResultsText}>
//             No results found for "{searchQuery}"
//           </Text>
//           <Text style={styles.noResultsSubtext}>
//             Try different keywords or filters
//           </Text>
//         </View>
//       )}

//       {/* Advanced Filters Modal */}
//       <Modal
//         visible={showAdvancedFilters}
//         animationType="slide"
//         transparent={true}
//         onRequestClose={() => setShowAdvancedFilters(false)}
//       >
//         <View style={styles.modalOverlay}>
//           <View style={styles.modalContent}>
//             <View style={styles.modalHeader}>
//               <Text style={styles.modalTitle}>Advanced Filters</Text>
//               <TouchableOpacity
//                 style={styles.closeModalButton}
//                 onPress={() => setShowAdvancedFilters(false)}
//               >
//                 <X size={24} color={Colors.dark.text} />
//               </TouchableOpacity>
//             </View>

//             <ScrollView style={styles.modalBody}>
//               <View style={styles.filterSection}>
//                 <Text style={styles.filterSectionTitle}>Location</Text>
//                 <View style={styles.filterInputContainer}>
//                   <MapPin size={20} color={Colors.dark.primary} />
//                   <TextInput
//                     style={styles.filterInput}
//                     placeholder="Filter by location..."
//                     placeholderTextColor={Colors.dark.subtext}
//                     value={advancedFilters.location || ""}
//                     onChangeText={(text) =>
//                       setAdvancedFilters({ ...advancedFilters, location: text })
//                     }
//                   />
//                 </View>
//               </View>

//               <View style={styles.filterSection}>
//                 <Text style={styles.filterSectionTitle}>Event Type</Text>
//                 <View style={styles.filterInputContainer}>
//                   <Calendar size={20} color={Colors.dark.primary} />
//                   <TextInput
//                     style={styles.filterInput}
//                     placeholder="Filter by event name..."
//                     placeholderTextColor={Colors.dark.subtext}
//                     value={advancedFilters.eventName || ""}
//                     onChangeText={(text) =>
//                       setAdvancedFilters({
//                         ...advancedFilters,
//                         eventName: text,
//                       })
//                     }
//                   />
//                 </View>
//               </View>

//               <View style={styles.filterSection}>
//                 <Text style={styles.filterSectionTitle}>Hashtags</Text>
//                 <View style={styles.filterInputContainer}>
//                   <Hash size={20} color={Colors.dark.primary} />
//                   <TextInput
//                     style={styles.filterInput}
//                     placeholder="Filter by hashtag..."
//                     placeholderTextColor={Colors.dark.subtext}
//                     value={advancedFilters.hashtag || ""}
//                     onChangeText={(text) =>
//                       setAdvancedFilters({ ...advancedFilters, hashtag: text })
//                     }
//                   />
//                 </View>
//               </View>

//               <View style={styles.filterSection}>
//                 <Text style={styles.filterSectionTitle}>Distance</Text>
//                 <View style={styles.rangeContainer}>
//                   <Text style={styles.rangeLabel}>Within 30km</Text>
//                   {/* In a real app, this would be a slider component */}
//                 </View>
//               </View>
//             </ScrollView>

//             <View style={styles.modalFooter}>
//               <TouchableOpacity
//                 style={styles.resetButton}
//                 onPress={() => setAdvancedFilters({})}
//               >
//                 <Text style={styles.resetButtonText}>Reset</Text>
//               </TouchableOpacity>

//               <TouchableOpacity
//                 style={styles.applyButton}
//                 onPress={handleApplyAdvancedFilters}
//               >
//                 <Text style={styles.applyButtonText}>Apply Filters</Text>
//               </TouchableOpacity>
//             </View>
//           </View>
//         </View>
//       </Modal>
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Colors.dark.background,
//   },
//   searchContainer: {
//     flexDirection: "row",
//     padding: 16,
//     alignItems: "center",
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//     marginTop: 40,
//   },
//   searchInputContainer: {
//     flex: 1,
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 20,
//     paddingHorizontal: 12,
//     height: 44,
//   },
//   searchIcon: {
//     marginRight: 8,
//   },
//   searchInput: {
//     flex: 1,
//     color: Colors.dark.text,
//     fontSize: 16,
//     height: "100%",
//   },
//   clearButton: {
//     padding: 4,
//   },
//   searchButtons: {
//     flexDirection: "row",
//   },
//   filterButton: {
//     marginLeft: 12,
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   advancedFilterButton: {
//     marginLeft: 8,
//     width: 44,
//     height: 44,
//     borderRadius: 22,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   filtersContainer: {
//     paddingHorizontal: 16,
//     paddingVertical: 12,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   filterOption: {
//     flexDirection: "row",
//     alignItems: "center",
//     paddingHorizontal: 16,
//     paddingVertical: 8,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     marginRight: 10,
//     height: 50,
//   },
//   activeFilterOption: {
//     backgroundColor: Colors.dark.primary,
//   },
//   filterText: {
//     color: Colors.dark.subtext,
//     marginLeft: 6,
//     fontSize: 14,
//   },
//   activeFilterText: {
//     color: Colors.dark.text,
//     fontWeight: "500",
//   },
//   historyContainer: {
//     flex: 1,
//     padding: 16,
//   },
//   historyItem: {
//     flexDirection: "row",
//     alignItems: "center",
//     paddingVertical: 12,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   historyText: {
//     color: Colors.dark.text,
//     marginLeft: 12,
//     fontSize: 16,
//   },
//   emptyText: {
//     color: Colors.dark.subtext,
//     textAlign: "center",
//     marginTop: 20,
//     fontSize: 16,
//   },
//   resultsContainer: {
//     flex: 1,
//   },
//   resultsContentContainer: {
//     padding: 16,
//     paddingBottom: 100, // Add extra bottom padding to prevent cutoff
//   },
//   resultItem: {
//     flexDirection: "row",
//     marginBottom: 16,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 12,
//     overflow: "hidden",
//   },
//   resultThumbnail: {
//     width: 100,
//     height: 100,
//   },
//   resultInfo: {
//     flex: 1,
//     padding: 12,
//     justifyContent: "center",
//   },
//   resultTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 6,
//   },
//   resultLocation: {
//     flexDirection: "row",
//     alignItems: "center",
//     marginBottom: 4,
//   },
//   resultLocationText: {
//     color: Colors.dark.subtext,
//     marginLeft: 4,
//     fontSize: 14,
//   },
//   distanceText: {
//     color: Colors.dark.primary,
//     fontSize: 12,
//     marginBottom: 4,
//   },
//   hashtagsContainer: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//   },
//   hashtag: {
//     color: Colors.dark.primary,
//     marginRight: 8,
//     fontSize: 14,
//   },
//   loadingContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   noResultsContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   noResultsText: {
//     fontSize: 18,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//     textAlign: "center",
//   },
//   noResultsSubtext: {
//     fontSize: 16,
//     color: Colors.dark.subtext,
//     textAlign: "center",
//   },
//   mapViewContainer: {
//     flex: 1,
//     position: "relative",
//   },
//   map: {
//     ...StyleSheet.absoluteFillObject,
//   },
//   webMapPlaceholder: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//     padding: 20,
//   },
//   webMapText: {
//     color: Colors.dark.text,
//     textAlign: "center",
//     fontSize: 16,
//     marginBottom: 20,
//   },
//   webMapImage: {
//     width: "100%",
//     height: 200,
//     borderRadius: 12,
//   },
//   mapResultsOverlay: {
//     position: "absolute",
//     bottom: 0,
//     left: 0,
//     right: 0,
//     backgroundColor: "rgba(0, 0, 0, 0.7)",
//     padding: 16,
//     borderTopLeftRadius: 16,
//     borderTopRightRadius: 16,
//   },
//   mapResultsTitle: {
//     color: Colors.dark.text,
//     fontSize: 18,
//     fontWeight: "bold",
//     marginBottom: 12,
//   },
//   mapResultsList: {
//     paddingBottom: 8,
//   },
//   viewAllButton: {
//     backgroundColor: Colors.dark.primary,
//     borderRadius: 8,
//     padding: 12,
//     alignItems: "center",
//     marginTop: 8,
//   },
//   viewAllText: {
//     color: Colors.dark.text,
//     fontWeight: "bold",
//     fontSize: 16,
//   },
//   // Modal Styles
//   modalOverlay: {
//     flex: 1,
//     backgroundColor: "rgba(0, 0, 0, 0.5)",
//     justifyContent: "flex-end",
//   },
//   modalContent: {
//     backgroundColor: Colors.dark.background,
//     borderTopLeftRadius: 20,
//     borderTopRightRadius: 20,
//     height: "70%",
//   },
//   modalHeader: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: 16,
//     borderBottomWidth: 1,
//     borderBottomColor: Colors.dark.divider,
//   },
//   modalTitle: {
//     fontSize: 20,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//   },
//   closeModalButton: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,
//     backgroundColor: Colors.dark.card,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   modalBody: {
//     flex: 1,
//     padding: 16,
//   },
//   filterSection: {
//     marginBottom: 20,
//   },
//   filterSectionTitle: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: Colors.dark.text,
//     marginBottom: 8,
//   },
//   filterInputContainer: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//   },
//   filterInput: {
//     flex: 1,
//     color: Colors.dark.text,
//     marginLeft: 8,
//     fontSize: 16,
//   },
//   rangeContainer: {
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 12,
//   },
//   rangeLabel: {
//     color: Colors.dark.text,
//     fontSize: 16,
//     textAlign: "center",
//   },
//   modalFooter: {
//     flexDirection: "row",
//     padding: 16,
//     borderTopWidth: 1,
//     borderTopColor: Colors.dark.divider,
//   },
//   resetButton: {
//     flex: 1,
//     backgroundColor: Colors.dark.card,
//     borderRadius: 8,
//     padding: 16,
//     alignItems: "center",
//     marginRight: 8,
//   },
//   resetButtonText: {
//     color: Colors.dark.text,
//     fontWeight: "bold",
//     fontSize: 16,
//   },
//   applyButton: {
//     flex: 1,
//     backgroundColor: Colors.dark.primary,
//     borderRadius: 8,
//     padding: 16,
//     alignItems: "center",
//     marginLeft: 8,
//   },
//   applyButtonText: {
//     color: Colors.dark.text,
//     fontWeight: "bold",
//     fontSize: 16,
//   },
  
//   // New search result styles
//   sectionContainer: {
//     marginBottom: 24,
//   },
//   sectionHeader: {
//     marginBottom: 12,
//     paddingHorizontal: 16,
//   },
//   sectionTitleContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//   },
//   sectionTitle: {
//     fontSize: 18,
//     fontWeight: 'bold',
//     color: Colors.dark.text,
//     marginLeft: 8,
//   },
//   sectionCount: {
//     fontSize: 14,
//     color: Colors.dark.subtext,
//     marginLeft: 8,
//   },
  
//   // Error styles
//   errorContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     padding: 20,
//   },
//   errorText: {
//     fontSize: 16,
//     color: Colors.dark.text,
//     textAlign: 'center',
//     marginBottom: 16,
//   },
//   retryButton: {
//     backgroundColor: Colors.dark.primary,
//     paddingHorizontal: 20,
//     paddingVertical: 12,
//     borderRadius: 8,
//   },
//   retryButtonText: {
//     color: Colors.dark.text,
//     fontWeight: 'bold',
//     fontSize: 16,
//   },
// });
