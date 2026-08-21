// =============================================================================
// FireISP 5.0 — Organization Routes
// =============================================================================

const { Router } = require('express');
const Organization = require('../models/Organization');
const OrganizationQuota = require('../models/OrganizationQuota');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createOrganization, updateOrganization, patchOrganization, updateSetting, updateOrgMxProfile } = require('../middleware/schemas/organizations');
const db = require('../config/database');
const { getQuotaWithUsage } = require('../services/quotaService');
const { isInstallOperator, OPERATOR_ONLY_MESSAGE } = require('../services/installOperator');
const {
  getDatabaseIsolation,
  saveDatabaseIsolation,
  testDatabaseIsolation,
} = require('../services/tenantDatabaseService');
const emailSettingsService = require('../services/emailSettingsService');
const mxRegisteredTemplateService = require('../services/mxRegisteredContractTemplateService');
const { updateEmailSettings, testEmailSettings: testEmailSettingsSchema } = require('../middleware/schemas/emailSettings');
const auditLog = require('../services/auditLog');
const { emailSettingsTestLimiter } = require('../middleware/rateLimit');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'routes/organizations' });

const router = Router();
const ctrl = crudController(Organization);

/**
 * A locale selects the legal/activation workflow for NEW work.  Never change
 * it underneath an unfinished workflow: doing so can leave a generic contract
 * waiting for MX evidence, or an MX contract waiting on generic paperwork.
 *
 * The guarded controller locks the organization row before this hook runs and
 * uses the same transaction for these reads and the eventual UPDATE.  Child
 * inserts also reference that parent row, so their FK lock serializes with the
 * organization lock.  Keep the lock order organization -> child rows.
 * Historical, closed workflows intentionally do not block a change; their own
 * source/environment snapshots remain immutable.
 */
async function assertLocaleChangeHasNoOpenWork(old, req, exec) {
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'locale')) return;
  if (req.body.locale === old.locale) return;

  const [rows] = await exec(
    `SELECT
       EXISTS (
         SELECT 1 FROM contracts
          WHERE organization_id = ?
            AND status IN ('pending','active','suspended')
            AND deleted_at IS NULL
          LIMIT 1
       ) AS has_nonterminal_contract,
       EXISTS (
         SELECT 1 FROM service_orders
          WHERE organization_id = ?
            AND order_type = 'new_install'
            AND status IN ('new','in_process')
            AND deleted_at IS NULL
          LIMIT 1
       ) AS has_open_new_install,
       EXISTS (
         SELECT 1 FROM signed_documents
          WHERE organization_id = ?
            AND status = 'pending'
            AND deleted_at IS NULL
          LIMIT 1
       ) AS has_pending_signed_document`,
    [old.id, old.id, old.id],
  );

  const state = rows[0] || {};
  const blockers = [];
  if (Number(state.has_nonterminal_contract)) blockers.push('nonterminal_contract');
  if (Number(state.has_open_new_install)) blockers.push('open_new_install');
  if (Number(state.has_pending_signed_document)) blockers.push('pending_signed_document');
  if (!blockers.length) return;

  const err = new AppError(
    'Finish or cancel open contracts, new installations, and pending signing documents before changing the organization locale.',
    409,
    'ORG_LOCALE_CHANGE_BLOCKED',
  );
  err.details = {
    current_locale: old.locale,
    requested_locale: req.body.locale,
    blockers,
  };
  throw err;
}

const localeGuardedCtrl = crudController(Organization, {
  transactionalWrites: true,
  beforeUpdate: assertLocaleChangeHasNoOpenWork,
});

function localeAwareUpdate(method) {
  return (req, res, next) => {
    const controller = Object.prototype.hasOwnProperty.call(req.body || {}, 'locale')
      ? localeGuardedCtrl
      : ctrl;
    return controller[method](req, res, next);
  };
}

router.use(authenticate);

