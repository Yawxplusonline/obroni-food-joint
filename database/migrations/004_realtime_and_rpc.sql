-- =============================================================================
-- OpenFood Delivery Platform — Migration 004: Realtime + PostGIS RPC Functions
-- =============================================================================
-- Run AFTER 001, 002, 003.
-- 1. Enables Supabase Realtime publication for the core tables.
-- 2. Creates reusable PostGIS RPC helper functions used by the backend API.
-- =============================================================================

-- =============================================================================
-- 1. Enable Supabase Realtime on key tables
-- =============================================================================
-- Supabase Realtime uses a PostgreSQL publication called "supabase_realtime".
-- Adding tables here allows clients to subscribe to row-level change events.

ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE rider_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE order_items;

-- =============================================================================
-- 2. PostGIS RPC: get_nearby_riders
-- =============================================================================
-- Returns online, available riders within `radius_m` metres of the given
-- lat/lng point. Used by the dispatch controller to find the closest rider.
--
-- Usage (Supabase JS client):
--   supabaseAdmin.rpc('get_nearby_riders', {
--     origin_lat: 5.6037, origin_lng: -0.1870, radius_m: 5000
--   })
-- =============================================================================
CREATE OR REPLACE FUNCTION get_nearby_riders(
  origin_lat  DOUBLE PRECISION,
  origin_lng  DOUBLE PRECISION,
  radius_m    DOUBLE PRECISION DEFAULT 5000
)
RETURNS TABLE (
  id                    UUID,
  is_online             BOOLEAN,
  is_available          BOOLEAN,
  last_location_update  TIMESTAMP WITH TIME ZONE,
  distance_m            DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER  -- runs with function owner's privileges (bypasses RLS for dispatch)
AS $$
  SELECT
    rp.id,
    rp.is_online,
    rp.is_available,
    rp.last_location_update,
    -- Distance in metres using PostGIS geography type for accurate measurement
    ST_Distance(
      rp.current_location::geography,
      ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography
    ) AS distance_m
  FROM rider_profiles rp
  WHERE
    rp.is_online = TRUE
    AND rp.is_available = TRUE
    AND rp.current_location IS NOT NULL
    AND ST_DWithin(
      rp.current_location::geography,
      ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography,
      radius_m
    )
  ORDER BY distance_m ASC;
$$;

-- Grant execute to the authenticated role (called via service_role from backend)
GRANT EXECUTE ON FUNCTION get_nearby_riders TO service_role;
GRANT EXECUTE ON FUNCTION get_nearby_riders TO authenticated;

-- =============================================================================
-- 3. PostGIS RPC: get_nearby_restaurants
-- =============================================================================
-- Returns active restaurants within `radius_m` metres, ordered by distance.
-- Called by the customer app home screen for proximity-sorted restaurant list.
--
-- Usage:
--   supabase.rpc('get_nearby_restaurants', {
--     origin_lat: 5.6037, origin_lng: -0.1870, radius_m: 10000
--   })
-- =============================================================================
CREATE OR REPLACE FUNCTION get_nearby_restaurants(
  origin_lat  DOUBLE PRECISION,
  origin_lng  DOUBLE PRECISION,
  radius_m    DOUBLE PRECISION DEFAULT 10000
)
RETURNS TABLE (
  id          UUID,
  name        VARCHAR,
  address     TEXT,
  distance_m  DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    r.id,
    r.name,
    r.address,
    ST_Distance(
      r.location::geography,
      ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography
    ) AS distance_m
  FROM restaurants r
  WHERE
    r.is_active = TRUE
    AND r.location IS NOT NULL
    AND ST_DWithin(
      r.location::geography,
      ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography,
      radius_m
    )
  ORDER BY distance_m ASC;
$$;

GRANT EXECUTE ON FUNCTION get_nearby_restaurants TO service_role;
GRANT EXECUTE ON FUNCTION get_nearby_restaurants TO authenticated;
GRANT EXECUTE ON FUNCTION get_nearby_restaurants TO anon;

-- =============================================================================
-- 4. Helper: on_auth_user_created trigger (auto-create user profile row)
-- =============================================================================
-- When a new user signs up via Supabase Auth (auth.users), this trigger
-- automatically inserts a row into the public.users table using metadata
-- the client sends during sign-up (full_name, role, phone).
--
-- This avoids a separate "create profile" API call after registration.
-- =============================================================================
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert profile row from auth metadata
  INSERT INTO public.users (id, full_name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, ''),
    COALESCE(
      (NEW.raw_user_meta_data->>'role')::user_role,
      'CUSTOMER'::user_role
    )
  )
  ON CONFLICT (id) DO NOTHING;

  -- If the new user is a RIDER, also create their rider_profile row
  IF (NEW.raw_user_meta_data->>'role') = 'RIDER' THEN
    INSERT INTO public.rider_profiles (id, is_online, is_available)
    VALUES (NEW.id, FALSE, TRUE)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach the trigger to Supabase's auth.users table
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_auth_user();
