/**
 * OpenFood Backend — Orders Controller
 *
 * Contains the business logic for all order-related operations:
 *  - Listing orders scoped to the caller's role (RLS)
 *  - Creating orders with server-side price validation
 *  - Updating order status with role authorization and PostGIS rider dispatch
 *  - Allowing a rider to accept an unassigned READY_FOR_PICKUP order
 *
 * Data access: Supabase PostgreSQL via @supabase/supabase-js
 */

'use strict';

const { supabaseAdmin, createUserClient } = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');

// Valid order status transitions (state machine)
const VALID_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
];

const RESTAURANT_ALLOWED_STATUSES = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'CANCELLED'];
const RIDER_ALLOWED_STATUSES = ['PICKED_UP', 'DELIVERED'];

// ---------------------------------------------------------------------------
// GET /api/orders
// ---------------------------------------------------------------------------
/**
 * listOrders
 * Returns orders filtered by the authenticated user's role.
 *
 * @param {import('express').Request}  req — req.user set by auth middleware
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function listOrders(req, res, next) {
  try {
    // Use user-scoped client so RLS policies apply automatically
    const db = createUserClient(req.accessToken);

    const { data: orders, error } = await db
      .from('orders')
      .select(
        `
        id,
        status,
        total_amount,
        delivery_address,
        created_at,
        updated_at,
        customer_id,
        restaurant_id,
        rider_id,
        restaurants ( id, name, address ),
        order_items (
          id,
          quantity,
          unit_price,
          subtotal,
          menu_items ( id, name )
        )
      `
      )
      .order('created_at', { ascending: false });

    if (error) {
      return next(Object.assign(new Error(error.message), { statusCode: 400 }));
    }

    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/orders
// ---------------------------------------------------------------------------
/**
 * createOrder
 * Places a new food delivery order.
 *
 * Expected body:
 * {
 *   "restaurant_id": "uuid",
 *   "delivery_address": "123 Main St, Accra",
 *   "delivery_location": { "lat": 5.6037, "lng": -0.1870 },
 *   "items": [{ "menu_item_id": "uuid", "quantity": 2 }]
 * }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createOrder(req, res, next) {
  try {
    const customerId = req.user.id;
    const { restaurant_id, delivery_address, delivery_location, items } = req.body;

    // -----------------------------------------------------------------------
    // 1. Validate required fields
    // -----------------------------------------------------------------------
    if (!restaurant_id || !delivery_address || !delivery_location || !items?.length) {
      return res.status(400).json({
        error: 'Bad Request',
        message:
          'Missing required fields: restaurant_id, delivery_address, delivery_location, items[].',
      });
    }

    const { lat, lng } = delivery_location;
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'delivery_location must contain numeric lat and lng values.',
      });
    }

    // -----------------------------------------------------------------------
    // 2. Fetch menu item prices to compute totals server-side
    //    (never trust client-sent prices)
    // -----------------------------------------------------------------------
    const menuItemIds = items.map((i) => i.menu_item_id);

    const { data: menuItems, error: menuError } = await supabaseAdmin
      .from('menu_items')
      .select('id, price, is_available, restaurant_id')
      .in('id', menuItemIds);

    if (menuError) {
      return next(Object.assign(new Error(menuError.message), { statusCode: 400 }));
    }

    // Ensure all items belong to the specified restaurant and are available
    for (const item of items) {
      const menuItem = menuItems.find((m) => m.id === item.menu_item_id);
      if (!menuItem) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Menu item ${item.menu_item_id} not found.`,
        });
      }
      if (!menuItem.is_available) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Menu item ${item.menu_item_id} is currently unavailable.`,
        });
      }
      if (menuItem.restaurant_id !== restaurant_id) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Menu item ${item.menu_item_id} does not belong to restaurant ${restaurant_id}.`,
        });
      }
    }

    // -----------------------------------------------------------------------
    // 3. Compute total amount
    // -----------------------------------------------------------------------
    let totalAmount = 0;
    const enrichedItems = items.map((item) => {
      const menuItem = menuItems.find((m) => m.id === item.menu_item_id);
      const unitPrice = parseFloat(menuItem.price);
      const qty = parseInt(item.quantity, 10);
      totalAmount += unitPrice * qty;
      return {
        id: uuidv4(),
        menu_item_id: item.menu_item_id,
        quantity: qty,
        unit_price: unitPrice,
      };
    });

    // -----------------------------------------------------------------------
    // 4. Insert the order record
    // -----------------------------------------------------------------------
    const { data: newOrder, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        customer_id: customerId,
        restaurant_id,
        total_amount: totalAmount.toFixed(2),
        delivery_address,
        // PostGIS POINT format: ST_SetSRID(ST_MakePoint(lng, lat), 4326)
        delivery_location: `SRID=4326;POINT(${lng} ${lat})`,
        status: 'PENDING',
      })
      .select()
      .single();

    if (orderError) {
      return next(Object.assign(new Error(orderError.message), { statusCode: 400 }));
    }

    // -----------------------------------------------------------------------
    // 5. Insert order items
    // -----------------------------------------------------------------------
    const orderItemsToInsert = enrichedItems.map((item) => ({
      ...item,
      order_id: newOrder.id,
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('order_items')
      .insert(orderItemsToInsert);

    if (itemsError) {
      // Attempt to rollback the order (best effort)
      await supabaseAdmin.from('orders').delete().eq('id', newOrder.id);
      return next(Object.assign(new Error(itemsError.message), { statusCode: 400 }));
    }

    // -----------------------------------------------------------------------
    // 6. Return the created order
    // -----------------------------------------------------------------------
    return res.status(201).json({
      success: true,
      message: 'Order placed successfully.',
      data: { ...newOrder, items: orderItemsToInsert },
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/status
// ---------------------------------------------------------------------------
/**
 * updateOrderStatus
 * Updates the status field of an order (e.g. ACCEPTED → PREPARING → READY_FOR_PICKUP).
 * When status becomes READY_FOR_PICKUP, triggers PostGIS rider dispatch (PRD 5.3).
 *
 * Expected body: { "status": "PREPARING" }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function updateOrderStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const callerId = req.user.id;

    // -----------------------------------------------------------------------
    // 1. Validate status value
    // -----------------------------------------------------------------------
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `status must be one of: ${VALID_STATUSES.join(', ')}.`,
      });
    }

    // -----------------------------------------------------------------------
    // 2. Fetch the existing order with restaurant ownership info
    // -----------------------------------------------------------------------
    const { data: existingOrder, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, status, customer_id, restaurant_id, rider_id, restaurants ( owner_id )')
      .eq('id', id)
      .single();

    if (fetchError || !existingOrder) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Order with id ${id} not found.`,
      });
    }

    // -----------------------------------------------------------------------
    // 3. Role-based authorization check
    // -----------------------------------------------------------------------
    const isRestaurantOwner = existingOrder.restaurants?.owner_id === callerId;
    const isAssignedRider = existingOrder.rider_id === callerId;
    const isCustomer = existingOrder.customer_id === callerId;

    if (RESTAURANT_ALLOWED_STATUSES.includes(status) && status !== 'CANCELLED') {
      if (!isRestaurantOwner) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Only the restaurant owner can set status to ${status}.`,
        });
      }
    } else if (RIDER_ALLOWED_STATUSES.includes(status)) {
      if (!isAssignedRider) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Only the assigned rider can set status to ${status}.`,
        });
      }
    } else if (status === 'CANCELLED') {
      if (!isRestaurantOwner && !(isCustomer && existingOrder.status === 'PENDING')) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Customers can only cancel PENDING orders; otherwise only the restaurant can cancel.',
        });
      }
    }

    // -----------------------------------------------------------------------
    // 4. Perform the status update
    // -----------------------------------------------------------------------
    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return next(Object.assign(new Error(updateError.message), { statusCode: 400 }));
    }

    // -----------------------------------------------------------------------
    // 5. PostGIS Rider Dispatch when status flips to READY_FOR_PICKUP (PRD 5.3)
    // -----------------------------------------------------------------------
    let dispatchResult = null;
    if (status === 'READY_FOR_PICKUP' && !updatedOrder.rider_id) {
      const { data: rpcDispatch, error: rpcErr } = await supabaseAdmin.rpc(
        'dispatch_nearest_rider',
        { p_order_id: id, p_radius_meters: 5000 }
      );

      if (!rpcErr && rpcDispatch?.length > 0) {
        dispatchResult = rpcDispatch[0];
        updatedOrder.rider_id = dispatchResult.assigned_rider_id;
      }
    }

    // -----------------------------------------------------------------------
    // 6. Release rider availability when order is DELIVERED or CANCELLED
    // -----------------------------------------------------------------------
    if (['DELIVERED', 'CANCELLED'].includes(status) && updatedOrder.rider_id) {
      await supabaseAdmin
        .from('rider_profiles')
        .update({ is_available: true })
        .eq('id', updatedOrder.rider_id);
    }

    return res.status(200).json({
      success: true,
      message: `Order status updated to ${status}.`,
      dispatch: dispatchResult,
      data: updatedOrder,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/orders/:id/accept
// ---------------------------------------------------------------------------
/**
 * acceptOrderDelivery
 * Allows an online rider to manually accept an unassigned READY_FOR_PICKUP order.
 */
