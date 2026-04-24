// =============================================================================
// FireISP 5.0 — Quota Service
// =============================================================================
// Provides per-tenant resource quota enforcement.
// Supported resources: 'clients', 'devices', 'storage_mb', 'scheduled_tasks'
// =============================================================================

const db = require('../config/database');
const OrganizationQuota = require('../models/OrganizationQuota');
const { ValidationError } = require('../utils/errors');

/**
 * Returns the configured quota limits for an organization.
 * Any NULL limit means "unlimited".
 *
 * @param {number} orgId
 * @returns {Promise<{max_clients, max_devices, max_storage_mb, max_scheduled_tasks}>}
 */
async function getQuota(orgId) {
  return OrganizationQuota.findByOrgId(orgId);
}

/**
 * Counts current resource usage for an organization.
 *
 * Storage is computed as the sum of `file_size` across all files owned by the
 * org — either directly (entity_type = 'organization') or transitively through
 * clients, devices, and tickets that belong to the org.
 *
 * @param {number} orgId
 * @returns {Promise<{clients, devices, storage_mb, scheduled_tasks}>}
 */
async function getUsage(orgId) {
  const [[clientRow], [deviceRow], [taskRow], [storageRow]] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS cnt FROM clients WHERE organization_id = ? AND deleted_at IS NULL`,
      [orgId],
    ),
    db.query(
      `SELECT COUNT(*) AS cnt FROM devices WHERE organization_id = ? AND deleted_at IS NULL`,
      [orgId],
    ),
    db.query(
      `SELECT COUNT(*) AS cnt FROM scheduled_tasks WHERE organization_id = ? AND deleted_at IS NULL`,
      [orgId],
    ),
    db.query(
      `SELECT COALESCE(SUM(f.file_size), 0) AS total_bytes
       FROM files f
       WHERE f.deleted_at IS NULL
         AND (
               (f.entity_type = 'organization' AND f.entity_id = ?)
            OR (f.entity_type = 'client'       AND f.entity_id IN (SELECT id FROM clients WHERE organization_id = ? AND deleted_at IS NULL))
            OR (f.entity_type = 'device'       AND f.entity_id IN (SELECT id FROM devices WHERE organization_id = ? AND deleted_at IS NULL))
            OR (f.entity_type = 'ticket'       AND f.entity_id IN (SELECT id FROM tickets WHERE organization_id = ? AND deleted_at IS NULL))
         )`,
      [orgId, orgId, orgId, orgId],
    ),
  ]);

  return {
    clients: clientRow[0].cnt,
    devices: deviceRow[0].cnt,
    storage_mb: Math.ceil(storageRow[0].total_bytes / (1024 * 1024)),
    scheduled_tasks: taskRow[0].cnt,
  };
}

/**
 * Returns quota limits plus current usage in a single object.
 *
 * @param {number} orgId
 * @returns {Promise<{limits, usage}>}
 */
async function getQuotaWithUsage(orgId) {
  const [limits, usage] = await Promise.all([getQuota(orgId), getUsage(orgId)]);
  return { limits, usage };
}

/**
 * Throws a ValidationError if the given resource is at or over its quota.
 * Silently succeeds if no quota row exists or the limit is NULL (unlimited).
 *
 * @param {number} orgId
 * @param {'clients'|'devices'|'storage_mb'|'scheduled_tasks'} resource
 */
async function checkQuota(orgId, resource) {
  const limitKey = `max_${resource}`;
  const quota = await getQuota(orgId);
  const limit = quota[limitKey];
  if (limit === null || limit === undefined) return; // unlimited

  const usage = await getUsage(orgId);
  const current = usage[resource];
  if (current >= limit) {
    const labels = {
      clients: 'client',
      devices: 'device',
      storage_mb: 'storage',
      scheduled_tasks: 'scheduled task',
    };
    throw new ValidationError(
      `Tenant quota exceeded: maximum ${limit} ${labels[resource] ?? resource}${limit === 1 ? '' : 's'} allowed (current: ${current})`,
    );
  }
}

module.exports = { getQuota, getUsage, getQuotaWithUsage, checkQuota };
