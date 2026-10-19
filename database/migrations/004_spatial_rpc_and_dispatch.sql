-- =============================================================================
-- OpenFood Delivery Platform — Migration 004: PostGIS Spatial RPCs, Auto-Dispatch & Realtime
-- =============================================================================
-- Run AFTER 001_initial_schema.sql, 002_rls_policies.sql, and 003_indexes.sql.
--
-- Implements:
--   1. Supabase Realtime publication for orders, rider_profiles, and menu_items
--   2. get_nearby_riders() RPC — PostGIS proximity search (PRD Section 5.3)
--   3. dispatch_nearest_rider() RPC — Assigns closest available rider within 5km
--   4. get_restaurants_near() RPC — Sorts active restaurants by distance
--   5. Automatic trigger on orders status -> READY_FOR_PICKUP / DELIVERED / CANCELLED
-- =============================================================================

-- =============================================================================
-- 1. Enable Supabase Realtime CDC on core tables
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE orders;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE rider_profiles;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE menu_items;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- Ensure full replica identity so UPDATE events include all columns
ALTER TABLE orders REPLICA IDENTITY FULL;
ALTER TABLE rider_profiles REPLICA IDENTITY FULL;

-- =============================================================================
-- 2. RPC: get_nearby_riders
-- =============================================================================
-- Returns online & available riders within `radius_meters` (default 5000m / 5km)
-- ordered by distance ascending, with extracted lat/lng coordinates.
CREATE OR REPLACE FUNCTION get_nearby_riders(
  target_lat DOUBLE PRECISION,
  target_lng DOUBLE PRECISION,
  radius_meters DOUBLE PRECISION DEFAULT 5000
)
RETURNS TABLE (
  rider_id UUID,
  full_name VARCHAR,
  phone VARCHAR,
  is_online BOOLEAN,
  is_available BOOLEAN,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION,
  last_location_update TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    r.id AS rider_id,
    u.full_name,
    u.phone,
    r.is_online,
    r.is_available,
    ST_Y(r.current_location::geometry) AS lat,
    ST_X(r.current_location::geometry) AS lng,
    ST_Distance(
      r.current_location,
      ST_SetSRID(ST_MakePoint(target_lng, target_lat), 4326),
      true
    ) AS distance_meters,
    r.last_location_update
  FROM rider_profiles r
  JOIN users u ON u.id = r.id
  WHERE r.is_online = TRUE
    AND r.is_available = TRUE
    AND r.current_location IS NOT NULL
    AND ST_DWithin(
      r.current_location,
      ST_SetSRID(ST_MakePoint(target_lng, target_lat), 4326),
      radius_meters,
      true
    )
  ORDER BY distance_meters ASC;
$$;

-- =============================================================================
-- 3. RPC: dispatch_nearest_rider (PRD Section 5.3 Exact Spatial Query)
-- =============================================================================
-- Finds the closest online & available rider within 5km of the order's restaurant,
-- assigns them to the order, and marks the rider as unavailable (busy).
CREATE OR REPLACE FUNCTION dispatch_nearest_rider(
  p_order_id UUID,
  p_radius_meters DOUBLE PRECISION DEFAULT 5000
)
RETURNS TABLE (
  assigned_rider_id UUID,
  distance_meters DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_restaurant_id UUID;
  v_rider_id UUID;
  v_distance DOUBLE PRECISION;
BEGIN
  -- 1. Lookup the order's restaurant_id (only if no rider is assigned yet)
  SELECT o.restaurant_id INTO v_restaurant_id
  FROM orders o
  WHERE o.id = p_order_id
    AND o.rider_id IS NULL;

  IF v_restaurant_id IS NULL THEN
    RETURN;
  END IF;

  -- 2. Execute PRD Section 5.3 PostGIS proximity query (5km radius, spheroid=true)
  SELECT
    r.id,
    ST_Distance(r.current_location, rest.location, true) AS dist_m
  INTO v_rider_id, v_distance
  FROM rider_profiles r
  JOIN restaurants rest ON rest.id = v_restaurant_id
  WHERE r.is_online = TRUE
    AND r.is_available = TRUE
    AND r.current_location IS NOT NULL
    AND ST_DWithin(r.current_location, rest.location, p_radius_meters, true)
  ORDER BY dist_m ASC
  LIMIT 1
  FOR UPDATE OF r SKIP LOCKED;

  -- 3. If a nearby rider was found, assign them and mark them busy
  IF v_rider_id IS NOT NULL THEN
    UPDATE orders
    SET rider_id = v_rider_id,
        updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE rider_profiles
    SET is_available = FALSE
    WHERE id = v_rider_id;

    RETURN QUERY SELECT v_rider_id, v_distance;
  END IF;
END;
$$;

-- =============================================================================
-- 4. RPC: get_restaurants_near
-- =============================================================================
-- Returns active restaurants with extracted lat/lng and distance in meters.
CREATE OR REPLACE FUNCTION get_restaurants_near(
  user_lat DOUBLE PRECISION DEFAULT 5.6037,
  user_lng DOUBLE PRECISION DEFAULT -0.1870,
  search_term TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  owner_id UUID,
  name VARCHAR,
  address TEXT,
  is_active BOOLEAN,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    rest.id,
    rest.owner_id,
    rest.name,
    rest.address,
    rest.is_active,
    ST_Y(rest.location::geometry) AS lat,
    ST_X(rest.location::geometry) AS lng,
    ST_Distance(
      rest.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326),
      true
    ) AS distance_meters
  FROM restaurants rest
  WHERE rest.is_active = TRUE
    AND (
      search_term IS NULL
      OR search_term = ''
      OR rest.name ILIKE '%' || search_term || '%'
    )
  ORDER BY distance_meters ASC;
$$;

-- =============================================================================
-- 5. Trigger: Auto-dispatch rider on READY_FOR_PICKUP & release on completion
-- =============================================================================
CREATE OR REPLACE FUNCTION handle_order_status_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rider_id UUID;
BEGIN
  -- When status flips to READY_FOR_PICKUP and no rider is assigned yet,
  -- find the nearest online & available rider within 5km (PRD Section 5.3)
  IF NEW.status = 'READY_FOR_PICKUP'
     AND (OLD.status IS DISTINCT FROM 'READY_FOR_PICKUP')
     AND NEW.rider_id IS NULL THEN

    SELECT r.id INTO v_rider_id
    FROM rider_profiles r
    JOIN restaurants rest ON rest.id = NEW.restaurant_id
    WHERE r.is_online = TRUE
      AND r.is_available = TRUE
      AND r.current_location IS NOT NULL
      AND ST_DWithin(r.current_location, rest.location, 5000, true)
    ORDER BY ST_Distance(r.current_location, rest.location, true) ASC
    LIMIT 1
    FOR UPDATE OF r SKIP LOCKED;

    IF v_rider_id IS NOT NULL THEN
      NEW.rider_id := v_rider_id;
      UPDATE rider_profiles SET is_available = FALSE WHERE id = v_rider_id;
    END IF;
  END IF;

  -- When order completes (DELIVERED or CANCELLED), free up the assigned rider
  IF NEW.status IN ('DELIVERED', 'CANCELLED')
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.rider_id IS NOT NULL THEN
    UPDATE rider_profiles
    SET is_available = TRUE
    WHERE id = NEW.rider_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_status_lifecycle ON orders;
CREATE TRIGGER trg_order_status_lifecycle
BEFORE UPDATE OF status ON orders
FOR EACH ROW
EXECUTE FUNCTION handle_order_status_lifecycle();
