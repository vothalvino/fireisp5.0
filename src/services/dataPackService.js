'use strict';

// =============================================================================
// FireISP 5.0 — Data Pack Service (§10.3)
// =============================================================================
// Manages the data pack catalog and subscriber purchases.
// Effective allowance = base_cap + active_packs + rollover_balance.
// =============================================================================

const db = require('../config/database');
const rolloverService = require('./rolloverService');

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

async function listPacks(organizationId, { includeGlobal = true } = {}) {
  let where = 'deleted_at IS NULL AND is_active = 1';
  const params = [];
  if (includeGlobal) {
    where += ' AND (organization_id = ? OR organization_id IS NULL)';
    params.push(organizationId);
  } else {
    where += ' AND organization_id = ?';
    params.push(organizationId);
  }
  const [rows] = await db.query(
    `SELECT * FROM data_packs WHERE ${where} ORDER BY price ASC`,
    params,
  );
  return rows;
}

async function getPack(id, organizationId) {
  const [[row]] = await db.query(
    `SELECT * FROM data_packs
     WHERE id = ?
       AND (organization_id = ? OR organization_id IS NULL)
       AND deleted_at IS NULL`,
    [id, organizationId],
  );
  return row || null;
}

async function createPack(organizationId, body) {
  const { name, description, data_gb, price, currency = 'MXN', validity_days = 30, is_active = true } = body;
  const [result] = await db.query(
    `INSERT INTO data_packs
       (organization_id, name, description, data_gb, price, currency, validity_days, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, name, description || null, data_gb, price, currency, validity_days, is_active ? 1 : 0],
  );
  return getPack(result.insertId, organizationId);
}

async function updatePack(id, organizationId, body) {
  const allowed = ['name', 'description', 'data_gb', 'price', 'currency', 'validity_days', 'is_active'];
  const fields = [];
  const params = [];
  for (const [key, val] of Object.entries(body)) {
    if (allowed.includes(key)) {
      fields.push(`${key} = ?`);
      params.push(val);
    }
  }
  if (!fields.length) return getPack(id, organizationId);
  params.push(id, organizationId);
  await db.query(
    `UPDATE data_packs
     SET ${fields.join(', ')}
     WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    params,
  );
  return getPack(id, organizationId);
}

async function deletePack(id, organizationId) {
  await db.query(
    `UPDATE data_packs SET deleted_at = NOW()
     WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [id, organizationId],
  );
}

async function restorePack(id, organizationId) {
  await db.query(
    'UPDATE data_packs SET deleted_at = NULL WHERE id = ? AND organization_id = ?',
    [id, organizationId],
  );
  return getPack(id, organizationId);
}

// ---------------------------------------------------------------------------
// Purchase helpers
// ---------------------------------------------------------------------------

async function purchasePack(organizationId, contractId, packId, { purchasedBy = 'admin', invoiceId = null } = {}) {
  const [[pack]] = await db.query(
    `SELECT * FROM data_packs
     WHERE id = ?
       AND (organization_id = ? OR organization_id IS NULL)
       AND is_active = 1
       AND deleted_at IS NULL`,
    [packId, organizationId],
  );
  if (!pack) throw Object.assign(new Error('Data pack not found or inactive'), { status: 404 });

  const activatedAt = new Date();
  const expiresAt = new Date(activatedAt.getTime() + pack.validity_days * 86400000);

  const [result] = await db.query(
    `INSERT INTO data_pack_purchases
       (organization_id, contract_id, data_pack_id, purchased_by,
        purchased_at, activated_at, expires_at, gb_applied, invoice_id, status)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, 'active')`,
    [organizationId, contractId, packId, purchasedBy, activatedAt, expiresAt, pack.data_gb, invoiceId],
  );

  const [[purchase]] = await db.query(
    `SELECT dpp.*, dp.name AS pack_name
     FROM data_pack_purchases dpp
     JOIN data_packs dp ON dpp.data_pack_id = dp.id
     WHERE dpp.id = ?`,
    [result.insertId],
  );
  return purchase;
}

async function listPurchases(organizationId, contractId) {
  const [rows] = await db.query(
    `SELECT dpp.*, dp.name AS pack_name, dp.data_gb AS pack_data_gb
     FROM data_pack_purchases dpp
     JOIN data_packs dp ON dpp.data_pack_id = dp.id
     WHERE dpp.contract_id = ?
       AND dpp.organization_id = ?
     ORDER BY dpp.purchased_at DESC`,
    [contractId, organizationId],
  );
  return rows;
}

async function listPackPurchases(packId, organizationId) {
  const [rows] = await db.query(
    `SELECT dpp.*, dp.name AS pack_name
     FROM data_pack_purchases dpp
     JOIN data_packs dp ON dpp.data_pack_id = dp.id
     WHERE dpp.data_pack_id = ?
       AND dpp.organization_id = ?
     ORDER BY dpp.purchased_at DESC
     LIMIT 100`,
    [packId, organizationId],
  );
  return rows;
}

async function cancelPurchase(purchaseId, organizationId) {
  await db.query(
    `UPDATE data_pack_purchases SET status = 'cancelled'
     WHERE id = ? AND organization_id = ? AND status IN ('pending','active')`,
    [purchaseId, organizationId],
  );
  const [[row]] = await db.query(
    'SELECT * FROM data_pack_purchases WHERE id = ?',
    [purchaseId],
  );
  return row;
}

// ---------------------------------------------------------------------------
// Effective allowance
// ---------------------------------------------------------------------------

/**
 * Compute a subscriber's total effective data allowance:
 *   base_cap + active (non-expired) data packs + available rollover GB
 *
 * @param {number} contractId
 * @returns {Promise<object|null>}
 */
async function getEffectiveAllowance(contractId) {
  const [[contract]] = await db.query(
    `SELECT c.id, c.organization_id, p.data_cap_gb
     FROM contracts c
     JOIN plans p ON c.plan_id = p.id
     WHERE c.id = ? AND c.deleted_at IS NULL`,
    [contractId],
  );
  if (!contract) return null;

  const baseCap = parseFloat(contract.data_cap_gb) || 0;

  // Active non-expired packs
  const [[packRow]] = await db.query(
    `SELECT COALESCE(SUM(gb_applied), 0) AS pack_gb
     FROM data_pack_purchases
     WHERE contract_id = ?
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [contractId],
  );
  const packGb = parseFloat(packRow.pack_gb) || 0;

  // Rollover
  const rollover = await rolloverService.getRolloverBalance(contractId);
  const rolloverGb = rollover.total_available_gb || 0;

  return {
    base_cap_gb: baseCap,
    pack_gb: packGb,
    rollover_gb: rolloverGb,
    total_gb: baseCap + packGb + rolloverGb,
  };
}

module.exports = {
  listPacks,
  getPack,
  createPack,
  updatePack,
  deletePack,
  restorePack,
  purchasePack,
  listPurchases,
  listPackPurchases,
  cancelPurchase,
  getEffectiveAllowance,
};
