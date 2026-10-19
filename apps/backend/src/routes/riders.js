/**
 * OpenFood Backend — Riders Router
 *
 * Defines HTTP routes for the riders resource. Enables riders to broadcast
 * their live location and toggle their availability status.
 *
 * Mounted at: /api/riders  (see src/routes/index.js)
 */

'use strict';

const { Router } = require('express');
const {
  getNearbyRiders,
  updateRiderLocation,
  updateRiderStatus,
} = require('../controllers/ridersController');

const { verifyToken } = require('../middleware/auth');

const router = Router();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/riders/nearby
 * Returns a list of online, available riders within a given radius of a point.
 *
 * Query parameters:
 *   lat    {number} — Latitude of the origin point
 *   lng    {number} — Longitude of the origin point
 *   radius {number} — Search radius in metres (default: 5000)
 *
 * Example: GET /api/riders/nearby?lat=5.6037&lng=-0.1870&radius=3000
 *
 * Auth: Required — used internally by the order-dispatch logic
 */
router.get('/nearby', verifyToken, getNearbyRiders);

/**
 * PATCH /api/riders/:id/location
 * Updates the real-time GPS location for a rider.
 * Called frequently by the Rider App's background location task.
 *
 * Expected body:
 * { "lat": 5.6037, "lng": -0.1870 }
 *
 * Auth: Required — rider can only update their own location
 */
router.patch('/:id/location', verifyToken, updateRiderLocation);

/**
 * PATCH /api/riders/:id/status
 * Toggles a rider's online/offline or available/unavailable status.
 *
 * Expected body:
 * { "is_online": true, "is_available": true }
 *
 * Auth: Required — rider can only update their own status
 */
router.patch('/:id/status', verifyToken, updateRiderStatus);

module.exports = router;
