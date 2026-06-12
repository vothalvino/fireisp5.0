// =============================================================================
// FireISP 5.0 — Traffic Engineering Routes (§10.4)
// =============================================================================
// Covers: interface QoS policies, MPLS/VLAN prioritization rules,
//         DSCP marking policies (+ config export).
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createInterfaceQosPolicy, updateInterfaceQosPolicy } = require('../middleware/schemas/interfaceQosPolicies');
const { createMplsVlanRule, updateMplsVlanRule } = require('../middleware/schemas/mplsVlanPrioritization');
const { createDscpMarkingPolicy, updateDscpMarkingPolicy } = require('../middleware/schemas/dscpMarkingPolicies');
const { exportDscpConfig } = require('../services/qosService');
const db = require('../config/database');

const router = Router();

router.use(['/interface-qos-policies', '/mpls-vlan-prioritization', '/dscp-marking-policies'], authenticate, orgScope);

// ---------------------------------------------------------------------------
// Helper: generic soft-delete CRUD factory
// ---------------------------------------------------------------------------

function teController(tableName) {
  return {
    async list(req, res, next) {
      try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
        const offset = (page - 1) * limit;

        const [[{ total }]] = await db.query(
          `SELECT COUNT(*) AS total FROM ${tableName}
           WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL`,
          [req.orgId],
        );
        const [rows] = await db.query(
          `SELECT * FROM ${tableName}
           WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL
           ORDER BY id ASC
           LIMIT ? OFFSET ?`,
          [req.orgId, limit, offset],
        );
        res.json({ data: rows, meta: { total, page, limit } });
      } catch (err) {
        next(err);
      }
    },

    async get(req, res, next) {
      try {
        const [[row]] = await db.query(
          `SELECT * FROM ${tableName}
           WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL`,
          [req.params.id, req.orgId],
        );
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json({ data: row });
      } catch (err) {
        next(err);
      }
    },

    async create(req, res, next) {
      try {
        const body = { ...req.body, organization_id: req.orgId };
        const cols = Object.keys(body).join(', ');
        const placeholders = Object.keys(body).map(() => '?').join(', ');
        const [result] = await db.query(
          `INSERT INTO ${tableName} (${cols}) VALUES (${placeholders})`,
          Object.values(body),
        );
        const [[row]] = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [result.insertId]);
        res.status(201).json({ data: row });
      } catch (err) {
        next(err);
      }
    },

    async update(req, res, next) {
      try {
        const [[existing]] = await db.query(
          `SELECT * FROM ${tableName}
           WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
          [req.params.id, req.orgId],
        );
        if (!existing) return res.status(404).json({ error: 'Not found' });

        const sets = Object.keys(req.body).map(k => `${k} = ?`).join(', ');
        await db.query(
          `UPDATE ${tableName} SET ${sets} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
          [...Object.values(req.body), req.params.id, req.orgId],
        );
        const [[row]] = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [req.params.id]);
        res.json({ data: row });
      } catch (err) {
        next(err);
      }
    },

    async destroy(req, res, next) {
      try {
        await db.query(
          `UPDATE ${tableName} SET deleted_at = NOW()
           WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
          [req.params.id, req.orgId],
        );
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },

    async restore(req, res, next) {
      try {
        await db.query(
          `UPDATE ${tableName} SET deleted_at = NULL WHERE id = ? AND organization_id = ?`,
          [req.params.id, req.orgId],
        );
        const [[row]] = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [req.params.id]);
        res.json({ data: row });
      } catch (err) {
        next(err);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Interface QoS Policies
// ---------------------------------------------------------------------------

const iqpCtrl = teController('interface_qos_policies');

router.get('/interface-qos-policies',         requirePermission('interface_qos_policies.view'),   iqpCtrl.list);
router.get('/interface-qos-policies/:id',      requirePermission('interface_qos_policies.view'),   iqpCtrl.get);
router.post('/interface-qos-policies',         requirePermission('interface_qos_policies.create'), validate(createInterfaceQosPolicy), iqpCtrl.create);
router.put('/interface-qos-policies/:id',      requirePermission('interface_qos_policies.update'), validate(updateInterfaceQosPolicy), iqpCtrl.update);
router.delete('/interface-qos-policies/:id',   requirePermission('interface_qos_policies.delete'), iqpCtrl.destroy);
router.post('/interface-qos-policies/:id/restore', requirePermission('interface_qos_policies.update'), iqpCtrl.restore);

// ---------------------------------------------------------------------------
// MPLS / VLAN Prioritization Rules
// ---------------------------------------------------------------------------

const mplsCtrl = teController('mpls_vlan_prioritization_rules');

router.get('/mpls-vlan-prioritization',         requirePermission('mpls_vlan_prioritization.view'),   mplsCtrl.list);
router.get('/mpls-vlan-prioritization/:id',      requirePermission('mpls_vlan_prioritization.view'),   mplsCtrl.get);
router.post('/mpls-vlan-prioritization',         requirePermission('mpls_vlan_prioritization.create'), validate(createMplsVlanRule), mplsCtrl.create);
router.put('/mpls-vlan-prioritization/:id',      requirePermission('mpls_vlan_prioritization.update'), validate(updateMplsVlanRule), mplsCtrl.update);
router.delete('/mpls-vlan-prioritization/:id',   requirePermission('mpls_vlan_prioritization.delete'), mplsCtrl.destroy);
router.post('/mpls-vlan-prioritization/:id/restore', requirePermission('mpls_vlan_prioritization.update'), mplsCtrl.restore);

// ---------------------------------------------------------------------------
// DSCP Marking Policies
// ---------------------------------------------------------------------------

const dscpCtrl = teController('dscp_marking_policies');

// Export must come before /:id to avoid route shadowing
router.get('/dscp-marking-policies/export/config', requirePermission('dscp_marking_policies.view'), async (req, res, next) => {
  try {
    const format = req.query.format === 'text' ? 'text' : 'json';
    const result = await exportDscpConfig(req.orgId, format);
    if (format === 'text') {
      res.type('text/plain').send(result);
    } else {
      res.json({ data: result });
    }
  } catch (err) {
    next(err);
  }
});

router.get('/dscp-marking-policies',         requirePermission('dscp_marking_policies.view'),   dscpCtrl.list);
router.get('/dscp-marking-policies/:id',      requirePermission('dscp_marking_policies.view'),   dscpCtrl.get);
router.post('/dscp-marking-policies',         requirePermission('dscp_marking_policies.create'), validate(createDscpMarkingPolicy), dscpCtrl.create);
router.put('/dscp-marking-policies/:id',      requirePermission('dscp_marking_policies.update'), validate(updateDscpMarkingPolicy), dscpCtrl.update);
router.delete('/dscp-marking-policies/:id',   requirePermission('dscp_marking_policies.delete'), dscpCtrl.destroy);
router.post('/dscp-marking-policies/:id/restore', requirePermission('dscp_marking_policies.update'), dscpCtrl.restore);

module.exports = router;
