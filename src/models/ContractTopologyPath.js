// =============================================================================
// FireISP 5.0 — ContractTopologyPath Model
// =============================================================================
// Cache table for the computed network topology path from a contract's CPE up
// to the edge/core device. Built and invalidated by topologyContextService.js.
// =============================================================================

const BaseModel = require('./BaseModel');

class ContractTopologyPath extends BaseModel {
  static get tableName() { return 'contract_topology_paths'; }

  static get fillable() {
    return [
      'contract_id',
      'path',
      'computed_at',
    ];
  }

  // Not org-scoped — keyed by contract_id; org scoping is done via contract.
  static get hasOrgScope() { return false; }

  /**
   * Find cached path by contract ID.
   * @param {number} contractId
   * @returns {Promise<object|null>}
   */
  static async findByContractId(contractId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM contract_topology_paths WHERE contract_id = ?',
      [contractId],
    );
    return rows[0] || null;
  }

  /**
   * Upsert a topology path for a contract.
   * @param {number} contractId
   * @param {Array}  path  Ordered [{device_id, role, link_id, medium}]
   * @returns {Promise<object>}
   */
  static async upsertPath(contractId, path) {
    const db = require('../config/database');
    const pathJson = JSON.stringify(path);
    await db.query(
      `INSERT INTO contract_topology_paths (contract_id, path, computed_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE path = VALUES(path), computed_at = NOW()`,
      [contractId, pathJson],
    );
    return this.findByContractId(contractId);
  }

  /**
   * Delete the cached path for a contract (forces rebuild on next getPath).
   * @param {number} contractId
   * @returns {Promise<void>}
   */
  static async invalidate(contractId) {
    const db = require('../config/database');
    await db.query(
      'DELETE FROM contract_topology_paths WHERE contract_id = ?',
      [contractId],
    );
  }

  /**
   * Delete all cached paths for every contract associated with a device.
   * Called when a device is modified.
   * @param {number} deviceId
   * @returns {Promise<void>}
   */
  static async invalidateByDevice(deviceId) {
    const db = require('../config/database');
    // Invalidate paths whose JSON path array references this device_id.
    // We also cover the contract that has this device as its CPE.
    await db.query(
      `DELETE ctp FROM contract_topology_paths ctp
       JOIN contracts c ON c.id = ctp.contract_id
       JOIN devices d ON d.contract_id = c.id
       WHERE d.id = ?`,
      [deviceId],
    );
    // Also invalidate any path that references this device inside the JSON
    // (the device may be a hop, not only the CPE).
    //
    // NOTE: JSON_SEARCH does not use a B-tree index on the `path` column.
    // This is acceptable because: (a) invalidation is infrequent (topology
    // changes), (b) the table is bounded per org to O(active contracts), and
    // (c) adding a generated + indexed column would require MySQL 5.7.8+
    // and complicates the schema.  If this becomes a hot path, introduce a
    // separate `contract_topology_path_devices` junction table.
    await db.query(
      `DELETE FROM contract_topology_paths
       WHERE JSON_SEARCH(path, 'one', CAST(? AS CHAR), NULL, '$[*].device_id') IS NOT NULL`,
      [deviceId],
    );
  }

  /**
   * Delete all cached paths for contracts connected via a given network link.
   * Called when a network link is modified.
   * @param {number} linkId
   * @returns {Promise<void>}
   */
  static async invalidateByLink(linkId) {
    const db = require('../config/database');
    await db.query(
      `DELETE FROM contract_topology_paths
       WHERE JSON_SEARCH(path, 'one', CAST(? AS CHAR), NULL, '$[*].link_id') IS NOT NULL`,
      [linkId],
    );
  }
}

module.exports = ContractTopologyPath;
