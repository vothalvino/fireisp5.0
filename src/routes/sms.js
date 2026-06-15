// =============================================================================
// FireISP 5.0 — SMS Routes
// =============================================================================
// Provides admin access to SMS delivery logs, manual send, and retry.
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const smsTransport = require('../services/smsTransport');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');

const router = Router();

router.use(authenticate, orgScope);

// ---------------------------------------------------------------------------
// GET /sms/logs — paginated SMS delivery log
// ---------------------------------------------------------------------------
router.get('/logs', requirePermission('read'), async (req, res) => {
  const {
    page     = 1,
    pageSize = 20,
    status,
    channel,
    clientId,
    phone,
  } = req.query;

  const limit  = Math.min(parseInt(pageSize, 10) || 20, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let where  = 'WHERE sl.organization_id = ?';
  const params = [req.organizationId];

  if (status)   { where += ' AND sl.status = ?';       params.push(status); }
  if (channel)  { where += ' AND sl.channel = ?';      params.push(channel); }
  if (clientId) { where += ' AND sl.client_id = ?';    params.push(clientId); }
  if (phone)    { where += ' AND sl.phone_number LIKE ?'; params.push(`%${phone}%`); }

  const countSql = `SELECT COUNT(*) AS total FROM sms_logs sl ${where}`;
  const dataSql  = `
    SELECT sl.*,
           CONCAT(c.first_name, ' ', c.last_name) AS client_name
      FROM sms_logs sl
      LEFT JOIN clients c ON c.id = sl.client_id
     ${where}
     ORDER BY sl.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`;

  const [[{ total }]] = await db.query(countSql, params);
  const [rows]        = await db.query(dataSql, params);

  res.json({
    data:  rows,
    total: Number(total),
    page:  Number(page),
    pageSize: limit,
  });
});

// ---------------------------------------------------------------------------
// POST /sms/send — send an SMS immediately (admin/support tool)
// ---------------------------------------------------------------------------
const sendSchema = {
  to:      { type: 'string', required: true, min: 7, max: 20 },
  body:    { type: 'string', required: true, min: 1, max: 1600 },
  channel: { type: 'string', enum: ['sms', 'whatsapp'] },
  clientId: { type: 'number' },
  templateId: { type: 'number' },
};

router.post('/send', requirePermission('write'), validate(sendSchema), async (req, res) => {
  const { to, body, channel = 'sms', clientId = null, templateId = null } = req.body;

  const result = await smsTransport.sendSms({
    organizationId: req.organizationId,
    clientId,
    to,
    body,
    channel,
    templateId,
  });

  if (result.success) {
    return res.status(200).json({ success: true, messageId: result.messageId });
  }
  return res.status(502).json({ success: false, error: result.error });
});

// ---------------------------------------------------------------------------
// POST /sms/logs/:id/retry — retry a failed SMS
// ---------------------------------------------------------------------------
router.post('/logs/:id/retry', requirePermission('write'), async (req, res) => {
  const logId = parseInt(req.params.id, 10);

  // Verify the log belongs to this org
  const [rows] = await db.query(
    'SELECT id FROM sms_logs WHERE id = ? AND organization_id = ?',
    [logId, req.organizationId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'SMS log not found' });

  const result = await smsTransport.retryLog(logId);
  if (result.success) {
    return res.json({ success: true, messageId: result.messageId });
  }
  return res.status(502).json({ success: false, error: result.error });
});

module.exports = router;
