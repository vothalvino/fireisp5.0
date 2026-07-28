-- =============================================================================
-- Migration 433 — configurable map tile source
-- =============================================================================
-- Every map hardcoded OpenStreetMap's public tile server. That is the right
-- DEFAULT (no account, no API key, no signup — a fresh install has working
-- maps immediately), but it should not be the only option: OSM's tile usage
-- policy is aimed at modest use, and an ISP whose dispatchers pan a map all day
-- is expected to run its own tile server or use a commercial provider.
--
-- Seeded rather than left absent so the keys are DISCOVERABLE: the org Settings
-- tab renders the settings map, so an admin can see and change them without
-- knowing they exist. The route falls back to these same values when a row is
-- missing or blank, so deleting one cannot break maps.
--
-- Any XYZ raster provider works by URL alone — self-hosted, MapTiler, Mapbox
-- raster, Thunderforest, Stadia, CARTO. Google is NOT one of these: its terms
-- require the Google Maps JavaScript API, which is a different renderer rather
-- than a different URL.
-- =============================================================================

INSERT INTO settings (setting_key, setting_value, description) VALUES
    ('map_tile_url',
     'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
     'XYZ raster tile URL template for all maps. Placeholders: {s} subdomain, {z} zoom, {x}/{y} tile. Blank = OpenStreetMap default. Google Maps is NOT supported here — it requires its own JS API, not a tile URL.'),
    ('map_tile_attribution',
     '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
     'Attribution HTML shown in the map corner. Most tile providers REQUIRE a specific credit — check your provider terms when changing map_tile_url.')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
