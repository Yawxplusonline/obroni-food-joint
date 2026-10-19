/**
 * OpenFood Backend — Restaurants Controller
 *
 * Handles business logic for restaurant discovery, menu retrieval,
 * and menu item availability management.
 * All restaurants with is_active = TRUE are publicly readable.
 */

'use strict';

const { supabaseAdmin } = require('../config/supabase');

// ---------------------------------------------------------------------------
// GET /api/restaurants
// ---------------------------------------------------------------------------
/**
 * listRestaurants
 * Returns all active restaurants. Supports optional name-based search and
 * PostGIS proximity sorting via `get_restaurants_near` RPC.
 *
 * Query params (all optional):
 *   search {string} — Partial name match
 *   lat    {number} — Latitude for proximity sort
 *   lng    {number} — Longitude for proximity sort
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function listRestaurants(req, res, next) {
  try {
    const { search } = req.query;
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);

    // -----------------------------------------------------------------------
    // 1. If lat/lng provided, try PostGIS proximity RPC `get_restaurants_near`
    // -----------------------------------------------------------------------
    if (!isNaN(lat) && !isNaN(lng)) {
      const { data: rpcRestaurants, error: rpcError } = await supabaseAdmin.rpc(
        'get_restaurants_near',
        {
          user_lat: lat,
          user_lng: lng,
          search_term: search?.trim() || null,
        }
      );

      if (!rpcError && Array.isArray(rpcRestaurants)) {
        return res.status(200).json({
          success: true,
          count: rpcRestaurants.length,
          data: rpcRestaurants,
        });
      }
    }

    // -----------------------------------------------------------------------
    // 2. Standard query fallback
    // -----------------------------------------------------------------------
    let query = supabaseAdmin
      .from('restaurants')
      .select(`
        id,
        name,
        address,
        is_active,
        owner_id,
        users ( id, full_name, phone )
      `)
      .eq('is_active', true)
      .order('name', { ascending: true });

    // Optional: name-based full-text / partial search
    if (search && search.trim().length > 0) {
      query = query.ilike('name', `%${search.trim()}%`);
    }

    const { data: restaurants, error } = await query;

    if (error) {
      return next(Object.assign(new Error(error.message), { statusCode: 400 }));
    }

    return res.status(200).json({
      success: true,
      count: restaurants.length,
      data: restaurants,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/restaurants/:id/menu
// ---------------------------------------------------------------------------
/**
 * getRestaurantMenu
 * Returns menu items for a given restaurant.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getRestaurantMenu(req, res, next) {
  try {
    const { id } = req.params;
    const includeUnavailable = req.query.include_unavailable === 'true';

    // -----------------------------------------------------------------------
    // 1. Confirm the restaurant exists and is active
    // -----------------------------------------------------------------------
    const { data: restaurant, error: restError } = await supabaseAdmin
      .from('restaurants')
      .select('id, name, address, is_active, owner_id')
      .eq('id', id)
      .single();

    if (restError || !restaurant) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Restaurant with id ${id} not found.`,
      });
    }

    if (!restaurant.is_active && req.user?.id !== restaurant.owner_id) {
      return res.status(403).json({
        error: 'Unavailable',
        message: 'This restaurant is currently closed.',
      });
    }

    // -----------------------------------------------------------------------
    // 2. Fetch the menu items
    // -----------------------------------------------------------------------
    let menuQuery = supabaseAdmin
      .from('menu_items')
      .select('id, name, description, price, is_available')
      .eq('restaurant_id', id)
      .order('name', { ascending: true });

    if (!includeUnavailable) {
      menuQuery = menuQuery.eq('is_available', true);
    }

    const { data: menuItems, error: menuError } = await menuQuery;

    if (menuError) {
      return next(Object.assign(new Error(menuError.message), { statusCode: 400 }));
    }

    return res.status(200).json({
      success: true,
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        address: restaurant.address,
      },
      count: menuItems.length,
      data: menuItems,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/restaurants/:id/menu/:itemId
// ---------------------------------------------------------------------------
/**
 * updateMenuItemAvailability
 * Allows a restaurant owner to toggle `is_available` or update price/details
 * for a menu item (PRD Section 2).
 */
async function updateMenuItemAvailability(req, res, next) {
  try {
    const { id: restaurantId, itemId } = req.params;
    const { is_available, price } = req.body;

    // 1. Verify restaurant ownership
    const { data: restaurant, error: restError } = await supabaseAdmin
      .from('restaurants')
      .select('id, owner_id')
      .eq('id', restaurantId)
      .single();

    if (restError || !restaurant) {
      return res.status(404).json({ error: 'Not Found', message: 'Restaurant not found.' });
    }

    if (restaurant.owner_id !== req.user.id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the restaurant owner can manage menu items.',
      });
    }

    // 2. Build update payload
    const updatePayload = {};
    if (typeof is_available === 'boolean') updatePayload.is_available = is_available;
    if (typeof price === 'number' && price >= 0) updatePayload.price = price;

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Provide at least one of: is_available (boolean), price (number).',
      });
    }

    const { data: updatedItem, error: updateError } = await supabaseAdmin
      .from('menu_items')
      .update(updatePayload)
      .eq('id', itemId)
      .eq('restaurant_id', restaurantId)
      .select()
      .single();

    if (updateError || !updatedItem) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Menu item not found for this restaurant.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Menu item updated.',
      data: updatedItem,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/restaurants/:id/menu
// ---------------------------------------------------------------------------
/**
 * createMenuItem
 * Allows a restaurant manager/owner to add a new stock/menu item.
 *
 * Expected body:
 * {
 *   "name": "Waakye Special",
 *   "description": "Traditional rice and beans with gari, spaghetti, and fish",
 *   "price": 40.00,
 *   "is_available": true
 * }
 */
async function createMenuItem(req, res, next) {
  try {
    const { id: restaurantId } = req.params;
    const { name, description = '', price, is_available = true } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Menu item name is required.',
      });
    }

    const numericPrice = parseFloat(price);
    if (isNaN(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'A valid positive price is required.',
      });
    }

    const { data: newItem, error } = await supabaseAdmin
      .from('menu_items')
      .insert({
        restaurant_id: restaurantId,
        name: name.trim(),
        description: String(description).trim(),
        price: numericPrice.toFixed(2),
        is_available: Boolean(is_available),
      })
      .select()
      .single();

    if (error) {
      return next(Object.assign(new Error(error.message), { statusCode: 400 }));
    }

    return res.status(201).json({
      success: true,
      message: 'New stock item added to menu.',
      data: newItem,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listRestaurants,
  getRestaurantMenu,
  updateMenuItemAvailability,
  createMenuItem,
};
