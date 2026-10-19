/**
 * OpenFood Backend — Auth Controller
 *
 * Handles user profile management that works alongside Supabase Auth.
 *
 * Flow:
 *   1. The client signs up via Supabase Auth (client-side SDK) — this
 *      creates a row in auth.users and fires our `handle_new_auth_user`
 *      trigger (migration 004) which auto-creates a public.users profile.
 *   2. POST /api/auth/profile — called after sign-up to confirm or update
 *      the profile (e.g., if the trigger wasn't set up yet, or to update
 *      phone / full_name).
 *   3. GET  /api/auth/me — returns the caller's full profile.
 */

'use strict';

const { supabaseAdmin } = require('../config/supabase');

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
/**
 * getMyProfile
 * Returns the authenticated user's profile from public.users.
 * If the user has a RIDER role, also returns their rider_profile.
 */
async function getMyProfile(req, res, next) {
  try {
    const userId = req.user.id;

    const { data: profile, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, role, created_at')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User profile not found. Please register first via POST /api/auth/profile.',
      });
    }

    // For riders, include their current status
    let riderProfile = null;
    if (profile.role === 'RIDER') {
      const { data: rp } = await supabaseAdmin
        .from('rider_profiles')
        .select('is_online, is_available, last_location_update')
        .eq('id', userId)
        .single();
      riderProfile = rp || null;
    }

    return res.status(200).json({
      success: true,
      data: {
        ...profile,
        rider_profile: riderProfile,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/profile
// ---------------------------------------------------------------------------
/**
 * upsertProfile
 * Creates or updates the caller's profile in public.users.
 * Safe to call multiple times (idempotent via UPSERT).
 *
 * Expected body:
 * {
 *   "full_name": "Akosua Mensah",
 *   "phone":     "+233201234567",
 *   "role":      "CUSTOMER" | "RESTAURANT_OWNER" | "RIDER"
 * }
 */
async function upsertProfile(req, res, next) {
  try {
    const userId = req.user.id;
    const { full_name, phone, role } = req.body;

    // -----------------------------------------------------------------------
    // Validate
    // -----------------------------------------------------------------------
    if (!full_name || !phone || !role) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'full_name, phone, and role are required.',
      });
    }

    const VALID_ROLES = ['CUSTOMER', 'RESTAURANT_OWNER', 'RIDER'];
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `role must be one of: ${VALID_ROLES.join(', ')}.`,
      });
    }

    // -----------------------------------------------------------------------
    // Upsert public.users
    // -----------------------------------------------------------------------
    const { data: profile, error } = await supabaseAdmin
      .from('users')
      .upsert(
        { id: userId, full_name: full_name.trim(), phone: phone.trim(), role },
        { onConflict: 'id' }
      )
      .select('id, full_name, phone, role, created_at')
      .single();

    if (error) {
      return next(Object.assign(new Error(error.message), { statusCode: 400 }));
    }

    // -----------------------------------------------------------------------
    // If rider, ensure rider_profiles row exists
    // -----------------------------------------------------------------------
    if (role === 'RIDER') {
      const { error: riderError } = await supabaseAdmin
        .from('rider_profiles')
        .upsert(
          { id: userId, is_online: false, is_available: true },
          { onConflict: 'id', ignoreDuplicates: true }
        );

      if (riderError) {
        console.warn('[authController] rider_profile upsert error:', riderError.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Profile saved successfully.',
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyProfile, upsertProfile };
