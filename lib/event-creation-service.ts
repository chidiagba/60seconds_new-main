import { supabase } from './supabase';
import { Database } from './supabase';
import { resolveCurrencyFromCountry } from '@/utils/country-currency';

type Tables = Database['public']['Tables'];
type EventInsert = Tables['events']['Insert'];
type VideoInsert = Tables['videos']['Insert'];
type ProductInsert = Tables['products']['Insert'];

export interface EventCreationData {
  event: {
    event_name: string;
    description?: string;
    start_date: string;
    end_date?: string;
    location_name?: string;
    location_city?: string;
    location_latitude?: number;
    location_longitude?: number;
    max_attendees?: number;
    ticket_price?: number;
    currency?: string;
    image_url?: string;
    category?: string;
    hashtags?: string[];
    is_public?: boolean;
    status?: 'draft' | 'published' | 'open' | 'closed' | 'cancelled' | 'completed';
  };
  video?: {
    title: string;
    description?: string;
    video_url: string;
    thumbnail_url?: string;
    duration?: number;
    file_size?: number;
    location_city?: string;
    hashtags?: string[];
  };
  products?: Array<{
    name: string;
    description?: string;
    price: number;
    currency?: string;
    type: 'ticket' | 'drink' | 'reservation' | 'merchandise';
    available_quantity?: number;
    image_url?: string;
  }>;
}

export interface EventCreationResult {
  success: boolean;
  event?: Tables['events']['Row'];
  video?: Tables['videos']['Row'];
  products?: Tables['products']['Row'][];
  error?: string;
  details?: any;
}

export class EventCreationService {
  /**
   * Creates an event with optional video and products in a transactional manner
   */
  static async createEventWithRelations(data: EventCreationData): Promise<EventCreationResult> {
    try {
      // Step 1: Verify authentication
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('User must be authenticated to create events');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('country, country_code')
        .eq('id', user.id)
        .maybeSingle();

      const defaultCurrency = resolveCurrencyFromCountry({
        country: profile?.country || user.user_metadata?.country,
        countryCode: profile?.country_code || user.user_metadata?.country_code,
      });

      console.log('🚀 Starting event creation process for user:', user.id);

      // Step 2: Create event first
      const eventResult = await this.createEvent(data.event, user.id, defaultCurrency);
      if (!eventResult.success || !eventResult.event) {
        throw new Error(`Failed to create event: ${eventResult.error}`);
      }

      console.log('✅ Event created successfully:', eventResult.event.id);

      // Step 3: Create video if provided
      let videoResult = null;
      if (data.video) {
        videoResult = await this.createVideo(data.video, user.id, eventResult.event.id);
        if (!videoResult.success) {
          console.warn('⚠️ Video creation failed, but event was created:', videoResult.error);
          // Continue without video - event is still valid
        } else {
          console.log('✅ Video created successfully:', videoResult.video?.id);
        }
      }

      // Step 4: Create products if provided
      let productsResult = null;
      if (data.products && data.products.length > 0) {
        productsResult = await this.createProducts(data.products, user.id, eventResult.event.id, defaultCurrency);
        if (!productsResult.success) {
          console.warn('⚠️ Products creation failed, but event was created:', productsResult.error);
          // Continue without products - event is still valid
        } else {
          console.log('✅ Products created successfully:', productsResult.products?.length);
        }
      }

      return {
        success: true,
        event: eventResult.event,
        video: videoResult?.video || undefined,
        products: productsResult?.products || undefined,
        details: {
          eventId: eventResult.event.id,
          videoId: videoResult?.video?.id,
          productCount: productsResult?.products?.length || 0
        }
      };

    } catch (error) {
      console.error('❌ Event creation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        details: error
      };
    }
  }

