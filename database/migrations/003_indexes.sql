-- =============================================================================
-- OpenFood Delivery Platform — Migration 003: Performance Indexes
-- =============================================================================
-- Run AFTER 001_initial_schema.sql.
-- These indexes dramatically improve query performance for the most common
-- access patterns in the application.
-- =============================================================================

-- =============================================================================
-- Spatial Index on rider_profiles.current_location
-- =============================================================================
-- GiST (Generalized Search Tree) is the required index type for PostGIS
-- geometry columns. It enables fast ST_DWithin, ST_Distance, and
-- ST_Intersects queries — critical for the nearby-rider lookup.
CREATE INDEX IF NOT EXISTS idx_rider_profiles_location_gist
  ON rider_profiles
  USING GIST (current_location);

-- Partial index: only index online riders (common filter in dispatch queries)
CREATE INDEX IF NOT EXISTS idx_rider_profiles_online_location_gist
  ON rider_profiles
  USING GIST (current_location)
  WHERE is_online = TRUE AND is_available = TRUE;

-- =============================================================================
-- Spatial Index on restaurants.location
-- =============================================================================
-- Enables efficient proximity searches for nearby restaurants.
CREATE INDEX IF NOT EXISTS idx_restaurants_location_gist
  ON restaurants
  USING GIST (location);

-- =============================================================================
-- Spatial Index on orders.delivery_location
-- =============================================================================
-- Used when matching orders to nearby riders or computing delivery zones.
CREATE INDEX IF NOT EXISTS idx_orders_delivery_location_gist
  ON orders
  USING GIST (delivery_location);

-- =============================================================================
-- Index on orders.status
-- =============================================================================
-- The most common filter: fetching orders by status (e.g., all PENDING orders
-- for a restaurant dashboard, all PICKED_UP orders for a rider).
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders (status);

-- =============================================================================
-- Index on orders.restaurant_id
-- =============================================================================
-- Restaurant dashboards frequently query: "all orders for my restaurant"
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_id
  ON orders (restaurant_id);

-- =============================================================================
-- Index on orders.customer_id
-- =============================================================================
-- Customer apps frequently query: "all my orders"
CREATE INDEX IF NOT EXISTS idx_orders_customer_id
  ON orders (customer_id);

-- =============================================================================
-- Index on orders.rider_id
-- =============================================================================
-- Rider apps query: "orders currently assigned to me"
CREATE INDEX IF NOT EXISTS idx_orders_rider_id
  ON orders (rider_id)
  WHERE rider_id IS NOT NULL; -- Partial index: skip unassigned orders

-- =============================================================================
-- Composite index on orders: (restaurant_id, status)
-- =============================================================================
-- Optimises the most common restaurant dashboard query pattern:
-- "Show me all PENDING or ACCEPTED orders for my restaurant"
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status
  ON orders (restaurant_id, status);

-- =============================================================================
-- Index on orders.created_at
-- =============================================================================
-- Used for pagination and time-based filtering / reporting.
CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON orders (created_at DESC);

-- =============================================================================
-- Index on order_items.order_id
-- =============================================================================
-- Every order detail fetch joins order_items by order_id.
CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON order_items (order_id);

-- =============================================================================
-- Index on menu_items.restaurant_id
-- =============================================================================
-- Menu page queries: "all menu items for restaurant X"
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_id
  ON menu_items (restaurant_id);

-- =============================================================================
-- Index on users.phone
-- =============================================================================
-- Login / lookup by phone number (already UNIQUE, but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_users_phone
  ON users (phone);

-- =============================================================================
-- Index on rider_profiles.last_location_update
-- =============================================================================
-- Used to detect stale/offline riders (e.g., cron job that marks riders
-- offline if they haven't sent a GPS update in the last 5 minutes).
CREATE INDEX IF NOT EXISTS idx_rider_profiles_last_update
  ON rider_profiles (last_location_update DESC);
