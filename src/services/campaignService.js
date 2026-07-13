// =============================================================================
// FireISP 5.0 — Campaign Service — §1.4
// =============================================================================
// Orchestrates bulk communication campaign dispatch: builds recipient lists,
// queues per-recipient messages, processes the send queue, and handles delivery
// status callbacks from providers.
// =============================================================================

const db = require('../config/database');
const emailTransport = require('./emailTransport');
const smsTransport = require('./smsTransport');
const logger = require('../utils/logger');
const { escapeHtmlForTemplate } = require('./notificationService');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Interpolate {{variable}} placeholders in a template string using a data
 * object. `tpl.body_html`/`tpl.subject` are staff-authored HTML/text — only
 * the substituted VALUES (client columns: name, email, etc. — free-text DB
 * data) are escaped when `escapeHtml` is set, never the surrounding
 * template markup itself. Callers pass `escapeHtml: true` for the email
 * channel only; the SMS channel sends the same interpolated string as
 * plain text and must NOT have its merge values HTML-escaped.
 * @param {string} template
 * @param {object} data
 * @param {object} [options]
 * @param {boolean} [options.escapeHtml=false]
 * @returns {string}
 */
function interpolate(template, data, { escapeHtml = false } = {}) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const raw = data[key] !== undefined && data[key] !== null ? String(data[key]) : '';
    return escapeHtml ? escapeHtmlForTemplate(raw) : raw;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the recipient list for a campaign based on its filters.
 *
 * Queries the clients table for org-scoped clients that match filter_status,
 * filter_plan_id, and filter_tag (all optional). Joins against
 * client_dnd_preferences to exclude opted-out clients for the campaign's
 * channel (or the 'all' channel).
 *
 * @param {object} campaign - Full communication_campaigns row
 * @returns {Promise<Array<{client_id: number, recipient: string, channel: string}>>}
 */
async function buildRecipientList(campaign) {
  const { organization_id, channel, filter_status, filter_plan_id, filter_tag } = campaign;

  const conditions = ['c.organization_id = ?'];
  const params = [organization_id];

  if (filter_status) {
    conditions.push('c.status = ?');
    params.push(filter_status);
  }

  if (filter_plan_id) {
    // Clients attached to a plan via their active contract
    conditions.push(
      'EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = c.id AND ct.plan_id = ? AND ct.status = \'active\')',
    );
    params.push(filter_plan_id);
  }

  if (filter_tag) {
    // Clients that belong to a client group whose name matches the tag
    conditions.push(
      'EXISTS (SELECT 1 FROM client_group_members cgm JOIN client_groups cg ON cg.id = cgm.group_id WHERE cgm.client_id = c.id AND cg.name = ?)',
    );
    params.push(filter_tag);
  }

  // Exclude clients who have opted out for this channel or 'all'
  conditions.push(`
    NOT EXISTS (
      SELECT 1 FROM client_dnd_preferences dnd
      WHERE dnd.client_id = c.id
        AND dnd.opt_out = 1
        AND dnd.channel IN ('all', ?)
    )
  `);
  params.push(channel);

  const whereClause = conditions.join(' AND ');

  const recipientField = (channel === 'email') ? 'c.email' : 'c.phone';

  const sql = `
    SELECT c.id AS client_id, ${recipientField} AS recipient
    FROM clients c
    WHERE ${whereClause}
      AND ${recipientField} IS NOT NULL
      AND ${recipientField} != ''
  `;

  const [rows] = await db.query(sql, params);

  return rows.map(row => ({
    client_id: row.client_id,
    recipient: row.recipient,
    channel,
  }));
}

/**
 * Dispatch a campaign: build recipient list, insert campaign_messages rows as
 * 'queued', update campaign status to 'sending', and set recipient_count.
 *
 * @param {number} campaignId
 * @param {number} organizationId
 * @returns {Promise<{queued: number}>}
 */
