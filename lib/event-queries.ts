import { supabase } from './supabase';
import { Database } from './supabase';

type Tables = Database['public']['Tables'];

export interface EventWithProducts extends Tables['events']['Row'] {
  products?: Tables['products']['Row'][];
  has_products?: boolean;
  product_count?: number;
  video?: Tables['videos']['Row'];
  creator?: Tables['profiles']['Row'];
}

export interface EventListItem extends Tables['events']['Row'] {
  has_products: boolean;
  product_count: number;
  video?: Pick<Tables['videos']['Row'], 'id' | 'title' | 'thumbnail_url' | 'video_url'>;
  creator?: Pick<Tables['profiles']['Row'], 'id' | 'username' | 'full_name' | 'avatar_url'>;
}

export class EventQueries {
  /**
   * Fetches all events with product existence check for home screen
   * This is optimized for the home screen where you need to show "Shop" buttons
   */
  static async getEventsForHomeScreen(limit: number = 20, offset: number = 0): Promise<{
    success: boolean;
    events?: EventListItem[];
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('events')
        .select(`
          *,
          products!inner(id, is_active),
          video:videos(id, title, thumbnail_url, video_url),
          creator:profiles!events_creator_id_fkey(id, username, full_name, avatar_url)
        `)
        .eq('is_public', true)
        .eq('status', 'published')
        .eq('products.is_active', true)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('Error fetching events for home screen:', error);
        return { success: false, error: this.formatError(error) };
      }

      // Transform data to include product counts
      const eventsWithProductInfo: EventListItem[] = (data || []).map(event => {
        const productCount = event.products?.length || 0;
        return {
          ...event,
          has_products: productCount > 0,
          product_count: productCount,
          products: undefined // Remove products array to save memory
        };
      });