  /**
   * Creates an event record
   */
  private static async createEvent(eventData: EventCreationData['event'], userId: string, defaultCurrency: string) {
    try {
      const eventInsert: EventInsert = {
        user_id: userId,
        creator_id: userId,
        event_name: eventData.event_name,
        description: eventData.description,
        start_date: eventData.start_date,
        end_date: eventData.end_date,
        location_name: eventData.location_name,
        location_city: eventData.location_city,
        location_latitude: eventData.location_latitude,
        location_longitude: eventData.location_longitude,
        max_attendees: eventData.max_attendees || 100,
        current_attendees: 0,
        ticket_price: eventData.ticket_price || 0,
        currency: eventData.currency || defaultCurrency || 'USD',
        image_url: eventData.image_url,
        category: eventData.category || 'General',
        hashtags: eventData.hashtags || [],
        is_public: eventData.is_public ?? true,
        status: eventData.status || 'published',
        business_id: userId // Assuming business_id for now
      };

      const { data, error } = await supabase
        .from('events')
        .insert(eventInsert)
        .select()
        .single();

      if (error) {
        console.error('Event creation error:', error);
        return { success: false, error: this.formatSupabaseError(error) };
      }

      return { success: true, event: data };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Creates a video record linked to the event
   */
  private static async createVideo(
    videoData: EventCreationData['video'], 
    userId: string, 
    eventId: string
  ) {
    try {
      if (!videoData) {
        return { success: true, video: null };
      }

      const videoInsert: VideoInsert = {
        user_id: userId,
        title: videoData.title,
        description: videoData.description,
        video_url: videoData.video_url,
        thumbnail_url: videoData.thumbnail_url,
        duration: videoData.duration,
        file_size: videoData.file_size,
        location_city: videoData.location_city,
        hashtags: videoData.hashtags || [],
        business_id: userId,
        status: 'published'
      };

      const { data, error } = await supabase
        .from('videos')
        .insert(videoInsert)
        .select()
        .single();

      if (error) {
        console.error('Video creation error:', error);
        return { success: false, error: this.formatSupabaseError(error) };
      }

      // Update event with video_id
      const { error: updateError } = await supabase
        .from('events')
        .update({ video_id: data.id })
        .eq('id', eventId);

      if (updateError) {
        console.warn('Failed to link video to event:', updateError);
      }

      return { success: true, video: data };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Creates multiple product records linked to the event
   */
  private static async createProducts(
    productsData: EventCreationData['products'], 
    userId: string, 
    eventId: string,
    defaultCurrency: string
  ) {
    try {
      if (!productsData || productsData.length === 0) {
        return { success: true, products: [] };
      }

      const productInserts: ProductInsert[] = productsData.map(product => ({
        event_id: eventId,
        business_id: userId,
        name: product.name,
        description: product.description,
        price: product.price,
        currency: product.currency || defaultCurrency || 'USD',
        type: product.type,
        available_quantity: product.available_quantity || 0,
        sold_quantity: 0,
        image_url: product.image_url,
        is_active: true
      }));

      const { data, error } = await supabase
        .from('products')
        .insert(productInserts)
        .select();

      if (error) {
        console.error('Products creation error:', error);
        return { success: false, error: this.formatSupabaseError(error) };
      }

      return { success: true, products: data || [] };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Formats Supabase errors into user-friendly messages
   */
  private static formatSupabaseError(error: any): string {
    if (error.code === '42501') {
      return 'Permission denied. Please ensure you are authenticated and have the correct permissions.';
    }
    if (error.code === '23503') {
      return 'Foreign key constraint violation. Please check that all referenced records exist.';
    }
    if (error.code === '23505') {
      return 'Duplicate entry. This record already exists.';
    }
    if (error.code === '23514') {
      return 'Check constraint violation. Please verify all field values are valid.';
    }
    if (error.message?.includes('row-level security')) {
      return 'Access denied by security policy. Please check your permissions.';
    }
    return error.message || 'Database error occurred';
  }

  /**
   * Validates event creation data before processing
   */
  static validateEventData(data: EventCreationData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate event data
    if (!data.event.event_name?.trim()) {
      errors.push('Event name is required');
    }
    if (!data.event.start_date) {
      errors.push('Event start date is required');
    }

    // Validate video data if provided
    if (data.video) {
      if (!data.video.title?.trim()) {
        errors.push('Video title is required');
      }
      if (!data.video.video_url?.trim()) {
        errors.push('Video URL is required');
      }
    }

    // Validate products data if provided
    if (data.products) {
      data.products.forEach((product, index) => {
        if (!product.name?.trim()) {
          errors.push(`Product ${index + 1}: Name is required`);
        }
        if (!product.price || product.price <= 0) {
          errors.push(`Product ${index + 1}: Valid price is required`);
        }
        if (!product.type) {
          errors.push(`Product ${index + 1}: Type is required`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
