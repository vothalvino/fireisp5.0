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

const router = Router();
const ctrl = crudController(ApiToken);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('api_tokens.view'), ctrl.list);
router.get('/:id', requirePermission('api_tokens.view'), ctrl.get);

// Create token — generate plaintext, store SHA-256 hash
router.post('/', requirePermission('api_tokens.create'), validate(createApiToken), async (req, res, next) => {
  try {
    const plaintext = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(plaintext).digest('hex');

    req.body.organization_id = req.orgId;
    req.body.token_hash = tokenHash;

    const token = await ApiToken.create(req.body);
    res.status(201).json({ data: { ...token, token: plaintext } });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('api_tokens.update'), validate(updateApiToken), ctrl.update);
router.delete('/:id', requirePermission('api_tokens.delete'), ctrl.destroy);

module.exports = router;
