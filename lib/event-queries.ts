import { logger } from '@/lib/logger';
import { supabase, Database } from './supabase';

const PUBLIC_OPEN_EVENT_STATUSES = ['published', 'open'];
type Tables = Database['public']['Tables'];

export interface EventWithProducts {
  id: string;
  user_id: string;
  creator_id?: string | null;
  event_name: string;
  description?: string | null;
  start_date: string;
  end_date?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  location_country?: string | null;
  location_latitude?: number | null;
  location_longitude?: number | null;
  max_attendees?: number | null;
  current_attendees?: number | null;
  ticket_price?: number | null;
  currency?: string | null;
  image_url?: string | null;
  category?: string | null;
  tags?: string[] | null;
  hashtags?: string[] | null;
  video_id?: string | null;
  business_id?: string | null;
  is_public: boolean;
  requires_approval?: boolean | null;
  status: 'draft' | 'published' | 'open' | 'closed' | 'cancelled' | 'completed';
  created_at: string;
  updated_at: string;
  products?: any[];
  has_products?: boolean;
  product_count?: number;
  video?: any;
  creator?: any;
}

export interface EventListItem {
  id: string;
  user_id: string;
  creator_id?: string | null;
  event_name: string;
  description?: string | null;
  start_date: string;
  end_date?: string | null;
  location_name?: string | null;
  location_city?: string | null;
  location_latitude?: number | null;
  location_longitude?: number | null;
  max_attendees?: number | null;
  current_attendees?: number | null;
  ticket_price?: number | null;
  currency?: string | null;
  image_url?: string | null;
  category?: string | null;
  hashtags?: string[] | null;
  video_id?: string | null;
  business_id?: string | null;
  is_public: boolean;
  requires_approval?: boolean | null;
  status: 'draft' | 'published' | 'open' | 'closed' | 'cancelled' | 'completed';
  created_at: string;
  updated_at: string;
  has_products: boolean;
  product_count: number;
  video?: { id: string; title?: string | null; thumbnail_url?: string | null; video_url?: string | null };
  creator?: { id: string; username?: string | null; full_name?: string | null; avatar_url?: string | null };
}

