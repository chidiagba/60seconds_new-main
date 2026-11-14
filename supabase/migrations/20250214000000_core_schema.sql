-- Canonical bootstrap derived from the legacy schema scripts.
-- Existing installations keep their data: all tables use IF NOT EXISTS.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  username TEXT UNIQUE,
  avatar_url TEXT,
  bio TEXT,
  user_type TEXT CHECK (user_type IN ('private', 'business')) DEFAULT 'private',
  business_name TEXT,
  business_type TEXT,
  business_description TEXT,
  business_address TEXT,
  business_phone TEXT,
  business_website TEXT,
  business_hours JSONB,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  duration INTEGER, -- in seconds
  file_size BIGINT, -- in bytes
  location_city TEXT,
  location_country TEXT,
  location_coordinates POINT,
  event_name TEXT,
  hashtags TEXT[],
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  rating DECIMAL(3,2) DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  is_public BOOLEAN DEFAULT TRUE,
  is_monetized BOOLEAN DEFAULT FALSE,
  price DECIMAL(10,2),
  currency TEXT DEFAULT 'USD',
  category TEXT,
  upload_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  business_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  order_number TEXT UNIQUE NOT NULL,
  items JSONB NOT NULL, -- Array of order items
  subtotal DECIMAL(10,2) NOT NULL,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled')) DEFAULT 'pending',
  payment_status TEXT CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')) DEFAULT 'pending',
  payment_method TEXT,
  payment_reference TEXT,
  delivery_type TEXT CHECK (delivery_type IN ('pickup', 'delivery')) DEFAULT 'pickup',
  delivery_address TEXT,
  delivery_fee DECIMAL(10,2) DEFAULT 0,
  estimated_ready_time TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  event_name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE,
  location_name TEXT,
  location_address TEXT,
  location_city TEXT,
  location_country TEXT,
  location_coordinates POINT,
  max_attendees INTEGER,
  current_attendees INTEGER DEFAULT 0,
  ticket_price DECIMAL(10,2),
  currency TEXT DEFAULT 'USD',
  is_public BOOLEAN DEFAULT TRUE,
  requires_approval BOOLEAN DEFAULT FALSE,
  status TEXT CHECK (status IN ('draft', 'published', 'cancelled', 'completed')) DEFAULT 'draft',
  image_url TEXT,
  tags TEXT[],
  contact_info JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vouchers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed_amount')) NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  minimum_order_amount DECIMAL(10,2),
  maximum_discount_amount DECIMAL(10,2),
  currency TEXT DEFAULT 'USD',
  usage_limit INTEGER,
  usage_count INTEGER DEFAULT 0,
  expiry_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  applicable_categories TEXT[],
  applicable_products TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  business_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  reservation_date DATE NOT NULL,
  reservation_time TIME,
  party_size INTEGER DEFAULT 1,
  service_type TEXT,
  total_amount DECIMAL(10,2),
  currency TEXT DEFAULT 'USD',
  status TEXT CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')) DEFAULT 'pending',
  confirmation_code TEXT UNIQUE,
  special_requests TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_interactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE NOT NULL,
  business_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  interaction_type TEXT CHECK (interaction_type IN ('view', 'like', 'comment', 'share', 'purchase')) NOT NULL,
  interaction_data JSONB, -- Additional data like comment text, purchase amount, etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, video_id, interaction_type)
);

CREATE TABLE IF NOT EXISTS event_attendees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  business_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  attendance_status TEXT CHECK (attendance_status IN ('going', 'maybe', 'interested', 'invited', 'declined')) DEFAULT 'interested',
  rsvp_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

CREATE TABLE IF NOT EXISTS business_customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  customer_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  first_interaction_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_interaction_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  total_interactions INTEGER DEFAULT 1,
  total_spent DECIMAL(10,2) DEFAULT 0,
  interaction_types TEXT[] DEFAULT '{}', -- Array of interaction types
  tags TEXT[] DEFAULT '{}', -- Custom tags for customer segmentation
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(business_id, customer_id)
);

