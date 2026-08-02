// =============================================================================
// FireISP 5.0 — Settings Validation Schemas
// =============================================================================

// `required` is deliberately false so an EMPTY value survives validation:
// blanking an install key is how an operator falls back to its documented
// default (blank map_tile_url = OpenStreetMap, blank ops_alert_email = notify
// every org admin), and validate() treats '' as absent when required is true.
// routes/settings.js still 422s a genuinely missing value with an explicit
// typeof check — the two together keep "missing" and "blank" distinct.
const updateSetting = {
  value: { type: 'string', required: false, max: 5000 },
  description: { type: 'string', max: 500 },
};

module.exports = { updateSetting };
