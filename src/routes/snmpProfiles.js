// =============================================================================
// FireISP 5.0 — SNMP Profile Routes
// =============================================================================

const { Router } = require('express');
const SnmpProfile = require('../models/SnmpProfile');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createSnmpProfile, updateSnmpProfile, createSnmpProfileOid } = require('../middleware/schemas/snmpProfiles');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(SnmpProfile);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('snmp_profiles.view'), ctrl.list);
router.get('/:id', requirePermission('snmp_profiles.view'), ctrl.get);
router.post('/', requirePermission('snmp_profiles.create'), validate(createSnmpProfile), ctrl.create);
router.put('/:id', requirePermission('snmp_profiles.update'), validate(updateSnmpProfile), ctrl.update);
router.delete('/:id', requirePermission('snmp_profiles.delete'), ctrl.destroy);

// Get OIDs for an SNMP profile
router.get('/:id/oids', requirePermission('snmp_profiles.view'), async (req, res, next) => {
  try {
    const oids = await SnmpProfile.getOids(req.params.id);
    res.json({ data: oids });
  } catch (err) {
    next(err);
  }
});

// Add an OID to an SNMP profile
router.post('/:id/oids', requirePermission('snmp_profiles.update'), validate(createSnmpProfileOid), async (req, res, next) => {
  try {
    const oid = await SnmpProfile.addOid({ profile_id: req.params.id, ...req.body });
    res.status(201).json({ data: oid });
  } catch (err) {
    next(err);
  }
});

// Delete an OID from an SNMP profile
router.delete('/:id/oids/:oidId', requirePermission('snmp_profiles.update'), async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM snmp_profile_oids WHERE id = ? AND profile_id = ?',
      [req.params.oidId, req.params.id],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
