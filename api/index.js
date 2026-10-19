/**
 * Vercel Serverless Function Entry Point
 *
 * Exports the OpenFood Express application so Vercel can serve
 * `/api/*` and `/health` routes as serverless functions.
 */

'use strict';

const app = require('../apps/backend/src/index');

module.exports = app;
