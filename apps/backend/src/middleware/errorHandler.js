/**
 * OpenFood Backend — Global Error Handler Middleware
 *
 * This must be the LAST middleware registered in src/index.js.
 * Express identifies error-handling middleware by its four-parameter signature:
 *   (err, req, res, next)
 *
 * All errors passed via `next(err)` or thrown in async handlers (when wrapped
 * correctly) will flow through here.
 *
 * Usage in a controller:
 *   try {
 *     // ... your logic
 *   } catch (err) {
 *     next(err);  // passes control to this handler
 *   }
 */

'use strict';

/**
 * errorHandler
 *
 * Formats errors into a consistent JSON response.
 * Distinguishes between operational errors (expected, e.g. validation failures)
 * and programmer errors (unexpected, e.g. null reference) for cleaner logging.
 *
 * @param {Error}  err
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next  — required by Express even if unused
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // -------------------------------------------------------------------------
  // 1. Log the error (replace with a proper logger like Winston/Pino in prod)
  // -------------------------------------------------------------------------
  const isProduction = process.env.NODE_ENV === 'production';

  console.error('──────────────────────────────────────────────');
  console.error(`[ERROR] ${new Date().toISOString()}`);
  console.error(`  Route  : ${req.method} ${req.originalUrl}`);
  console.error(`  Message: ${err.message}`);
  if (!isProduction) {
    console.error(`  Stack  :\n${err.stack}`);
  }
  console.error('──────────────────────────────────────────────');

  // -------------------------------------------------------------------------
  // 2. Determine HTTP status code
  // -------------------------------------------------------------------------
  // Use the error's statusCode/status if set, otherwise fall back to 500.
  const statusCode =
    err.statusCode || err.status || (Number.isInteger(err.code) ? err.code : null) || 500;

  // -------------------------------------------------------------------------
  // 3. Construct the response payload
  // -------------------------------------------------------------------------
  const response = {
    error: statusCode >= 500 ? 'Internal Server Error' : err.name || 'Error',
    message:
      statusCode >= 500 && isProduction
        ? 'An unexpected error occurred. Please try again later.'
        : err.message,
  };

  // In development, include the stack trace for easier debugging
  if (!isProduction && err.stack) {
    response.stack = err.stack;
  }

  // -------------------------------------------------------------------------
  // 4. Send the response
  // -------------------------------------------------------------------------
  res.status(statusCode).json(response);
}

// ---------------------------------------------------------------------------
// Helper — creates an operational error with a custom status code.
// Use this in controllers to produce client-friendly errors.
// ---------------------------------------------------------------------------
/**
 * createError
 *
 * @param {string} message  — Human-readable error message
 * @param {number} [statusCode=400] — HTTP status code
 * @returns {Error}
 */
function createError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

module.exports = { errorHandler, createError };
// Express requires the default export to be the middleware function
module.exports = errorHandler;
module.exports.createError = createError;
