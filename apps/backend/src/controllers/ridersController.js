/**
 * OpenFood Backend — Riders Controller
 *
 * Handles business logic for rider management:
 *  - Fetching nearby available riders (for dispatch via PostGIS ST_DWithin / ST_Distance)
 *  - Updating a rider's real-time GPS location
 *  - Toggling a rider's online / available status
 *
 * All location data is stored as PostGIS GEOMETRY(Point, 4326).
 */

'use strict';

const { supabaseAdmin } = require('../config/supabase');

// ---------------------------------------------------------------------------
// GET /api/riders/nearby
// ---------------------------------------------------------------------------
/**
 * getNearbyRiders
 * Returns online and available riders within a radius of a given point.
 * Uses the `get_nearby_riders` PostGIS RPC (migration 004) for exact
 * spheroid distance filtering and sorting.
 *
 * Query params: lat, lng, radius (metres, default 5000)
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getNearbyRiders(req, res, next) {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseInt(req.query.radius, 10) || 5000; // default 5km (PRD Section 5.3)

    // -----------------------------------------------------------------------
    // Validate coordinates
    // -----------------------------------------------------------------------
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Query parameters lat and lng are required and must be valid numbers.',
      });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'lat must be between -90 and 90, lng between -180 and 180.',
      });
    }

    // -----------------------------------------------------------------------
    // Execute PostGIS spatial query via Supabase RPC `get_nearby_riders`
    // -----------------------------------------------------------------------
    const { data: rpcRiders, error: rpcError } = await supabaseAdmin.rpc('get_nearby_riders', {
      target_lat: lat,
      target_lng: lng,
      radius_meters: radius,
    });

    if (!rpcError && Array.isArray(rpcRiders)) {
      return res.status(200).json({
        success: true,
        count: rpcRiders.length,
        radius_meters: radius,
        data: rpcRiders,
      });
    }

    // Fallback query if migration 004 hasn't been applied yet
    const { data: riders, error } = await supabaseAdmin
      .from('rider_profiles')
      .select(`
        id,
        is_online,
        is_available,
        current_location,
        last_location_update,
        users ( id, full_name, phone )
      `)
      .eq('is_online', true)
      .eq('is_available', true)
      .not('current_location', 'is', null);

    if (error) {
      return next(Object.assign(new Error(error.message), { statusCode: 400 }));
    }

    return res.status(200).json({
      success: true,
      count: riders.length,
      radius_meters: radius,
      data: riders,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/riders/:id/location
// ---------------------------------------------------------------------------
/**
 * updateRiderLocation
 * Updates the stored GPS coordinates of a rider.
 * Called frequently by the Rider App's background task (every ~5-10 seconds).
 *
 * Expected body: { "lat": 5.6037, "lng": -0.1870 }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function updateRiderLocation(req, res, next) {
  try {
    const { id } = req.params;
    const { lat, lng } = req.body;

    // -----------------------------------------------------------------------
    // Authorization — riders can only update their own location
    // -----------------------------------------------------------------------
    if (req.user.id !== id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only update your own location.',
      });
    }

    // -----------------------------------------------------------------------
    // Validate coordinates
    // -----------------------------------------------------------------------
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Body must contain numeric lat and lng values.',
      });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'lat must be between -90 and 90, lng between -180 and 180.',
      });
    }

    // -----------------------------------------------------------------------
    // Upsert location — use POINT(lng lat) for PostGIS (note: lng first)
    // -----------------------------------------------------------------------
    const { data, error } = await supabaseAdmin
      .from('rider_profiles')
      .update({
        current_location: `SRID=4326;POINT(${lng} ${lat})`,
        last_location_update: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, is_online, is_available, last_location_update')
      .single();

    if (error) {
      return next(Object.assign(new Error(error.message), { statusCode: 400 }));
    }

    return res.status(200).json({
      success: true,
      message: 'Location updated.',
      data,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/riders/:id/status
// ---------------------------------------------------------------------------
/**
 * updateRiderStatus
 * Sets a rider's online / available flags.
 *
 * Expected body: { "is_online": true, "is_available": true }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function updateRiderStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { is_online, is_available } = req.body;

    // -----------------------------------------------------------------------
    // Authorization — riders can only update their own status
    // -----------------------------------------------------------------------
    if (req.user.id !== id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only update your own status.',
      });
    }

    // -----------------------------------------------------------------------
    // Build the update payload — only include provided fields
    // -----------------------------------------------------------------------
    const updatePayload = {};
    if (typeof is_online === 'boolean') updatePayload.is_online = is_online;
    if (typeof is_available === 'boolean') updatePayload.is_available = is_available;

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Provide at least one of: is_online (boolean), is_available (boolean).',
      });
    }

    // -----------------------------------------------------------------------
    // Perform the update
    // -----------------------------------------------------------------------
    const { data, error } = await supabaseAdmin
      .from('rider_profiles')
      .update(updatePayload)
      .eq('id', id)
      .select('id, is_online, is_available, last_location_update')
      .single();

    if (error) {
      return next(Object.assign(new Error(error.message), { statusCode: 400 }));
    }

    return res.status(200).json({
      success: true,
      message: 'Rider status updated.',
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getNearbyRiders, updateRiderLocation, updateRiderStatus };
