/**
 * OpenFood Backend — Auth Routes
 *
 * Endpoints for user profile management (works alongside Supabase Auth).
 * Mounted at: /api/auth  (see src/routes/index.js)
 */

'use strict';

const { Router } = require('express');
const { getMyProfile, upsertProfile } = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

const router = Router();

/**
 * GET /api/auth/me
 * Returns the authenticated caller's profile + rider status if applicable.
 * Auth: Required
 */
router.get('/me', verifyToken, getMyProfile);

/**
 * POST /api/auth/profile
 * Creates or updates the caller's profile in public.users.
 * Call this once after Supabase Auth sign-up to persist full_name/phone/role.
 *
 * Body: { full_name, phone, role }
 * Auth: Required
 */
router.post('/profile', verifyToken, upsertProfile);

module.exports = router;
