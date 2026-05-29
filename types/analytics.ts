export interface SalesData {
  totalRevenue: number;
  revenueChange: number;
  totalOrders: number;
  ordersChange: number;
  averageOrderValue: number;
  aovChange: number;
  uniqueCustomers: number;
  customersChange: number;
  bestSellingProduct: string;
  bestSellingTime: string;
}

export interface ProductPerformanceData {
  id: string;
  name: string;
  type: string;
  image: string;
  sold: number;
  soldChange: number;
  revenue: number;
  revenueChange: number;
}

export interface TimeAnalyticsData {
  label: string;
  revenue: number;
  orders: number;
}

export interface CustomerData {
  totalCustomers: number;
  repeatCustomerRate: number;
  averageCustomerSpend: number;
  ageGroups: {
    label: string;
    value: number;
  }[];
  genderDistribution: {
    label: string;
    value: number;
    color: string;
  }[];
  locationDistribution: {
    label: string;
    value: number;
  }[];
}

export interface AnalyticsState {
  salesData: SalesData;
  productPerformance: ProductPerformanceData[];
  timeAnalytics: TimeAnalyticsData[];
  customerData: CustomerData;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchAnalytics: (businessId: string, timePeriod: string) => Promise<void>;
  exportAnalytics: (format: 'pdf' | 'csv') => Promise<string>;
}