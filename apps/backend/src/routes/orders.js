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
  submitOrderPayment,
  confirmOrderPayment,
} = require('../controllers/ordersController');

const { verifyToken } = require('../middleware/auth');

const router = Router();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/orders
 * Retrieves a list of orders scoped to the caller's role.
 */
router.get('/', verifyToken, listOrders);

/**
 * POST /api/orders
 * Places a new delivery order.
 */
router.post('/', verifyToken, createOrder);

/**
 * PATCH /api/orders/:id/status
 * Updates the status of an existing order.
 */
router.patch('/:id/status', verifyToken, updateOrderStatus);

/**
 * POST /api/orders/:id/accept
 * Allows an online rider to accept an unassigned order ready for pickup.
 */
router.post('/:id/accept', verifyToken, acceptOrderDelivery);

/**
 * POST /api/orders/:id/pay
 * Submits Mobile Money or Bank Card payment after placing an order (Customer).
 */
router.post('/:id/pay', verifyToken, submitOrderPayment);

/**
 * PATCH /api/orders/:id/confirm-payment
 * Confirms receipt of customer payment (Restaurant Owner).
 */
router.patch('/:id/confirm-payment', verifyToken, confirmOrderPayment);

module.exports = router;
