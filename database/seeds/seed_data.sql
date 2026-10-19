-- =============================================================================
-- OpenFood Delivery Platform — Seed Data
-- =============================================================================
-- Populates the database with realistic sample data for development and testing.
-- Run AFTER all migrations (001, 002, 003).
--
-- IMPORTANT: These UUIDs are fixed for reproducibility. Do NOT use gen_random_uuid()
-- in seed files so that foreign key references remain consistent.
-- =============================================================================

-- =============================================================================
-- 1. Users (3 users: 1 customer, 1 restaurant owner, 1 rider)
-- =============================================================================

INSERT INTO users (id, full_name, phone, role, created_at) VALUES
  (
    'a1b2c3d4-0001-0001-0001-000000000001',
    'Akosua Mensah',
    '+233201234567',
    'CUSTOMER',
    NOW() - INTERVAL '30 days'
  ),
  (
    'a1b2c3d4-0002-0002-0002-000000000002',
    'Kwame Asante',
    '+233207654321',
    'RESTAURANT_OWNER',
    NOW() - INTERVAL '60 days'
  ),
  (
    'a1b2c3d4-0003-0003-0003-000000000003',
    'Yaw Boateng',
    '+233209876543',
    'RIDER',
    NOW() - INTERVAL '45 days'
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2. Restaurants (2 active restaurants in Accra, Ghana)
-- =============================================================================
-- PostGIS POINT format: ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
-- Coordinates: Osu, Accra (-0.1870, 5.6037) and Labone, Accra (-0.1730, 5.5900)

INSERT INTO restaurants (id, owner_id, name, is_active, location, address) VALUES
  (
    'b1b2c3d4-0001-0001-0001-000000000001',
    'a1b2c3d4-0002-0002-0002-000000000002',
    'Mama Akua Kitchen',
    TRUE,
    ST_SetSRID(ST_MakePoint(-0.1870, 5.6037), 4326),
    '14 Cantonments Road, Osu, Accra, Ghana'
  ),
  (
    'b1b2c3d4-0002-0002-0002-000000000002',
    'a1b2c3d4-0002-0002-0002-000000000002',
    'Chop Bar Deluxe',
    TRUE,
    ST_SetSRID(ST_MakePoint(-0.1730, 5.5900), 4326),
    '7 Labone Close, Labone, Accra, Ghana'
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 3. Menu Items (for Mama Akua Kitchen)
-- =============================================================================

INSERT INTO menu_items (id, restaurant_id, name, description, price, is_available) VALUES
  (
    'c1b2c3d4-0001-0001-0001-000000000001',
    'b1b2c3d4-0001-0001-0001-000000000001',
    'Jollof Rice & Chicken',
    'Perfectly spiced Ghanaian jollof rice served with grilled chicken and coleslaw.',
    35.00,
    TRUE
  ),
  (
    'c1b2c3d4-0002-0002-0002-000000000002',
    'b1b2c3d4-0001-0001-0001-000000000001',
    'Banku & Tilapia',
    'Fermented corn and cassava dumpling served with grilled tilapia and pepper sauce.',
    45.00,
    TRUE
  ),
  (
    'c1b2c3d4-0003-0003-0003-000000000003',
    'b1b2c3d4-0001-0001-0001-000000000001',
    'Kelewele',
    'Spiced fried plantain cubes — the perfect snack or side dish.',
    15.00,
    TRUE
  ),
  -- Menu Items for Chop Bar Deluxe
  (
    'c1b2c3d4-0004-0004-0004-000000000004',
    'b1b2c3d4-0002-0002-0002-000000000002',
    'Fufu & Light Soup',
    'Pounded cassava and plantain in a light tomato and pepper soup with meat.',
    40.00,
    TRUE
  ),
  (
    'c1b2c3d4-0005-0005-0005-000000000005',
    'b1b2c3d4-0002-0002-0002-000000000002',
    'Rice & Stew',
    'Plain white rice with Ghanaian tomato stew and your choice of protein.',
    30.00,
    TRUE
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 4. Rider Profile (for the rider user)
-- =============================================================================

INSERT INTO rider_profiles (id, is_online, is_available, current_location, last_location_update)
VALUES (
  'a1b2c3d4-0003-0003-0003-000000000003',
  TRUE,
  TRUE,
  -- Starting location near Osu, Accra
  ST_SetSRID(ST_MakePoint(-0.1855, 5.6020), 4326),
  NOW() - INTERVAL '2 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 5. Sample Order (customer orders Jollof Rice from Mama Akua Kitchen)
-- =============================================================================

INSERT INTO orders (id, customer_id, restaurant_id, rider_id, status, total_amount, delivery_address, delivery_location, created_at, updated_at)
VALUES (
  'd1b2c3d4-0001-0001-0001-000000000001',
  'a1b2c3d4-0001-0001-0001-000000000001',
  'b1b2c3d4-0001-0001-0001-000000000001',
  'a1b2c3d4-0003-0003-0003-000000000003',
  'PICKED_UP',
  80.00,
  '22 Airport Residential Area, Accra, Ghana',
  ST_SetSRID(ST_MakePoint(-0.1760, 5.6150), 4326),
  NOW() - INTERVAL '45 minutes',
  NOW() - INTERVAL '10 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 6. Order Items (2x Jollof Rice & Chicken + 2x Kelewele)
-- =============================================================================

INSERT INTO order_items (id, order_id, menu_item_id, quantity, unit_price) VALUES
  (
    'e1b2c3d4-0001-0001-0001-000000000001',
    'd1b2c3d4-0001-0001-0001-000000000001',
    'c1b2c3d4-0001-0001-0001-000000000001', -- Jollof Rice & Chicken
    2,
    35.00
  ),
  (
    'e1b2c3d4-0002-0002-0002-000000000002',
    'd1b2c3d4-0001-0001-0001-000000000001',
    'c1b2c3d4-0003-0003-0003-000000000003', -- Kelewele
    2,
    15.00
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Verification Query (optional — run to check inserts)
-- =============================================================================
-- SELECT u.full_name, u.role FROM users u;
-- SELECT r.name, r.address FROM restaurants r;
-- SELECT o.status, o.total_amount FROM orders o;
