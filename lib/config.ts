/**
 * Application Configuration
 * Centralized configuration management for the app
 */

export const config = {
  // Supabase Configuration
  supabase: {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://rvvujgbaswecqohixgog.supabase.co',
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_sIzCwLBlhd1--vlMsdY1Hg_UEWYbGVp',
  },

  // App Configuration
  app: {
    name: process.env.EXPO_PUBLIC_APP_NAME || '60Seconds',
    version: process.env.EXPO_PUBLIC_APP_VERSION || '1.0.0',
    debug: process.env.EXPO_PUBLIC_DEBUG_MODE === 'true',
    logLevel: process.env.EXPO_PUBLIC_LOG_LEVEL || 'info',
  },

  // Feature Flags
  features: {
    analytics: process.env.EXPO_PUBLIC_ANALYTICS_ENABLED === 'true',
    realTime: true,
    fileUpload: true,
    locationServices: true,
    pushNotifications: true,
  },

  // API Configuration
  api: {
    timeout: 30000, // 30 seconds
    retryAttempts: 3,
    retryDelay: 1000, // 1 second
  },

  // Storage Configuration
  storage: {
    maxFileSize: 100 * 1024 * 1024, // 100MB
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedVideoTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'],
    videoBucket: 'videos',
    imageBucket: 'images',
    avatarBucket: 'avatars',
  },

  // Pagination
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },

  // Cache Configuration
  cache: {
    profileCacheTime: 5 * 60 * 1000, // 5 minutes
    videoCacheTime: 10 * 60 * 1000, // 10 minutes
    eventCacheTime: 15 * 60 * 1000, // 15 minutes
  },

  // Validation
  validation: {
    username: {
      minLength: 3,
      maxLength: 30,
      pattern: /^[a-zA-Z0-9_]+$/,
    },
    password: {
      minLength: 8,
      maxLength: 128,
    },
    email: {
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
  },

  // Error Messages
  errors: {
    network: 'Network error. Please check your connection.',
    auth: 'Authentication failed. Please try again.',
    permission: 'Permission denied. Please check your access rights.',
    validation: 'Invalid input. Please check your data.',
    server: 'Server error. Please try again later.',
    notFound: 'Resource not found.',
    rateLimit: 'Too many requests. Please try again later.',
  },
} as const;

// Type definitions for better TypeScript support
export type Config = typeof config;
export type SupabaseConfig = typeof config.supabase;
export type AppConfig = typeof config.app;
export type FeatureFlags = typeof config.features;

