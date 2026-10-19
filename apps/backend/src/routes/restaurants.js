/**
 * OpenFood Backend — Restaurants Router
 *
 * Defines HTTP routes for browsing restaurants, retrieving menus,
 * and managing menu item availability.
 *
 * Mounted at: /api/restaurants  (see src/routes/index.js)
 */

'use strict';

const { Router } = require('express');
const {
  listRestaurants,
  getRestaurantMenu,
  updateMenuItemAvailability,
} = require('../controllers/restaurantsController');

const { verifyToken } = require('../middleware/auth');

const router = Router();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/restaurants
 * Returns all active restaurants, optionally sorted by PostGIS proximity.
 */
router.get('/', verifyToken, listRestaurants);

/**
 * GET /api/restaurants/:id/menu
 * Returns menu items for the specified restaurant.
 */
router.get('/:id/menu', verifyToken, getRestaurantMenu);

/**
 * PATCH /api/restaurants/:id/menu/:itemId
 * Toggles menu item availability or updates price (Restaurant Owner only).
 */
router.patch('/:id/menu/:itemId', verifyToken, updateMenuItemAvailability);

module.exports = router;
