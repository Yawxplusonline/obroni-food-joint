/**
 * OpenFood Backend — Orders Router
 *
 * Defines HTTP routes for the orders resource and delegates business logic
 * to the corresponding controller functions.
 *
 * Mounted at: /api/orders  (see src/routes/index.js)
 */

'use strict';

const { Router } = require('express');
const {
  listOrders,
  createOrder,
  updateOrderStatus,
  acceptOrderDelivery,
} = require('../controllers/ordersController');

const { verifyToken } = require('../middleware/auth');

const router = Router();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/orders
 * Retrieves a list of orders. Results are filtered by the caller's role:
 *   - CUSTOMER        → their own orders
 *   - RESTAURANT_OWNER → orders for their restaurant
 *   - RIDER           → orders assigned to them
 *
 * Auth: Required (Bearer JWT)
 */
router.get('/', verifyToken, listOrders);

/**
 * POST /api/orders
 * Places a new delivery order.
 *
 * Expected body:
 * {
 *   "restaurant_id": "uuid",
 *   "delivery_address": "123 Main St",
 *   "delivery_location": { "lat": 5.6037, "lng": -0.1870 },
 *   "items": [
 *     { "menu_item_id": "uuid", "quantity": 2 }
 *   ]
 * }
 *
 * Auth: Required — must be a CUSTOMER
 */
router.post('/', verifyToken, createOrder);

/**
 * PATCH /api/orders/:id/status
 * Updates the status of an existing order.
 *
 * Expected body:
 * { "status": "ACCEPTED" | "PREPARING" | "READY_FOR_PICKUP" | "PICKED_UP" | "DELIVERED" | "CANCELLED" }
 *
 * Auth: Required — only the relevant restaurant or assigned rider may update
 */
router.patch('/:id/status', verifyToken, updateOrderStatus);

/**
 * POST /api/orders/:id/accept
 * Allows an online rider to accept an unassigned order ready for pickup.
 *
 * Auth: Required — RIDER
 */
router.post('/:id/accept', verifyToken, acceptOrderDelivery);

module.exports = router;
