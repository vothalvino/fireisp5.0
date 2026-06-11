// =============================================================================
// FireISP 5.0 — CPE Profile Routes (§8.2)
// =============================================================================
// Mounted at /api/v1/cpe-profiles
// =============================================================================

'use strict';

const { Router } = require('express');
const db = require('../config/database');
const CpeProfile = require('../models/CpeProfile');
const CpeParameterMapping = require('../models/CpeParameterMapping');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createCpeProfile, updateCpeProfile } = require('../middleware/schemas/cpeProfiles');
const {
  createCpeParameterMapping,
  updateCpeParameterMapping,
} = require('../middleware/schemas/cpeParameterMappings');
const cpeProfileService = require('../services/cpeProfileService');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

router.get('/', requirePermission('cpe_profiles.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const conditions = ['deleted_at IS NULL'];
    const params = [];
    if (req.orgId) {
      conditions.push('(organization_id = ? OR organization_id IS NULL)');
      params.push(req.orgId);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await db.query(
      `SELECT * FROM cpe_profiles ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM cpe_profiles ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('cpe_profiles.view'), async (req, res, next) => {
  try {
    const profile = await CpeProfile.findByIdOrFail(req.params.id);
    const chain = await cpeProfileService.resolveProfile(profile.id);
    const merged = cpeProfileService.mergeProfileParameters(chain);
    res.json({ data: { ...profile, resolved: merged, chain: chain.map(p => p.id) } });
  } catch (err) { next(err); }
});

router.post('/', requirePermission('cpe_profiles.create'), validate(createCpeProfile), async (req, res, next) => {
  try {
    const record = await CpeProfile.create({ ...req.body, organization_id: req.orgId });
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('cpe_profiles.update'), validate(updateCpeProfile), async (req, res, next) => {
  try {
    const record = await CpeProfile.update(req.params.id, req.body, req.orgId);
    res.json({ data: record });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('cpe_profiles.delete'), async (req, res, next) => {
  try {
    await CpeProfile.delete(req.params.id, req.orgId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Parameter mappings for a profile
// ---------------------------------------------------------------------------

router.get('/:id/mappings', requirePermission('cpe_mappings.view'), async (req, res, next) => {
  try {
    await CpeProfile.findByIdOrFail(req.params.id);
    const [rows] = await db.query(
      'SELECT * FROM cpe_parameter_mappings WHERE cpe_profile_id = ? ORDER BY id ASC',
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/mappings', requirePermission('cpe_mappings.create'), validate(createCpeParameterMapping), async (req, res, next) => {
  try {
    await CpeProfile.findByIdOrFail(req.params.id);
    const record = await CpeParameterMapping.create({
      ...req.body,
      organization_id: req.orgId,
      cpe_profile_id: parseInt(req.params.id, 10),
    });
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

router.put('/:id/mappings/:mappingId', requirePermission('cpe_mappings.update'), validate(updateCpeParameterMapping), async (req, res, next) => {
  try {
    await CpeProfile.findByIdOrFail(req.params.id);
    const record = await CpeParameterMapping.update(req.params.mappingId, req.body);
    res.json({ data: record });
  } catch (err) { next(err); }
});

router.delete('/:id/mappings/:mappingId', requirePermission('cpe_mappings.delete'), async (req, res, next) => {
  try {
    await CpeProfile.findByIdOrFail(req.params.id);
    await CpeParameterMapping.delete(req.params.mappingId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Resolve endpoint — merge inheritance + mappings for a given contract context
// ---------------------------------------------------------------------------

router.post('/:id/resolve', requirePermission('cpe_profiles.view'), async (req, res, next) => {
  try {
    const profile = await CpeProfile.findByIdOrFail(req.params.id);
    const chain = await cpeProfileService.resolveProfile(profile.id);
    const merged = cpeProfileService.mergeProfileParameters(chain);

    const { cpe_device, contract, plan } = req.body || {};
    const mappedParams = await cpeProfileService.resolveParameterMappings(
      cpe_device || {},
      contract || null,
      plan || null,
      profile,
    );

    // Merge mapping results into the parameters
    for (const { path, value } of mappedParams) {
      merged.parameters[path] = value;
    }

    res.json({ data: { merged, mappings: mappedParams } });
  } catch (err) { next(err); }
});

module.exports = router;
