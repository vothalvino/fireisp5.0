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
const { buildBulkValues } = require('../utils/sqlBuild');
const communicationPreferences = require('./clientCommunicationPreferenceService');

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
 * filter_plan_id, and filter_tag (all optional). Requires affirmative, active,
 * channel-specific marketing consent and then
 * applies client_dnd_preferences as an additional veto.  A missing DND row is
 * never interpreted as permission to send.
 *
 * @param {object} campaign - Full communication_campaigns row
 * @param {Function} [run] - Query runner; pass a transaction-bound execute function during dispatch
 * @returns {Promise<Array<{client_id: number, recipient: string, channel: string}>>}
 */
async function buildRecipientList(campaign, run = db.query.bind(db)) {
  const { organization_id, channel, filter_status, filter_plan_id, filter_tag } = campaign;

  const conditions = [
    'c.organization_id <=> ?',
    'c.deleted_at IS NULL',
    "c.status <> 'inactive'",
  ];
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

  // Positive consent is the entry condition. Legacy broad marketing rows with
  // no communication_channel deliberately do not count: they cannot prove
  // which destination the customer approved.
  conditions.push(`
    EXISTS (
      SELECT 1 FROM subscriber_consents consent
      WHERE consent.client_id = c.id
        AND consent.organization_id <=> c.organization_id
        AND consent.purpose = 'marketing'
        AND consent.communication_channel = ?
        AND consent.withdrawn_at IS NULL
        AND consent.communication_contact_epoch = CASE
          WHEN consent.communication_channel = 'email' THEN c.email_contact_epoch
          ELSE c.phone_contact_epoch
        END
    )
  `);
  params.push(channel);

  // DND is a second, mutable safety veto even when consent exists.
  conditions.push(`
    NOT EXISTS (
      SELECT 1 FROM client_dnd_preferences dnd
      WHERE dnd.client_id = c.id
        AND dnd.organization_id <=> c.organization_id
        AND dnd.opt_out = 1
        AND dnd.channel IN ('all', ?)
    )
  `);
  params.push(channel);

  const whereClause = conditions.join(' AND ');

  const recipientField = (channel === 'email') ? 'c.email' : 'c.phone';
  const contactEpochField = (channel === 'email') ? 'c.email_contact_epoch' : 'c.phone_contact_epoch';

  const sql = `
    SELECT c.id AS client_id, ${recipientField} AS recipient,
           ${contactEpochField} AS client_contact_epoch
    FROM clients c
    WHERE ${whereClause}
      AND ${recipientField} IS NOT NULL
      AND ${recipientField} != ''
  `;

  const [rows] = await run(sql, params);

  return rows.map(row => ({
    client_id: row.client_id,
    recipient: row.recipient,
    client_contact_epoch: Number(row.client_contact_epoch || 0),
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
  const owner = await communicationPreferences.getOrganizationDeliveryState(organizationId);
  if (!owner.active) throw new Error('Organization is not active');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Serialize dispatches for one campaign. A competing request waits for
    // this lock, then observes the committed non-dispatchable status instead
    // of independently inserting the same recipient snapshot.
    const [campaignRows] = await conn.execute(
      `SELECT * FROM communication_campaigns
        WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL
        FOR UPDATE`,
      [campaignId, organizationId],
    );

    const campaign = campaignRows[0];
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
    if (!['draft', 'failed', 'cancelled'].includes(campaign.status)) {
      throw new Error(`Campaign ${campaignId} cannot be dispatched from status '${campaign.status}'`);
    }

    // A provider may have accepted a previously claimed message even if its
    // worker crashed before recording the outcome. Never build a replacement
    // batch while that ambiguity remains, or redispatch could duplicate it.
    const [unresolvedRows] = await conn.execute(
      `SELECT id FROM campaign_messages
        WHERE campaign_id = ? AND organization_id <=> ?
          AND status = 'failed' AND error_message IN (?, ?)
        LIMIT 1 FOR UPDATE`,
      [campaignId, organizationId,
        'Delivery claimed; awaiting provider result',
        'Provider invocation started; delivery outcome is unknown'],
    );
    if (unresolvedRows[0]) {
      throw new Error(`Campaign ${campaignId} has an unresolved provider outcome and cannot be redispatched`);
    }

    // A cancelled/failed campaign can be dispatched again. Retire any rows
    // left queued by its previous run before changing it back to sending, or
    // those stale snapshots would become eligible alongside the new batch.
    if (campaign.status !== 'draft') {
      await conn.execute(
        `UPDATE campaign_messages
            SET status = 'failed', error_message = ?
          WHERE campaign_id = ? AND organization_id <=> ? AND status = 'queued'`,
        ['Superseded by campaign redispatch', campaignId, organizationId],
      );
    }

    const recipients = await buildRecipientList(campaign, conn.execute.bind(conn));
    const nextStatus = recipients.length === 0 ? 'sent' : 'sending';
    const completedAt = recipients.length === 0 ? 'NOW()' : 'NULL';
    const [transition] = await conn.execute(
      `UPDATE communication_campaigns
          SET status = ?, recipient_count = ?, started_at = NOW(), completed_at = ${completedAt}
        WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL AND status = ?`,
      [nextStatus, recipients.length, campaignId, organizationId, campaign.status],
    );
    if (transition.affectedRows !== 1) {
      throw new Error(`Campaign ${campaignId} cannot be dispatched because its state changed`);
    }

    if (recipients.length > 0) {
      const now = new Date();
      const insertValues = recipients.map(r => [
        organizationId,
        owner.epoch || 0,
        campaignId,
        r.client_id,
        r.client_contact_epoch,
        r.recipient,
        r.channel,
        'queued',
        now,
      ]);
      // execute() cannot expand a 2-D array bound to one placeholder.
      const { placeholders, values } = buildBulkValues(insertValues);
      await conn.execute(
        `INSERT INTO campaign_messages
           (organization_id, organization_epoch, campaign_id, client_id,
            client_contact_epoch, recipient, channel, status, queued_at)
         VALUES ${placeholders}`,
        values,
      );
    }

    await conn.commit();
    logger.info({ campaignId, queued: recipients.length }, 'Campaign dispatched');
    return { queued: recipients.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
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
const DELIVERY_CLAIM_MARKER = 'Delivery claimed; awaiting provider result';
const DELIVERY_OUTCOME_UNKNOWN = 'Provider invocation started; delivery outcome is unknown';
const STALE_CLAIM_MINUTES = 5;

async function processCurrentQueue({ organizationId = null, excludeOrganizationIds = [] } = {}) {
  const excluded = [...new Set(excludeOrganizationIds.map(Number).filter(Number.isSafeInteger))];
  const params = [];
  let scope = '';
  if (organizationId !== null && organizationId !== undefined) {
    scope = ' AND cc.organization_id = ?';
    params.push(Number(organizationId));
  } else if (excluded.length) {
    scope = ` AND (cc.organization_id IS NULL OR cc.organization_id NOT IN (${excluded.map(() => '?').join(',')}))`;
    params.push(...excluded);
  }
  // A stale pre-I/O claim is safe to recover. Outcome-unknown rows are never
  // reclaimed because the provider may already have accepted the message.
  await db.query(`
    UPDATE campaign_messages cm
    JOIN communication_campaigns cc
      ON cc.id = cm.campaign_id
     AND cc.organization_id <=> cm.organization_id
       SET cm.status = 'queued', cm.error_message = NULL
     WHERE cm.status = 'failed' AND cm.error_message = ?
       AND cm.updated_at < DATE_SUB(NOW(), INTERVAL ${STALE_CLAIM_MINUTES} MINUTE)
       ${scope}
  `, [DELIVERY_CLAIM_MARKER, ...params]);
  const [queued] = await db.query(`
    SELECT cm.*, cc.template_id AS campaign_template_id,
           cc.organization_id AS campaign_org_id
    FROM campaign_messages cm
    JOIN communication_campaigns cc
      ON cc.id = cm.campaign_id
     AND cc.organization_id <=> cm.organization_id
    WHERE cm.status = 'queued'
      AND cc.status = 'sending'
      AND cc.deleted_at IS NULL
      ${scope}
    ORDER BY cm.queued_at ASC
    LIMIT 100
  `, params);

  let sent = 0;
  let failed = 0;

  for (const msg of queued) {
    const organizationId = msg.campaign_org_id;
    // The queued row freezes both transport channel and destination. Campaign
    // edits after dispatch must never redirect an already-queued message.
    const channel = msg.channel;

    let providerBoundaryOwned = false;
    try {
      const owner = await communicationPreferences.getOrganizationDeliveryState(organizationId);
      if (!owner.active || Number(owner.epoch) !== Number(msg.organization_epoch || 0)) {
        const [skip] = await db.query(
          `UPDATE campaign_messages SET status = 'failed', error_message = ?
            WHERE id = ? AND organization_id <=> ? AND status = 'queued'`,
          ['Organization delivery authorization changed; message skipped', msg.id, organizationId],
        );
        if (skip.affectedRows === 1) {
          await db.query(
            `UPDATE communication_campaigns SET failed_count = failed_count + 1
              WHERE id = ? AND organization_id <=> ?`,
            [msg.campaign_id, organizationId],
          );
          failed++;
        }
        continue;
      }
      let subject = 'Mensaje de su proveedor';
      let body = '';

      if (msg.campaign_template_id) {
        const [templateRows] = await db.query(
          `SELECT * FROM message_templates
            WHERE id = ? AND deleted_at IS NULL AND is_active = 1
              AND (organization_id <=> ? OR organization_id IS NULL)`,
          [msg.campaign_template_id, organizationId],
        );
        const tpl = templateRows[0];

        if (tpl) {
          let clientData = {};
          if (msg.client_id) {
            const [clientRows] = await db.query(
              `SELECT * FROM clients
                WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL`,
              [msg.client_id, organizationId],
            );
            if (clientRows[0]) clientData = clientRows[0];
          }

          const escapeHtml = channel === 'email';
          subject = interpolate(tpl.subject || subject, clientData, { escapeHtml });
          body = interpolate(tpl.body_text || tpl.body_html || tpl.body || '', clientData, { escapeHtml });
        }
      }

      // This compare-and-set is both the last-moment eligibility check and the
      // delivery claim. Only one worker can change queued -> failed; failed is
      // used as an honest, schema-compatible in-flight state and is promoted
      // to sent only after the provider confirms acceptance.
      const [claim] = await db.query(
        `UPDATE campaign_messages cm
          JOIN communication_campaigns cc
            ON cc.id = cm.campaign_id
           AND cc.organization_id <=> cm.organization_id
          JOIN clients c
            ON c.id = cm.client_id
           AND c.organization_id <=> cc.organization_id
           AND c.deleted_at IS NULL
           AND c.status <> 'inactive'
           SET cm.status = 'failed', cm.error_message = ?
         WHERE cm.id = ? AND cm.status = 'queued'
           AND cm.organization_id <=> ?
           AND cm.channel = ? AND cm.recipient = ?
           AND cm.client_contact_epoch = CASE
             WHEN cm.channel = 'email' THEN c.email_contact_epoch
             ELSE c.phone_contact_epoch
           END
           AND cc.status = 'sending' AND cc.deleted_at IS NULL
           AND (
             (cm.channel = 'email' AND c.email = cm.recipient)
             OR (cm.channel IN ('sms', 'whatsapp') AND c.phone = cm.recipient)
           )
           AND EXISTS (
             SELECT 1 FROM subscriber_consents consent
              WHERE consent.organization_id <=> cc.organization_id
                AND consent.client_id = c.id
                AND consent.purpose = 'marketing'
                AND consent.communication_channel = cm.channel
                AND consent.withdrawn_at IS NULL
                AND consent.communication_contact_epoch = CASE
                  WHEN consent.communication_channel = 'email' THEN c.email_contact_epoch
                  ELSE c.phone_contact_epoch
                END
           )
           AND NOT EXISTS (
             SELECT 1 FROM client_dnd_preferences dnd
              WHERE dnd.organization_id <=> cc.organization_id
                AND dnd.client_id = c.id
                AND dnd.opt_out = 1
                AND dnd.channel IN ('all', cm.channel)
           )`,
        [DELIVERY_CLAIM_MARKER, msg.id, organizationId, channel, msg.recipient],
      );

      if (claim.affectedRows !== 1) {
        // If the row is still queued, the live campaign/client/contact/consent
        // guard rejected it. If another worker already claimed it, this update
        // affects zero rows and this worker quietly leaves it alone.
        const [skip] = await db.query(
          `UPDATE campaign_messages
              SET status = 'failed', error_message = ?
            WHERE id = ? AND organization_id <=> ? AND status = 'queued'`,
          [`Recipient or ${channel} permission changed; message skipped`, msg.id, organizationId],
        );
        if (skip.affectedRows === 1) {
          await db.query(
            `UPDATE communication_campaigns
                SET failed_count = failed_count + 1
              WHERE id = ? AND organization_id <=> ?`,
            [msg.campaign_id, organizationId],
          );
          failed++;
        }
        continue;
      }

      const finalOwner = await communicationPreferences.getOrganizationDeliveryState(organizationId);
      if (!finalOwner.active || Number(finalOwner.epoch) !== Number(msg.organization_epoch || 0)) {
        const [skip] = await db.query(
          `UPDATE campaign_messages SET status = 'failed', error_message = ?
            WHERE id = ? AND organization_id <=> ?
              AND status = 'failed' AND error_message = ?`,
          ['Organization delivery authorization changed; message skipped', msg.id, organizationId, DELIVERY_CLAIM_MARKER],
        );
        if (skip.affectedRows === 1) {
          await db.query(
            `UPDATE communication_campaigns SET failed_count = failed_count + 1
              WHERE id = ? AND organization_id <=> ?`,
            [msg.campaign_id, organizationId],
          );
          failed++;
        }
        continue;
      }

      // From this durable marker onward a crash is ambiguous: the provider
      // may accept the message even if no result reaches the database. Never
      // auto-recover or redispatch this state.
      const [invocation] = await db.query(
        `UPDATE campaign_messages
            SET error_message = ?
          WHERE id = ? AND organization_id <=> ?
            AND status = 'failed' AND error_message = ?`,
        [DELIVERY_OUTCOME_UNKNOWN, msg.id, organizationId, DELIVERY_CLAIM_MARKER],
      );
      if (invocation.affectedRows !== 1) continue;
      providerBoundaryOwned = true;

      // No database or rendering work belongs between the guarded claim and
      // transport invocation: this is the narrowest practical revocation and
      // cancellation race window without holding a DB lock across network I/O.
      const result = channel === 'email'
        ? await emailTransport.sendEmail({
          organizationId,
          clientId: msg.client_id || null,
          to: msg.recipient,
          subject,
          html: body || undefined,
          text: body || undefined,
          messageClass: 'marketing',
          expectedClientContactEpoch: Number(msg.client_contact_epoch || 0),
        })
        : await smsTransport.sendSms({
          organizationId,
          clientId: msg.client_id || null,
          to: msg.recipient,
          body,
          channel,
          messageClass: 'marketing',
          expectedClientContactEpoch: Number(msg.client_contact_epoch || 0),
        });

      if (result.success) {
        const [outcome] = await db.query(
          `UPDATE campaign_messages
              SET status = 'sent', sent_at = NOW(), provider_message_id = ?, error_message = NULL
            WHERE id = ? AND organization_id <=> ?
              AND status = 'failed' AND error_message = ?`,
          [result.messageId || null, msg.id, organizationId, DELIVERY_OUTCOME_UNKNOWN],
        );
        if (outcome.affectedRows !== 1) continue;
        await db.query(
          `UPDATE communication_campaigns
              SET sent_count = sent_count + 1
            WHERE id = ? AND organization_id <=> ?`,
          [msg.campaign_id, organizationId],
        );
        sent++;
      } else {
        // A policy skip proves no provider call happened inside the guarded
        // transport and may become an ordinary terminal failure. Any provider
        // failure remains outcome-unknown to prevent an automatic duplicate.
        if (result.skipped) {
          await db.query(
            `UPDATE campaign_messages
                SET status = 'failed', error_message = ?
              WHERE id = ? AND organization_id <=> ?
                AND status = 'failed' AND error_message = ?`,
            [result.error || 'Recipient permission changed; message skipped',
              msg.id, organizationId, DELIVERY_OUTCOME_UNKNOWN],
          );
        }
        await db.query(
          `UPDATE communication_campaigns
              SET failed_count = failed_count + 1
            WHERE id = ? AND organization_id <=> ?`,
          [msg.campaign_id, organizationId],
        );
        failed++;
      }
    } catch (err) {
      logger.warn({ code: err?.code || 'CAMPAIGN_DELIVERY_FAILED', msgId: msg.id }, 'Campaign message send failed');
      // Preserve outcome-unknown after provider invocation. Before that
      // boundary, a failure is known not to have sent and may be terminalized.
      const [failureUpdate] = providerBoundaryOwned
        ? [{ affectedRows: 1 }]
        : await db.query(
          `UPDATE campaign_messages
              SET status = 'failed', error_message = ?
            WHERE id = ? AND organization_id <=> ?
              AND (status = 'queued' OR (status = 'failed' AND error_message = ?))`,
          ['Campaign delivery failed before provider invocation',
            msg.id, organizationId, DELIVERY_CLAIM_MARKER],
        ).catch(() => [{ affectedRows: 0 }]);
      if (failureUpdate.affectedRows === 1) {
        await db.query(
          `UPDATE communication_campaigns
              SET failed_count = failed_count + 1
            WHERE id = ? AND organization_id <=> ?`,
          [msg.campaign_id, organizationId],
        ).catch(() => {});
        failed++;
      }
    }
  }

  await db.query(
    `UPDATE communication_campaigns cc
          SET cc.status = CASE
                WHEN EXISTS (
                  SELECT 1 FROM campaign_messages unresolved
                   WHERE unresolved.campaign_id = cc.id
                     AND unresolved.organization_id <=> cc.organization_id
                     AND unresolved.status = 'failed'
                     AND unresolved.error_message = ?
                ) THEN 'failed'
                ELSE 'sent'
              END,
              cc.completed_at = NOW()
        WHERE cc.status = 'sending' AND cc.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM campaign_messages cm
             WHERE cm.campaign_id = cc.id
               AND (
                 cm.status = 'queued'
                 OR (cm.status = 'failed' AND cm.error_message = ?)
               )
          )${scope}`,
    [DELIVERY_OUTCOME_UNKNOWN, DELIVERY_CLAIM_MARKER, ...params],
  );

  return { sent, failed, total: queued.length };
}

function mergeQueueResults(target, result) {
  target.sent += Number(result.sent || 0);
  target.failed += Number(result.failed || 0);
  target.total += Number(result.total || 0);
}

async function processQueue(organizationId = null) {
  if (organizationId !== null && organizationId !== undefined) {
    const run = () => processCurrentQueue({ organizationId: Number(organizationId) });
    return typeof db.withTenantContext === 'function'
      ? db.withTenantContext(Number(organizationId), run)
      : run();
  }
  if (typeof db.withPrimaryContext !== 'function' || typeof db.withTenantContext !== 'function') {
    return processCurrentQueue();
  }
  const [isolated] = await db.withPrimaryContext(() => db.query(
    `SELECT organization_id FROM organization_database_configs
      WHERE isolation_mode = 'isolated' ORDER BY organization_id`,
  ));
  const isolatedIds = isolated.map(row => Number(row.organization_id)).filter(Number.isSafeInteger);
  const total = { sent: 0, failed: 0, total: 0 };
  mergeQueueResults(total, await db.withPrimaryContext(
    () => processCurrentQueue({ excludeOrganizationIds: isolatedIds }),
  ));
  for (const row of isolated) {
    try {
      mergeQueueResults(total, await db.withTenantContext(
        Number(row.organization_id),
        () => processCurrentQueue({ organizationId: Number(row.organization_id) }),
      ));
    } catch (_err) {
      total.failed++;
    }
  }
  return total;
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
