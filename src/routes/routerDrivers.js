// =============================================================================
// FireISP 5.0 — Router Driver Routes (§18.3)
// =============================================================================
// MikroTik driver: live via routerosService.
// Other vendors: STUBBED (no live SSH/NETCONF/REST call).
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const db = require('../config/database');
const routerDriverService = require('../services/routerDriverService');

const createDriverSchema = {
  vendor:       { type: 'string', required: true, enum: ['mikrotik','cisco_ios','cisco_iosxe','juniper_junos','zte','huawei','generic_rest'] },
  protocol:     { type: 'string', enum: ['routeros_api','ssh','restconf','netconf','rest','tl1'] },
  host:         { type: 'string', max: 253 },
  port:         { type: 'number', min: 1, max: 65535 },
  username:     { type: 'string', max: 255 },
  password:     { type: 'string', max: 1000 },
  api_token:    { type: 'string', max: 1000 },
  device_id:    { type: 'number' },
  ssl_enabled:  { type: 'boolean' },
  ssl_verify:   { type: 'boolean' },
  timeout_ms:   { type: 'number', min: 1000, max: 60000 },
  extra_params: { type: 'object' },
};

const updateDriverSchema = {
  vendor:       { type: 'string', enum: ['mikrotik','cisco_ios','cisco_iosxe','juniper_junos','zte','huawei','generic_rest'] },
  protocol:     { type: 'string', enum: ['routeros_api','ssh','restconf','netconf','rest','tl1'] },
  host:         { type: 'string', max: 253 },
  port:         { type: 'number', min: 1, max: 65535 },
  username:     { type: 'string', max: 255 },
  password:     { type: 'string', max: 1000 },
  api_token:    { type: 'string', max: 1000 },
  ssl_enabled:  { type: 'boolean' },
  ssl_verify:   { type: 'boolean' },
  timeout_ms:   { type: 'number', min: 1000, max: 60000 },
  extra_params: { type: 'object' },
  is_active:    { type: 'boolean' },
};

const dispatchCommandSchema = {
  command: { type: 'string', required: true, min: 1, max: 500 },
  params:  { type: 'object' },
};

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /router-drivers
router.get('/', requirePermission('router_driver_configs.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, vendor, is_active } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = ['organization_id = ? AND deleted_at IS NULL'];
    const params = [req.orgId];
    if (vendor)    { conditions.push('vendor = ?');    params.push(vendor); }
    if (is_active !== undefined) { conditions.push('is_active = ?'); params.push(is_active === 'true' ? 1 : 0); }

    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT id, organization_id, device_id, vendor, protocol, host, port, username,
              ssl_enabled, ssl_verify, timeout_ms, extra_params, is_active,
              has_password, last_tested_at, last_test_status, created_at, updated_at
       FROM (
         SELECT *, (encrypted_password IS NOT NULL) AS has_password,
                   (api_token IS NOT NULL) AS has_api_token
         FROM router_driver_configs WHERE ${where}
       ) t ORDER BY vendor ASC, host ASC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset],
    );
    const sanitized = rows.map(r => routerDriverService.sanitizeConfig(r));
    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM router_driver_configs WHERE ${where}`, params);
    res.json({ data: sanitized, meta: { total: countResult[0].total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

// GET /router-drivers/:id
router.get('/:id', requirePermission('router_driver_configs.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM router_driver_configs WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Router driver config not found' } });
    res.json({ data: routerDriverService.sanitizeConfig(rows[0]) });
  } catch (err) { next(err); }
});

// POST /router-drivers
router.post('/', requirePermission('router_driver_configs.create'), validate(createDriverSchema), async (req, res, next) => {
  try {
    const config = await routerDriverService.createDriverConfig(req.orgId, req.body, req.user.id);
    res.status(201).json({ data: config });
  } catch (err) { next(err); }
});

// PUT /router-drivers/:id
router.put('/:id', requirePermission('router_driver_configs.update'), validate(updateDriverSchema), async (req, res, next) => {
  try {
    const config = await routerDriverService.updateDriverConfig(req.params.id, req.orgId, req.body);
    if (!config) return res.status(404).json({ error: { message: 'Router driver config not found' } });
    res.json({ data: config });
  } catch (err) { next(err); }
});

// DELETE /router-drivers/:id
router.delete('/:id', requirePermission('router_driver_configs.delete'), async (req, res, next) => {
  try {
    const [existing] = await db.query(
      'SELECT id FROM router_driver_configs WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { message: 'Router driver config not found' } });
    await db.query('UPDATE router_driver_configs SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /router-drivers/:id/test
router.post('/:id/test', requirePermission('router_driver_configs.view'), async (req, res, next) => {
  try {
    const result = await routerDriverService.testDriverConnection(req.params.id, req.orgId);
    if (!result) return res.status(404).json({ error: { message: 'Router driver config not found' } });
    // Non-implemented vendors return not_implemented — surface as 501 so clients know the test did not run
    if (result.status === 'not_implemented') {
      return res.status(501).json({ error: { message: result.message }, data: result });
    }
    res.json({ data: result });
  } catch (err) { next(err); }
});

// POST /router-drivers/:id/dispatch — send a command
router.post('/:id/dispatch', requirePermission('device_command_executions.execute'), validate(dispatchCommandSchema), async (req, res, next) => {
  try {
    const result = await routerDriverService.dispatchCommand(
      req.params.id, req.orgId, req.body.command, req.body.params || {}, req.user.id,
    );
    if (!result) return res.status(404).json({ error: { message: 'Router driver config not found' } });
    // Surface non-implemented vendor dispatch honestly — never return 200 for an unexecuted command
    if (result.status === 'not_dispatched') {
      return res.status(501).json({
        error: { message: result.error_message, dispatched: false, vendor: result.vendor },
        data: result,
      });
    }
    res.json({ data: result });
  } catch (err) { next(err); }
});

// GET /router-drivers/command-executions — list command executions
router.get('/command-executions/list', requirePermission('device_command_executions.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, vendor, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = ['organization_id = ?'];
    const params = [req.orgId];
    if (vendor) { conditions.push('vendor = ?'); params.push(vendor); }
    if (status) { conditions.push('status = ?'); params.push(status); }

    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT * FROM device_command_executions WHERE ${where} ORDER BY executed_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset],
    );
    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM device_command_executions WHERE ${where}`, params);
    res.json({ data: rows, meta: { total: countResult[0].total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

module.exports = router;