// LIST — the caller's own organisations, unless they run the install (j67).
//
// Organization.hasOrgScope is false, so the generic list returned EVERY ISP on
// the box to anyone holding organizations.view — which migration 119 grants
// every org's admin. Under the isolation model the product now commits to,
// that is enumeration of your neighbours: names, tax ids, status, and the ids
// every other guard is keyed on. Memberships come from organization_users, the
// same source /auth/me already uses for the org switcher.
router.get('/', requirePermission('organizations.view'), async (req, res, next) => {
  try {
    if (await isInstallOperator(req)) return ctrl.list(req, res, next);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT o.* FROM organizations o
         JOIN organization_users ou ON ou.organization_id = o.id
        WHERE ou.user_id = ? AND ou.deleted_at IS NULL AND o.deleted_at IS NULL
        ORDER BY o.id ASC LIMIT ${limit} OFFSET ${offset}`,
      [req.user.id],
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM organizations o
         JOIN organization_users ou ON ou.organization_id = o.id
        WHERE ou.user_id = ? AND ou.deleted_at IS NULL AND o.deleted_at IS NULL`,
      [req.user.id],
    );
    res.json({ data: rows, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

router.get('/:id', orgScope, requirePermission('organizations.view'), assertCallerOwnsTargetOrg, ctrl.get);
// Create is INSTALL-OPERATOR only, symmetric with delete (product decision,
// 2026-08-02): membership is required to ENTER an org (j66/j67), and create
// grants the creator no membership — so a tenant admin could only ever mint
// orgs they can never enter. Orgs are the operator's inventory, both ends.
router.post('/', requirePermission('organizations.create'), requireInstallOperator, validate(createOrganization), ctrl.create);
/**
 * The ownership guard for every :id route on this router.
 *
 * Organization.hasOrgScope is false, so BaseModel SILENTLY omits the tenant
 * predicate — `UPDATE organizations SET ... WHERE id = ?` with no
 * organization_id — and requirePermission resolves against the CALLER's active
 * org, never the target. Without an explicit check, any org's admin could act
 * on any other org's row by id, and GET / lists the ids for them.
 *
 * The older assertCallerCanManageOrgFiscal is NOT enough on its own: it waves
 * through anyone with users.role='admin', which is the per-TENANT admin persona
 * (roles is a GLOBAL table and User.resolveGroupMirror copies group.kind into
 * users.role), so on a multi-organisation install it lets org A's admin act on
 * org B. Here the caller must either be acting on their OWN organisation or be
 * a verified install operator.
 *
 * Applied to every :id route on this router that reads or writes one
 * organisation's data. The per-org config sub-routes had NO ownership check at
 * all, so a tenant admin could read or rewrite another org's quota, SMTP
 * identity (email-settings carries outbound mail credentials) and database
 * isolation by choosing the id — which GET / lists for them. mx-profile keeps
 * the older, weaker assertCallerCanManageOrgFiscal for now: it also guards the
 * RFC/CFDI series, and tightening the fiscal surface is filed as j66.
 */
async function assertCallerOwnsTargetOrg(req, res, next) {
  try {
    if (Number(req.params.id) === Number(req.orgId)) return next();
    if (await isInstallOperator(req)) return next();
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'You can only manage your own organization.' },
    });
  } catch (err) { return next(err); }
}

router.put('/:id', orgScope, requirePermission('organizations.update'), assertCallerOwnsTargetOrg, validate(updateOrganization), localeAwareUpdate('update'));
router.patch('/:id', orgScope, requirePermission('organizations.update'), assertCallerOwnsTargetOrg, validate(patchOrganization), localeAwareUpdate('partialUpdate'));
// Delete and restore had NO ownership guard at all, and Organization declares
// hasOrgScope=false — so BaseModel omitted the org filter entirely (the j36
// trap, on the organizations table itself) and any tenant admin could
// soft-delete or resurrect ANOTHER tenant's organisation by id, with GET /
// listing the ids for them. That is destructive on its own, and it also
// undermined the install-operator gate, which counts organisations: deleting
// the neighbours would have restored operator status. The count now spans all
// rows (see services/installOperator.js) AND these two verbs are guarded.
// Both verbs are INSTALL-OPERATOR only (product decision, 2026-08-02): a
// tenant admin must not delete even their own organisation — an org holds
// fiscal records (stamped CFDIs) whose retention outlives any tenant's wish
// to leave, so decommissioning is the operator's act, like restore already was.
router.delete('/:id', orgScope, requirePermission('organizations.delete'), requireInstallOperator, ctrl.destroy);
router.post('/:id/restore', orgScope, requirePermission('organizations.update'), requireInstallOperator, ctrl.restore);

// Settings sub-routes — PER-ORG keys only (migration 443 split, j56).
// Before the split these served the INSTALL-level table while taking an :id
// they ignored, so any tenant admin could rewrite deployment-wide values —
// and they lacked the assertCallerCanManageOrg guard their sibling routes
// have, so the :id was attacker-chosen on top of being ignored. Install keys
// are edited on /settings by the install operator, never through this door.
const { ORG_SETTING_DEFS } = require('../services/settingsCatalog');

/** The target org's settings as a key→value map, catalog defaults filled in. */
async function orgSettingsMap(orgId) {
  const values = await Organization.getOrgSettings(orgId);
  const map = {};
  for (const [key, def] of Object.entries(ORG_SETTING_DEFS)) {
    map[key] = values[key] ?? def.default;
  }
  return map;
}

/**
 * For surfaces that are constraints IMPOSED ON a tenant rather than the
 * tenant's own configuration. Owning the organisation is not enough: a tenant
 * that can raise its own quota has no quota, and database isolation is
 * deployment infrastructure, not customer data.
 */
async function requireInstallOperator(req, res, next) {
  try {
    if (await isInstallOperator(req)) return next();
    return res.status(403).json({
      error: { code: 'INSTALL_OPERATOR_ONLY', message: OPERATOR_ONLY_MESSAGE },
    });
  } catch (err) { return next(err); }
}

router.get('/:id/settings', orgScope, requirePermission('settings.view'), assertCallerOwnsTargetOrg, async (req, res, next) => {
  try {
    res.json({ data: await orgSettingsMap(req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/settings/:key', orgScope, requirePermission('settings.update'), assertCallerOwnsTargetOrg, validate(updateSetting), async (req, res, next) => {
  try {
    // Object.hasOwn, not a bare lookup — 'constructor' is truthy on any plain
    // object and would 500 on def.validate instead of 422ing.
    const def = Object.hasOwn(ORG_SETTING_DEFS, req.params.key) ? ORG_SETTING_DEFS[req.params.key] : null;
    if (!def) {
      return res.status(422).json({
        error: { code: 'UNKNOWN_SETTING', message: `'${req.params.key}' is not a per-organization setting.` },
      });
    }
    const problem = def.validate(req.body.value);
    if (problem) {
      return res.status(422).json({
        error: { code: 'INVALID_SETTING_VALUE', message: `${req.params.key} ${problem}` },
      });
    }
    await Organization.setOrgSetting(req.params.id, req.params.key, req.body.value);
    res.json({ data: await orgSettingsMap(req.params.id) });
  } catch (err) {
    next(err);
  }
});

// Quota sub-routes
router.get('/:id/quota', orgScope, requirePermission('organizations.view'), assertCallerOwnsTargetOrg, async (req, res, next) => {
  try {
    const data = await getQuotaWithUsage(req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/quota', orgScope, requirePermission('organizations.update'), requireInstallOperator, async (req, res, next) => {
  try {
    const QUOTA_FIELDS = ['max_clients', 'max_devices', 'max_storage_mb', 'max_scheduled_tasks'];
    const { ValidationError: VE } = require('../utils/errors');
    const body = req.body || {};
    for (const key of Object.keys(body)) {
      if (!QUOTA_FIELDS.includes(key)) {
        return next(new VE(`Unknown quota field: ${key}`));
      }
      const val = body[key];
      if (val !== null && val !== '') {
        const num = Number(val);
        if (!Number.isInteger(num) || num < 0) {
          return next(new VE(`${key} must be a non-negative integer or null`));
        }
      }
    }
    await OrganizationQuota.upsert(req.params.id, body);
    const data = await getQuotaWithUsage(req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// Per-function outbound email identity sub-routes (migration 407).
// email_settings.view/update are admin+super_admin only (migration 386) — an
// SMTP credential is org-wide send-as-anyone infrastructure. Managing another
// org's identities is per-:id here (the org detail page's Mail tab); the
// legacy /email-settings routes stay scoped to the caller's active org.
router.get('/:id/email-settings', orgScope, requirePermission('email_settings.view'), assertCallerOwnsTargetOrg, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const data = await emailSettingsService.listEmailSettings(req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/email-settings/:function', orgScope, requirePermission('email_settings.update'), assertCallerOwnsTargetOrg, validate(updateEmailSettings), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const data = await emailSettingsService.saveEmailSettings(req.params.id, req.params.function, req.body);
    // Never log the password itself; logger redaction covers req.body.smtp_password too.
    logger.info({ orgId: req.params.id, function: req.params.function, actorUserId: req.user?.id }, 'Org email identity updated');
    await auditLog.log({
      userId: req.user?.id, organizationId: Number(req.params.id), action: 'update',
      tableName: 'organization_email_settings',
      summary: `Updated ${req.params.function} email identity for org ${req.params.id}`,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/email-settings/:function/test', orgScope, requirePermission('email_settings.update'), assertCallerOwnsTargetOrg, emailSettingsTestLimiter, validate(testEmailSettingsSchema), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const data = await emailSettingsService.testEmailSettings(req.params.id, req.params.function, req.body.to);
    logger.info({ orgId: req.params.id, function: req.params.function, actorUserId: req.user?.id, success: data.success }, 'Org email identity test sent');
    await auditLog.log({
      userId: req.user?.id,
      organizationId: Number(req.params.id),
      action: 'test',
      tableName: 'organization_email_settings',
      summary: `Tested ${req.params.function} email identity for org ${req.params.id}: ${data.success ? 'success' : 'failed'}`,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// Per-tenant database isolation sub-routes
router.get('/:id/database-isolation', orgScope, requirePermission('organizations.view'), requireInstallOperator, async (req, res, next) => {
  try {
    const data = await getDatabaseIsolation(req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/database-isolation', orgScope, requirePermission('organizations.update'), requireInstallOperator, async (req, res, next) => {
  try {
    const data = await saveDatabaseIsolation(req.params.id, req.body || {});
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/database-isolation/test', orgScope, requirePermission('organizations.update'), requireInstallOperator, async (req, res, next) => {
  try {
    const data = await testDatabaseIsolation(req.params.id, req.body && Object.keys(req.body).length ? req.body : null);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// MX fiscal identity (emisor) — GET/PUT /:id/mx-profile
// ---------------------------------------------------------------------------
// The org's SAT taxpayer identity (RFC, razón social, régimen fiscal, C.P.,
// fiscal address, CFDI series). Joined by cfdiService at XML-generation time
// as the cfdi:Emisor — never stored per-document. Gated on the TARGET org's
// locale (this route manages org :id, which may differ from the caller's
// active org, so the requireMxLocale middleware — which checks req.orgId —
// would gate on the wrong org). CSD and PAC credentials are intentionally NOT
// part of this surface: they live at /csd-certificates and /pac-providers.
async function assertTargetOrgIsMx(orgId) {
  const locale = await Organization.getLocale(orgId);
  if (locale !== 'MX') {
    throw new AppError('This organization is not MX-locale — SAT fiscal identity does not apply.', 404, 'REGION_DISABLED');
  }
}

// The org's SAT identity is tenant-private: unlike the platform-ops sub-routes
// above (quota, email-settings — super_admin surface by permission seeding),
// organizations.view is granted broadly, so without this check any member of
// one org could read (or with organizations.update, overwrite) another org's
// RFC/razón social by iterating ids. Callers may act on their OWN org; only a
// platform admin (legacy users.role='admin', the rbac full-bypass tier) may
// manage other orgs' fiscal identity. orgScope (mounted on these two routes
// only — the rest of this router is platform-ops surface without it) supplies
// req.orgId as the caller's ACTIVE org.
function assertCallerCanManageOrgFiscal(req, what = 'fiscal identity') {
  if (Number(req.params.id) === Number(req.orgId)) return;
  // No operator escape here, deliberately (j66, answered by the user): an
  // organisation's fiscal identity — RFC, razón social, régimen fiscal, CFDI
  // serie/folio — is editable only from INSIDE that organisation. Someone who
  // runs the install and needs to touch it switches into the org first, which
  // makes the act attributable to that org rather than to a god-mode caller.
  // The check this replaced admitted any users.role='admin', i.e. every
  // tenant's admin, because that is the per-tenant admin persona.
  throw new AppError(`You can only manage your own organization's ${what}.`, 403, 'FORBIDDEN');
}

router.get('/:id/mx-profile', orgScope, requirePermission('organizations.view'), async (req, res, next) => {
  try {
    assertCallerCanManageOrgFiscal(req);
    await assertTargetOrgIsMx(req.params.id);
    const [rows] = await db.query(
      `SELECT id, organization_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
              colonia, municipio, exterior_number, interior_number,
              profeco_registro, carta_derechos_url,
              cfdi_serie_ingreso, cfdi_serie_egreso, cfdi_serie_pago, cfdi_folio_next,
              created_at, updated_at
         FROM organization_mx_profiles
        WHERE organization_id = ? AND deleted_at IS NULL`,
      [req.params.id],
    );
    res.json({ data: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/mx-profile', orgScope, requirePermission('organizations.update'), validate(updateOrgMxProfile), async (req, res, next) => {
  let profileConnection = null;
  try {
    assertCallerCanManageOrgFiscal(req);
    await assertTargetOrgIsMx(req.params.id);
    const { rfc, razon_social, regimen_fiscal, codigo_postal_fiscal } = req.body;

    // Uniform partial-update semantics for the optional fields: a key that is
    // OMITTED leaves the stored value unchanged; an explicitly-sent empty
    // string clears a nullable address field to NULL. Serie columns are
    // NOT NULL — an empty string for them means "reset to nothing sent" and is
    // ignored (they always have a value; change it by sending a new one).
    const ADDRESS_FIELDS = ['colonia', 'municipio', 'exterior_number', 'interior_number',
      'profeco_registro', 'carta_derechos_url'];
    const SERIE_FIELDS = ['cfdi_serie_ingreso', 'cfdi_serie_egreso', 'cfdi_serie_pago'];
    const sets = [];
    const params = [];
    for (const f of ADDRESS_FIELDS) {
      if (f in req.body) {
        sets.push(`${f} = ?`);
        params.push((req.body[f] ?? '').trim() || null);
      }
    }
    for (const f of SERIE_FIELDS) {
      const v = (req.body[f] ?? '').trim();
      if (v) {
        sets.push(`${f} = ?`);
        params.push(v);
      }
    }

    const [existing] = await db.query(
      'SELECT id FROM organization_mx_profiles WHERE organization_id = ? AND deleted_at IS NULL',
      [req.params.id],
    );

    let profile;
    if (existing[0]) {
      await db.query(
        `UPDATE organization_mx_profiles
            SET rfc = ?, razon_social = ?, regimen_fiscal = ?, codigo_postal_fiscal = ?${sets.length ? ', ' + sets.join(', ') : ''}
          WHERE organization_id = ? AND deleted_at IS NULL`,
        [rfc, razon_social, regimen_fiscal, codigo_postal_fiscal, ...params, req.params.id],
      );
    } else {
      // A pre-452 registry may exist even when the fiscal profile was never
      // created. Serialize first profile creation on the organization row and
      // inherit that effective production lane; accepting the DB's sandbox
      // default here would silently switch an established installation flow
      // outside the audited environment-switch endpoint.
      profileConnection = await db.getConnection();
      await profileConnection.beginTransaction();
      const [lockedOrganizations] = await profileConnection.query(
        'SELECT id, locale FROM organizations WHERE id = ? LIMIT 1 FOR UPDATE',
        [req.params.id],
      );
      if (!lockedOrganizations[0] || lockedOrganizations[0].locale !== 'MX') {
        throw new AppError('Mexican fiscal configuration is disabled for this organization.', 404, 'REGION_DISABLED');
      }
      const [concurrentProfiles] = await profileConnection.query(
        'SELECT id FROM organization_mx_profiles WHERE organization_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [req.params.id],
      );
      const body = req.body;
      if (concurrentProfiles[0]) {
        await profileConnection.query(
          `UPDATE organization_mx_profiles
              SET rfc = ?, razon_social = ?, regimen_fiscal = ?, codigo_postal_fiscal = ?${sets.length ? ', ' + sets.join(', ') : ''}
            WHERE organization_id = ? AND deleted_at IS NULL`,
          [rfc, razon_social, regimen_fiscal, codigo_postal_fiscal, ...params, req.params.id],
        );
      } else {
        const effective = await mxRegisteredTemplateService.loadOrganizationContractEnvironment(
          profileConnection.query.bind(profileConnection),
          { orgId: Number(req.params.id) },
        );
        const contractEnvironment = effective?.contract_environment || 'sandbox';
        await profileConnection.query(
          `INSERT INTO organization_mx_profiles
             (organization_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
              colonia, municipio, exterior_number, interior_number,
              profeco_registro, carta_derechos_url, contract_environment,
              cfdi_serie_ingreso, cfdi_serie_egreso, cfdi_serie_pago)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'A'), COALESCE(?, 'E'), COALESCE(?, 'P'))`,
          [req.params.id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
            (body.colonia ?? '').trim() || null, (body.municipio ?? '').trim() || null,
            (body.exterior_number ?? '').trim() || null, (body.interior_number ?? '').trim() || null,
            (body.profeco_registro ?? '').trim() || null, (body.carta_derechos_url ?? '').trim() || null,
            contractEnvironment,
            (body.cfdi_serie_ingreso ?? '').trim() || null, (body.cfdi_serie_egreso ?? '').trim() || null,
            (body.cfdi_serie_pago ?? '').trim() || null],
        );
      }
      const [profileRows] = await profileConnection.query(
        `SELECT id, organization_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
                colonia, municipio, exterior_number, interior_number,
                profeco_registro, carta_derechos_url,
                cfdi_serie_ingreso, cfdi_serie_egreso, cfdi_serie_pago, cfdi_folio_next,
                created_at, updated_at
           FROM organization_mx_profiles
          WHERE organization_id = ? AND deleted_at IS NULL`,
        [req.params.id],
      );
      profile = profileRows[0];
      await profileConnection.commit();
    }

    await auditLog.log({
      userId: req.user?.id, organizationId: Number(req.params.id), action: existing[0] ? 'update' : 'create',
      tableName: 'organization_mx_profiles', recordId: existing[0]?.id ?? null,
      summary: `Updated MX fiscal profile (emisor) for org ${req.params.id}`,
    });

    const [rows] = profile ? [[profile]] : await db.query(
      `SELECT id, organization_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
              colonia, municipio, exterior_number, interior_number,
              profeco_registro, carta_derechos_url,
              cfdi_serie_ingreso, cfdi_serie_egreso, cfdi_serie_pago, cfdi_folio_next,
              created_at, updated_at
         FROM organization_mx_profiles
        WHERE organization_id = ? AND deleted_at IS NULL`,
      [req.params.id],
    );
    res.json({ data: rows[0] });
  } catch (err) {
    if (profileConnection) await profileConnection.rollback().catch(() => {});
    next(err);
  } finally {
    if (profileConnection) profileConnection.release();
  }
});

module.exports = router;