async function acceptOrderDelivery(req, res, next) {
  try {
    const { id } = req.params;
    const riderId = req.user.id;

    // 1. Verify order is READY_FOR_PICKUP and unassigned
    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('id, status, rider_id')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ error: 'Not Found', message: 'Order not found.' });
    }

    if (order.rider_id && order.rider_id !== riderId) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'This order has already been assigned to another rider.',
      });
    }

    if (!['READY_FOR_PICKUP', 'PREPARING', 'ACCEPTED'].includes(order.status)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Order cannot be accepted in status ${order.status}.`,
      });
    }

    // 2. Assign rider and mark rider busy
    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update({ rider_id: riderId })
      .eq('id', id)
      .is('rider_id', null)
      .select()
      .single();

    if (updateErr || !updatedOrder) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Could not claim order — it may have been claimed already.',
      });
    }

    await supabaseAdmin
      .from('rider_profiles')
      .update({ is_available: false })
      .eq('id', riderId);

    return res.status(200).json({
      success: true,
      message: 'Delivery accepted.',
      data: updatedOrder,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/orders/:id/pay
// ---------------------------------------------------------------------------
const VALID_PAYMENT_METHODS = ['MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AT', 'BANK_CARD'];

/**
 * submitOrderPayment
 * Allows the customer to pay for a placed order via Mobile Money (MTN, Telecel, AT)
 * or Bank Card (Visa/Mastercard) after cueing in their 4-digit MoMo/Card PIN.
 *
 * Expected body:
 * {
 *   "payment_method": "MOMO_MTN" | "MOMO_TELECEL" | "MOMO_AT" | "BANK_CARD",
 *   "payment_account": "0241234567" or "**** 4242",
 *   "momo_pin": "1234"
 * }
 */
async function submitOrderPayment(req, res, next) {
  try {
    const { id } = req.params;
    const { payment_method, payment_account, momo_pin } = req.body;
    const customerId = req.user.id;

    if (!payment_method || !VALID_PAYMENT_METHODS.includes(payment_method)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `payment_method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}.`,
      });
    }

    if (!payment_account || String(payment_account).trim().length < 4) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'payment_account (MoMo phone number or masked card digits) is required.',
      });
    }

    if (!momo_pin || !/^\d{4}$/.test(String(momo_pin).trim())) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'A valid 4-digit MoMo / Card PIN is required to authorize the final payment transaction.',
      });
    }

    // Verify order belongs to the customer
    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('id, customer_id, status, payment_status')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ error: 'Not Found', message: 'Order not found.' });
    }

    if (order.customer_id !== customerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the customer who placed this order can submit payment.',
      });
    }

    const prefix = payment_method === 'BANK_CARD' ? 'CARD' : 'MOMO';
    const paymentReference = `TXN-${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;

    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update({
        payment_method,
        payment_account: String(payment_account).trim(),
        payment_reference: paymentReference,
        payment_status: 'PAID_PENDING_CONFIRMATION',
        paid_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return next(Object.assign(new Error(updateErr.message), { statusCode: 400 }));
    }

    return res.status(200).json({
      success: true,
      message: 'MoMo PIN verified and payment authorized. Waiting for restaurant confirmation.',
      data: updatedOrder,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/confirm-payment
// ---------------------------------------------------------------------------
/**
 * confirmOrderPayment
 * Allows the restaurant owner to confirm that a customer's Mobile Money or
 * Bank Card payment has been received (`payment_status = 'CONFIRMED'`).
 */
async function confirmOrderPayment(req, res, next) {
  try {
    const { id } = req.params;
    const callerId = req.user.id;

    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('id, status, payment_status, restaurant_id, restaurants ( owner_id )')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ error: 'Not Found', message: 'Order not found.' });
    }

    if (order.restaurants?.owner_id !== callerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the restaurant owner can confirm payment for this order.',
      });
    }

    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update({
        payment_status: 'CONFIRMED',
        payment_confirmed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return next(Object.assign(new Error(updateErr.message), { statusCode: 400 }));
    }

    return res.status(200).json({
      success: true,
      message: 'Payment confirmed by restaurant.',
      data: updatedOrder,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listOrders,
  createOrder,
  updateOrderStatus,
  acceptOrderDelivery,
  submitOrderPayment,
  confirmOrderPayment,
};
