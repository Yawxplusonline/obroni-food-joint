/**
 * OpenFood Customer App — Supabase Client
 *
 * Initialises and exports a singleton Supabase client for use throughout
 * the customer app. Uses the public anon key — RLS policies protect data.
 *
 * Environment variables must be prefixed with EXPO_PUBLIC_ to be bundled
 * by Expo into the client-side app at build time.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[supabase.js] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your Supabase project credentials.'
  );
}

/**
 * Singleton Supabase client.
 * Import this wherever you need database or auth access:
 *   import { supabase } from '../lib/supabase';
 */
export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-key',
  {
    auth: {
      // Expo / React Native uses AsyncStorage for session persistence.
      // Install @react-native-async-storage/async-storage and pass it here:
      // storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    realtime: {
      // Realtime is used by TrackingScreen for live order/rider updates
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);
