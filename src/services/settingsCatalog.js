// =============================================================================
// FireISP 5.0 — Settings catalog (j56)
// =============================================================================
// Single source of truth for which setting keys exist and where each one
// lives. Two scopes, split by migration 443:
//
//   INSTALL — rows in the global `settings` table. One value for the whole
//   deployment, so only the install operator (legacy users.role='admin') may
//   write them; every org may read them. Exposing these through per-org
//   routes as writable was the j56 cross-tenant hole: any tenant admin could
//   redirect ops_alert_email or repoint every tenant's map tiles.
//
//   ORG — rows in `organization_settings`, one per org per key, editable by
//   that org's admins. Values are validated here; the old routes upserted
//   arbitrary keys with arbitrary values, which is how a global table
//   accumulated 23 dead keys nothing ever read.
//
// Adding a key: add it here (with default/description/validate for org keys;
// seed migration + this list for install keys) — routes, both settings
// surfaces and the frontend render from this catalog.
// =============================================================================

/** Install-wide keys, seeded with descriptions by migrations 433/436. */
const INSTALL_SETTING_KEYS = ['ops_alert_email', 'map_tile_url', 'map_tile_attribution'];

/**
 * Per-org keys. `validate` returns null when the value is acceptable, or a
 * human-readable problem string for a 422. Values are stored as strings
 * (TEXT column), so defaults are strings too.
 */
const ORG_SETTING_DEFS = {
  mab_password_mode: {
    default: 'auth_type_accept',
    description: "How MAC-auth-bypass credentials are written to radcheck: 'auth_type_accept' (Auth-Type := Accept) or 'cleartext' (Cleartext-Password := the normalized MAC).",
    validate(value) {
      return ['auth_type_accept', 'cleartext'].includes(value)
        ? null
        : "must be 'auth_type_accept' or 'cleartext'";
    },
  },
  pppoe_auth_failure_threshold: {
    default: '5',
    description: 'RADIUS auth failures per 15-minute window before a pppoe.auth_failures event is raised for an account.',
    validate(value) {
      const n = Number(value);
      return Number.isInteger(n) && n > 0 ? null : 'must be a positive integer';
    },
  },
  install_test_window_minutes: {
    default: '60',
    description: 'Minutes of temporary internet the technician gets on a pending contract to test the install (speed test included) before formal activation. The line is disabled again when the window ends.',
    validate(value) {
      const n = Number(value);
      return Number.isInteger(n) && n >= 5 && n <= 480 ? null : 'must be an integer between 5 and 480';
    },
  },
  billing_followup_days: {
    default: '3',
    description: 'Days after a service order completes before a follow-up ticket is auto-created for the billing team to check in with the client (service working well, happy with the install). 0 disables the follow-up for this organization.',
    validate(value) {
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 && n <= 90 ? null : 'must be an integer between 0 and 90';
    },
  },
};

module.exports = { INSTALL_SETTING_KEYS, ORG_SETTING_DEFS };
