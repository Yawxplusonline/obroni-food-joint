-- =============================================================================
-- OpenFood Delivery Platform — Migration 002: Row Level Security (RLS) Policies
-- =============================================================================
-- Run AFTER 001_initial_schema.sql.
-- These policies enforce that users can only access data they are authorised
-- to see, using Supabase's built-in auth.uid() function.
--
-- IMPORTANT: Supabase enables RLS per-table. If you want the service_role key
-- (backend) to bypass ALL policies, that is handled automatically by Supabase.
-- =============================================================================

-- =============================================================================
-- Enable RLS on all tables
-- =============================================================================
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rider_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items     ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- USERS table
-- =============================================================================

-- Users can read their own profile only
CREATE POLICY "users_select_own"
  ON users
  FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile only (e.g. name, phone)
CREATE POLICY "users_update_own"
  ON users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- =============================================================================
-- RESTAURANTS table
-- =============================================================================

-- Any authenticated user can browse active restaurants (public-facing listing)
CREATE POLICY "restaurants_select_active"
  ON restaurants
  FOR SELECT
  USING (is_active = TRUE);

-- A restaurant owner can see their own restaurant regardless of active status
CREATE POLICY "restaurants_select_own"
  ON restaurants
  FOR SELECT
  USING (auth.uid() = owner_id);

-- Only the owner can insert / update / delete their restaurant
CREATE POLICY "restaurants_insert_own"
  ON restaurants
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "restaurants_update_own"
  ON restaurants
  FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "restaurants_delete_own"
  ON restaurants
  FOR DELETE
  USING (auth.uid() = owner_id);

-- =============================================================================
-- MENU_ITEMS table
-- =============================================================================

-- Any authenticated user can view available menu items
CREATE POLICY "menu_items_select_available"
  ON menu_items
  FOR SELECT
  USING (is_available = TRUE);

-- Restaurant owner can manage their own menu items
-- (Requires a join to restaurants — use a subquery)
CREATE POLICY "menu_items_owner_all"
  ON menu_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM restaurants r
      WHERE r.id = menu_items.restaurant_id
        AND r.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM restaurants r
      WHERE r.id = menu_items.restaurant_id
        AND r.owner_id = auth.uid()
    )
  );

-- =============================================================================
-- RIDER_PROFILES table
-- =============================================================================

-- Riders can read and update their own profile
CREATE POLICY "rider_profiles_select_own"
  ON rider_profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "rider_profiles_update_own"
  ON rider_profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow restaurants / system to read online & available riders
-- (Used by dispatch logic — typically done via service_role key on the backend)
CREATE POLICY "rider_profiles_select_available"
  ON rider_profiles
  FOR SELECT
  USING (is_online = TRUE AND is_available = TRUE);

-- =============================================================================
-- ORDERS table
-- =============================================================================

-- Customer can see their own orders
CREATE POLICY "orders_select_customer"
  ON orders
  FOR SELECT
  USING (auth.uid() = customer_id);

-- Restaurant owner can see orders for their restaurant
CREATE POLICY "orders_select_restaurant"
  ON orders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM restaurants r
      WHERE r.id = orders.restaurant_id
        AND r.owner_id = auth.uid()
    )
  );

-- Assigned rider can see their orders
CREATE POLICY "orders_select_rider"
  ON orders
  FOR SELECT
  USING (auth.uid() = rider_id);

-- Only authenticated customers can place orders
CREATE POLICY "orders_insert_customer"
  ON orders
  FOR INSERT
  WITH CHECK (auth.uid() = customer_id);

-- Status updates are managed via the backend (service_role), not direct client writes.
-- If you want direct client updates, add more granular UPDATE policies here.

-- =============================================================================
-- ORDER_ITEMS table
-- =============================================================================

-- Order items are readable if the parent order is readable (follows orders RLS)
-- We allow SELECT for anyone who can see the related order.
-- INSERT is handled by the backend (service_role key bypasses RLS).
CREATE POLICY "order_items_select_via_order"
  ON order_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.customer_id = auth.uid()
          OR o.rider_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid()
          )
        )
    )
  );
