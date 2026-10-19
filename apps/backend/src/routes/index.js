/**
 * OpenFood Backend — Main Router
 *
 * Aggregates all sub-routers and mounts them under their respective
 * API path prefixes. This file is the single entry point for all
 * /api/* routes, imported by src/index.js.
 */

'use strict';

const { Router } = require('express');

const authRouter = require('./auth');
const ordersRouter = require('./orders');
const ridersRouter = require('./riders');
const restaurantsRouter = require('./restaurants');
const dispatchRouter = require('./dispatch');

const router = Router();

// ---------------------------------------------------------------------------
// Mount sub-routers
// ---------------------------------------------------------------------------

/**
 * Auth routes — profile creation and retrieval
 * Base path: /api/auth
 */
router.use('/auth', authRouter);

/**
 * Orders routes — create, list, and update delivery orders
 * Base path: /api/orders
 */
router.use('/orders', ordersRouter);

/**
 * Riders routes — manage rider availability and live location
 * Base path: /api/riders
 */
router.use('/riders', ridersRouter);

/**
 * Restaurants routes — browse restaurants and their menus
 * Base path: /api/restaurants
 */
router.use('/restaurants', restaurantsRouter);

/**
 * Dispatch routes — automatic rider assignment
 * Base path: /api/dispatch
 */
router.use('/dispatch', dispatchRouter);

// ---------------------------------------------------------------------------
// API root — useful for quick sanity checks
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  res.json({
    message: 'OpenFood API v1',
    endpoints: [
      'GET  /api/orders',
      'POST /api/orders',
      'PATCH /api/orders/:id/status',
      'GET  /api/riders/nearby',
      'PATCH /api/riders/:id/location',
      'PATCH /api/riders/:id/status',
      'GET  /api/restaurants',
      'GET  /api/restaurants/:id/menu',
    ],
  });
});

module.exports = router;
