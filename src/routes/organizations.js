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
const {
  getDatabaseIsolation,
  saveDatabaseIsolation,
  testDatabaseIsolation,
} = require('../services/tenantDatabaseService');
const emailSettingsService = require('../services/emailSettingsService');
const { updateEmailSettings, testEmailSettings: testEmailSettingsSchema } = require('../middleware/schemas/emailSettings');
const auditLog = require('../services/auditLog');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'routes/organizations' });

const router = Router();
const ctrl = crudController(Organization);

router.use(authenticate);

router.get('/', requirePermission('organizations.view'), ctrl.list);
router.get('/:id', requirePermission('organizations.view'), ctrl.get);
router.post('/', requirePermission('organizations.create'), validate(createOrganization), ctrl.create);
router.put('/:id', requirePermission('organizations.update'), validate(updateOrganization), ctrl.update);
router.patch('/:id', requirePermission('organizations.update'), validate(patchOrganization), ctrl.partialUpdate);
router.delete('/:id', requirePermission('organizations.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('organizations.update'), ctrl.restore);

// Settings sub-routes
router.get('/:id/settings', requirePermission('settings.view'), async (req, res, next) => {
  try {
    const settings = await Organization.getSettings(req.params.id);
    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/settings/:key', requirePermission('settings.update'), validate(updateSetting), async (req, res, next) => {
  try {
    await Organization.setSetting(req.params.id, req.params.key, req.body.value);
    const settings = await Organization.getSettings(req.params.id);
    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

// Quota sub-routes
router.get('/:id/quota', requirePermission('organizations.view'), async (req, res, next) => {
  try {
    const data = await getQuotaWithUsage(req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/quota', requirePermission('organizations.update'), async (req, res, next) => {
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
router.get('/:id/email-settings', requirePermission('email_settings.view'), async (req, res, next) => {
  try {
    const data = await emailSettingsService.listEmailSettings(req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/email-settings/:function', requirePermission('email_settings.update'), validate(updateEmailSettings), async (req, res, next) => {
  try {
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

router.post('/:id/email-settings/:function/test', requirePermission('email_settings.update'), validate(testEmailSettingsSchema), async (req, res, next) => {
  try {
    const data = await emailSettingsService.testEmailSettings(req.params.id, req.params.function, req.body.to);
    logger.info({ orgId: req.params.id, function: req.params.function, actorUserId: req.user?.id, success: data.success }, 'Org email identity test sent');
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// Per-tenant database isolation sub-routes
router.get('/:id/database-isolation', requirePermission('organizations.view'), async (req, res, next) => {
  try {
    const data = await getDatabaseIsolation(req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/database-isolation', requirePermission('organizations.update'), async (req, res, next) => {
  try {
    const data = await saveDatabaseIsolation(req.params.id, req.body || {});
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/database-isolation/test', requirePermission('organizations.update'), async (req, res, next) => {
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
function assertCallerCanManageOrgFiscal(req) {
  if (Number(req.params.id) === Number(req.orgId)) return;
  if (req.user?.role === 'admin') return;
  throw new AppError('You can only manage your own organization\'s fiscal identity.', 403, 'FORBIDDEN');
}

router.get('/:id/mx-profile', orgScope, requirePermission('organizations.view'), async (req, res, next) => {
  try {
    assertCallerCanManageOrgFiscal(req);
    await assertTargetOrgIsMx(req.params.id);
    const [rows] = await db.query(
      `SELECT id, organization_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
              colonia, municipio, exterior_number, interior_number,
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
  try {
    assertCallerCanManageOrgFiscal(req);
    await assertTargetOrgIsMx(req.params.id);
    const { rfc, razon_social, regimen_fiscal, codigo_postal_fiscal } = req.body;

    // Uniform partial-update semantics for the optional fields: a key that is
    // OMITTED leaves the stored value unchanged; an explicitly-sent empty
    // string clears a nullable address field to NULL. Serie columns are
    // NOT NULL — an empty string for them means "reset to nothing sent" and is
    // ignored (they always have a value; change it by sending a new one).
    const ADDRESS_FIELDS = ['colonia', 'municipio', 'exterior_number', 'interior_number'];
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

    if (existing[0]) {
      await db.query(
        `UPDATE organization_mx_profiles
            SET rfc = ?, razon_social = ?, regimen_fiscal = ?, codigo_postal_fiscal = ?${sets.length ? ', ' + sets.join(', ') : ''}
          WHERE organization_id = ? AND deleted_at IS NULL`,
        [rfc, razon_social, regimen_fiscal, codigo_postal_fiscal, ...params, req.params.id],
      );
    } else {
      const body = req.body;
      await db.query(
        `INSERT INTO organization_mx_profiles
           (organization_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
            colonia, municipio, exterior_number, interior_number,
            cfdi_serie_ingreso, cfdi_serie_egreso, cfdi_serie_pago)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'A'), COALESCE(?, 'E'), COALESCE(?, 'P'))`,
        [req.params.id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
          (body.colonia ?? '').trim() || null, (body.municipio ?? '').trim() || null,
          (body.exterior_number ?? '').trim() || null, (body.interior_number ?? '').trim() || null,
          (body.cfdi_serie_ingreso ?? '').trim() || null, (body.cfdi_serie_egreso ?? '').trim() || null,
          (body.cfdi_serie_pago ?? '').trim() || null],
      );
    }

    await auditLog.log({
      userId: req.user?.id, organizationId: Number(req.params.id), action: existing[0] ? 'update' : 'create',
      tableName: 'organization_mx_profiles', recordId: existing[0]?.id ?? null,
      summary: `Updated MX fiscal profile (emisor) for org ${req.params.id}`,
    });

    const [rows] = await db.query(
      `SELECT id, organization_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
              colonia, municipio, exterior_number, interior_number,
              cfdi_serie_ingreso, cfdi_serie_egreso, cfdi_serie_pago, cfdi_folio_next,
              created_at, updated_at
         FROM organization_mx_profiles
        WHERE organization_id = ? AND deleted_at IS NULL`,
      [req.params.id],
    );
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
