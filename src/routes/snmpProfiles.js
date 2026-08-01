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
const { rejectOrgReassignment, adoptUnattributed } = require('../utils/orgAdoption');
const { AppError } = require('../utils/errors');

const router = Router();
const ctrl = crudController(SnmpProfile);

router.use(authenticate);
router.use(orgScope);

// A profile the tenant may SEE: its own, a system profile that ships with
// FireISP, or an unattributed legacy row. BaseModel cannot express this — with
// hasOrgScope true it emits a bare `organization_id = ?`, which would hide the
// whole vendor library and leave every install with an empty profile list.
const VISIBLE = '(p.organization_id = ? OR p.organization_id IS NULL)';

router.get('/', requirePermission('snmp_profiles.view'), async (req, res, next) => {
  try {
    const { manufacturer, device_type, status, page = 1, limit = 50 } = req.query;
    const where = [VISIBLE, 'p.deleted_at IS NULL'];
    const params = [req.orgId];
    if (manufacturer) { where.push('p.manufacturer = ?'); params.push(manufacturer); }
    if (device_type) { where.push('p.device_type = ?'); params.push(device_type); }
    if (status) { where.push('p.status = ?'); params.push(status); }

    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const clause = `WHERE ${where.join(' AND ')}`;

    // is_system tells the UI why a visible row cannot be edited, and
    // is_unattributed why one has no owner — same idea as #566 / #582 / #599.
    const [rows] = await db.query(
      `SELECT p.*, (p.organization_id IS NULL AND p.is_system = 0) AS is_unattributed
         FROM snmp_profiles p ${clause}
        ORDER BY p.is_system DESC, p.name ASC
        LIMIT ${safeLimit} OFFSET ${(safePage - 1) * safeLimit}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM snmp_profiles p ${clause}`, params,
    );
    res.json({
      data: rows,
      meta: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
    });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('snmp_profiles.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, (p.organization_id IS NULL AND p.is_system = 0) AS is_unattributed
         FROM snmp_profiles p WHERE p.id = ? AND ${VISIBLE} AND p.deleted_at IS NULL LIMIT 1`,
      [req.params.id, req.orgId],
    );
    if (!rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'SNMP profile not found' } });
    }
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * A system profile is product content, not customer data.
 *
 * It is visible to every tenant, so letting any one of them retune "MikroTik
 * RouterOS" would change what every OTHER tenant polls, and a delete would
 * break polling install-wide with no way back short of re-running the seed.
 * Locked for everyone — there is no per-tenant answer to "should this be
 * editable", so it is not a permission.
 *
 * A tenant that needs a variant creates its own; POST always writes
 * is_system = 0, because is_system is not in the model's fillable.
 */
async function rejectSystemProfile(req, res, next) {
  try {
    const [rows] = await db.query(
      'SELECT is_system FROM snmp_profiles WHERE id = ? LIMIT 1', [req.params.id],
    );
    if (rows[0] && Number(rows[0].is_system) === 1) {
      throw new AppError(
        'This profile ships with FireISP and cannot be changed. Create your own profile instead.',
        403,
        'SYSTEM_PROFILE_IMMUTABLE',
      );
    }
    next();
  } catch (err) { next(err); }
}

const rejectMove = rejectOrgReassignment('SNMP profile');
const adopt = adoptUnattributed('snmp_profiles', 'SNMP profile');

router.post('/', requirePermission('snmp_profiles.create'), validate(createSnmpProfile), ctrl.create);
router.put('/:id', requirePermission('snmp_profiles.update'), rejectSystemProfile, rejectMove, adopt, validate(updateSnmpProfile), ctrl.update);
router.delete('/:id', requirePermission('snmp_profiles.delete'), rejectSystemProfile, adopt, ctrl.destroy);
router.post('/:id/restore', requirePermission('snmp_profiles.update'), rejectSystemProfile, adopt, ctrl.restore);

// ---------------------------------------------------------------------------
// OIDs belonging to a profile
// ---------------------------------------------------------------------------
// These took req.params.id with NO ownership check of any kind, so a tenant
// could read any other tenant's OID list, and — worse — ADD to or DELETE from
// any profile including a SYSTEM one. That last part would have walked straight
// around the immutability lock above: you cannot edit "MikroTik RouterOS", but
// you could gut it by deleting its OIDs one at a time.
//
// Every handler now resolves the profile through the same visibility rules as
// the parent routes, and the write paths refuse system profiles for the same
// reason the parent PUT does.

/** 404s unless the profile is this tenant's, a system profile, or unattributed. */
async function requireVisibleProfile(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT id FROM snmp_profiles p
        WHERE p.id = ? AND ${VISIBLE} AND p.deleted_at IS NULL LIMIT 1`,
      [req.params.id, req.orgId],
    );
    if (!rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'SNMP profile not found' } });
    }
    next();
  } catch (err) { next(err); }
}

router.get('/:id/oids', requirePermission('snmp_profiles.view'), requireVisibleProfile, async (req, res, next) => {
  try {
    const oids = await SnmpProfile.getOids(req.params.id);
    res.json({ data: oids });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/oids', requirePermission('snmp_profiles.update'), requireVisibleProfile, rejectSystemProfile, validate(createSnmpProfileOid), async (req, res, next) => {
  try {
    const oid = await SnmpProfile.addOid({ profile_id: req.params.id, ...req.body });
    res.status(201).json({ data: oid });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/oids/:oidId', requirePermission('snmp_profiles.update'), requireVisibleProfile, rejectSystemProfile, async (req, res, next) => {
  try {
    await db.query(
      'UPDATE snmp_profile_oids SET deleted_at = NOW() WHERE id = ? AND profile_id = ? AND deleted_at IS NULL',
      [req.params.oidId, req.params.id],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
