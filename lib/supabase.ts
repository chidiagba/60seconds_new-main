import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Custom fetch with timeout for React Native
// Password reset emails can take 30-40 seconds due to email service processing
const fetchWithTimeout = (url: RequestInfo | URL, options: RequestInit = {}) => {
  // Check if AbortController is available (React Native 0.60+)
  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    // Increased timeout to 45 seconds for password reset emails
    // Supabase email service can take 30-40 seconds to process
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout
    
    return fetch(url, {
      ...options,
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId);
    });
  } else {
    // Fallback for older React Native versions - use Promise.race
    return new Promise<Response>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('Request timeout')), 45000);

      fetch(url, options)
        .then((response) => {
          clearTimeout(timeoutId);
          resolve(response);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      'X-Client-Info': 'supabase-js-react-native',
    },
    // Add fetch with timeout for all requests to prevent long waits
    fetch: fetchWithTimeout,
  },
  db: {
    schema: 'public',
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          user_type: 'business' | 'private';
          full_name: string;
          username: string;
          email: string;
          country?: string;
          country_code?: string;
          avatar_url?: string;
          avatar_gender?: 'male' | 'female';
          bio?: string;
          location_city?: string;
          hashtags?: string[];
          business_name?: string;
          business_type?: string;
          followers_count: number;
          following_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          user_type: 'business' | 'private';
          full_name: string;
          username: string;
          email: string;
          country?: string;
          country_code?: string;
          avatar_url?: string;
          avatar_gender?: 'male' | 'female';
          bio?: string;
          location_city?: string;
          hashtags?: string[];
          business_name?: string;
          business_type?: string;
          followers_count?: number;
          following_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_type?: 'business' | 'private';
          full_name?: string;
          username?: string;
          email?: string;
          country?: string;
          country_code?: string;
          avatar_url?: string;
          avatar_gender?: 'male' | 'female';
          bio?: string;
          location_city?: string;
          hashtags?: string[];
          business_name?: string;
          business_type?: string;
          followers_count?: number;
          following_count?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      follows: {
        Row: {
          id: string;
          follower_id: string;
          following_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          follower_id: string;
          following_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          follower_id?: string;
          following_id?: string;
          created_at?: string;
        };
      };
      videos: {
        Row: {
          id: string;
          user_id: string;
          business_id?: string;
          event_id?: string;
          video_url: string;
          duration?: number;
          file_size?: number;
          status?: string;
          watermarked_video_url?: string | null;
          watermark_status: 'pending' | 'processing' | 'ready' | 'failed';
          thumbnail_url?: string;
          title: string;
          description?: string;
          likes_count: number;
          comments_count: number;
          shares_count: number;
          rating: number;
          rating_count: number;
          location_name?: string;
          location_address?: string;
          location_city?: string;
          location_state?: string;
          location_country?: string;
          location_coordinates?: string; // POINT type as string
          event_name?: string;
          event_date?: string;
          hashtags?: string[];
          upload_date: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          video_url: string;
          duration?: number;
          file_size?: number;
          business_id?: string;
          status?: string;
          watermarked_video_url?: string | null;
          watermark_status?: 'pending' | 'processing' | 'ready' | 'failed';
          thumbnail_url?: string;
          title: string;
          description?: string;
          likes_count?: number;
          comments_count?: number;
          shares_count?: number;
          rating?: number;
          rating_count?: number;
          location_name?: string;
          location_address?: string;
          location_city?: string;
          location_state?: string;
          location_country?: string;
          location_coordinates?: string; // POINT type as string
          event_name?: string;
          event_date?: string;
          hashtags?: string[];
          upload_date?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          video_url?: string;
          watermarked_video_url?: string | null;
          watermark_status?: 'pending' | 'processing' | 'ready' | 'failed';
          thumbnail_url?: string;
          title?: string;
          description?: string;
          likes_count?: number;
          comments_count?: number;
          shares_count?: number;
          rating?: number;
          rating_count?: number;
          location_name?: string;
          location_address?: string;
          location_city?: string;
          location_state?: string;
          location_country?: string;
          location_coordinates?: string; // POINT type as string
          event_name?: string;
          event_date?: string;
          hashtags?: string[];
          upload_date?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      orders: {
        Row: {
          id: string;
          order_number: string;
          user_id: string;
          business_id?: string;
          event_id?: string;
          video_id?: string;
          status: 'pending' | 'confirmed' | 'open' | 'partially_completed' | 'completed' | 'cancelled';
          total_amount: number;
          currency: string;
          payment_method?: string;
          payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
          payment_provider?: string;
          payment_reference?: string;
          payment_transaction_id?: string;
          payment_metadata?: Record<string, any>;
          subtotal?: number;
          platform_fee?: number;
          source?: string;
          expires_at?: string;
          items: {
            product_id: string;
            type?: string;
            description?: string;
            quantity: number;
            price: number;
            name: string;
          }[];
          shipping_address?: {
            street: string;
            city: string;
            state: string;
            country: string;
            postal_code: string;
          };
          notes?: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          order_number?: string;
          user_id: string;
          business_id?: string;
          event_id?: string;
          video_id?: string;
          status?: 'pending' | 'confirmed' | 'open' | 'partially_completed' | 'completed' | 'cancelled';
          total_amount: number;
          currency?: string;
          payment_method?: string;
          payment_status?: 'pending' | 'paid' | 'failed' | 'refunded';
          payment_provider?: string;
          payment_reference?: string;
          payment_transaction_id?: string;
          payment_metadata?: Record<string, any>;
          subtotal?: number;
          platform_fee?: number;
          source?: string;
          expires_at?: string;
          items: {
            product_id: string;
            type?: string;
            description?: string;
            quantity: number;
            price: number;
            name: string;
          }[];
          shipping_address?: {
            street: string;
            city: string;
            state: string;
            country: string;
            postal_code: string;
          };
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          order_number?: string;
          user_id?: string;
          business_id?: string;
          event_id?: string;
          video_id?: string;
          status?: 'pending' | 'confirmed' | 'open' | 'partially_completed' | 'completed' | 'cancelled';
          total_amount?: number;
          currency?: string;
          payment_method?: string;
          payment_status?: 'pending' | 'paid' | 'failed' | 'refunded';
          payment_provider?: string;
          payment_reference?: string;
          payment_transaction_id?: string;
          payment_metadata?: Record<string, any>;
          subtotal?: number;
          platform_fee?: number;
          source?: string;
          expires_at?: string;
          items?: {
            product_id: string;
            type?: string;
            description?: string;
            quantity: number;
            price: number;
            name: string;
          }[];
          shipping_address?: {
            street: string;
            city: string;
            state: string;
            country: string;
            postal_code: string;
          };
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      payments: {
        Row: { id: string; order_id: string; user_id: string; organizer_id?: string; payment_provider: string; provider_reference: string; amount: number; currency: string; status: string; provider_status?: string; transaction_id?: string; gateway_reference?: string; gateway_response?: Record<string, any>; authorization_code?: string; processing_fee: number; net_amount?: number; metadata: Record<string, any>; failure_reason?: string; completed_at?: string; paid_at?: string; settled_at?: string; created_at: string; updated_at: string };
        Insert: { id?: string; order_id: string; user_id: string; organizer_id?: string; payment_provider: string; provider_reference: string; amount: number; currency: string; status?: string; provider_status?: string; transaction_id?: string; gateway_reference?: string; gateway_response?: Record<string, any>; authorization_code?: string; processing_fee?: number; net_amount?: number; metadata?: Record<string, any>; failure_reason?: string; completed_at?: string; paid_at?: string; settled_at?: string; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['payments']['Insert']>;
      };
      ticket_receipts: {
        Row: {
          id: string;
          order_id: string;
          order_number: string;
          buyer_id: string;
          owner_id: string;
          video_id?: string;
          event_id?: string;
          product_id?: string;
          ticket_type?: string;
          receipt_kind: 'ticket' | 'product';
          ticket_title: string;
          quantity: number;
          unit_price: number;
          total_price: number;
          currency: string;
          qr_code_data: string;
          ticket_image_url?: string;
          pdf_url?: string;
          seat_no?: string;
          event_name?: string;
          event_start_date?: string;
          event_end_date?: string;
          location_name?: string;
          is_active: boolean;
          redeemed_at?: string;
          redeemed_by?: string;
          issued_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          order_number: string;
          buyer_id: string;
          owner_id: string;
          video_id?: string;
          event_id?: string;
          product_id?: string;
          ticket_type?: string;
          receipt_kind?: 'ticket' | 'product';
          ticket_title: string;
          quantity?: number;
          unit_price: number;
          total_price: number;
          currency?: string;
          qr_code_data: string;
          ticket_image_url?: string;
          pdf_url?: string;
          seat_no?: string;
          event_name?: string;
          event_start_date?: string;
          event_end_date?: string;
          location_name?: string;
          is_active?: boolean;
          redeemed_at?: string;
          redeemed_by?: string;
          issued_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          order_number?: string;
          buyer_id?: string;
          owner_id?: string;
          video_id?: string;
          event_id?: string;
          product_id?: string;
          ticket_type?: string;
          receipt_kind?: 'ticket' | 'product';
          ticket_title?: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
          currency?: string;
          qr_code_data?: string;
          ticket_image_url?: string;
          pdf_url?: string;
          seat_no?: string;
          event_name?: string;
          event_start_date?: string;
          event_end_date?: string;
          location_name?: string;
          is_active?: boolean;
          redeemed_at?: string;
          redeemed_by?: string;
          issued_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      events: {
        Row: {
          id: string;
          user_id: string;
          creator_id: string; // Added
          event_name: string;
          description?: string;
          start_date: string;
          end_date?: string;
          location_name?: string;
          location_address?: string;
          location_city?: string;
          location_state?: string;
          location_country?: string;
          location_latitude?: number;
          location_longitude?: number;
          max_attendees?: number;
          current_attendees: number;
          ticket_price?: number;
          currency?: string;
          image_url?: string;
          category?: string;
          tags?: string[];
          hashtags?: string[];
          video_id?: string;
          business_id?: string;
          is_public: boolean;
          requires_approval: boolean;
          status: 'draft' | 'published' | 'open' | 'closed' | 'cancelled' | 'completed';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          creator_id?: string; // Added
          event_name: string;
          description?: string;
          start_date: string;
          end_date?: string;
          location_name?: string;
          location_address?: string;
          location_city?: string;
          location_state?: string;
          location_country?: string;
          location_latitude?: number;
          location_longitude?: number;
          max_attendees?: number;
          current_attendees?: number;
          ticket_price?: number;
          currency?: string;
          image_url?: string;
          category?: string;
          tags?: string[];
          hashtags?: string[];
          video_id?: string;
          business_id?: string;
          is_public?: boolean;
          requires_approval?: boolean;
          status?: 'draft' | 'published' | 'open' | 'closed' | 'cancelled' | 'completed';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          creator_id?: string; // Added
          event_name?: string;
          description?: string;
          start_date?: string;
          end_date?: string;
          location_name?: string;
          location_address?: string;
          location_city?: string;
          location_state?: string;
          location_country?: string;
          location_latitude?: number;
          location_longitude?: number;
          max_attendees?: number;
          current_attendees?: number;
          ticket_price?: number;
          currency?: string;
          image_url?: string;
          category?: string;
          tags?: string[];
          hashtags?: string[];
          video_id?: string;
          business_id?: string;
          is_public?: boolean;
          requires_approval?: boolean;
          status?: 'draft' | 'published' | 'open' | 'closed' | 'cancelled' | 'completed';
          created_at?: string;
          updated_at?: string;
        };
      };
      vouchers: {
        Row: {
          id: string;
          business_id: string;
          code: string;
          name: string;
          description?: string;
          discount_type: 'percentage' | 'fixed';
          discount_amount: number;
          min_purchase_amount?: number;
          max_discount_amount?: number;
          usage_limit?: number;
          usage_count: number;
          expiry_date?: string;
          is_active: boolean;
          applicable_products?: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          code: string;
          name: string;
          description?: string;
          discount_type: 'percentage' | 'fixed';
          discount_amount: number;
          min_purchase_amount?: number;
          max_discount_amount?: number;
          usage_limit?: number;
          usage_count?: number;
          expiry_date?: string;
          is_active?: boolean;
          applicable_products?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          code?: string;
          name?: string;
          description?: string;
          discount_type?: 'percentage' | 'fixed';
          discount_amount?: number;
          min_purchase_amount?: number;
          max_discount_amount?: number;
          usage_limit?: number;
          usage_count?: number;
          expiry_date?: string;
          is_active?: boolean;
          applicable_products?: string[];
          created_at?: string;
          updated_at?: string;
        };
      };
      reservations: {
        Row: {
          id: string;
          user_id: string;
          event_id?: string;
          video_id?: string;
          business_id?: string;
          reservation_type: 'event' | 'table' | 'service' | 'appointment';
          status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
          reservation_date: string;
          reservation_time?: string;
          party_size?: number;
          special_requests?: string;
          contact_name: string;
          contact_phone?: string;
          contact_email?: string;
          total_amount?: number;
          currency?: string;
          payment_status?: 'pending' | 'paid' | 'failed' | 'refunded';
          confirmation_code?: string;
          notes?: string;
          metadata?: Record<string, any>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_id?: string;
          video_id?: string;
          business_id?: string;
          reservation_type: 'event' | 'table' | 'service' | 'appointment';
          status?: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
          reservation_date: string;
          reservation_time?: string;
          party_size?: number;
          special_requests?: string;
          contact_name: string;
          contact_phone?: string;
          contact_email?: string;
          total_amount?: number;
          currency?: string;
          payment_status?: 'pending' | 'paid' | 'failed' | 'refunded';
          confirmation_code?: string;
          notes?: string;
          metadata?: Record<string, any>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          event_id?: string;
          video_id?: string;
          business_id?: string;
          reservation_type?: 'event' | 'table' | 'service' | 'appointment';
          status?: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
          reservation_date?: string;
          reservation_time?: string;
          party_size?: number;
          special_requests?: string;
          contact_name?: string;
          contact_phone?: string;
          contact_email?: string;
          total_amount?: number;
          currency?: string;
          payment_status?: 'pending' | 'paid' | 'failed' | 'refunded';
          confirmation_code?: string;
          notes?: string;
          metadata?: Record<string, any>;
          created_at?: string;
          updated_at?: string;
        };
      };
      products: {
        Row: {
          id: string;
          event_id: string;
          business_id: string;
          name: string;
          description?: string;
          price: number;
          currency: string;
          type: 'ticket' | 'drink' | 'reservation' | 'merchandise';
          available_quantity: number;
          sold_quantity: number;
          image_url?: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          business_id: string;
          name: string;
          description?: string;
          price: number;
          currency?: string;
          type: 'ticket' | 'drink' | 'reservation' | 'merchandise';
          available_quantity?: number;
          sold_quantity?: number;
          image_url?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          business_id?: string;
          name?: string;
          description?: string;
          price?: number;
          currency?: string;
          type?: 'ticket' | 'drink' | 'reservation' | 'merchandise';
          available_quantity?: number;
          sold_quantity?: number;
          image_url?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      video_comments: {
        Row: {
          id: string;
          video_id: string;
          user_id: string;
          parent_id: string | null;
          text: string;
          likes_count: number;
          is_hidden: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          video_id: string;
          user_id: string;
          parent_id?: string | null;
          text: string;
          likes_count?: number;
          is_hidden?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          video_id?: string;
          user_id?: string;
          parent_id?: string | null;
          text?: string;
          likes_count?: number;
          is_hidden?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      video_ratings: {
        Row: {
          id: string;
          video_id: string;
          user_id: string;
          rating: number;
          is_hidden: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          video_id: string;
          user_id: string;
          rating: number;
          is_hidden?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          video_id?: string;
          user_id?: string;
          rating?: number;
          is_hidden?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      video_likes: {
        Row: {
          id: string;
          video_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          video_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          video_id?: string;
          user_id?: string;
          created_at?: string;
        };
      };
      video_shares: {
        Row: {
          id: string;
          video_id: string;
          user_id: string;
          source: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          video_id: string;
          user_id: string;
          source?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          video_id?: string;
          user_id?: string;
          source?: string;
          created_at?: string;
        };
      };
    };
  };
};
