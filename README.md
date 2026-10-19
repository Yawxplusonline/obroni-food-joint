# OpenFood Delivery Platform

A full-stack food delivery platform (similar to UberEats) built as a **monorepo**. It consists of:

- **Backend** — Node.js + Express REST API, backed by Supabase (PostgreSQL + PostGIS + Realtime)
- **Customer App** — Expo React Native app for customers to browse, order, and track deliveries
- **Restaurant Dashboard** — Expo React Native tablet/web app for restaurants to manage incoming orders
- **Rider App** — Expo React Native app for delivery riders with background GPS tracking

---

## Monorepo Structure

```
OpenFood/
├── README.md
├── .gitignore
├── .env.example
├── package.json                  # Root workspace config
│
├── apps/
│   ├── backend/                  # Node.js Express API
│   │   ├── package.json
│   │   ├── .env.example
│   │   └── src/
│   │       ├── index.js
│   │       ├── config/
│   │       │   └── supabase.js
│   │       ├── routes/
│   │       │   ├── index.js
│   │       │   ├── orders.js
│   │       │   ├── riders.js
│   │       │   └── restaurants.js
│   │       ├── middleware/
│   │       │   ├── auth.js
│   │       │   └── errorHandler.js
│   │       └── controllers/
│   │           ├── ordersController.js
│   │           ├── ridersController.js
│   │           └── restaurantsController.js
│   │
│   ├── customer-app/             # Expo RN — Customer
│   │   ├── package.json
│   │   ├── app.json
│   │   ├── App.js
│   │   ├── .env.example
│   │   └── src/
│   │       ├── screens/
│   │       │   ├── HomeScreen.js
│   │       │   ├── TrackingScreen.js
│   │       │   └── CartScreen.js
│   │       └── lib/
│   │           └── supabase.js
│   │
│   ├── restaurant-dashboard/     # Expo RN — Restaurant tablet/web
│   │   ├── package.json
│   │   ├── app.json
│   │   ├── App.js
│   │   ├── .env.example
│   │   └── src/
│   │       ├── screens/
│   │       │   └── OrdersScreen.js
│   │       └── lib/
│   │           └── supabase.js
│   │
│   └── rider-app/                # Expo RN — Rider with background GPS
│       ├── package.json
│       ├── app.json
│       ├── App.js
│       ├── .env.example
│       └── src/
│           ├── screens/
│           │   └── DashboardScreen.js
│           ├── tasks/
│           │   └── locationTask.js
│           └── lib/
│               └── supabase.js
│
└── database/
    ├── README.md
    ├── migrations/
    │   ├── 001_initial_schema.sql
    │   ├── 002_rls_policies.sql
    │   └── 003_indexes.sql
    └── seeds/
        └── seed_data.sql
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| npm | 9+ |
| Expo CLI | Latest (`npm i -g expo-cli`) |
| Supabase account | [supabase.com](https://supabase.com) |

---

## Quick Start

### 1. Clone & install root dependencies

```bash
git clone <repo-url>
cd OpenFood
npm install
```

### 2. Configure environment variables

Copy the root `.env.example` to `.env` and fill in your Supabase project credentials:

```bash
cp .env.example .env
```

Also copy `.env.example` inside each app folder:

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/customer-app/.env.example apps/customer-app/.env
cp apps/restaurant-dashboard/.env.example apps/restaurant-dashboard/.env
cp apps/rider-app/.env.example apps/rider-app/.env
```

### 3. Set up the database

See [`database/README.md`](database/README.md) for migration instructions.

### 4. Run the backend

```bash
cd apps/backend
npm run dev
```

The API will be available at `http://localhost:3001`. Health check: `GET /health`.

### 5. Run the Expo apps

```bash
# Customer App
cd apps/customer-app && npx expo start

# Restaurant Dashboard
cd apps/restaurant-dashboard && npx expo start

# Rider App
cd apps/rider-app && npx expo start
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Node.js, Express |
| Database | Supabase (PostgreSQL + PostGIS) |
| Realtime | Supabase Realtime |
| Auth | Supabase Auth (JWT) |
| Mobile apps | Expo / React Native |
| Maps | react-native-maps (MapLibre planned) |
| Background GPS | expo-location + expo-task-manager |

---

## Environment Variables Reference

See `.env.example` at the root for a full list. The most important ones:

- `SUPABASE_URL` — Your project URL from Supabase dashboard
- `SUPABASE_ANON_KEY` — Public anon key (safe for client apps)
- `SUPABASE_SERVICE_ROLE_KEY` — Secret key (backend only — never expose to clients)
- `FCM_SERVER_KEY` — Firebase Cloud Messaging key for push notifications

---

## Contributing

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Commit changes following [Conventional Commits](https://www.conventionalcommits.org/)
3. Open a pull request against `main`

---

## License

MIT
