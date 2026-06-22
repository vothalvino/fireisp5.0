// =============================================================================
// FireISP 5.0 — API Token Routes
// =============================================================================

const crypto = require('crypto');
const { Router } = require('express');
const ApiToken = require('../models/ApiToken');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createApiToken, updateApiToken } = require('../middleware/schemas/apiTokens');
const { validateScopes, listAvailableScopes } = require('../utils/scopes');
const { ValidationError } = require('../utils/errors');

const router = Router();
const ctrl = crudController(ApiToken);

router.use(authenticate);
router.use(orgScope);

// GET /api-tokens/scopes — list all available scopes (for UI token-creation forms)
router.get('/scopes', requirePermission('api_tokens.view'), (_req, res) => {
  res.json({ data: listAvailableScopes() });
});

router.get('/', requirePermission('api_tokens.view'), ctrl.list);
router.get('/:id', requirePermission('api_tokens.view'), ctrl.get);

// Create token — generate plaintext, store SHA-256 hash, validate scopes
router.post('/', requirePermission('api_tokens.create'), validate(createApiToken, { strip: true }), async (req, res, next) => {
  try {
    // Validate scopes if provided
    if (req.body.scopes !== undefined && req.body.scopes !== null) {
      const { valid, errors } = validateScopes(req.body.scopes);
      if (!valid) {
        throw new ValidationError('Invalid scopes', errors);
      }
      // Store as JSON (MySQL JSON column)
      req.body.scopes = JSON.stringify(req.body.scopes);
    }

    const plaintext = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(plaintext).digest('hex');

    req.body.organization_id = req.orgId;
    // SECURITY: bind the token to the authenticated creator. user_id is fillable
    // and was previously mass-assignable from the body, letting an
    // api_tokens.create holder mint a token impersonating another user (e.g. the
    // admin user_id=1) and inherit that user's role on every request.
    req.body.user_id = req.user.id;
    req.body.token_hash = tokenHash;

    const token = await ApiToken.create(req.body);
    res.status(201).json({ data: { ...token, token: plaintext } });
  } catch (err) {
    next(err);
  }
});

// Update token — validate scopes if changing
router.put('/:id', requirePermission('api_tokens.update'), validate(updateApiToken, { strip: true }), async (req, res, next) => {
  try {
    if (req.body.scopes !== undefined && req.body.scopes !== null) {
      const { valid, errors } = validateScopes(req.body.scopes);
      if (!valid) {
        throw new ValidationError('Invalid scopes', errors);
      }
      req.body.scopes = JSON.stringify(req.body.scopes);
    }

    const old = await ApiToken.findByIdOrFail(req.params.id, req.orgId);
    const record = await ApiToken.update(req.params.id, req.body, req.orgId);
    const auditLog = require('../services/auditLog');
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'update',
      tableName: ApiToken.tableName,
      recordId: record.id,
      oldValues: old,
      newValues: req.body,
    });
    res.json({ data: record });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('api_tokens.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('api_tokens.update'), ctrl.restore);

module.exports = router;
