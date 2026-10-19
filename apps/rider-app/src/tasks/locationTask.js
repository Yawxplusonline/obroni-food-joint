/**
 * OpenFood Rider App — Background Location Task
 *
 * This module defines and registers a background location task using
 * expo-task-manager. When the rider is online, the task fires periodically
 * even when the app is backgrounded or the screen is off, and updates the
 * rider's current_location in Supabase.
 *
 * ⚠️  IMPORTANT: This file MUST be imported at the very top of App.js,
 * before any navigation or UI code. expo-task-manager requires tasks to be
 * registered at the module level during app startup.
 *
 * Platform notes:
 *  - iOS  : Requires the "location" background mode in app.json (already set).
 *            Uses the blue status-bar indicator to inform the user.
 *  - Android: Requires a foreground service notification (configured when
 *              calling Location.startLocationUpdatesAsync in DashboardScreen).
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Task Name — export so DashboardScreen can reference the same string
// ---------------------------------------------------------------------------
export const LOCATION_TASK_NAME = 'openfood-rider-location-task';

// ---------------------------------------------------------------------------
// Supabase Client (for the background task context)
//
// Background tasks run in a separate JS context and cannot import the
// singleton from src/lib/supabase.js. We create a dedicated client here.
// The service-role key is NOT used — we rely on the rider's session token
// stored securely and passed via task options (see TODO below).
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

// ---------------------------------------------------------------------------
// Task Definition
// ---------------------------------------------------------------------------
/**
 * TaskManager.defineTask runs in a background context whenever the OS
 * delivers a new location update. The callback receives:
 *
 * @param {object} taskData
 * @param {object} taskData.data
 * @param {Location.LocationObject[]} taskData.data.locations — array of location objects
 * @param {Error|null} taskData.error
 */
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error(`[${LOCATION_TASK_NAME}] Location task error:`, error.message);
    return;
  }

  if (!data?.locations?.length) {
    console.warn(`[${LOCATION_TASK_NAME}] No locations in payload.`);
    return;
  }

  // Use the most recent location from the batch
  const location = data.locations[data.locations.length - 1];
  const { latitude, longitude, accuracy, speed } = location.coords;

  console.log(
    `[${LOCATION_TASK_NAME}] New location: (${latitude.toFixed(5)}, ${longitude.toFixed(5)}) ` +
      `accuracy=${accuracy?.toFixed(0)}m speed=${speed?.toFixed(1)}m/s`
  );

  // -------------------------------------------------------------------------
  // Update rider location in Supabase
  // -------------------------------------------------------------------------
  // TODO: In production, retrieve the authenticated rider's ID from secure
  // storage (e.g., expo-secure-store) rather than hardcoding it.
  // Example:
  //   import * as SecureStore from 'expo-secure-store';
  //   const riderId = await SecureStore.getItemAsync('rider_id');
  //   const accessToken = await SecureStore.getItemAsync('access_token');
  //   supabase.auth.setSession({ access_token: accessToken, ... });
  //
  // For the scaffold, we use the seed rider ID:
  const RIDER_ID = 'a1b2c3d4-0003-0003-0003-000000000003';

  try {
    const { error: dbError } = await supabase
      .from('rider_profiles')
      .update({
        // PostGIS POINT — note: longitude comes FIRST in WKT/EWKT
        current_location: `SRID=4326;POINT(${longitude} ${latitude})`,
        last_location_update: new Date().toISOString(),
      })
      .eq('id', RIDER_ID);

    if (dbError) {
      console.error(`[${LOCATION_TASK_NAME}] Supabase update error:`, dbError.message);
    } else {
      console.log(`[${LOCATION_TASK_NAME}] ✅ Location saved to Supabase.`);
    }
  } catch (updateErr) {
    console.error(`[${LOCATION_TASK_NAME}] Unexpected error during update:`, updateErr.message);
  }
});

// ---------------------------------------------------------------------------
// Exported helpers — used by DashboardScreen
// ---------------------------------------------------------------------------

/**
 * startLocationTracking
 * Convenience wrapper to start the background task with recommended settings.
 * Call after obtaining background location permission.
 */
export async function startLocationTracking() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (!isRegistered) {
    console.warn(`[${LOCATION_TASK_NAME}] Task not registered yet. Is this being imported in App.js?`);
    return;
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,       // fire every 5 seconds
    distanceInterval: 10,     // or every 10 metres
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'OpenFood Rider — Active Delivery',
      notificationBody: 'Your location is being shared with customers.',
      notificationColor: '#FF6B35',
    },
    activityType: Location.ActivityType.AutomotiveNavigation,
  });

  console.log(`[${LOCATION_TASK_NAME}] Background location tracking STARTED.`);
}

/**
 * stopLocationTracking
 * Stops the background task when the rider goes offline.
 */
export async function stopLocationTracking() {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    console.log(`[${LOCATION_TASK_NAME}] Background location tracking STOPPED.`);
  }
}