async function dispatchCampaign(campaignId, organizationId) {
  const [campaignRows] = await db.query(
    'SELECT * FROM communication_campaigns WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [campaignId, organizationId],
  );

  const campaign = campaignRows[0];
  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }

  if (!['draft', 'failed', 'cancelled'].includes(campaign.status)) {
    throw new Error(`Campaign ${campaignId} cannot be dispatched from status '${campaign.status}'`);
  }

  const recipients = await buildRecipientList(campaign);

  if (recipients.length === 0) {
    await db.query(
      `UPDATE communication_campaigns
          SET status = 'sent', recipient_count = 0, started_at = NOW(), completed_at = NOW()
        WHERE id = ?`,
      [campaignId],
    );
    return { queued: 0 };
  }

  // Bulk-insert campaign_messages as 'queued'
  const now = new Date();
  const insertValues = recipients.map(r => [
    organizationId,
    campaignId,
    r.client_id,
    r.recipient,
    r.channel,
    'queued',
    now,
  ]);

  await db.query(
    `INSERT INTO campaign_messages
       (organization_id, campaign_id, client_id, recipient, channel, status, queued_at)
     VALUES ?`,
    [insertValues],
  );

  await db.query(
    `UPDATE communication_campaigns
        SET status = 'sending', recipient_count = ?, started_at = NOW()
      WHERE id = ?`,
    [recipients.length, campaignId],
  );

  logger.info({ campaignId, queued: recipients.length }, 'Campaign dispatched');
  return { queued: recipients.length };
}

/**
 * Process queued campaign_messages rows (up to 100 at a time).
 *
 * For each message: load the template if campaign has template_id, interpolate
 * with client data, then send via emailTransport or smsTransport. Updates the
 * message row status and the campaign's aggregate counters.
 *
 * Called by the 'campaign_send' scheduled task.
 *
 * @returns {Promise<{sent: number, failed: number, total: number}>}
 */
async function processQueue() {
  const [queued] = await db.query(`
    SELECT cm.*, cc.template_id AS campaign_template_id, cc.channel AS campaign_channel,
           cc.organization_id AS campaign_org_id
    FROM campaign_messages cm
    JOIN communication_campaigns cc ON cc.id = cm.campaign_id
    WHERE cm.status = 'queued'
    ORDER BY cm.queued_at ASC
    LIMIT 100
  `);

  let sent = 0;
  let failed = 0;

  for (const msg of queued) {
    try {
      const organizationId = msg.campaign_org_id;
      const channel = msg.campaign_channel || msg.channel;

      // Load template content if available
      let subject = 'Mensaje de su proveedor';
      let body = msg.recipient; // fallback – overridden below

      if (msg.campaign_template_id) {
        const [templateRows] = await db.query(
          'SELECT * FROM message_templates WHERE id = ?',
          [msg.campaign_template_id],
        );
        const tpl = templateRows[0];

        if (tpl) {
          // Load client data for variable substitution
          let clientData = {};
          if (msg.client_id) {
            const [clientRows] = await db.query(
              'SELECT * FROM clients WHERE id = ?',
              [msg.client_id],
            );
            if (clientRows[0]) clientData = clientRows[0];
          }

          const escapeHtml = channel === 'email';
          subject = interpolate(tpl.subject || subject, clientData, { escapeHtml });
          body = interpolate(tpl.body_text || tpl.body_html || '', clientData, { escapeHtml });
        }
      } else {
        body = '';
        subject = 'Mensaje de su proveedor';
      }

      let result;
      if (channel === 'email') {
        result = await emailTransport.sendEmail({
          organizationId,
          to: msg.recipient,
          subject,
          html: body || undefined,
          text: body || undefined,
        });
      } else {
        result = await smsTransport.sendSms({
          organizationId,
          clientId: msg.client_id || null,
          to: msg.recipient,
          body,
          channel,
        });
      }

      if (result.success) {
        await db.query(
          `UPDATE campaign_messages
              SET status = 'sent', sent_at = NOW(), provider_message_id = ?
            WHERE id = ?`,
          [result.messageId || null, msg.id],
        );

        await db.query(
          `UPDATE communication_campaigns
              SET sent_count = sent_count + 1
            WHERE id = ?`,
          [msg.campaign_id],
        );
        sent++;
      } else {
        await db.query(
          `UPDATE campaign_messages
              SET status = 'failed', error_message = ?
            WHERE id = ?`,
          [result.error || 'Unknown error', msg.id],
        );

        await db.query(
          `UPDATE communication_campaigns
              SET failed_count = failed_count + 1
            WHERE id = ?`,
          [msg.campaign_id],
        );
        failed++;
      }
    } catch (err) {
      logger.warn({ err, msgId: msg.id }, 'Campaign message send failed');

      await db.query(
        `UPDATE campaign_messages
            SET status = 'failed', error_message = ?
          WHERE id = ?`,
        [err.message || String(err), msg.id],
      ).catch(() => {});

      await db.query(
        `UPDATE communication_campaigns
            SET failed_count = failed_count + 1
          WHERE id = ?`,
        [msg.campaign_id],
      ).catch(() => {});
      failed++;
    }
  }

  // Mark campaigns as 'sent' when all messages are processed
  if (queued.length > 0) {
    await db.query(`
      UPDATE communication_campaigns cc
      SET cc.status = 'sent', cc.completed_at = NOW()
      WHERE cc.status = 'sending'
        AND NOT EXISTS (
          SELECT 1 FROM campaign_messages cm
          WHERE cm.campaign_id = cc.id AND cm.status = 'queued'
        )
    `);
  }

  return { sent, failed, total: queued.length };
}

