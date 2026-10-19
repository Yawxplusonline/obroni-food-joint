/**
 * OpenFood Backend — Supabase Client Configuration
 *
 * Initialises two Supabase clients:
 *  - `supabaseAnon`  : uses the public anon key, subject to Row Level Security (RLS).
 *                      Use for operations that should respect user permissions.
 *  - `supabaseAdmin` : uses the service role key, bypasses RLS.
 *                      Use sparingly — only for trusted server-side operations
 *                      (e.g. sending notifications, admin-level queries).
 *
 * Both clients are singletons — import this file wherever you need DB access.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Load environment variables with safe development fallbacks
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'placeholder-anon-key';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn(
    '⚠️  [supabase.js] SUPABASE_URL / SUPABASE_ANON_KEY not set in .env — running with local demo placeholders.'
  );
}

// ---------------------------------------------------------------------------
// Anon Client — honours Row Level Security
// ---------------------------------------------------------------------------
/**
 * Use `supabaseAnon` when executing queries on behalf of an authenticated user.
 * Pass the user's JWT via `supabaseAnon.auth.setSession()` or by constructing
 * a per-request client using `createClient` with the user's access token in
 * the `Authorization` header (see auth middleware for the pattern).
 */
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Disable automatic session persistence on the server — sessions are
    // managed per-request via the Authorization header.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

// ---------------------------------------------------------------------------
// Admin Client — bypasses Row Level Security
// ---------------------------------------------------------------------------
/**
 * Use `supabaseAdmin` only for operations that require elevated privileges and
 * are performed entirely on the trusted server (e.g., creating system records,
 * sending push notifications, running cron-like tasks).
 *
 * ⚠️  NEVER expose the service role key to client-side code.
 */
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

// ---------------------------------------------------------------------------
// Helper — create a per-request client scoped to a user's JWT
// ---------------------------------------------------------------------------
/**
 * Creates a Supabase client that sends the given JWT in every request,
 * so that RLS policies evaluate correctly for that specific user.
 *
 * @param {string} accessToken - The user's Supabase JWT (from Authorization header)
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function createUserClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

module.exports = { supabaseAnon, supabaseAdmin, createUserClient };
