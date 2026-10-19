/**
 * OpenFood Customer App — PostGIS Spatial Utilities
 *
 * Parses PostGIS GEOMETRY(Point, 4326) values returned by Supabase REST or
 * Supabase Realtime (postgres_changes) into standard { lat, lng } objects.
 *
 * Supported formats:
 *   1. GeoJSON object: { type: 'Point', coordinates: [lng, lat] }
 *   2. EWKT / WKT string: "SRID=4326;POINT(-0.1870 5.6037)" or "POINT(-0.1870 5.6037)"
 *   3. Hex-encoded EWKB / WKB string: "0101000020E6100000..." (sent by Supabase Realtime CDC)
 *   4. Plain { lat, lng } or { latitude, longitude } object
 */

/**
 * Converts a 16-character (8-byte) hex string into an IEEE 754 double-precision float.
 *
 * @param {string} hex16 - 16 hex characters representing 8 bytes
 * @param {boolean} littleEndian - true if byte order is little-endian (NDR = 01)
 * @returns {number}
 */
function hexToDouble(hex16, littleEndian = true) {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = parseInt(hex16.slice(i * 2, i * 2 + 2), 16);
  }
  const view = new DataView(bytes.buffer);
  return view.getFloat64(0, littleEndian);
}

/**
 * Parses a PostGIS Point representation into `{ lat, lng }`.
 * Remember: PostGIS stores coordinates in `(longitude, latitude)` order!
 *
 * @param {string|object|null|undefined} rawLocation
 * @returns {{ lat: number, lng: number } | null}
 */
export function parsePostGISPoint(rawLocation) {
  if (!rawLocation) return null;

  // 1. Object formats (GeoJSON or plain { lat, lng })
  if (typeof rawLocation === 'object') {
    if (
      rawLocation.type === 'Point' &&
      Array.isArray(rawLocation.coordinates) &&
      rawLocation.coordinates.length >= 2
    ) {
      const [lng, lat] = rawLocation.coordinates;
      if (typeof lat === 'number' && typeof lng === 'number') {
        return { lat, lng };
      }
    }
    if (typeof rawLocation.lat === 'number' && typeof rawLocation.lng === 'number') {
      return { lat: rawLocation.lat, lng: rawLocation.lng };
    }
    if (typeof rawLocation.latitude === 'number' && typeof rawLocation.longitude === 'number') {
      return { lat: rawLocation.latitude, lng: rawLocation.longitude };
    }
    return null;
  }

  if (typeof rawLocation !== 'string') return null;
  const trimmed = rawLocation.trim();

  // 2. WKT / EWKT string: e.g. "SRID=4326;POINT(-0.1870 5.6037)"
  const wktMatch = trimmed.match(/POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)/i);
  if (wktMatch) {
    const lng = parseFloat(wktMatch[1]);
    const lat = parseFloat(wktMatch[2]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  }

  // 3. Hex-encoded EWKB / WKB Point
  // Little-endian EWKB Point with SRID (e.g. 01 01000020 E6100000 <16 hex X> <16 hex Y> = 50 hex chars)
  // Little-endian WKB Point without SRID (e.g. 01 01000000 <16 hex X> <16 hex Y> = 42 hex chars)
  if (/^[0-9a-fA-F]{42,50}$/.test(trimmed)) {
    try {
      const littleEndian = trimmed.slice(0, 2) === '01';
      // Coordinate X (lng) and Y (lat) are always the final 32 hex chars (16 bytes) of a 2D Point
      const coordsHex = trimmed.slice(trimmed.length - 32);
      const lng = hexToDouble(coordsHex.slice(0, 16), littleEndian);
      const lat = hexToDouble(coordsHex.slice(16, 32), littleEndian);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Computes the great-circle distance in kilometres between two `{ lat, lng }` points
 * using the Haversine formula.
 *
 * @param {{ lat: number, lng: number }} pointA
 * @param {{ lat: number, lng: number }} pointB
 * @returns {number} Distance in kilometres
 */
export function calculateDistanceKm(pointA, pointB) {
  if (!pointA || !pointB) return 0;
  const R = 6371; // Earth radius in km
  const dLat = ((pointB.lat - pointA.lat) * Math.PI) / 180;
  const dLng = ((pointB.lng - pointA.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((pointA.lat * Math.PI) / 180) *
      Math.cos((pointB.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
