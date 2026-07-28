// =============================================================================
// FireISP 5.0 — Map tile configuration
// =============================================================================
// Every map in the product hardcoded OpenStreetMap's public tile server. That
// is the right DEFAULT — it needs no account, no API key and no signup, so a
// fresh install has working maps out of the box — but it should not be the
// only option:
//
//   * OSM's tile usage policy is aimed at modest use. An ISP whose dispatchers
//     pan a map all day is expected to point at their own tile server or a
//     commercial provider.
//   * Some operators already pay for tiles and would rather use them.
//
// So the tile source is a setting, defaulting to OSM. Any XYZ raster provider
// works by URL alone: a self-hosted server, MapTiler, Mapbox's raster
// endpoint, Thunderforest, Stadia, CARTO.
//
// NOT GOOGLE, and that is worth stating rather than discovering: Google Maps
// tiles cannot legitimately be consumed as raw XYZ tiles — their terms require
// the Google Maps JavaScript API, which is a different renderer, not a
// different URL. Supporting it means a second map component, not a setting.
//
// ITS OWN ENDPOINT, not /organizations/:id/settings, because that route needs
// `settings.view` — granted to admin and billing only (migration 119). The
// technician map's primary audience is technicians, who do not hold it, so
// reading the tile URL through settings would 403 exactly the people who need
// the map. Nothing here is secret: it is a public tile URL and an attribution
// string, so authentication alone is the right bar.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../config/database');

const router = Router();
router.use(authenticate);

// Kept in sync with the seed in migration 433. Duplicated deliberately: an
// install whose settings row was deleted must still get working maps rather
// than a blank grey square.
const DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('map_tile_url', 'map_tile_attribution')",
    );
    const map = {};
    for (const r of rows) map[r.setting_key] = r.setting_value;

    // An empty string is "unset", not "no tiles" — a blank value in the
    // settings form must fall back rather than break every map.
    const tileUrl = (map.map_tile_url || '').trim() || DEFAULT_TILE_URL;
    const attribution = (map.map_tile_attribution || '').trim() || DEFAULT_ATTRIBUTION;

    res.json({ data: { tile_url: tileUrl, attribution, is_default: tileUrl === DEFAULT_TILE_URL } });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.DEFAULT_TILE_URL = DEFAULT_TILE_URL;
module.exports.DEFAULT_ATTRIBUTION = DEFAULT_ATTRIBUTION;
