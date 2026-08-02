// =============================================================================
// FireISP 5.0 — Settings Routes
// =============================================================================
// Two scopes behind one surface (split by migration 443 — j56):
//
//   ORG rows      — per-organization values (organization_settings), editable
//                   by anyone holding settings.update in their org.
//   INSTALL rows  — deployment-wide values (settings), readable by every org
//                   but writable ONLY by the install operator (legacy
//                   users.role='admin', the same gate the version/update
//                   endpoints use — deliberately NOT a permission slug,
//                   because every org admin holds settings.update).
//
// Before the split, both routes read and wrote the install table while
// PRETENDING to be per-org: any tenant admin could redirect ops_alert_email
// (the install's infrastructure alerts) or repoint every tenant's map tiles,
// and the per-org response cache made a legitimate operator change take up to
// 10 minutes to reach other tenants. The cache is gone rather than re-keyed:
// settings reads are rare, and a stale security-relevant value is a worse
// trade than an extra SELECT.
//
// Keys are allowlisted via settingsCatalog — the old PUT upserted arbitrary
// keys, which is how the table accumulated 23 dead rows nothing ever read.
// =============================================================================

const { Router } = require('express');
const Organization = require('../models/Organization');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission, userHasPermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { updateSetting } = require('../middleware/schemas/settings');
const { INSTALL_SETTING_KEYS, ORG_SETTING_DEFS } = require('../services/settingsCatalog');
const { isInstallOperator, OPERATOR_ONLY_MESSAGE } = require('../services/installOperator');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// All settings visible to this caller: the org's own rows (catalog defaults
// filled in) plus the install-wide rows, each stamped with its scope and
// whether THIS caller may edit it — so the frontend never has to guess.
//
// `editable` is derived from the caller's REAL permissions, not assumed: this
// route only needs settings.view, so a readonly or billing user reaches it
// without settings.update. Hardcoding editable:true would give them an Edit
// button that 403s — the visible-but-forbidden action this codebase keeps
// re-growing.
router.get('/', requirePermission('settings.view'), async (req, res, next) => {
  try {
    const orgValues = await Organization.getOrgSettings(req.orgId);
    const installRows = await Organization.getInstallSettings();
    const canUpdate = await userHasPermission(req, 'settings.update');
    const operator = canUpdate && await isInstallOperator(req);
    const data = [
      ...Object.entries(ORG_SETTING_DEFS).map(([key, def]) => ({
        key,
        value: orgValues[key] ?? def.default,
        description: def.description,
        scope: 'org',
        editable: canUpdate,
      })),
      ...installRows.map((row) => ({
        key: row.setting_key,
        value: row.setting_value,
        description: row.description,
        scope: 'install',
        editable: operator,
      })),
    ];
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// Update a single setting by key — org keys for the caller's org, install
// keys for the operator only. Anything else is refused: an unknown key would
// silently become a dead row (the pre-443 failure mode).
router.put('/:key', requirePermission('settings.update'), validate(updateSetting), async (req, res, next) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    // The schema allows '' (blanking an install key is how you fall back to
    // its documented default — blank map_tile_url means OpenStreetMap, blank
    // ops_alert_email means notify every org admin), so `required` cannot do
    // this check; a missing value must still be a 422 rather than writing the
    // string "undefined".
    if (typeof value !== 'string') {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'value is required' },
      });
    }

    // Object.hasOwn, not a bare lookup: `constructor`/`toString` are truthy on
    // any plain object, so ORG_SETTING_DEFS['constructor'] would sail past the
    // guard and then 500 on def.validate.
    const def = Object.hasOwn(ORG_SETTING_DEFS, key) ? ORG_SETTING_DEFS[key] : null;
    if (def) {
      const problem = def.validate(value);
      if (problem) {
        return res.status(422).json({
          error: { code: 'INVALID_SETTING_VALUE', message: `${key} ${problem}` },
        });
      }
      await Organization.setOrgSetting(req.orgId, key, value);
      return res.json({ data: { key, value, scope: 'org' } });
    }

    if (INSTALL_SETTING_KEYS.includes(key)) {
      if (!await isInstallOperator(req)) {
        return res.status(403).json({
          error: { code: 'INSTALL_SETTING_OPERATOR_ONLY', message: OPERATOR_ONLY_MESSAGE },
        });
      }
      await Organization.setInstallSetting(key, value);
      return res.json({ data: { key, value, scope: 'install' } });
    }

    return res.status(422).json({
      error: { code: 'UNKNOWN_SETTING', message: `'${key}' is not a known setting.` },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