CREATE TABLE IF NOT EXISTS voucher_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_id UUID REFERENCES vouchers(id) ON DELETE CASCADE NOT NULL,
  business_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  customer_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  shared_via TEXT CHECK (shared_via IN ('message', 'email', 'notification')) DEFAULT 'message',
  message_text TEXT,
  is_used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_pdfs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  order_number TEXT NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  pdf_url TEXT NOT NULL,
  qr_code_data TEXT NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  type TEXT NOT NULL CHECK (type IN ('ticket', 'drink', 'reservation', 'merchandise')),
  available_quantity INTEGER NOT NULL DEFAULT 0,
  sold_quantity INTEGER DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  balance DECIMAL(15,2) DEFAULT 0.00,
  currency TEXT DEFAULT 'USD',
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  type TEXT CHECK (type IN ('deposit', 'withdrawal', 'payment', 'transfer', 'fee', 'refund')) NOT NULL,
  status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
  description TEXT NOT NULL,
  transaction_fee DECIMAL(15,2) DEFAULT 0.00,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT CHECK (type IN ('credit_card', 'bank_account', 'paypal', 'twint', 'paystack', 'worldline')) NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  nickname TEXT NOT NULL,
  last_four TEXT,
  expiry_date TEXT,
  card_type TEXT CHECK (card_type IN ('visa', 'mastercard', 'amex', 'discover')),
  bank_name TEXT,
  account_type TEXT CHECK (account_type IN ('checking', 'savings')),
  
  -- Twint specific fields
  twint_phone_number TEXT,
  
  -- Paystack specific fields
  paystack_email TEXT,
  paystack_auth_code TEXT,
  
  -- Worldline specific fields
  worldline_customer_id TEXT,
  worldline_payment_method_id TEXT,
  
  -- Additional metadata
  metadata JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_bank_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  bank_name TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  routing_number TEXT,
  iban TEXT,
  swift_code TEXT,
  country TEXT NOT NULL,
  currency TEXT DEFAULT 'USD',
  is_verified BOOLEAN DEFAULT FALSE,
  is_primary BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
  business_bank_account_id UUID REFERENCES business_bank_accounts(id) ON DELETE SET NULL,
  processing_fee DECIMAL(15,2) DEFAULT 0.00,
  net_amount DECIMAL(15,2),
  failure_reason TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  payment_provider TEXT CHECK (payment_provider IN ('internal', 'twint', 'paystack', 'worldline')) NOT NULL,
  payment_method_id TEXT,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded')) DEFAULT 'pending',
  transaction_id TEXT,
  gateway_reference TEXT,
  gateway_response JSONB,
  metadata JSONB,
  processing_fee DECIMAL(10,2) DEFAULT 0,
  net_amount DECIMAL(10,2),
  failure_reason TEXT,
  failure_code TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS ticket_receipts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  order_number TEXT NOT NULL,
  buyer_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ticket_type TEXT,
  ticket_title TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  qr_code_data TEXT NOT NULL,
  ticket_image_url TEXT,
  pdf_url TEXT,
  seat_no TEXT,
  event_name TEXT,
  event_start_date TIMESTAMP WITH TIME ZONE,
  event_end_date TIMESTAMP WITH TIME ZONE,
  location_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT follows_no_self_follow CHECK (follower_id <> following_id),
  CONSTRAINT follows_unique_pair UNIQUE (follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS user_hidden_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  hidden_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, video_id)
);

