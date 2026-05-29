import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Product } from '@/types';
import { mockProducts } from '@/mocks/products';
import { TRANSACTION_FEE_PERCENTAGE } from '@/types/wallet';

interface CartItem {
  product: Product;
  quantity: number;
}

interface ProductSale {
  productId: string;
  quantity: number;
  price: number;
  date: string;
  userId: string;
  eventId: string;
  transactionFee?: number;
}

interface ProductPerformanceItem {
  productId: string;
  totalSold: number;
  totalRevenue: number;
  name: string;
}

interface ProductState {
  products: Product[];
  cart: CartItem[];
  sales: ProductSale[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchProducts: (userId?: string) => Promise<void>;
  addToCart: (product: Product, quantity: number) => void;
  removeFromCart: (productId: string) => void;
  updateCartItemQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getCartTotal: () => number;
  getCartItemCount: () => number;
  getCartFee: () => number;
  getCartGrandTotal: () => number;
  addProduct: (product: Product) => void;
  updateProduct: (product: Product) => void;
  deleteProduct: (productId: string) => void;
  
  // Sales tracking
  recordSale: (sale: Omit<ProductSale, 'date'>) => void;
  getSalesByEvent: (eventId: string) => ProductSale[];
  getSalesByProduct: (productId: string) => ProductSale[];
  getSalesByBusinessId: (businessId: string) => ProductSale[];
  getTotalRevenue: (businessId: string, period?: string) => number;
  getProductPerformance: (businessId: string, period?: string) => {
    productId: string;
    name: string;
    totalSold: number;
    totalRevenue: number;
  }[];
}

export const useProductStore = create<ProductState>()(
  persist(
    (set, get) => ({
  products: [],
  cart: [],
  sales: [
    // Mock sales data
    {
      productId: '1',
      quantity: 5,
      price: 49.99,
      date: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
      userId: 'user1',
      eventId: '1',
      transactionFee: 12.50,
    },
    {
      productId: '1',
      quantity: 3,
      price: 49.99,
      date: new Date(Date.now() - 86400000 * 5).toISOString(), // 5 days ago
      userId: 'user2',
      eventId: '1',
      transactionFee: 7.50,
    },
    {
      productId: '2',
      quantity: 2,
      price: 299.99,
      date: new Date(Date.now() - 86400000 * 3).toISOString(), // 3 days ago
      userId: 'user3',
      eventId: '1',
      transactionFee: 30.00,
    },
    {
      productId: '3',
      quantity: 10,
      price: 29.99,
      date: new Date(Date.now() - 86400000 * 7).toISOString(), // 7 days ago
      userId: 'user4',
      eventId: '3',
      transactionFee: 15.00,
    },
    {
      productId: '4',
      quantity: 8,
      price: 59.99,
      date: new Date(Date.now() - 86400000 * 10).toISOString(), // 10 days ago
      userId: 'user5',
      eventId: '3',
      transactionFee: 24.00,
    },
    {
      productId: '5',
      quantity: 15,
      price: 34.99,
      date: new Date(Date.now() - 86400000 * 15).toISOString(), // 15 days ago
      userId: 'user6',
      eventId: '5',
      transactionFee: 26.25,
    },
    // More recent sales
    {
      productId: '1',
      quantity: 7,
      price: 49.99,
      date: new Date(Date.now() - 86400000 * 1).toISOString(), // 1 day ago
      userId: 'user7',
      eventId: '1',
      transactionFee: 17.50,
    },
    {
      productId: '2',
      quantity: 3,
      price: 299.99,
      date: new Date(Date.now() - 3600000 * 12).toISOString(), // 12 hours ago
      userId: 'user8',
      eventId: '1',
      transactionFee: 45.00,
    },
    {
      productId: '3',
      quantity: 12,
      price: 29.99,
      date: new Date(Date.now() - 3600000 * 6).toISOString(), // 6 hours ago
      userId: 'user9',
      eventId: '3',
      transactionFee: 18.00,
    },
  ],
  isLoading: false,
  error: null,
  
  fetchProducts: async (userId?: string) => {
    set({ isLoading: true, error: null });
    try {
      // In a real app, this would be an API call
      // Simulating network delay
      await new Promise(resolve => setTimeout(resolve, 300));
      const filteredProducts = userId 
        ? mockProducts.filter(product => {
            // For business users, return all their products
            return true; // In real app, you'd filter by business/user ID
          })
        : mockProducts;
      set({ products: filteredProducts, isLoading: false });
    } catch (error) {
      set({ error: 'Failed to fetch products', isLoading: false });
    }
  },
  
  addToCart: (product: Product, quantity: number) => {
    set(state => {
      const existingItem = state.cart.find(item => item.product.id === product.id);
      
      if (existingItem) {
        console.log('🛒 Updating cart item quantity:', product.name, 'new quantity:', existingItem.quantity + quantity);
        return {
          cart: state.cart.map(item => 
            item.product.id === product.id 
              ? { ...item, quantity: item.quantity + quantity } 
              : item
          )
        };
      } else {
        console.log('🛒 Adding new item to cart:', product.name, 'quantity:', quantity);
        return {
          cart: [...state.cart, { product, quantity }]
        };
      }
    });
  },
  
  removeFromCart: (productId: string) => {
    set(state => ({
      cart: state.cart.filter(item => item.product.id !== productId)
    }));
  },
  
  updateCartItemQuantity: (productId: string, quantity: number) => {
    set(state => ({
      cart: state.cart.map(item => 
        item.product.id === productId 
          ? { ...item, quantity } 
          : item
      )
    }));
  },
  
  clearCart: () => {
    console.log('🛒 Clearing cart');
    set({ cart: [] });
  },
  
  getCartTotal: () => {
    const { cart } = get();
    return cart.reduce((total, item) => total + (item.product.price * item.quantity), 0);
  },
  
  getCartFee: () => {
    const subtotal = get().getCartTotal();
    return parseFloat((subtotal * TRANSACTION_FEE_PERCENTAGE).toFixed(2));
  },
  
  getCartGrandTotal: () => {
    const subtotal = get().getCartTotal();
    const fee = get().getCartFee();
    return subtotal + fee;
  },
  
  getCartItemCount: () => {
    const { cart } = get();
    return cart.reduce((count, item) => count + item.quantity, 0);
  },
  
  addProduct: (product: Product) => {
    set(state => ({
      products: [...state.products, product]
    }));
  },
  
  updateProduct: (product: Product) => {
    set(state => ({
      products: state.products.map(p => 
        p.id === product.id ? product : p
      )
    }));
  },
  
  deleteProduct: (productId: string) => {
    set(state => ({
      products: state.products.filter(p => p.id !== productId)
    }));
  },
  
  // Sales tracking methods
  recordSale: (sale) => {
    const transactionFee = parseFloat((sale.price * sale.quantity * TRANSACTION_FEE_PERCENTAGE).toFixed(2));
    
    set(state => ({
      sales: [...state.sales, { 
        ...sale, 
        date: new Date().toISOString(),
        transactionFee
      }]
    }));
  },
  
  getSalesByEvent: (eventId) => {
    const { sales } = get();
    return sales.filter(sale => sale.eventId === eventId);
  },
  
  getSalesByProduct: (productId) => {
    const { sales } = get();
    return sales.filter(sale => sale.productId === productId);
  },
  
  getSalesByBusinessId: (businessId) => {
    const { sales } = get();
    const { products } = get();
    
    // Get all products for this business
    const businessProducts = products.filter(product => {
      // In a real app, you would have a businessId field on products
      // For now, we'll use the videoId to match with events from the business
      const video = mockVideos.find(v => v.id === product.videoId);
      return video && video.userId === businessId;
    });
    
    const businessProductIds = businessProducts.map(product => product.id);
    
    // Filter sales for these products
    return sales.filter(sale => businessProductIds.includes(sale.productId));
  },
  
  getTotalRevenue: (businessId, period) => {
    const sales = get().getSalesByBusinessId(businessId);
    
    // Filter by period if specified
    const filteredSales = period ? filterSalesByPeriod(sales, period) : sales;
    
    // Calculate total revenue (excluding platform fees)
    return filteredSales.reduce((total, sale) => {
      const saleTotal = sale.price * sale.quantity;
      return total + saleTotal;
    }, 0);
  },
  
  getProductPerformance: (businessId, period) => {
    const sales = get().getSalesByBusinessId(businessId);
    const { products } = get();
    
    // Filter by period if specified
    const filteredSales = period ? filterSalesByPeriod(sales, period) : sales;
    
    // Group sales by product
    const productPerformance: Record<string, ProductPerformanceItem> = {};
    
    filteredSales.forEach(sale => {
      if (!productPerformance[sale.productId]) {
        productPerformance[sale.productId] = {
          productId: sale.productId,
          totalSold: 0,
          totalRevenue: 0,
          name: '',
        };
      }
      
      productPerformance[sale.productId].totalSold += sale.quantity;
      productPerformance[sale.productId].totalRevenue += sale.price * sale.quantity;
    });
    
    // Add product names
    return Object.values(productPerformance).map(performance => {
      const product = products.find(p => p.id === performance.productId) || 
                     mockProducts.find(p => p.id === performance.productId);
      
      return {
        ...performance,
        name: product ? product.name : 'Unknown Product',
      };
    });
  },
    }),
    {
      name: 'product-store', // unique name for the storage key
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the cart, not the entire store
      partialize: (state) => ({ 
        cart: state.cart,
        // You can add other fields you want to persist here
      }),
      // Debug: Log when cart is loaded from storage
      onRehydrateStorage: () => (state) => {
        if (state?.cart) {
          console.log('🛒 Cart loaded from storage:', state.cart.length, 'items');
        }
      },
    }
  )
);

// Helper function to filter sales by time period
function filterSalesByPeriod(sales: ProductSale[], period: string) {
  const now = new Date();
  let cutoffDate: Date;
  
  switch (period) {
    case 'today':
      cutoffDate = new Date(now.setHours(0, 0, 0, 0));
      break;
    case 'week':
      cutoffDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      cutoffDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'year':
      cutoffDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    default:
      // 'all' or invalid period - no filtering
      return sales;
  }
  
  return sales.filter(sale => new Date(sale.date) >= cutoffDate);
}

// Import mockVideos for business ID lookup
import { mockVideos } from '@/mocks/videos';