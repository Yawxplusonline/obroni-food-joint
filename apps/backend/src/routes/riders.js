/**
 * OpenFood Backend — Riders Router
 *
 * Defines HTTP routes for the riders resource:
 *  - Listing all riders & registering new riders (Fleet Manager)
 *  - Querying nearby available riders via PostGIS
 *  - Updating rider GPS location and online/available status
 *
 * Mounted at: /api/riders  (see src/routes/index.js)
 */

'use strict';

const { Router } = require('express');
const {
  listRiders,
  createRider,
  getNearbyRiders,
  updateRiderLocation,
  updateRiderStatus,
} = require('../controllers/ridersController');

const { verifyToken } = require('../middleware/auth');

const router = Router();

/**
 * GET /api/riders
 * Lists all riders in the fleet.
 */
router.get('/', verifyToken, listRiders);

/**
 * POST /api/riders
 * Registers a new rider in the fleet.
 */
router.post('/', verifyToken, createRider);

/**
 * GET /api/riders/nearby
 * Returns online, available riders within a radius of a point (PostGIS).
 */
router.get('/nearby', verifyToken, getNearbyRiders);

/**
 * PATCH /api/riders/:id/location
 * Updates the real-time GPS location for a rider.
 */
router.patch('/:id/location', verifyToken, updateRiderLocation);

/**
 * PATCH /api/riders/:id/status
 * Toggles a rider's online/offline or available/unavailable status.
 */
router.patch('/:id/status', verifyToken, updateRiderStatus);

module.exports = router;
