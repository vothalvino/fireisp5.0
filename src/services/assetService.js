// =============================================================================
// FireISP 5.0 — Asset Service — §14
// =============================================================================

const db = require('../config/database');

/**
 * Generate a barcode payload for an asset.
 * Returns the payload string and metadata — no external library needed.
 */
function generateBarcode(asset) {
  const payload = asset.barcode || `AST-${String(asset.id).padStart(8, '0')}`;
  return {
    asset_id: asset.id,
    barcode_payload: payload,
    format: 'code128',
    svg: null,
  };
}

/**
 * Calculate straight-line depreciation for an asset.
 * Returns book value, accumulated depreciation, and monthly rate.
 */
function calculateDepreciation(asset) {
  const cost = parseFloat(asset.purchase_cost || 0);
  const salvage = parseFloat(asset.salvage_value || 0);
  const lifeMonths = parseInt(asset.useful_life_months || 60, 10);

  if (!asset.purchase_date || cost <= 0 || lifeMonths <= 0) {
    return { method: asset.depreciation_method, book_value: cost, accumulated: 0, monthly_rate: 0, months_elapsed: 0 };
  }

  const purchaseDate = new Date(asset.purchase_date);
  const now = new Date();
  const monthsElapsed = Math.max(
    0,
    (now.getFullYear() - purchaseDate.getFullYear()) * 12 + (now.getMonth() - purchaseDate.getMonth()),
  );

  if (asset.depreciation_method === 'straight_line') {
    const monthlyRate = lifeMonths > 0 ? (cost - salvage) / lifeMonths : 0;
    const accumulated = Math.min(monthlyRate * monthsElapsed, cost - salvage);
    const bookValue = Math.max(salvage, cost - accumulated);
    return {
      method: 'straight_line',
      purchase_cost: cost,
      salvage_value: salvage,
      useful_life_months: lifeMonths,
      months_elapsed: monthsElapsed,
      monthly_rate: parseFloat(monthlyRate.toFixed(4)),
      accumulated_depreciation: parseFloat(accumulated.toFixed(2)),
      book_value: parseFloat(bookValue.toFixed(2)),
    };
  }

  if (asset.depreciation_method === 'declining_balance') {
    const rate = lifeMonths > 0 ? (2 / lifeMonths) : 0;
    let bookValue = cost;
    let accumulated = 0;
    for (let m = 0; m < Math.min(monthsElapsed, lifeMonths); m++) {
      const monthly = bookValue * (rate / 12);
      bookValue = Math.max(salvage, bookValue - monthly);
      accumulated = cost - bookValue;
    }
    return {
      method: 'declining_balance',
      purchase_cost: cost,
      salvage_value: salvage,
      useful_life_months: lifeMonths,
      months_elapsed: monthsElapsed,
      accumulated_depreciation: parseFloat(accumulated.toFixed(2)),
      book_value: parseFloat(bookValue.toFixed(2)),
    };
  }

  return { method: 'none', book_value: cost, accumulated_depreciation: 0, months_elapsed: monthsElapsed };
}

/**
 * Find assets below their reorder level (via inventory_items.reorder_level).
 */
async function getLowStockItems(orgId) {
  const [rows] = await db.query(
    `SELECT i.id AS item_id, i.name, i.sku, i.reorder_level,
            COALESCE(SUM(s.quantity), 0) AS total_stock
     FROM inventory_items i
     LEFT JOIN inventory_stock s ON s.item_id = i.id
       AND (? IS NULL OR s.organization_id = ?)
     WHERE i.deleted_at IS NULL
       AND (? IS NULL OR i.organization_id = ?)
       AND i.reorder_level > 0
     GROUP BY i.id, i.name, i.sku, i.reorder_level
     HAVING total_stock < i.reorder_level
     ORDER BY (i.reorder_level - total_stock) DESC`,
    [orgId, orgId, orgId, orgId],
  );
  return rows;
}

/**
 * Look up an asset by barcode payload.
 */
async function findByBarcode(orgId, barcode) {
  const [rows] = await db.query(
    `SELECT * FROM assets
     WHERE barcode = ?
       AND (? IS NULL OR organization_id = ?)
       AND deleted_at IS NULL
     LIMIT 1`,
    [barcode, orgId, orgId],
  );
  return rows[0] || null;
}

/**
 * Get aggregate asset stats for an org.
 */
async function getStats(orgId) {
  const [rows] = await db.query(
    `SELECT
       COUNT(*) AS total,
       SUM(lifecycle_status = 'in_stock') AS in_stock,
       SUM(lifecycle_status = 'assigned') AS assigned,
       SUM(lifecycle_status = 'deployed') AS deployed,
       SUM(lifecycle_status = 'maintenance') AS maintenance,
       SUM(lifecycle_status = 'rma') AS rma,
       SUM(lifecycle_status = 'disposed') AS disposed,
       SUM(warranty_expires_at IS NOT NULL AND warranty_expires_at < CURDATE()) AS warranty_expired,
       SUM(warranty_expires_at IS NOT NULL AND warranty_expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)) AS warranty_expiring_soon
     FROM assets
     WHERE deleted_at IS NULL
       AND (? IS NULL OR organization_id = ?)`,
    [orgId, orgId],
  );
  return rows[0];
}

module.exports = { generateBarcode, calculateDepreciation, getLowStockItems, findByBarcode, getStats };
