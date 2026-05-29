import { create } from 'zustand';
import { AnalyticsState } from '@/types/analytics';
import { mockProducts } from '@/mocks/products';

// Initial empty state
const initialSalesData = {
  totalRevenue: 0,
  revenueChange: 0,
  totalOrders: 0,
  ordersChange: 0,
  averageOrderValue: 0,
  aovChange: 0,
  uniqueCustomers: 0,
  customersChange: 0,
  bestSellingProduct: '',
  bestSellingTime: '',
};

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  salesData: initialSalesData,
  productPerformance: [],
  timeAnalytics: [],
  customerData: {
    totalCustomers: 0,
    repeatCustomerRate: 0,
    averageCustomerSpend: 0,
    ageGroups: [],
    genderDistribution: [],
    locationDistribution: [],
  },
  isLoading: false,
  error: null,
  
  fetchAnalytics: async (businessId, timePeriod) => {
    set({ isLoading: true, error: null });
    
    try {
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Generate mock data based on the business ID and time period
      const mockSalesData = generateMockSalesData(businessId, timePeriod);
      const mockProductPerformance = generateMockProductPerformance(businessId, timePeriod);
      const mockTimeAnalytics = generateMockTimeAnalytics(businessId, timePeriod);
      const mockCustomerData = generateMockCustomerData(businessId, timePeriod);
      
      set({
        salesData: mockSalesData,
        productPerformance: mockProductPerformance,
        timeAnalytics: mockTimeAnalytics,
        customerData: mockCustomerData,
        isLoading: false,
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },
  
  exportAnalytics: async (format) => {
    set({ isLoading: true, error: null });
    
    try {
      // In a real app, this would generate a file
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      set({ isLoading: false });
      return `analytics_report.${format}`;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      return '';
    }
  },
}));

// Helper functions to generate mock data
function generateMockSalesData(businessId: string, timePeriod: string) {
  // Use businessId as a seed for consistent random data
  const seed = businessId.charCodeAt(0) + businessId.charCodeAt(businessId.length - 1);
  
  // Base values
  const baseRevenue = 5000 + (seed % 5000);
  const baseOrders = 100 + (seed % 100);
  const baseCustomers = 80 + (seed % 50);
  
  // Multipliers based on time period
  const multiplier = timePeriod === 'today' ? 0.05 :
                    timePeriod === 'week' ? 0.3 :
                    timePeriod === 'month' ? 1 :
                    timePeriod === 'year' ? 12 : 24;
  
  // Calculate values
  const totalRevenue = Math.round(baseRevenue * multiplier);
  const totalOrders = Math.round(baseOrders * multiplier);
  const uniqueCustomers = Math.round(baseCustomers * multiplier);
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  
  // Changes (between -15% and +25%)
  const revenueChange = ((seed % 40) - 15);
  const ordersChange = ((seed % 35) - 10);
  const customersChange = ((seed % 30) - 5);
  const aovChange = ((seed % 25) - 5);
  
  // Get a product from mock data
  const productIndex = seed % mockProducts.length;
  const bestSellingProduct = mockProducts[productIndex]?.name || "VIP Entry Ticket";
  
  // Best selling time
  const times = ["Friday 8-10 PM", "Saturday 9-11 PM", "Thursday 7-9 PM", "Sunday 6-8 PM"];
  const timeIndex = seed % times.length;
  
  return {
    totalRevenue,
    revenueChange,
    totalOrders,
    ordersChange,
    averageOrderValue,
    aovChange,
    uniqueCustomers,
    customersChange,
    bestSellingProduct,
    bestSellingTime: times[timeIndex],
  };
}

function generateMockProductPerformance(businessId: string, timePeriod: string) {
  // Use businessId as a seed
  const seed = businessId.charCodeAt(0) + businessId.charCodeAt(businessId.length - 1);
  
  // Multipliers based on time period
  const multiplier = timePeriod === 'today' ? 0.05 :
                    timePeriod === 'week' ? 0.3 :
                    timePeriod === 'month' ? 1 :
                    timePeriod === 'year' ? 12 : 24;
  
  // Generate performance data for each product
  return mockProducts.map((product, index) => {
    const productSeed = seed + index;
    const sold = Math.round((10 + (productSeed % 90)) * multiplier);
    const revenue = sold * product.price;
    
    // Changes (between -20% and +30%)
    const soldChange = ((productSeed % 50) - 20);
    const revenueChange = ((productSeed % 50) - 20);
    
    return {
      id: product.id,
      name: product.name,
      type: product.type,
      image: product.image,
      sold,
      soldChange,
      revenue,
      revenueChange,
    };
  });
}

