-- =============================================================================
-- Rollback 433: remove the map tile settings
-- =============================================================================
-- Maps keep working: the route falls back to the same OpenStreetMap defaults
-- when the rows are absent.

DELETE FROM settings WHERE setting_key IN ('map_tile_url', 'map_tile_attribution');