export class EventQueries {
  static async getDealsEvents(limit = 60): Promise<{ success: boolean; events?: EventListItem[]; error?: string }> {
    const { data, error } = await supabase.from('events')
      .select('*,products!inner(id),video:videos(id,title,thumbnail_url,video_url)')
      .eq('is_public', true).in('status', PUBLIC_OPEN_EVENT_STATUSES)
      .eq('products.is_active', true).gt('products.available_quantity', 0).gt('products.price', 0)
      .or(`end_date.gt.${new Date().toISOString()},and(end_date.is.null,start_date.gt.${new Date().toISOString()})`)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) return { success: false, error: this.formatError(error) };
    return { success: true, events: (data || []).map((event: any) => ({ ...event, has_products: true, product_count: event.products.length })) };
  }
  /**
   * Fetches latest public events that have a linked video.
   * This powers Discover when users want newest events first.
   */
  static async getLatestEvents(limit: number = 60): Promise<{
    success: boolean;
    events?: EventListItem[];
    error?: string;
  }> {
    try {
      const selectLatestEvents = (selectClause: string) =>
        supabase
          .from('events')
          .select(selectClause)
          .eq('is_public', true)
          .order('created_at', { ascending: false })
          .limit(limit);

      let { data: events, error } = await selectLatestEvents(`
        *,
        video:videos(id, title, thumbnail_url, video_url),
        creator:profiles!events_creator_id_fkey(id, username, full_name, avatar_url)
      `);

      if (error) {
        logger.warn('Latest events relationship query failed, retrying without joins:', this.formatError(error));
        const fallback = await selectLatestEvents('*');
        events = fallback.data;
        error = fallback.error;
      }

      if (error) {
        logger.warn('Unable to fetch latest events:', this.formatError(error));
        return { success: false, error: this.formatError(error) };
      }

      const { data: saleableProducts, error: productError } = await supabase.from('products')
        .select('event_id').in('event_id', (events || []).map((e: any) => e.id))
        .eq('is_active', true).gt('available_quantity', 0).gt('price', 0);
      if (productError) throw productError;
      const counts = new Map<string, number>();
      for (const product of saleableProducts || []) counts.set(product.event_id, (counts.get(product.event_id) || 0) + 1);
      return {
        success: true,
        events: ((Array.isArray(events) ? events : []) as any[]).map((event) => ({
          ...event,
          has_products: (counts.get(event.id) || 0) > 0,
          product_count: counts.get(event.id) || 0,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Fetches current public events with linked videos for the discover/category tabs.
   * Events that have already ended are excluded so newer active/upcoming events fill the list.
   */
  static async getTrendingEvents(limit: number = 60): Promise<{
    success: boolean;
    events?: EventListItem[];
    error?: string;
  }> {
    try {
      const nowIso = new Date().toISOString();
      const selectTrendingEvents = (selectClause: string) =>
        supabase
          .from('events')
          .select(selectClause)
          .eq('is_public', true)
          .in('status', PUBLIC_OPEN_EVENT_STATUSES)
          .or(`end_date.gt.${nowIso},and(end_date.is.null,start_date.gt.${nowIso})`)
          .order('current_attendees', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(limit);

      let { data: events, error } = await selectTrendingEvents(`
        *,
        video:videos(id, title, thumbnail_url, video_url),
        creator:profiles!events_creator_id_fkey(id, username, full_name, avatar_url)
      `);

      if (error) {
        logger.warn('Trending events relationship query failed, retrying without joins:', this.formatError(error));
        const fallback = await selectTrendingEvents('*');
        events = fallback.data;
        error = fallback.error;
      }

      if (error) {
        logger.warn('Unable to fetch trending events:', this.formatError(error));
        return { success: false, error: this.formatError(error) };
      }

      return {
        success: true,
        events: ((Array.isArray(events) ? events : []) as any[]).map((event) => ({
          ...event,
          has_products: false,
          product_count: 0,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

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
        .in('status', PUBLIC_OPEN_EVENT_STATUSES)
        .eq('products.is_active', true)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        logger.error('Error fetching events for home screen:', error);
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
        .in('status', PUBLIC_OPEN_EVENT_STATUSES)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (eventsError) {
        logger.error('Error fetching events:', eventsError);
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
        logger.warn('Error fetching product counts:', productsError);
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
        logger.error('Error fetching event with products:', error);
        return { success: false, error: this.formatError(error) };
      }

      if (!data) {
        return { success: false, error: 'Event not found' };
      }

      // Filter only active products
      const activeProducts = data.products?.filter((product: Tables['products']['Row']) => product.is_active) || [];
      
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
        logger.error('Error fetching event products:', error);
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
      const selectUserEvents = async (selectClause: string, includeCreator = true) => {
        let query = supabase
          .from('events')
          .select(selectClause);

        query = includeCreator
          ? query.or(`user_id.eq.${userId},creator_id.eq.${userId}`)
          : query.eq('user_id', userId);

        return query.order('created_at', { ascending: false });
      };

      let { data, error } = await selectUserEvents(`
        *,
        products!products_event_id_fkey(*),
        video:videos(*)
      `);

      if (error) {
        logger.warn('User events relationship query failed, retrying without joins:', this.formatError(error));
        const fallback = await selectUserEvents('*');
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        logger.warn('User events creator query failed, retrying user_id only:', this.formatError(error));
        const fallback = await selectUserEvents('*', false);
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        logger.warn('Unable to fetch user events:', this.formatError(error));
        return { success: false, error: this.formatError(error) };
      }

      const eventRows = (Array.isArray(data) ? data : []) as any[];
      const eventsWithProducts: EventWithProducts[] = eventRows.map(event => {
        const activeProducts = event.products?.filter((product: Tables['products']['Row']) => product.is_active) || [];
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
        .in('status', PUBLIC_OPEN_EVENT_STATUSES);

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
        logger.error('Error searching events:', eventsError);
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
