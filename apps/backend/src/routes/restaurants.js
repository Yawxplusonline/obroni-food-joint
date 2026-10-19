/**
 * OpenFood Backend — Restaurants Router
 *
 * Defines HTTP routes for browsing restaurants, retrieving menus,
 * adding new menu stock items, and managing menu item availability.
 *
 * Mounted at: /api/restaurants  (see src/routes/index.js)
 */

'use strict';

const { Router } = require('express');
const {
  listRestaurants,
  getRestaurantMenu,
  createMenuItem,
  updateMenuItemAvailability,
} = require('../controllers/restaurantsController');

const { verifyToken } = require('../middleware/auth');

const router = Router();

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
 * POST /api/restaurants/:id/menu
 * Adds a new stock item to the restaurant's menu.
 */
router.post('/:id/menu', verifyToken, createMenuItem);

/**
 * PATCH /api/restaurants/:id/menu/:itemId
 * Toggles menu item availability or updates price (Restaurant Owner only).
 */
router.patch('/:id/menu/:itemId', verifyToken, updateMenuItemAvailability);

module.exports = router;
