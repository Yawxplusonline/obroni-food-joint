/**
 * OpenFood Backend — Express Application Entry Point
 *
 * Bootstraps the Express app with all global middleware and mounts the
 * main router. The server listens on the port defined in .env (default 3001).
 */

'use strict';

// Load environment variables from .env file first, before any other imports
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const router = require('./routes/index');
const errorHandler = require('./middleware/errorHandler');

// ---------------------------------------------------------------------------
// App Initialization
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Global Middleware
// ---------------------------------------------------------------------------

const path = require('path');

/**
 * helmet — sets secure HTTP response headers.
 * Allows unpkg.com (Leaflet) and tile.openstreetmap.org (OSM tiles) for the live web portal.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://*.tile.openstreetmap.org',
          'https://tile.openstreetmap.org',
          'https://*.basemaps.cartocdn.com',
          'https://unpkg.com',
        ],
        connectSrc: [
          "'self'",
          'https://*.supabase.co',
          'wss://*.supabase.co',
          'https://*.tile.openstreetmap.org',
          'https://*.basemaps.cartocdn.com',
        ],
      },
    },
  })
);

/**
 * cors — enables Cross-Origin Resource Sharing so the Expo/React Native apps
 * and any web clients can communicate with this API.
 */
app.use(
  cors({
    origin: process.env.NODE_ENV === 'production' ? [] : '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

/**
 * morgan — HTTP request logger.
 */
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

/**
 * express.json — parses incoming requests with JSON payloads.
 */
app.use(express.json({ limit: '1mb' }));

/**
 * express.urlencoded — parses URL-encoded form data.
 */
app.use(express.urlencoded({ extended: true }));

/**
 * Serve the interactive 3-in-1 OpenFood Web Launchpad at `/`
 */
app.use(express.static(path.join(__dirname, '../public')));

// ---------------------------------------------------------------------------
// Health Check Endpoint
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'openfood-backend',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
app.use('/api', router);

// ---------------------------------------------------------------------------
// 404 Handler — catch any routes not matched above
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// ---------------------------------------------------------------------------
// Global Error Handler — must be last middleware registered
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log(`🚀  OpenFood Backend running on http://localhost:${PORT}`);
    console.log(`📋  Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log(`🏥  Health check: http://localhost:${PORT}/health`);
    console.log('='.repeat(60));
  });
}

// Export for testing purposes
module.exports = app;
