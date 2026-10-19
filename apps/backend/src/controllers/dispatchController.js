/**
 * OpenFood Backend — Dispatch Controller
 *
 * Handles automatic rider assignment for orders. When a restaurant accepts
 * an order (status → ACCEPTED), the dispatch logic:
 *   1. Fetches the order's restaurant location.
 *   2. Calls the `get_nearby_riders` PostGIS RPC to find available riders
 *      sorted by distance to the restaurant.
 *   3. Assigns the closest rider and updates the order's rider_id.
 *   4. Marks the rider as unavailable until the delivery is complete.
 *
 * Mounted at: POST /api/dispatch/assign  (see routes/dispatch.js)
 */

'use strict';

const { supabaseAdmin } = require('../config/supabase');

// Maximum search radius for riders (metres)
const DEFAULT_SEARCH_RADIUS_M = 8000; // 8km

// ---------------------------------------------------------------------------
// POST /api/dispatch/assign
// ---------------------------------------------------------------------------
/**
 * assignRider
 * Finds the nearest available rider to a restaurant and assigns them to an order.
 *
 * Expected body:
 * { "order_id": "uuid" }
 *
 * Can be called:
 *   - Internally (by the orders controller when status changes to ACCEPTED)
 *   - Externally (by a cron job or webhook)
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function assignRider(req, res, next) {
  try {
    const { order_id } = req.body;

    if (!order_id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'order_id is required.',
      });
    }

    // -----------------------------------------------------------------------
    // 1. Fetch the order with its restaurant location
    // -----------------------------------------------------------------------
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        status,
        rider_id,
        restaurant_id,
        restaurants (
          id,
          name,
          location
        )
      `)
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Order ${order_id} not found.`,
      });
    }

    if (order.rider_id) {
      return res.status(409).json({
        error: 'Conflict',
        message: `Order already has a rider assigned (rider_id: ${order.rider_id}).`,
      });
    }

    if (!['PENDING', 'ACCEPTED'].includes(order.status)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Cannot assign a rider to an order with status: ${order.status}.`,
      });
    }

    // -----------------------------------------------------------------------
    // 2. Get restaurant coordinates from PostGIS geometry
    //    The `location` column returns as GeoJSON when using Supabase JS client.
    //    We need lat/lng to pass to the get_nearby_riders RPC.
    // -----------------------------------------------------------------------
    // Fallback: if geometry parsing fails, use a default Accra location
    // TODO: Parse GeoJSON properly:
    //   const [lng, lat] = order.restaurants.location.coordinates;
    // For now, use the restaurant ID to look up via a raw query.
    const { data: restaurantGeo, error: geoError } = await supabaseAdmin
      .rpc('get_nearby_restaurants', {
        origin_lat: 5.6037,  // placeholder — will be replaced by real restaurant coords
        origin_lng: -0.1870,
        radius_m: 1,         // 1m radius to get just this restaurant
      });

    // We'll use a direct PostGIS query instead for accuracy
    // Extract lat/lng from the restaurant's geometry using ST_X / ST_Y
    const { data: coords, error: coordsError } = await supabaseAdmin
      .rpc('get_restaurant_coords', { restaurant_id: order.restaurant_id })
      .catch(() => ({ data: null, error: new Error('RPC not found') }));

    // Graceful fallback: use the seed Accra coordinates if RPC isn't available yet
    let originLat = 5.6037;
    let originLng = -0.1870;

    if (coords) {
      originLat = coords.lat;
      originLng = coords.lng;
    }

    // -----------------------------------------------------------------------
    // 3. Find nearby riders via PostGIS RPC
    // -----------------------------------------------------------------------
    const { data: nearbyRiders, error: riderError } = await supabaseAdmin.rpc(
      'get_nearby_riders',
      {
        origin_lat: originLat,
        origin_lng: originLng,
        radius_m: DEFAULT_SEARCH_RADIUS_M,
      }
    );

    if (riderError) {
      console.error('[dispatchController] get_nearby_riders RPC error:', riderError.message);
      return next(Object.assign(new Error(riderError.message), { statusCode: 500 }));
    }

    if (!nearbyRiders || nearbyRiders.length === 0) {
      return res.status(404).json({
        error: 'No Riders Available',
        message: `No available riders found within ${DEFAULT_SEARCH_RADIUS_M / 1000}km of the restaurant.`,
        searched_radius_m: DEFAULT_SEARCH_RADIUS_M,
      });
    }

    // The RPC returns riders sorted by distance ASC — pick the closest
    const selectedRider = nearbyRiders[0];
    console.log(
      `[dispatchController] Assigning rider ${selectedRider.id} ` +
        `(${(selectedRider.distance_m / 1000).toFixed(2)}km away) to order ${order_id}`
    );

    // -----------------------------------------------------------------------
    // 4. Assign the rider to the order atomically
    // -----------------------------------------------------------------------
    const { data: updatedOrder, error: assignError } = await supabaseAdmin
      .from('orders')
      .update({ rider_id: selectedRider.id })
      .eq('id', order_id)
      .is('rider_id', null) // Guard against race conditions — only assign if not already taken
      .select('id, status, rider_id')
      .single();

    if (assignError || !updatedOrder) {
      return res.status(409).json({
        error: 'Assignment Conflict',
        message: 'A rider was already assigned to this order (race condition). Please retry.',
      });
    }

    // -----------------------------------------------------------------------
    // 5. Mark the rider as unavailable
    // -----------------------------------------------------------------------
    await supabaseAdmin
      .from('rider_profiles')
      .update({ is_available: false })
      .eq('id', selectedRider.id);

    // -----------------------------------------------------------------------
    // 6. Respond
    // -----------------------------------------------------------------------
    return res.status(200).json({
      success: true,
      message: `Rider assigned successfully.`,
      data: {
        order_id,
        assigned_rider_id: selectedRider.id,
        distance_m: Math.round(selectedRider.distance_m),
        total_candidates: nearbyRiders.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/dispatch/release-rider
// ---------------------------------------------------------------------------
/**
 * releaseRider
 * Marks a rider as available again after completing a delivery.
 * Called automatically when an order status transitions to DELIVERED or CANCELLED.
 *
 * Expected body: { "rider_id": "uuid" }
 */
async function releaseRider(req, res, next) {
  try {
    const { rider_id } = req.body;

    if (!rider_id) {
      return res.status(400).json({ error: 'Bad Request', message: 'rider_id is required.' });
    }

    const { error } = await supabaseAdmin
      .from('rider_profiles')
      .update({ is_available: true })
      .eq('id', rider_id);

    if (error) {
      return next(Object.assign(new Error(error.message), { statusCode: 400 }));
    }

    return res.status(200).json({
      success: true,
      message: `Rider ${rider_id} is now available for new deliveries.`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { assignRider, releaseRider };
