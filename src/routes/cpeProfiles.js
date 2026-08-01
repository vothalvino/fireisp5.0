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
const { NotFoundError } = require('../utils/errors');

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

// Every handler below was missing its tenancy check entirely (j58):
//
//   * `CpeProfile.findByIdOrFail(req.params.id)` was called with NO orgId, so
//     BaseModel omitted the org predicate and a FOREIGN profile passed the
//     existence check that was supposed to authorise the rest of the handler.
//   * the mappings SELECT had no org predicate of its own;
//   * update/delete passed no orgId, so BaseModel emitted
//     `WHERE id = ?` alone — any tenant could rewrite or destroy any mapping
//     by guessing an id.
//
// TR-069 parameter mappings decide what gets provisioned onto a subscriber's
// CPE, so a cross-tenant write here is a configuration-integrity problem, not
// only a disclosure one.
//
// Belt and braces on purpose: the parent profile is verified against the org
// AND every mapping query is scoped again. The second check also fixes a
// smaller correctness bug — a mapping belonging to a DIFFERENT profile of the
// same org could be edited through the wrong URL.

/**
 * The mapping named in the URL, proven to belong to both the named profile and
 * the calling organization. 404 rather than 403: which mappings exist is
 * exactly what must not be confirmed.
 */
async function findMappingOrFail(req) {
  const [rows] = await db.query(
    `SELECT id FROM cpe_parameter_mappings
      WHERE id = ? AND cpe_profile_id = ?
        AND (organization_id = ? OR (? IS NULL AND organization_id IS NULL))
      LIMIT 1`,
    [req.params.mappingId, req.params.id, req.orgId, req.orgId],
  );
  if (!rows.length) throw new NotFoundError('CPE parameter mapping');
  return rows[0];
}

router.get('/:id/mappings', requirePermission('cpe_mappings.view'), async (req, res, next) => {
  try {
    await CpeProfile.findByIdOrFail(req.params.id, req.orgId);
    const [rows] = await db.query(
      `SELECT * FROM cpe_parameter_mappings
        WHERE cpe_profile_id = ?
          AND (organization_id = ? OR (? IS NULL AND organization_id IS NULL))
        ORDER BY id ASC`,
      [req.params.id, req.orgId, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/mappings', requirePermission('cpe_mappings.create'), validate(createCpeParameterMapping), async (req, res, next) => {
  try {
    await CpeProfile.findByIdOrFail(req.params.id, req.orgId);
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
    await CpeProfile.findByIdOrFail(req.params.id, req.orgId);
    await findMappingOrFail(req);
    const record = await CpeParameterMapping.update(req.params.mappingId, req.body, req.orgId);
    res.json({ data: record });
  } catch (err) { next(err); }
});

router.delete('/:id/mappings/:mappingId', requirePermission('cpe_mappings.delete'), async (req, res, next) => {
  try {
    await CpeProfile.findByIdOrFail(req.params.id, req.orgId);
    await findMappingOrFail(req);
    await CpeParameterMapping.delete(req.params.mappingId, req.orgId);
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