      return { success: true, events: eventsWithProductInfo };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Alternative query for home screen - fetches events and checks for products separately
   * This is more efficient if you have many events but few with products
   */
  static async getEventsWithProductCheck(limit: number = 20, offset: number = 0): Promise<{
    success: boolean;
    events?: EventListItem[];
    error?: string;
  }> {
    try {
      // First, get all public events
      const { data: events, error: eventsError } = await supabase
        .from('events')
        .select(`
          *,
          video:videos(id, title, thumbnail_url, video_url),
          creator:profiles!events_creator_id_fkey(id, username, full_name, avatar_url)
        `)
        .eq('is_public', true)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (eventsError) {
        console.error('Error fetching events:', eventsError);
        return { success: false, error: this.formatError(eventsError) };
      }

      if (!events || events.length === 0) {
        return { success: true, events: [] };
      }

      // Get product counts for these events
      const eventIds = events.map(event => event.id);
      const { data: productCounts, error: productsError } = await supabase
        .from('products')
        .select('event_id')
        .in('event_id', eventIds)
        .eq('is_active', true);

      if (productsError) {
        console.warn('Error fetching product counts:', productsError);
        // Continue without product info
      }

      // Count products per event
      const productCountMap = new Map<string, number>();
      (productCounts || []).forEach(product => {
        const count = productCountMap.get(product.event_id) || 0;
        productCountMap.set(product.event_id, count + 1);
      });

      // Combine events with product info
      const eventsWithProductInfo: EventListItem[] = events.map(event => {
        const productCount = productCountMap.get(event.id) || 0;
        return {
          ...event,
          has_products: productCount > 0,
          product_count: productCount
        };
      });

      return { success: true, events: eventsWithProductInfo };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Fetches a single event with all its products for the shop screen
   */
  static async getEventWithProducts(eventId: string): Promise<{
    success: boolean;
    event?: EventWithProducts;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('events')
        .select(`
          *,
          products!products_event_id_fkey(*),
          video:videos(*),
          creator:profiles!events_creator_id_fkey(*)
        `)
        .eq('id', eventId)
        .eq('is_public', true)
        .single();

      if (error) {
        console.error('Error fetching event with products:', error);
        return { success: false, error: this.formatError(error) };
      }

      if (!data) {
        return { success: false, error: 'Event not found' };
      }

      // Filter only active products
      const activeProducts = data.products?.filter(product => product.is_active) || [];
      
      const eventWithProducts: EventWithProducts = {
        ...data,
        products: activeProducts,
        has_products: activeProducts.length > 0,
        product_count: activeProducts.length
      };

      return { success: true, event: eventWithProducts };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Fetches products for a specific event (for shop screen)
   */
  static async getEventProducts(eventId: string): Promise<{
    success: boolean;
    products?: Tables['products']['Row'][];
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching event products:', error);
        return { success: false, error: this.formatError(error) };
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
   * Fetches user's own events (for profile/management screens)
   */
  static async getUserEvents(userId: string): Promise<{
    success: boolean;
    events?: EventWithProducts[];
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('events')
        .select(`
          *,
          products!products_event_id_fkey(*),
          video:videos(*)
        `)
        .or(`user_id.eq.${userId},creator_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching user events:', error);
        return { success: false, error: this.formatError(error) };
      }

      const eventsWithProducts: EventWithProducts[] = (data || []).map(event => {
        const activeProducts = event.products?.filter(product => product.is_active) || [];
        return {
          ...event,
          products: activeProducts,
          has_products: activeProducts.length > 0,
          product_count: activeProducts.length
        };
      });

      return { success: true, events: eventsWithProducts };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Searches events by location, category, or hashtags
   */
  static async searchEvents(searchTerm: string, filters?: {
    location?: string;
    category?: string;
    hasProducts?: boolean;
  }): Promise<{
    success: boolean;
    events?: EventListItem[];
    error?: string;
  }> {
    try {
      let query = supabase
        .from('events')
        .select(`
          *,
          video:videos(id, title, thumbnail_url, video_url),
          creator:profiles!events_creator_id_fkey(id, username, full_name, avatar_url)
        `)
        .eq('is_public', true)
        .eq('status', 'published');

      // Add search term
      if (searchTerm) {
        query = query.or(`event_name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
      }

      // Add filters
      if (filters?.location) {
        query = query.ilike('location_city', `%${filters.location}%`);
      }
      if (filters?.category) {
        query = query.eq('category', filters.category);
      }

      const { data: events, error: eventsError } = await query
        .order('created_at', { ascending: false })
        .limit(50);

      if (eventsError) {
        console.error('Error searching events:', eventsError);
        return { success: false, error: this.formatError(eventsError) };
      }

      if (!events || events.length === 0) {
        return { success: true, events: [] };
      }

      // Get product counts if needed
      let eventsWithProductInfo: EventListItem[] = events.map(event => ({
        ...event,
        has_products: false,
        product_count: 0
      }));

      if (filters?.hasProducts !== undefined) {
        const eventIds = events.map(event => event.id);
        const { data: productCounts, error: productsError } = await supabase
          .from('products')
          .select('event_id')
          .in('event_id', eventIds)
          .eq('is_active', true);

        if (!productsError && productCounts) {
          const productCountMap = new Map<string, number>();
          productCounts.forEach(product => {
            const count = productCountMap.get(product.event_id) || 0;
            productCountMap.set(product.event_id, count + 1);
          });

          eventsWithProductInfo = events.map(event => {
            const productCount = productCountMap.get(event.id) || 0;
            return {
              ...event,
              has_products: productCount > 0,
              product_count: productCount
            };
          });

          // Filter by hasProducts if specified
          if (filters.hasProducts) {
            eventsWithProductInfo = eventsWithProductInfo.filter(event => event.has_products);
          }
        }
      }

      return { success: true, events: eventsWithProductInfo };
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
  private static formatError(error: any): string {
    if (error.code === 'PGRST116') {
      return 'No data found';
    }
    if (error.code === '42501') {
      return 'Permission denied';
    }
    if (error.message?.includes('row-level security')) {
      return 'Access denied by security policy';
    }
    return error.message || 'Database error occurred';
  }
}

