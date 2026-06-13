// =============================================================================
// integrations.js — §20.2 Third-Party Integration Framework routes
//
// Endpoints:
//   GET    /integrations/providers               list available providers
//   GET    /integrations/providers/:id           get single provider
//   GET    /integrations/connections             list org connections
//   POST   /integrations/connections             create connection
//   GET    /integrations/connections/:id         get connection (no credentials)
//   PUT    /integrations/connections/:id         update connection
//   DELETE /integrations/connections/:id         delete connection
//   POST   /integrations/connections/:id/test    test connection (stubbed)
//   POST   /integrations/connections/:id/sync    trigger sync (stubbed)
//   GET    /integrations/connections/:id/logs    list sync logs
// =============================================================================

'use strict';

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const integrationService = require('../services/integrationService');
const { createConnectionSchema, updateConnectionSchema } = require('../middleware/schemas/integrations');

const router = Router();

// All routes require authentication and org scope
router.use(authenticate, orgScope);

// ---------------------------------------------------------------------------
// Providers — read-only catalog
// ---------------------------------------------------------------------------

// GET /integrations/providers
router.get(
  '/providers',
  requirePermission('integration_providers.view'),
  async (req, res, next) => {
    try {
      const { category } = req.query;
      const providers = await integrationService.listProviders({ category });
      res.json({ data: providers, total: providers.length });
    } catch (err) {
      next(err);
    }
  },
);

// GET /integrations/providers/:id
router.get(
  '/providers/:id',
  requirePermission('integration_providers.view'),
  async (req, res, next) => {
    try {
      const provider = await integrationService.getProvider(req.params.id);
      if (!provider) return res.status(404).json({ error: 'Provider not found' });
      res.json({ data: provider });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Connections — per-org configured instances
// ---------------------------------------------------------------------------

// GET /integrations/connections
router.get(
  '/connections',
  requirePermission('integration_connections.view'),
  async (req, res, next) => {
    try {
      const { provider_id, status, limit = 50, offset = 0 } = req.query;
      const connections = await integrationService.listConnections(
        req.organizationId,
        { providerId: provider_id, status },
      );
      // Apply simple pagination
      const total = connections.length;
      const page = connections.slice(Number(offset), Number(offset) + Number(limit));
      res.json({ data: page, total, limit: Number(limit), offset: Number(offset) });
    } catch (err) {
      next(err);
    }
  },
);

// POST /integrations/connections
router.post(
  '/connections',
  requirePermission('integration_connections.create'),
  validate(createConnectionSchema),
  async (req, res, next) => {
    try {
      const connection = await integrationService.createConnection(
        req.organizationId,
        req.user.id,
        req.body,
      );
      res.status(201).json({ data: connection });
    } catch (err) {
      next(err);
    }
  },
);

// GET /integrations/connections/:id
router.get(
  '/connections/:id',
  requirePermission('integration_connections.view'),
  async (req, res, next) => {
    try {
      const connection = await integrationService.getConnection(
        req.params.id,
        req.organizationId,
      );
      if (!connection) return res.status(404).json({ error: 'Connection not found' });
      res.json({ data: connection });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /integrations/connections/:id
router.put(
  '/connections/:id',
  requirePermission('integration_connections.update'),
  validate(updateConnectionSchema),
  async (req, res, next) => {
    try {
      const connection = await integrationService.updateConnection(
        req.params.id,
        req.organizationId,
        req.body,
      );
      res.json({ data: connection });
    } catch (err) {
      if (err.statusCode === 404) return res.status(404).json({ error: err.message });
      next(err);
    }
  },
);

// DELETE /integrations/connections/:id
router.delete(
  '/connections/:id',
  requirePermission('integration_connections.delete'),
  async (req, res, next) => {
    try {
      await integrationService.deleteConnection(req.params.id, req.organizationId);
      res.status(204).send();
    } catch (err) {
      if (err.statusCode === 404) return res.status(404).json({ error: err.message });
      next(err);
    }
  },
);

// POST /integrations/connections/:id/test
router.post(
  '/connections/:id/test',
  requirePermission('integration_connections.test'),
  async (req, res, next) => {
    try {
      const result = await integrationService.testConnection(
        req.params.id,
        req.organizationId,
      );
      res.json({ data: result });
    } catch (err) {
      if (err.statusCode === 404) return res.status(404).json({ error: err.message });
      if (err.statusCode === 422) return res.status(422).json({ error: err.message });
      next(err);
    }
  },
);

// POST /integrations/connections/:id/sync
router.post(
  '/connections/:id/sync',
  requirePermission('integration_connections.sync'),
  async (req, res, next) => {
    try {
      const { direction } = req.body || {};
      const result = await integrationService.sync(
        req.params.id,
        req.organizationId,
        direction || 'bidirectional',
      );
      res.json({ data: result });
    } catch (err) {
      if (err.statusCode === 404) return res.status(404).json({ error: err.message });
      if (err.statusCode === 422) return res.status(422).json({ error: err.message });
      next(err);
    }
  },
);

// GET /integrations/connections/:id/logs
router.get(
  '/connections/:id/logs',
  requirePermission('integration_sync_logs.view'),
  async (req, res, next) => {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const result = await integrationService.listSyncLogs(
        req.params.id,
        req.organizationId,
        { limit: Number(limit), offset: Number(offset) },
      );
      res.json({ data: result.rows, total: result.total, limit: Number(limit), offset: Number(offset) });
    } catch (err) {
      if (err.statusCode === 404) return res.status(404).json({ error: err.message });
      next(err);
    }
  },
);

module.exports = router;
