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
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { updateSetting } = require('../middleware/schemas/settings');
const { INSTALL_SETTING_KEYS, ORG_SETTING_DEFS } = require('../services/settingsCatalog');

const router = Router();

router.use(authenticate);
router.use(orgScope);

/** Legacy install-operator check — mirrors routes/systemVersion.js. */
const isInstallOperator = (req) => req.user?.role === 'admin';

// All settings visible to this caller: the org's own rows (catalog defaults
// filled in) plus the install-wide rows, each stamped with its scope and
// whether THIS caller may edit it — so the frontend never has to guess.
router.get('/', requirePermission('settings.view'), async (req, res, next) => {
  try {
    const orgValues = await Organization.getOrgSettings(req.orgId);
    const installRows = await Organization.getInstallSettings();
    const operator = isInstallOperator(req);
    const data = [
      ...Object.entries(ORG_SETTING_DEFS).map(([key, def]) => ({
        key,
        value: orgValues[key] ?? def.default,
        description: def.description,
        scope: 'org',
        editable: true,
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

    const def = ORG_SETTING_DEFS[key];
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
      if (!isInstallOperator(req)) {
        return res.status(403).json({
          error: {
            code: 'INSTALL_SETTING_OPERATOR_ONLY',
            message: 'This setting applies to the whole installation and can only be changed by the install operator.',
          },
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
