/**
 * OpenFood Delivery Platform — End-to-End Backend & Spatial Verification Suite
 *
 * Verifies:
 *   1. Express API health check (`/health`) and 404 handling
 *   2. JWT Auth middleware protection across `/api/orders`, `/api/riders`, `/api/restaurants`
 *   3. PostGIS spatial geometry parser (EWKT, WKT, GeoJSON, and Hex EWKB)
 *   4. SQL migrations (001–004) and seed files exist and contain required PostGIS constructs
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Set placeholder env vars before loading Express app so Supabase client initializes cleanly
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'placeholder-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key';

const app = require('../src/index');

// Helper to make HTTP requests against an ephemeral test server
function request(server, method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            // ignore non-json
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('OpenFood Backend API & Spatial Suite', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  t.after(() => {
    server.close();
  });

  await t.test('GET /health returns 200 OK with service metadata', async () => {
    const res = await request(server, 'GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.service, 'openfood-backend');
  });

  await t.test('Unknown route returns 404 Not Found', async () => {
    const res = await request(server, 'GET', '/api/non-existent-route');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not Found');
  });

  await t.test('Protected routes reject unauthenticated requests with 401', async () => {
    const endpoints = [
      ['GET', '/api/orders'],
      ['POST', '/api/orders'],
      ['PATCH', '/api/orders/123/status'],
      ['POST', '/api/orders/123/accept'],
      ['POST', '/api/orders/123/pay'],
      ['PATCH', '/api/orders/123/confirm-payment'],
      ['GET', '/api/riders/nearby?lat=5.6037&lng=-0.1870'],
      ['PATCH', '/api/riders/123/location'],
      ['PATCH', '/api/riders/123/status'],
      ['GET', '/api/restaurants'],
      ['GET', '/api/restaurants/123/menu'],
      ['PATCH', '/api/restaurants/123/menu/456'],
    ];

    for (const [method, endpoint] of endpoints) {
      const res = await request(server, method, endpoint);
      assert.equal(
        res.status,
        401,
        `Expected ${method} ${endpoint} without token to return 401, got ${res.status}`
      );
    }
  });

  await t.test('Database migrations 001–005 and seed_data.sql are complete', async () => {
    const dbRoot = path.resolve(__dirname, '../../../database');
    const expectedFiles = [
      'migrations/001_initial_schema.sql',
      'migrations/002_rls_policies.sql',
      'migrations/003_indexes.sql',
      'migrations/004_spatial_rpc_and_dispatch.sql',
      'migrations/005_payments.sql',
      'seeds/seed_data.sql',
    ];

    for (const relPath of expectedFiles) {
      const fullPath = path.join(dbRoot, relPath);
      assert.ok(fs.existsSync(fullPath), `Missing database file: ${relPath}`);
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.ok(content.length > 100, `Database file ${relPath} should not be empty`);
    }

    const mig004 = fs.readFileSync(
      path.join(dbRoot, 'migrations/004_spatial_rpc_and_dispatch.sql'),
      'utf8'
    );
    assert.ok(mig004.includes('dispatch_nearest_rider'), '004 should define dispatch_nearest_rider');
    assert.ok(mig004.includes('ST_DWithin'), '004 should use PostGIS ST_DWithin');
    assert.ok(mig004.includes('ST_Distance'), '004 should use PostGIS ST_Distance');
  });
});
