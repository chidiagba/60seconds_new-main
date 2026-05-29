import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Users, Calendar, DollarSign, BarChart2, PieChart, TrendingUp } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuthStore } from '@/store/auth-store';
import { useVideoStore } from '@/store/video-store';
import { mockVideos } from '@/mocks/videos';
import SalesOverview from '@/components/analytics/SalesOverview';
import ProductPerformance from '@/components/analytics/ProductPerformance';
import TimeAnalytics from '@/components/analytics/TimeAnalytics';
import CustomerDemographics from '@/components/analytics/CustomerDemographics';
import { AttendanceStatus } from '@/types';
import { SalesData, ProductPerformanceData, TimeAnalyticsData, CustomerData } from '@/types/analytics';

// Mock data for analytics
const mockSalesData: SalesData = {
  totalRevenue: 12580.50,
  revenueChange: 8.3,
  totalOrders: 342,
  ordersChange: 12.5,
  averageOrderValue: 36.78,
  aovChange: -2.1,
  uniqueCustomers: 215,
  customersChange: 5.7,
  bestSellingProduct: "VIP Tickets",
  bestSellingTime: "6PM - 8PM"
};

const mockProductData: ProductPerformanceData[] = [
  {
    id: "prod1",
    name: "VIP Tickets",
    type: "ticket",
    image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=200&q=80",
    sold: 120,
    soldChange: 15.2,
    revenue: 5980.00,
    revenueChange: 18.5
  },
  {
    id: "prod2",
    name: "Standard Tickets",
    type: "ticket",
    image: "https://images.unsplash.com/photo-1566737236500-c8ac43014a67?auto=format&fit=crop&w=200&q=80",
    sold: 185,
    soldChange: 8.7,
    revenue: 3700.00,
    revenueChange: 6.2
  },
  {
    id: "prod3",
    name: "Event T-Shirt",
    type: "merchandise",
    image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=200&q=80",
    sold: 37,
    soldChange: -5.1,
    revenue: 925.00,
    revenueChange: -3.8
  }
];

const mockTimeData: TimeAnalyticsData[] = [
  { label: "Mon", revenue: 1850.50, orders: 48 },
  { label: "Tue", revenue: 1420.75, orders: 39 },
  { label: "Wed", revenue: 1680.25, orders: 45 },
  { label: "Thu", revenue: 2150.00, orders: 58 },
  { label: "Fri", revenue: 2780.50, orders: 72 },
  { label: "Sat", revenue: 1950.25, orders: 52 },
  { label: "Sun", revenue: 748.25, orders: 28 }
];

const mockCustomerData: CustomerData = {
  totalCustomers: 215,
  repeatCustomerRate: 32.5,
  averageCustomerSpend: 58.50,
  ageGroups: [
    { label: "18-24", value: 45 },
    { label: "25-34", value: 85 },
    { label: "35-44", value: 52 },
    { label: "45-54", value: 25 },
    { label: "55+", value: 8 }
  ],
  genderDistribution: [
    { label: "Male", value: 120, color: "#8A2BE2" },
    { label: "Female", value: 90, color: "#FF69B4" },
    { label: "Other", value: 5, color: "#20B2AA" }
  ],
  locationDistribution: [
    { label: "New York", value: 58 },
    { label: "Los Angeles", value: 42 },
    { label: "Chicago", value: 35 },
    { label: "Miami", value: 28 },
    { label: "Austin", value: 22 },
    { label: "Seattle", value: 18 },
    { label: "Other", value: 12 }
  ]
};

