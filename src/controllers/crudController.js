// =============================================================================
// FireISP 5.0 — CRUD Controller Factory
// =============================================================================
// Generates standard list/get/create/update/delete handlers for any model.
// Controllers can override or extend these defaults.
// =============================================================================

const auditLog = require('../services/auditLog');

/**
 * Create standard CRUD handlers for a model.
 * @param {typeof import('../models/BaseModel')} Model
 * @param {object} [options]
 * @param {string} [options.resourceName] - Name for error messages
 */
function crudController(Model, _options = {}) {

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
          data: rows,
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
        res.json({ data: record });
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

        const record = await Model.create(req.body);

        await auditLog.log({
          userId: req.user?.id,
          organizationId: req.orgId,
          action: 'create',
          tableName: Model.tableName,
          recordId: record.id,
          newValues: req.body,
        });

        res.status(201).json({ data: record });
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

        res.json({ data: record });
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

        res.json({ data: record });
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

        res.json({ data: record });
      } catch (err) {
        next(err);
      }
    },
  };
}

module.exports = { crudController };
