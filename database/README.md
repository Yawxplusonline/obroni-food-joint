# OpenFood — Database Setup Guide

This directory contains all SQL migration files and seed data for the OpenFood platform's Supabase PostgreSQL database.

## Directory Structure

```
database/
├── migrations/
│   ├── 001_initial_schema.sql          — Tables, enums, types, and triggers
│   ├── 002_rls_policies.sql            — Row Level Security policies
│   ├── 003_indexes.sql                 — Performance indexes (including spatial GiST)
│   └── 004_spatial_rpc_and_dispatch.sql — PostGIS RPCs, Realtime CDC & auto-dispatch trigger
└── seeds/
    └── seed_data.sql                   — Sample data for development/testing
```

## Prerequisites

- A Supabase project ([supabase.com](https://supabase.com))
- Access to the **SQL Editor** in the Supabase Dashboard, or the [Supabase CLI](https://supabase.com/docs/reference/cli/introduction)

> **Note:** PostGIS is automatically available in all Supabase projects. The migration enables it with `CREATE EXTENSION IF NOT EXISTS postgis`.

---

## Running Migrations

### Option 1 — Supabase Dashboard SQL Editor (Easiest)

1. Open your Supabase project dashboard
2. Navigate to **SQL Editor** (left sidebar)
3. Click **New Query**
4. Copy & paste the content of each file **in order**:
   1. `migrations/001_initial_schema.sql`
   2. `migrations/002_rls_policies.sql`
   3. `migrations/003_indexes.sql`
   4. `migrations/004_spatial_rpc_and_dispatch.sql`
5. Click **Run** for each

---

### Option 2 — Supabase CLI

Install the CLI and link your project:

```bash
npm install -g supabase
supabase login
supabase link --project-ref your-project-ref
```

Run each migration file:

```bash
supabase db execute --file database/migrations/001_initial_schema.sql
supabase db execute --file database/migrations/002_rls_policies.sql
supabase db execute --file database/migrations/003_indexes.sql
```

---

### Option 3 — psql (Direct Connection)

Get your database connection string from Supabase Dashboard → **Settings → Database → Connection string (URI)**.

```bash
psql "postgres://postgres:[password]@db.[project-ref].supabase.co:5432/postgres" \
  -f database/migrations/001_initial_schema.sql \
  -f database/migrations/002_rls_policies.sql \
  -f database/migrations/003_indexes.sql
```

---

## Seeding Development Data

After running all migrations, insert sample data:

```bash
# Via Supabase CLI
supabase db execute --file database/seeds/seed_data.sql

# Or paste into the SQL Editor
```

This creates:
- **2 restaurants** — Mama Akua Kitchen (Osu) and Chop Bar Deluxe (Labone)
- **3 users** — 1 customer (Akosua), 1 restaurant owner (Kwame), 1 rider (Yaw)
- **5 menu items** — spread across both restaurants
- **1 sample order** — in `PICKED_UP` status with 2 order items

---

## Resetting the Database

To start fresh (⚠️ destroys all data):

```sql
-- Run in SQL Editor
DROP TABLE IF EXISTS order_items, orders, rider_profiles, menu_items, restaurants, users CASCADE;
DROP TYPE IF EXISTS order_status, user_role CASCADE;
DROP EXTENSION IF EXISTS postgis CASCADE;
```

Then re-run the migrations in order.

---

## Schema Overview

```
users ──────────────────────────────────────────────┐
  id (PK)                                            │
  full_name, phone, role (CUSTOMER|RESTAURANT_OWNER|RIDER)
                                                     │
restaurants ──────────────────────┐                  │
  id (PK)                         │                  │
  owner_id → users.id             │                  │
  location (PostGIS Point)        │                  │
                                  │                  │
menu_items ──────────┐            │                  │
  id (PK)            │            │                  │
  restaurant_id ─────┘            │                  │
  price, is_available             │                  │
                                  │                  │
rider_profiles                    │                  │
  id → users.id (PK)              │                  │
  current_location (PostGIS)      │                  │
                                  │                  │
orders ───────────────────────────┘                  │
  id (PK)                                            │
  customer_id → users.id ──────────────────────────┘
  restaurant_id → restaurants.id
  rider_id → users.id
  delivery_location (PostGIS Point)
  status (order_status enum)

order_items
  id (PK)
  order_id → orders.id
  menu_item_id → menu_items.id
  quantity, unit_price
  subtotal (computed column)
```
