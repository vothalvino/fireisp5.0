// =============================================================================
// FireISP 5.0 — MX SNII infrastructure-report preparation API
// =============================================================================

'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('node:path');
const db = require('../config/database');
const service = require('../services/sniiReportingService');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requireMxLocale } = require('../middleware/orgLocale');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { exportLimiter } = require('../middleware/rateLimit');
const { runInPrimaryContext } = require('../utils/primaryContext');
const { contentDispositionAttachment } = require('../middleware/upload');
const { ForbiddenError, ValidationError } = require('../utils/errors');
const schemas = require('../middleware/schemas/sniiReporting');

const router = Router();

const EVIDENCE_MIME_BY_EXTENSION = new Map([
  ['.pdf', new Set(['application/pdf'])],
  ['.xml', new Set(['application/xml', 'text/xml'])],
  ['.txt', new Set(['text/plain'])],
  ['.csv', new Set(['text/csv', 'application/csv'])],
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.png', new Set(['image/png'])],
]);
const filingEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 7, parts: 8 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const accepted = EVIDENCE_MIME_BY_EXTENSION.get(extension);
    if (!accepted || !accepted.has(file.mimetype)) {
      const error = new ValidationError('Unsupported filing-evidence file type');
      return callback(error);
    }
    return callback(null, true);
  },
}).single('evidence_file');

function parseFilingEvidence(req, _res, next) {
  filingEvidenceUpload(req, _res, (error) => {
    if (error) return next(error instanceof ValidationError
      ? error : new ValidationError('Filing evidence upload failed'));
    if (!req.file?.buffer?.length) return next(new ValidationError('evidence_file is required'));
    const extension = path.extname(req.file.originalname || '').toLowerCase();
    const bytes = req.file.buffer;
    const magicMatches = extension === '.pdf' ? bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
      : extension === '.png' ? bytes.subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : ['.jpg', '.jpeg'].includes(extension)
          ? bytes[0] === 0xff && bytes[1] === 0xd8
          : !bytes.includes(0);
    if (!magicMatches) return next(new ValidationError('Filing evidence content does not match its file type'));
    req.file.mimetype = [...EVIDENCE_MIME_BY_EXTENSION.get(extension)][0];
    const allowed = new Set([
      'event_type', 'attempt_no', 'occurred_at', 'occurred_timezone',
      'authority_reference', 'notes',
    ]);
    const unknown = Object.keys(req.body || {}).filter(field => !allowed.has(field));
    if (unknown.length) {
      return next(new ValidationError('Unknown filing-event fields', unknown.map(field => ({ field }))));
    }
    if (typeof req.body.attempt_no === 'string' && /^\d+$/.test(req.body.attempt_no)) {
      req.body.attempt_no = Number(req.body.attempt_no);
    }
    return next();
  });
}

function routeContext(req) {
  return {
    organizationId: req.orgId,
    actorId: req.user.id,
    ipAddress: req.ip || null,
    userAgent: req.get('user-agent') || null,
  };
}

/**
 * Restricted SNII coordinates require a live target-organization membership.
 * API keys and install-operator cross-tenant authority are deliberately never
 * accepted here.  Permission middleware still runs after this check, so a
 * membership alone does not grant access.
 */