export default function BusinessAnalyticsScreen() {
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const { user } = useAuthStore();
  const { getEventAttendees } = useVideoStore();
  
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [attendees, setAttendees] = useState<any[]>([]);
  const [attendeeStats, setAttendeeStats] = useState({
    going: 0,
    maybe: 0,
    interested: 0,
    total: 0
  });
  
  useEffect(() => {
    if (!user || !user.isBusinessAccount) {
      // Redirect non-business users
      router.replace('/profile');
      return;
    }
    
    const loadData = async () => {
      setIsLoading(true);
      
      try {
        // If eventId is provided, load that specific event
        if (eventId) {
          const event = mockVideos.find(v => v.id === eventId);
          if (event) {
            setSelectedEvent(event);
            
            // Get attendees for this event
            const eventAttendees = getEventAttendees(event.id);
            setAttendees(eventAttendees);
            
            // Calculate attendee stats
            const going = eventAttendees.filter(a => a.status === AttendanceStatus.GOING).length;
            const maybe = eventAttendees.filter(a => a.status === AttendanceStatus.MAYBE).length;
            const interested = eventAttendees.filter(a => a.status === AttendanceStatus.INTERESTED).length;
            
            setAttendeeStats({
              going,
              maybe,
              interested,
              total: eventAttendees.length
            });
          }
        } else {
          // Load all events for this business
          const businessEvents = mockVideos.filter(v => v.userId === user.id);
          
          if (businessEvents.length > 0) {
            setSelectedEvent(businessEvents[0]);
            
            // Get attendees for all events
            let allAttendees: any[] = [];
            let totalGoing = 0;
            let totalMaybe = 0;
            let totalInterested = 0;
            
            businessEvents.forEach(event => {
              const eventAttendees = getEventAttendees(event.id);
              allAttendees = [...allAttendees, ...eventAttendees];
              
              totalGoing += eventAttendees.filter(a => a.status === AttendanceStatus.GOING).length;
              totalMaybe += eventAttendees.filter(a => a.status === AttendanceStatus.MAYBE).length;
              totalInterested += eventAttendees.filter(a => a.status === AttendanceStatus.INTERESTED).length;
            });
            
            setAttendees(allAttendees);
            setAttendeeStats({
              going: totalGoing,
              maybe: totalMaybe,
              interested: totalInterested,
              total: allAttendees.length
            });
          }
        }
      } catch (error) {
        console.error('Error loading analytics data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadData();
  }, [user, eventId, router]);
  
  const handleViewAttendees = () => {
    if (selectedEvent) {
      router.push({
        pathname: '/event/[id]',
        params: { id: selectedEvent.id, showAttendees: 'true' }
      });
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/profile');
  };
  
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
        <Text style={styles.loadingText}>Loading analytics...</Text>
      </View>
    );
  }
  
  if (!selectedEvent) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Business Analytics</Text>
          <View style={styles.headerRight} />
        </View>
        
        <View style={styles.emptyContainer}>
          <BarChart2 size={60} color={Colors.dark.primary} />
          <Text style={styles.emptyTitle}>No Events Found</Text>
          <Text style={styles.emptyText}>You don't have any events to analyze yet.</Text>
          <TouchableOpacity 
            style={styles.createButton}
            onPress={() => router.push('/upload')}
          >
            <Text style={styles.createButtonText}>Create an Event</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Business Analytics</Text>
        <View style={styles.headerRight} />
      </View>
      
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {selectedEvent && (
          <View style={styles.eventHeader}>
            <Text style={styles.eventName}>{selectedEvent.eventName}</Text>
            <Text style={styles.eventLocation}>{selectedEvent.location.name}</Text>
          </View>
        )}
        
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <View style={styles.statIconContainer}>
              <Users size={24} color={Colors.dark.primary} />
            </View>
            <View style={styles.statContent}>
              <Text style={styles.statValue}>{attendeeStats.going}</Text>
              <Text style={styles.statLabel}>Going</Text>
            </View>
          </View>
          
          <View style={styles.statCard}>
            <View style={styles.statIconContainer}>
              <Calendar size={24} color="#FFA500" />
            </View>
            <View style={styles.statContent}>
              <Text style={styles.statValue}>{attendeeStats.maybe}</Text>
              <Text style={styles.statLabel}>Maybe</Text>
            </View>
          </View>
          
          <View style={styles.statCard}>
            <View style={styles.statIconContainer}>
              <TrendingUp size={24} color="#4CAF50" />
            </View>
            <View style={styles.statContent}>
              <Text style={styles.statValue}>{attendeeStats.interested}</Text>
              <Text style={styles.statLabel}>Interested</Text>
            </View>
          </View>
        </View>
        
        <TouchableOpacity 
          style={styles.viewAttendeesButton}
          onPress={handleViewAttendees}
        >
          <Users size={20} color={Colors.dark.text} />
          <Text style={styles.viewAttendeesText}>
            View All Attendees ({attendeeStats.total})
          </Text>
        </TouchableOpacity>
        
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <DollarSign size={20} color={Colors.dark.primary} />
            <Text style={styles.sectionTitle}>Sales Overview</Text>
          </View>
          <SalesOverview data={mockSalesData} eventId={selectedEvent.id} />
        </View>
        
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <BarChart2 size={20} color={Colors.dark.primary} />
            <Text style={styles.sectionTitle}>Product Performance</Text>
          </View>
          <ProductPerformance data={mockProductData} eventId={selectedEvent.id} />
        </View>
        
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Calendar size={20} color={Colors.dark.primary} />
            <Text style={styles.sectionTitle}>Time Analytics</Text>
          </View>
          <TimeAnalytics data={mockTimeData} eventId={selectedEvent.id} />
        </View>
        
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <PieChart size={20} color={Colors.dark.primary} />
            <Text style={styles.sectionTitle}>Customer Demographics</Text>
          </View>
          <CustomerDemographics data={mockCustomerData} eventId={selectedEvent.id} attendees={attendees} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  headerRight: {
    width: 40,
  },
  scrollContent: {
    padding: 16,
  },
  eventHeader: {
    marginBottom: 20,
  },
  eventName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  eventLocation: {
    fontSize: 16,
    color: Colors.dark.subtext,
    marginTop: 4,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(138, 43, 226, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  statContent: {
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.dark.subtext,
  },
  viewAttendeesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  viewAttendeesText: {
    color: Colors.dark.text,
    fontSize: 16,
    marginLeft: 8,
  },
  sectionContainer: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginLeft: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: Colors.dark.text,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.dark.subtext,
    textAlign: 'center',
    marginBottom: 24,
  },
  createButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  createButtonText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});