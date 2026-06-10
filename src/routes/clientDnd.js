// =============================================================================
// FireISP 5.0 — Client DND Preference Routes — §1.4
// =============================================================================
// Mounted at /clients in app.js — routes resolve to /clients/:clientId/dnd*
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');

const router = Router();

router.use(authenticate);
router.use(orgScope);

const CHANNELS = ['email', 'sms', 'whatsapp', 'all'];

const dndPrefSchema = {
  opt_out:             { type: 'boolean', required: true },
  quiet_hours_start:   { type: 'string', max: 8 },
  quiet_hours_end:     { type: 'string', max: 8 },
  reason:              { type: 'string', max: 300 },
};

const dndPrefBulkItemSchema = {
  channel:             { type: 'string', required: true, enum: CHANNELS },
  opt_out:             { type: 'boolean', required: true },
  quiet_hours_start:   { type: 'string', max: 8 },
  quiet_hours_end:     { type: 'string', max: 8 },
  reason:              { type: 'string', max: 300 },
};

/**
 * Validate a single DND preference item against the schema.
 * Returns array of error strings.
 */
function validateDndItem(item) {
  const errors = [];
  for (const [field, rules] of Object.entries(dndPrefBulkItemSchema)) {
    const value = item[field];
    if (rules.required && (value === undefined || value === null)) {
      errors.push(`${field} is required`);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (rules.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`${field} must be a boolean`);
    }
    if (rules.type === 'string' && typeof value !== 'string') {
      errors.push(`${field} must be a string`);
    }
    if (rules.enum && !rules.enum.includes(value)) {
      errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
    }
    if (rules.max && typeof value === 'string' && value.length > rules.max) {
      errors.push(`${field} must be at most ${rules.max} characters`);
    }
  }
  return errors;
}

/**
 * @openapi
 * /clients/{clientId}/dnd:
 *   get:
 *     summary: Get DND preferences for a client
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: DND preferences for all channels
 */
router.get('/:clientId/dnd', requirePermission('dnd.view'), async (req, res, next) => {
  try {
    const clientId = parseInt(req.params.clientId, 10);
    const [rows] = await db.query(
      'SELECT * FROM client_dnd_preferences WHERE client_id = ? AND organization_id = ?',
      [clientId, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /clients/{clientId}/dnd:
 *   put:
 *     summary: Upsert all DND preferences for a client
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               required: [channel, opt_out]
 *               properties:
 *                 channel:
 *                   type: string
 *                   enum: [email, sms, whatsapp, all]
 *                 opt_out:
 *                   type: boolean
 *                 quiet_hours_start:
 *                   type: string
 *                 quiet_hours_end:
 *                   type: string
 *                 reason:
 *                   type: string
 *     responses:
 *       200:
 *         description: Updated DND preferences
 */
router.put('/:clientId/dnd', requirePermission('dnd.update'), async (req, res, next) => {
  try {
    const clientId = parseInt(req.params.clientId, 10);
    const prefs = req.body;

    if (!Array.isArray(prefs)) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'Body must be an array of DND preference objects' },
      });
    }

    // Validate each item
    const allErrors = [];
    for (let i = 0; i < prefs.length; i++) {
      const errors = validateDndItem(prefs[i]);
      if (errors.length) allErrors.push({ index: i, errors });
    }
    if (allErrors.length) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: allErrors },
      });
    }

    const results = [];
    for (const pref of prefs) {
      const { channel, opt_out, quiet_hours_start = null, quiet_hours_end = null, reason = null } = pref;

      await db.query(
        `INSERT INTO client_dnd_preferences
           (organization_id, client_id, channel, opt_out, quiet_hours_start, quiet_hours_end, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           opt_out = VALUES(opt_out),
           quiet_hours_start = VALUES(quiet_hours_start),
           quiet_hours_end = VALUES(quiet_hours_end),
           reason = VALUES(reason)`,
        [req.orgId, clientId, channel, opt_out ? 1 : 0, quiet_hours_start, quiet_hours_end, reason],
      );

      const [rows] = await db.query(
        'SELECT * FROM client_dnd_preferences WHERE client_id = ? AND channel = ? AND organization_id = ?',
        [clientId, channel, req.orgId],
      );
      if (rows[0]) results.push(rows[0]);
    }

    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /clients/{clientId}/dnd/{channel}:
 *   patch:
 *     summary: Upsert DND preference for a single channel
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: channel
 *         required: true
 *         schema:
 *           type: string
 *           enum: [email, sms, whatsapp, all]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [opt_out]
 *             properties:
 *               opt_out:
 *                 type: boolean
 *               quiet_hours_start:
 *                 type: string
 *               quiet_hours_end:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated DND preference
 */
router.patch(
  '/:clientId/dnd/:channel',
  requirePermission('dnd.update'),
  validate(dndPrefSchema),
  async (req, res, next) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      const { channel } = req.params;

      if (!CHANNELS.includes(channel)) {
        return res.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: `channel must be one of: ${CHANNELS.join(', ')}` },
        });
      }

      const { opt_out, quiet_hours_start = null, quiet_hours_end = null, reason = null } = req.body;

      await db.query(
        `INSERT INTO client_dnd_preferences
           (organization_id, client_id, channel, opt_out, quiet_hours_start, quiet_hours_end, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           opt_out = VALUES(opt_out),
           quiet_hours_start = VALUES(quiet_hours_start),
           quiet_hours_end = VALUES(quiet_hours_end),
           reason = VALUES(reason)`,
        [req.orgId, clientId, channel, opt_out ? 1 : 0, quiet_hours_start, quiet_hours_end, reason],
      );

      const [rows] = await db.query(
        'SELECT * FROM client_dnd_preferences WHERE client_id = ? AND channel = ? AND organization_id = ?',
        [clientId, channel, req.orgId],
      );

      res.json({ data: rows[0] || null });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