function generateMockTimeAnalytics(businessId: string, timePeriod: string) {
  // Use businessId as a seed
  const seed = businessId.charCodeAt(0) + businessId.charCodeAt(businessId.length - 1);
  
  // Generate labels based on time period
  let labels: string[] = [];
  
  if (timePeriod === 'today') {
    labels = ['9 AM', '12 PM', '3 PM', '6 PM', '9 PM', '12 AM', '3 AM'];
  } else if (timePeriod === 'week') {
    labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  } else if (timePeriod === 'month') {
    labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
  } else if (timePeriod === 'year') {
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  } else {
    // all time - last 12 months
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  }
  
  // Base values
  const baseRevenue = 1000 + (seed % 2000);
  const baseOrders = 20 + (seed % 30);
  
  // Generate data for each time period
  return labels.map((label, index) => {
    const timeSeed = seed + index;
    
    // Add some randomness but keep a trend
    const trendFactor = Math.sin((index / labels.length) * Math.PI) * 0.5 + 0.5; // 0 to 1 sine wave
    const randomFactor = 0.7 + (timeSeed % 60) / 100; // 0.7 to 1.3
    
    const revenue = Math.round(baseRevenue * trendFactor * randomFactor);
    const orders = Math.round(baseOrders * trendFactor * randomFactor);
    
    return {
      label,
      revenue,
      orders,
    };
  });
}

function generateMockCustomerData(businessId: string, timePeriod: string) {
  // Use businessId as a seed
  const seed = businessId.charCodeAt(0) + businessId.charCodeAt(businessId.length - 1);
  
  // Multipliers based on time period
  const multiplier = timePeriod === 'today' ? 0.05 :
                    timePeriod === 'week' ? 0.3 :
                    timePeriod === 'month' ? 1 :
                    timePeriod === 'year' ? 12 : 24;
  
  // Base values
  const baseTotalCustomers = 100 + (seed % 200);
  const totalCustomers = Math.round(baseTotalCustomers * multiplier);
  
  // Repeat customer rate (30-70%)
  const repeatCustomerRate = 30 + (seed % 40);
  
  // Average spend ($20-$100)
  const averageCustomerSpend = 20 + (seed % 80);
  
  // Age groups
  const ageGroups = [
    { label: '18-24', value: 10 + (seed % 20) },
    { label: '25-34', value: 20 + (seed % 30) },
    { label: '35-44', value: 15 + (seed % 25) },
    { label: '45-54', value: 10 + (seed % 15) },
    { label: '55+', value: 5 + (seed % 10) },
  ];
  
  // Gender distribution
  const genderDistribution = [
    { label: 'Male', value: 40 + (seed % 20), color: '#2196F3' },
    { label: 'Female', value: 40 + (seed % 20), color: '#E91E63' },
    { label: 'Other', value: 5 + (seed % 5), color: '#9C27B0' },
  ];
  
  // Location distribution
  const locationDistribution = [
    { label: 'New York', value: 20 + (seed % 30) },
    { label: 'Los Angeles', value: 15 + (seed % 25) },
    { label: 'Chicago', value: 10 + (seed % 20) },
    { label: 'Miami', value: 10 + (seed % 15) },
    { label: 'Austin', value: 8 + (seed % 12) },
    { label: 'San Francisco', value: 7 + (seed % 13) },
    { label: 'Seattle', value: 5 + (seed % 10) },
    { label: 'Boston', value: 5 + (seed % 8) },
  ];
  
  return {
    totalCustomers,
    repeatCustomerRate,
    averageCustomerSpend,
    ageGroups,
    genderDistribution,
    locationDistribution,
  };
}