async function requireSniiTenantMember(req, _res, next) {
  try {
    if (req.user?.apiTokenId) {
      throw new ForbiddenError('SNII reporting requires an interactive user session');
    }
    if (req.user?.isInstallOperator) {
      throw new ForbiddenError('Install-operator access is not permitted for SNII reporting');
    }
    const [memberships] = await runInPrimaryContext(() => db.query(
      `SELECT ou.id
         FROM organization_users ou
         JOIN users u ON u.id = ou.user_id
         JOIN organizations o ON o.id = ou.organization_id
        WHERE ou.user_id = ? AND ou.organization_id = ? AND ou.deleted_at IS NULL
          AND u.status = 'active' AND u.deleted_at IS NULL
          AND o.status = 'active' AND o.deleted_at IS NULL
        LIMIT 1`,
      [req.user?.id, req.orgId],
    ));
    if (memberships.length !== 1) {
      throw new ForbiddenError('Live organization membership is required for SNII reporting');
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.use(authenticate);
router.use(orgScope);
router.use(requireMxLocale);
router.use(requireSniiTenantMember);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  next();
});

router.get('/catalog', requirePermission('snii_reporting.view'), (_req, res) => {
  res.json({ data: service.getCatalog() });
});

router.get('/profile', requirePermission('snii_reporting.view'), async (req, res, next) => {
  try {
    res.json(await service.getProfileEnvelope(req.orgId));
  } catch (err) {
    next(err);
  }
});

router.put('/profile', requirePermission('snii_reporting.prepare'),
  validate(schemas.upsertProfile, { strip: true }), async (req, res, next) => {
    try {
      const profile = await service.upsertProfile(
        req.orgId, req.user.id, req.body, routeContext(req),
      );
      res.json({ data: profile });
    } catch (err) {
      next(err);
    }
  });

router.put('/profile/subject-applicability', requirePermission('snii_reporting.review'),
  validate(schemas.setSubjectApplicability, { strip: true }), async (req, res, next) => {
    try {
      const profile = await service.setSubjectApplicability(
        req.orgId, req.user.id, req.body, routeContext(req),
      );
      res.json({ data: profile });
    } catch (err) {
      next(err);
    }
  });

router.put('/profile/applicability/:elementType', requirePermission('snii_reporting.review'),
  validate(schemas.setApplicability, { strip: true }), async (req, res, next) => {
    try {
      const decision = await service.setApplicability(
        req.orgId, req.user.id, req.params.elementType, req.body, routeContext(req),
      );
      res.json({ data: decision });
    } catch (err) {
      next(err);
    }
  });

router.get('/candidates', requirePermission('snii_reporting.view'), async (req, res, next) => {
  try {
    res.json({ data: await service.listCandidates(req.orgId, routeContext(req)) });
  } catch (err) {
    next(err);
  }
});

router.get('/assets', requirePermission('snii_reporting.view'), async (req, res, next) => {
  try {
    res.json({ data: await service.listAssets(req.orgId, req.query, routeContext(req)) });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/:id',
  requirePermission('snii_reporting.review', 'snii_reporting.approve'), async (req, res, next) => {
    try {
      res.json({ data: await service.getAssetDetail(
        req.orgId, req.params.id, routeContext(req),
      ) });
    } catch (err) {
      next(err);
    }
  });

router.post('/assets', requirePermission('snii_reporting.review'),
  validate(schemas.createAsset, { strip: true }), async (req, res, next) => {
    try {
      const asset = await service.createAsset(
        req.orgId, req.user.id, req.body, routeContext(req),
      );
      res.status(201).json({ data: asset });
    } catch (err) {
      next(err);
    }
  });

router.patch('/assets/:id', requirePermission('snii_reporting.review'),
  validate(schemas.updateAsset, { strip: true }), async (req, res, next) => {
    try {
      const asset = await service.updateAsset(
        req.orgId, req.user.id, req.params.id, req.body, routeContext(req),
      );
      res.json({ data: asset });
    } catch (err) {
      next(err);
    }
  });

router.post('/assets/:id/approve', requirePermission('snii_reporting.approve'),
  validate(schemas.approveAsset, { strip: true }), async (req, res, next) => {
    try {
      const asset = await service.approveAsset(
        req.orgId, req.user.id, req.params.id,
        req.body.expected_source_snapshot_hash, req.body.expected_classification_hash,
        routeContext(req),
      );
      res.json({ data: asset });
    } catch (err) {
      next(err);
    }
  });

router.get('/batches', requirePermission('snii_reporting.view'), async (req, res, next) => {
  try {
    res.json({ data: await service.listBatches(req.orgId) });
  } catch (err) {
    next(err);
  }
});

router.post('/batches', requirePermission('snii_reporting.prepare'),
  validate(schemas.createBatch, { strip: true }), async (req, res, next) => {
    try {
      const batch = await service.createBatch(
        req.orgId, req.user.id, req.body, routeContext(req),
      );
      res.status(201).json({ data: batch });
    } catch (err) {
      next(err);
    }
  });

router.get('/batches/:id', requirePermission('snii_reporting.view'), async (req, res, next) => {
  try {
    res.json({ data: await service.getBatch(req.orgId, req.params.id, routeContext(req)) });
  } catch (err) {
    next(err);
  }
});

router.post('/batches/:id/validate', requirePermission('snii_reporting.prepare'),
  async (req, res, next) => {
    try {
      const batch = await service.validateBatch(
        req.orgId, req.user.id, req.params.id, routeContext(req),
      );
      res.json({ data: batch });
    } catch (err) {
      next(err);
    }
  });

router.post('/batches/:id/approve', requirePermission('snii_reporting.approve'),
  validate(schemas.approveBatch, { strip: true }), async (req, res, next) => {
    try {
      const batch = await service.approveBatch(
        req.orgId, req.user.id, req.params.id,
        req.body.expected_snapshot_hash, routeContext(req),
      );
      res.json({ data: batch });
    } catch (err) {
      next(err);
    }
  });

router.post('/batches/:id/artifacts', exportLimiter,
  requirePermission('snii_reporting.export'),
  validate(schemas.generateArtifact, { strip: true }), async (req, res, next) => {
    try {
      const artifact = await service.generateArtifact(
        req.orgId, req.user.id, req.params.id, req.body, routeContext(req),
      );
      res.status(201).json({ data: artifact });
    } catch (err) {
      next(err);
    }
  });

router.get('/artifacts/:id/download', exportLimiter,
  requirePermission('snii_reporting.export'), async (req, res, next) => {
    try {
      const artifact = await service.getArtifactForDownload(
        req.orgId, req.user.id, req.params.id, routeContext(req),
      );
      res.set('Content-Type', artifact.mime_type);
      res.set('Content-Disposition', contentDispositionAttachment(artifact.file_name));
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Security-Policy', 'sandbox');
      res.set('X-Evidence-SHA256', artifact.content_sha256);
      res.send(artifact.content_text);
    } catch (err) {
      next(err);
    }
  });

router.get('/batches/:id/filing-events', requirePermission('snii_reporting.view'),
  async (req, res, next) => {
    try {
      res.json({ data: await service.listFilingEvents(
        req.orgId, req.params.id, routeContext(req),
      ) });
    } catch (err) {
      next(err);
    }
  });

router.post('/batches/:id/filing-events', requirePermission('snii_reporting.file'),
  parseFilingEvidence, validate(schemas.createFilingEvent, { strip: true }),
  async (req, res, next) => {
    try {
      const event = await service.recordFilingEvent(
        req.orgId, req.user.id, req.params.id, req.body, req.file, routeContext(req),
      );
      res.status(201).json({ data: event });
    } catch (err) {
      next(err);
    }
  });

router.get('/filing-events/:id/evidence/download', exportLimiter,
  requirePermission('snii_reporting.evidence'), async (req, res, next) => {
    try {
      const evidence = await service.getFilingEvidenceForDownload(
        req.orgId, req.user.id, req.params.id, routeContext(req),
      );
      res.set('Content-Type', evidence.evidence_mime_type);
      res.set('Content-Disposition', contentDispositionAttachment(evidence.evidence_file_name));
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Security-Policy', 'sandbox');
      res.set('X-Evidence-SHA256', evidence.evidence_sha256);
      res.send(evidence.evidence_content);
    } catch (err) {
      next(err);
    }
  });

router.get('/audit-events', requirePermission('snii_reporting.view'), async (req, res, next) => {
  try {
    res.json({ data: await service.listAuditEvents(req.orgId, req.query) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.requireSniiTenantMember = requireSniiTenantMember;
