/**
 * OpenFood Backend — Auth Middleware
 *
 * Verifies the Supabase JWT sent in the Authorization header of each request.
 * On success, attaches the decoded user object to `req.user` so downstream
 * route handlers and controllers can access identity and role information.
 *
 * Usage (in a router):
 *   const { verifyToken } = require('../middleware/auth');
 *   router.get('/protected', verifyToken, myController);
 *
 * Expected header format:
 *   Authorization: Bearer <supabase-access-token>
 */

'use strict';

const { supabaseAdmin } = require('../config/supabase');

/**
 * verifyToken
 *
 * Express middleware that validates a Supabase JWT.
 * Supabase access tokens are standard JWTs signed with your project's JWT secret.
 * We use the Admin client's `auth.getUser()` helper to validate the token
 * remotely — this avoids us having to manage the JWT secret ourselves and
 * ensures revoked tokens are rejected.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function verifyToken(req, res, next) {
  try {
    // -------------------------------------------------------------------------
    // 1. Extract the token from the Authorization header
    // -------------------------------------------------------------------------
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No token provided.',
      });
    }

    // -------------------------------------------------------------------------
    // 2. Validate the token with Supabase
    // -------------------------------------------------------------------------
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: error?.message || 'Invalid or expired token.',
      });
    }

    // -------------------------------------------------------------------------
    // 3. Attach user info to request object for downstream handlers
    // -------------------------------------------------------------------------
    // `data.user` contains: id, email, phone, user_metadata, app_metadata, etc.
    // Store the raw token too so controllers can create user-scoped DB clients.
    req.user = data.user;
    req.accessToken = token;

    // TODO: Optionally fetch the user's role from the `users` table and attach it:
    // const { data: profile } = await supabaseAdmin
    //   .from('users')
    //   .select('role')
    //   .eq('id', data.user.id)
    //   .single();
    // req.userRole = profile?.role;

    next();
  } catch (err) {
    // Pass unexpected errors to the global error handler
    next(err);
  }
}

/**
 * requireRole
 *
 * Factory that creates role-gating middleware. Use after `verifyToken`.
 *
 * Example:
 *   router.post('/orders', verifyToken, requireRole('CUSTOMER'), createOrder);
 *
 * @param {...string} roles — Allowed roles (e.g. 'CUSTOMER', 'RIDER', 'RESTAURANT_OWNER')
 * @returns {import('express').RequestHandler}
 */
function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.userRole; // Set by verifyToken (once role fetching is enabled)

    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of the following roles: ${roles.join(', ')}.`,
      });
    }

    next();
  };
}

module.exports = { verifyToken, requireRole };
