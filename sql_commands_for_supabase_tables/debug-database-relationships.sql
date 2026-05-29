-- Debug Database Relationships
-- Run this in your Supabase SQL Editor to see what's in your database

-- ==============================================
-- 1. CHECK VIDEOS TABLE
-- ==============================================
SELECT 
    'VIDEOS' as table_name,
    id,
    title,
    event_name,
    created_at
FROM videos 
ORDER BY created_at DESC
LIMIT 10;

-- ==============================================
-- 2. CHECK EVENTS TABLE
-- ==============================================
SELECT 
    'EVENTS' as table_name,
    id,
    event_name,
    video_id,
    status,
    created_at
FROM events 
ORDER BY created_at DESC
LIMIT 10;

-- ==============================================
-- 3. CHECK PRODUCTS TABLE
-- ==============================================
SELECT 
    'PRODUCTS' as table_name,
    id,
    event_id,
    name,
    price,
    is_active,
    created_at
FROM products 
ORDER BY created_at DESC
LIMIT 10;

-- ==============================================
-- 4. CHECK VIDEO-EVENT RELATIONSHIPS
-- ==============================================
SELECT 
    'VIDEO-EVENT RELATIONSHIPS' as table_name,
    v.id as video_id,
    v.title as video_title,
    e.id as event_id,
    e.event_name,
    e.status as event_status
FROM videos v
LEFT JOIN events e ON e.video_id = v.id
ORDER BY v.created_at DESC
LIMIT 10;

-- ==============================================
-- 5. CHECK EVENT-PRODUCT RELATIONSHIPS
-- ==============================================
SELECT 
    'EVENT-PRODUCT RELATIONSHIPS' as table_name,
    e.id as event_id,
    e.event_name,
    e.video_id,
    p.id as product_id,
    p.name as product_name,
    p.price,
    p.is_active
FROM events e
LEFT JOIN products p ON p.event_id = e.id
ORDER BY e.created_at DESC
LIMIT 10;

-- ==============================================
-- 6. COMPLETE CHAIN: VIDEO -> EVENT -> PRODUCTS
-- ==============================================
SELECT 
    'COMPLETE CHAIN' as table_name,
    v.id as video_id,
    v.title as video_title,
    e.id as event_id,
    e.event_name,
    p.id as product_id,
    p.name as product_name,
    p.price,
    p.is_active as product_active
FROM videos v
LEFT JOIN events e ON e.video_id = v.id
LEFT JOIN products p ON p.event_id = e.id
ORDER BY v.created_at DESC
LIMIT 10;




























