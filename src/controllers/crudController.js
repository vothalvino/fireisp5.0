// =============================================================================
// FireISP 5.0 — CRUD Controller Factory
// =============================================================================
// Generates standard list/get/create/update/delete handlers for any model.
// Controllers can override or extend these defaults.
// =============================================================================

const auditLog = require('../services/auditLog');
const { bustCache } = require('../middleware/httpCache');
const logger = require('../utils/logger').child({ service: 'crudController' });

/**
 * Create standard CRUD handlers for a model.
 * @param {typeof import('../models/BaseModel')} Model
 * @param {object} [options]
 * @param {string} [options.resourceName] - Name for error messages
 * @param {string} [options.cacheResource] - Cache resource name to bust on mutations
 */
function crudController(Model, _options = {}) {
  const { cacheResource } = _options;
  // Optional response serializer — lets a resource strip sensitive columns
  // (e.g. User.sanitize) from every record before it is returned.  Defaults to
  // identity so existing resources are unaffected.
  const serialize = typeof _options.serialize === 'function' ? _options.serialize : (x) => x;
  // Optional create override — lets a resource customise the insert (e.g. Nas
  // restore-on-create by IP) while keeping org-injection, audit-log, cache-bust
  // and serialize behaviour identical. Defaults to a plain Model.create.
  const createFn = typeof _options.createImpl === 'function'
    ? _options.createImpl
    : (data) => Model.create(data);
  // Optional post-create hook — called after the create succeeds. NEVER allowed
  // to fail the create response; errors are caught and logged. Receives
  // (record, req). Useful for side-effects like WireGuard provisioning.
  const afterCreateHook = typeof _options.afterCreate === 'function' ? _options.afterCreate : null;
  // Optional post-delete hook — called after the delete succeeds with the record
  // as it was BEFORE deletion (and req). NEVER allowed to fail the delete
  // response; errors are caught and logged. Useful for teardown side-effects
  // (e.g. revoking a deleted user's WireGuard peers).
  const afterDeleteHook = typeof _options.afterDelete === 'function' ? _options.afterDelete : null;
  // Optional post-restore hook — called after a soft-deleted record is restored,
  // with the restored record (and req). NEVER allowed to fail the restore
  // response; errors are caught and logged. The inverse of afterDelete (e.g.
  // reviving a NAS's WireGuard tunnel that teardown soft-deleted).
  const afterRestoreHook = typeof _options.afterRestore === 'function' ? _options.afterRestore : null;

  return {
    /**
     * GET / — List with pagination
     */
    async list(req, res, next) {
      try {
        const { page = 1, limit = 50, order_by, order, include_deleted, ...filters } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const withDeleted = include_deleted === 'true';

        const [rows, total] = await Promise.all([
          Model.findAll({
            where: filters,
            orderBy: order_by || 'id',
            order: order || 'ASC',
            limit: Math.min(parseInt(limit), 100),
            offset,
            orgId: req.orgId,
            withDeleted,
          }),
          Model.count({ where: filters, orgId: req.orgId, withDeleted }),
        ]);

        res.json({
          data: Array.isArray(rows) ? rows.map(serialize) : rows,
          meta: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        });
      } catch (err) {
        next(err);
      }
    },

    /**
     * GET /:id — Get by ID
     */
    async get(req, res, next) {
      try {
        const record = await Model.findByIdOrFail(req.params.id, req.orgId);
        res.json({ data: serialize(record) });
      } catch (err) {
        next(err);
      }
    },

    /**
     * POST / — Create
     */
    async create(req, res, next) {
      try {
        // Auto-inject organization_id if the model supports it
        if (Model.hasOrgScope && req.orgId) {
          req.body.organization_id = req.orgId;
        }

        const record = await createFn(req.body);

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: 'create',
          tableName: Model.tableName,
          recordId: record.id,
          newValues: req.body,
        });

        if (cacheResource) await bustCache(req.orgId, cacheResource);

        // Run the optional post-create hook. Wrapped in try/catch so it can
        // NEVER fail the create response — side-effect errors are advisory.
        if (afterCreateHook) {
          try {
            await afterCreateHook(record, req);
          } catch (hookErr) {
            logger.warn(
              { err: hookErr.message, recordId: record.id, table: Model.tableName },
              'crudController afterCreate hook failed (non-fatal)',
            );
          }
        }

        res.status(201).json({ data: serialize(record) });
      } catch (err) {
        next(err);
      }
    },

    /**
     * PUT /:id — Update
     */
    async update(req, res, next) {
      try {
        const old = await Model.findByIdOrFail(req.params.id, req.orgId);
        const record = await Model.update(req.params.id, req.body, req.orgId);

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: 'update',
          tableName: Model.tableName,
          recordId: record.id,
          oldValues: old,
          newValues: req.body,
        });

        if (cacheResource) await bustCache(req.orgId, cacheResource);
        res.json({ data: serialize(record) });
      } catch (err) {
        next(err);
      }
    },

    /**
     * PATCH /:id — Partial update
     */
    async partialUpdate(req, res, next) {
      try {
        const old = await Model.findByIdOrFail(req.params.id, req.orgId);
        const record = await Model.update(req.params.id, req.body, req.orgId);

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: 'partial_update',
          tableName: Model.tableName,
          recordId: record.id,
          oldValues: old,
          newValues: req.body,
        });

        if (cacheResource) await bustCache(req.orgId, cacheResource);
        res.json({ data: serialize(record) });
      } catch (err) {
        next(err);
      }
    },

    /**
     * DELETE /:id — Soft-delete (archive) or hard-delete depending on model
     */
    async destroy(req, res, next) {
      try {
        const old = await Model.findByIdOrFail(req.params.id, req.orgId);
        await Model.delete(req.params.id, req.orgId);

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: Model.softDelete ? 'soft_delete' : 'delete',
          tableName: Model.tableName,
          recordId: parseInt(req.params.id),
          oldValues: old,
        });

        if (cacheResource) await bustCache(req.orgId, cacheResource);

        // Run the optional post-delete hook with the pre-delete record. Wrapped
        // in try/catch so it can NEVER fail the delete response — teardown
        // side-effect errors are advisory.
        if (afterDeleteHook) {
          try {
            await afterDeleteHook(old, req);
          } catch (hookErr) {
            logger.warn(
              { err: hookErr.message, recordId: old.id, table: Model.tableName },
              'crudController afterDelete hook failed (non-fatal)',
            );
          }
        }

        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },

    /**
     * POST /:id/restore — Restore a soft-deleted record
     */
    async restore(req, res, next) {
      try {
        const record = await Model.restore(req.params.id, req.orgId);

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: 'restore',
          tableName: Model.tableName,
          recordId: record.id,
        });

        if (cacheResource) await bustCache(req.orgId, cacheResource);

        // Run the optional post-restore hook with the restored record. Wrapped
        // in try/catch so it can NEVER fail the restore response — side-effect
        // errors are advisory (mirrors afterCreate/afterDelete).
        if (afterRestoreHook) {
          try {
            await afterRestoreHook(record, req);
          } catch (hookErr) {
            logger.warn(
              { err: hookErr.message, recordId: record.id, table: Model.tableName },
              'crudController afterRestore hook failed (non-fatal)',
            );
          }
        }

        res.json({ data: serialize(record) });
      } catch (err) {
        next(err);
      }
    },
  };
}

module.exports = { crudController };