/**
 * Handle a delivery status callback from a provider (webhook).
 *
 * Finds the campaign_message by provider_message_id, updates its status and
 * appropriate timestamp, then increments the campaign's aggregate counter.
 *
 * @param {string} providerMessageId
 * @param {string} newStatus - 'delivered', 'bounced', 'opened', 'failed'
 * @param {object} [meta] - Extra data from provider
 * @returns {Promise<{updated: boolean}>}
 */
async function handleDeliveryCallback(providerMessageId, newStatus, _meta = {}) {
  if (!providerMessageId) return { updated: false };

  const validStatuses = ['delivered', 'bounced', 'opened', 'failed'];
  if (!validStatuses.includes(newStatus)) {
    logger.warn({ providerMessageId, newStatus }, 'handleDeliveryCallback: unknown status');
    return { updated: false };
  }

  const [rows] = await db.query(
    'SELECT * FROM campaign_messages WHERE provider_message_id = ?',
    [providerMessageId],
  );

  const msg = rows[0];
  if (!msg) {
    logger.debug({ providerMessageId }, 'handleDeliveryCallback: message not found');
    return { updated: false };
  }

  // Map status → timestamp column
  const timestampCol = {
    delivered: 'delivered_at',
    bounced: 'bounced_at',
    opened: 'opened_at',
    failed: null,
  }[newStatus];

  const timestampClause = timestampCol ? `, ${timestampCol} = NOW()` : '';

  await db.query(
    `UPDATE campaign_messages SET status = ?${timestampClause} WHERE id = ?`,
    [newStatus, msg.id],
  );

  // Increment the campaign's aggregate counter
  const counterCol = `${newStatus}_count`;
  await db.query(
    `UPDATE communication_campaigns SET ${counterCol} = ${counterCol} + 1 WHERE id = ?`,
    [msg.campaign_id],
  );

  logger.debug({ providerMessageId, newStatus, msgId: msg.id }, 'Delivery callback processed');
  return { updated: true };
}

module.exports = { buildRecipientList, dispatchCampaign, processQueue, handleDeliveryCallback };