CREATE TABLE IF NOT EXISTS public.video_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.video_comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) > 0 AND char_length(text) <= 2000),
  likes_count INTEGER NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.video_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT video_ratings_unique_user_video UNIQUE (video_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.video_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT video_likes_unique_user_video UNIQUE (video_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.video_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_chats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  avatar_color TEXT NOT NULL DEFAULT '#6366F1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_chat_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_chat_id UUID NOT NULL REFERENCES public.group_chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.group_chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_chat_id UUID NOT NULL REFERENCES public.group_chats(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'video', 'event')),
  text TEXT,
  video_id UUID REFERENCES public.videos(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT group_chat_messages_payload_check CHECK (
    (message_type = 'text' AND NULLIF(BTRIM(COALESCE(text, '')), '') IS NOT NULL AND video_id IS NULL AND event_id IS NULL) OR
    (message_type = 'video' AND video_id IS NOT NULL AND event_id IS NULL) OR
    (message_type = 'event' AND event_id IS NOT NULL AND video_id IS NULL)
  )
);

create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null,
  type text not null check (type in ('signup', 'recovery')),
  user_id uuid null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);


CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS video_id uuid REFERENCES public.videos(id) ON DELETE SET NULL;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country text, ADD COLUMN IF NOT EXISTS country_code text, ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_provider text, ADD COLUMN IF NOT EXISTS payment_transaction_id text, ADD COLUMN IF NOT EXISTS payment_gateway_response jsonb, ADD COLUMN IF NOT EXISTS payment_metadata jsonb;


ALTER TABLE public.events ADD COLUMN IF NOT EXISTS organizer_id uuid REFERENCES public.profiles(id);

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS organizer_id uuid REFERENCES public.profiles(id);

CREATE TABLE IF NOT EXISTS public.chats (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user1_id uuid NOT NULL REFERENCES public.profiles(id), user2_id uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE(user1_id,user2_id)
);
CREATE TABLE IF NOT EXISTS public.messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE, sender_id uuid NOT NULL REFERENCES public.profiles(id), content text, message_type text DEFAULT 'text', video_id uuid REFERENCES public.videos(id), event_id uuid REFERENCES public.events(id), is_read boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.profiles(id);

ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.profiles(id), ADD COLUMN IF NOT EXISTS status text DEFAULT 'published', ADD COLUMN IF NOT EXISTS event_date timestamptz, ADD COLUMN IF NOT EXISTS location_name text;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS avatar_gender TEXT
CHECK (avatar_gender IN ('male', 'female'));

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS country_code TEXT;

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS location_city TEXT;

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS hashtags TEXT[];

ALTER TABLE public.events 
ADD COLUMN IF NOT EXISTS location_name TEXT,
ADD COLUMN IF NOT EXISTS location_address TEXT,
ADD COLUMN IF NOT EXISTS location_city TEXT,
ADD COLUMN IF NOT EXISTS location_state TEXT,
ADD COLUMN IF NOT EXISTS location_country TEXT,
ADD COLUMN IF NOT EXISTS location_latitude DECIMAL(10,8),
ADD COLUMN IF NOT EXISTS location_longitude DECIMAL(11,8),
ADD COLUMN IF NOT EXISTS max_attendees INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS current_attendees INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ticket_price DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General',
ADD COLUMN IF NOT EXISTS tags TEXT[],
ADD COLUMN IF NOT EXISTS hashtags TEXT[],
ADD COLUMN IF NOT EXISTS video_id TEXT,
ADD COLUMN IF NOT EXISTS business_id TEXT,
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

ALTER TABLE public.videos 
ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS comments_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS shares_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS location_address TEXT,
ADD COLUMN IF NOT EXISTS location_state TEXT,
ADD COLUMN IF NOT EXISTS location_city TEXT,
ADD COLUMN IF NOT EXISTS location_country TEXT,
ADD COLUMN IF NOT EXISTS location_coordinates TEXT,
ADD COLUMN IF NOT EXISTS event_name TEXT,
ADD COLUMN IF NOT EXISTS event_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS hashtags TEXT[],
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider_reference text, ADD COLUMN IF NOT EXISTS provider_status text, ADD COLUMN IF NOT EXISTS authorization_code text, ADD COLUMN IF NOT EXISTS paid_at timestamptz, ADD COLUMN IF NOT EXISTS settled_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_unique ON public.payments(payment_provider,provider_reference);

-- Legacy hosted orders may lack the notes column used by the scoped update grant.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;
