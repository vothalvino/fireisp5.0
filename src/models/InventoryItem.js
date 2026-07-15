// =============================================================================
// FireISP 5.0 — Inventory Item Model
// =============================================================================

const BaseModel = require('./BaseModel');

class InventoryItem extends BaseModel {
  static get tableName() { return 'inventory_items'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'sku', 'category', 'serial_required', 'manufacturer', 'model',
      'description', 'unit', 'unit_cost', 'sale_price', 'reorder_level', 'notes', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Get stock levels for this item across all warehouses.
   */
  static async getStock(itemId) {
    const db = require('../config/database');
    const [rows] = await db.query(`
      SELECT s.*, w.name AS warehouse_name
      FROM inventory_stock s
      JOIN warehouses w ON w.id = s.warehouse_id
      WHERE s.item_id = ?
      ORDER BY w.name
    `, [itemId]);
    return rows;
  }

  /**
   * List items enriched with `quantity_on_hand` — the SUM of this item's
   * stock across every warehouse, via a single grouped LEFT JOIN (no N+1).
   * Mirrors BaseModel.findAll's filter/sort/pagination contract exactly
   * (same fillable-column filter whitelist, same soft-delete/org-scope
   * handling, same LIMIT/OFFSET literal-interpolation safety — see that
   * method's comment for why) so `GET /inventory/items`
   * (src/routes/inventory.js) can hand-roll its list handler around this
   * instead of the generic crudController — which has no way to express a
   * JOIN+GROUP BY — while returning a response byte-identical in shape to
   * every other crudController-backed list, plus the new field. This is also
   * what makes the invoice/quote product picker's on-hand quantity and the
   * InventoryManagement Stock tab's `quantity_on_hand` column (previously
   * always "—" — the field was never in the response before) real.
   *
   * Table/column names are hardcoded literals (not `this.tableName`) since
   * this method only ever serves InventoryItem — see Plan.getAddons for the
   * same aggregation pattern (this table's Phase 2 sibling).
   */
  static async findAllWithStock({ where = {}, orderBy = 'id', order = 'ASC', limit = 50, offset = 0, orgId = null, withDeleted = false, onlyDeleted = false } = {}) {
    if (onlyDeleted && !this.softDelete) return [];

    const conditions = [];
    const params = [];

    if (orgId !== null && this.hasOrgScope) {
      conditions.push('i.organization_id = ?');
      params.push(orgId);
    }

    if (this.softDelete && onlyDeleted) {
      conditions.push('i.deleted_at IS NOT NULL');
    } else if (this.softDelete && !withDeleted) {
      conditions.push('i.deleted_at IS NULL');
    }

    for (const [col, val] of Object.entries(where)) {
      if (this.fillable.includes(col) || col === 'id' || col === 'status' || col === 'organization_id') {
        conditions.push(`i.\`${col}\` = ?`);
        params.push(val);
      }
    }

    const safeOrderBy = this.sortable.includes(orderBy) ? orderBy : 'id';
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT i.*, COALESCE(SUM(s.quantity), 0) AS quantity_on_hand
       FROM inventory_items i
       LEFT JOIN inventory_stock s ON s.item_id = i.id AND s.deleted_at IS NULL
       ${whereClause}
       GROUP BY i.id
       ORDER BY i.\`${safeOrderBy}\` ${order === 'DESC' ? 'DESC' : 'ASC'}
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    return rows;
  }
}

module.exports = InventoryItem;
