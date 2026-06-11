// =============================================================================
// FireISP 5.0 — Invoice Settings Service
// =============================================================================
// Manages per-organization invoice branding settings stored in the
// organization_invoice_settings table (migration 204).
// =============================================================================

const db = require('../config/database');

/**
 * Get invoice settings for an organization.
 * Returns null if no custom settings have been saved yet.
 * @param {number} organizationId
 * @returns {Promise<object|null>}
 */
async function getInvoiceSettings(organizationId) {
  const [rows] = await db.query(
    'SELECT * FROM organization_invoice_settings WHERE organization_id = ?',
    [organizationId],
  );
  return rows[0] || null;
}

/**
 * Upsert invoice settings for an organization.
 * @param {number} organizationId
 * @param {{ logo_url?, header_color?, footer_legal?, payment_instructions? }} data
 * @returns {Promise<object>}
 */
async function upsertInvoiceSettings(organizationId, data) {
  const { logo_url, header_color, footer_legal, payment_instructions } = data;

  await db.query(
    `INSERT INTO organization_invoice_settings
        (organization_id, logo_url, header_color, footer_legal, payment_instructions)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        logo_url             = VALUES(logo_url),
        header_color         = VALUES(header_color),
        footer_legal         = VALUES(footer_legal),
        payment_instructions = VALUES(payment_instructions),
        updated_at           = CURRENT_TIMESTAMP`,
    [organizationId, logo_url || null, header_color || null, footer_legal || null, payment_instructions || null],
  );

  return getInvoiceSettings(organizationId);
}

module.exports = { getInvoiceSettings, upsertInvoiceSettings };
