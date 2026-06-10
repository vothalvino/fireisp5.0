// =============================================================================
// FireISP 5.0 — Geocoding Service (Google Maps Geocoding API)
// =============================================================================
// Resolves a postal/service address to GPS coordinates (latitude/longitude) for
// the client service-address map pin (isp-platform-features.md §1.1).
//
// Requires GOOGLE_MAPS_API_KEY to be configured. When the key is absent the
// service throws a ConfigError so the route can return a clear 503/422 instead
// of silently failing.
// =============================================================================

const config = require('../config');
const logger = require('../utils/logger').child({ service: 'geocoding' });
const { ValidationError, AppError } = require('../utils/errors');

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/**
 * Build a single-line address string from structured address parts.
 * @param {object} parts
 * @returns {string}
 */
function formatAddress({ address, city, state, zip_code, country } = {}) {
  return [address, city, state, zip_code, country]
    .map(p => String(p ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Geocode an address into { latitude, longitude, formatted_address }.
 *
 * @param {object|string} input - structured address parts or a single string.
 * @returns {Promise<{ latitude: number, longitude: number, formatted_address: string }>}
 * @throws {ValidationError} when the address is empty or cannot be resolved.
 * @throws {AppError} when the provider is not configured or returns an error.
 */
async function geocodeAddress(input) {
  const apiKey = config.geocoding.googleApiKey;
  if (!apiKey) {
    throw new AppError('Geocoding is not configured (GOOGLE_MAPS_API_KEY is not set)', 503);
  }

  const addressString = typeof input === 'string' ? input.trim() : formatAddress(input);
  if (!addressString) {
    throw new ValidationError('An address is required to geocode');
  }

  const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(addressString)}&key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.geocoding.timeoutMs);

  let body;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new AppError(`Geocoding provider returned HTTP ${res.status}`, 502);
    }
    body = await res.json();
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'AbortError') {
      throw new AppError('Geocoding request timed out', 504);
    }
    logger.error({ err }, 'Geocoding request failed');
    throw new AppError('Geocoding request failed', 502);
  } finally {
    clearTimeout(timer);
  }

  // Google returns a top-level `status` field. A status other than OK or
  // ZERO_RESULTS (e.g. REQUEST_DENIED, OVER_QUERY_LIMIT) is a provider-side
  // error and must be surfaced as a 502 rather than "address not found".
  if (body.status && body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
    logger.warn({ status: body.status, error: body.error_message }, 'Geocoding provider non-OK status');
    throw new AppError(`Geocoding provider error: ${body.status}`, 502);
  }
  if (body.status === 'ZERO_RESULTS' || !Array.isArray(body.results) || body.results.length === 0) {
    throw new ValidationError(`No coordinates found for address: ${addressString}`);
  }

  const top = body.results[0];
  const loc = top.geometry && top.geometry.location;
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
    throw new AppError('Geocoding provider returned an unexpected response', 502);
  }

  return {
    latitude: loc.lat,
    longitude: loc.lng,
    formatted_address: top.formatted_address || addressString,
  };
}

module.exports = { geocodeAddress, formatAddress };
