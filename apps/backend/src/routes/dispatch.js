/**
 * OpenFood Backend — Dispatch Routes
 *
 * Endpoints for automatic rider assignment.
 * Mounted at: /api/dispatch  (see src/routes/index.js)
 *
 * These routes are typically called by the server itself (e.g., from the
 * ordersController when an order is accepted), not directly by clients.
 */

'use strict';

const { Router } = require('express');
const { assignRider, releaseRider } = require('../controllers/dispatchController');
const { verifyToken } = require('../middleware/auth');

const router = Router();

/**
 * POST /api/dispatch/assign
 * Finds the nearest available rider and assigns them to an order.
 * Body: { "order_id": "uuid" }
 * Auth: Required (in production, add an internal service key check)
 */
router.post('/assign', verifyToken, assignRider);

/**
 * POST /api/dispatch/release-rider
 * Marks a rider as available again after delivering or cancelling.
 * Body: { "rider_id": "uuid" }
 * Auth: Required
 */
router.post('/release-rider', verifyToken, releaseRider);

module.exports = router;
