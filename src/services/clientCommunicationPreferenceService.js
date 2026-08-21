// =============================================================================
// FireISP 5.0 — Authoritative client communication preference enforcement
// =============================================================================
// `client_dnd_preferences` is the mutable delivery veto for every client-
// directed email, SMS, and WhatsApp message. Marketing delivery additionally
// requires a current affirmative `subscriber_consents` row. The helpers in
// this module are deliberately shared by routes, transports, and signed-
// consent workflows so one path cannot accidentally implement weaker rules.
// =============================================================================

const db = require('../config/database');
const { NotFoundError, ValidationError } = require('../utils/errors');

const CHANNELS = Object.freeze(['email', 'sms', 'whatsapp']);
const PREFERENCE_CHANNELS = Object.freeze(['all', ...CHANNELS]);
const MESSAGE_CLASSES = Object.freeze(['marketing', 'transactional', 'security', 'support_reply']);

const BLOCK_CODES = Object.freeze({
  ORGANIZATION_INACTIVE: 'ORGANIZATION_INACTIVE',
  ORGANIZATION_REQUIRED: 'CLIENT_ORGANIZATION_REQUIRED',
  CLIENT_INACTIVE: 'CLIENT_INACTIVE',
  CLIENT_NOT_FOUND: 'CLIENT_NOT_FOUND',
  CONTACT_MISMATCH: 'CLIENT_COMMUNICATION_CONTACT_MISMATCH',
  OPTED_OUT: 'CLIENT_COMMUNICATION_OPTED_OUT',
  CONSENT_REQUIRED: 'CLIENT_MARKETING_CONSENT_REQUIRED',
});

function withPrimary(callback) {
  return typeof db.withPrimaryContext === 'function' ? db.withPrimaryContext(callback) : callback();
}

function withTenant(organizationId, callback) {
  return organizationId === null || organizationId === undefined
    || typeof db.withTenantContext !== 'function'
    ? callback()
    : db.withTenantContext(Number(organizationId), callback);
}

async function getOrganizationDeliveryState(organizationId) {
  // NULL is retained only for explicitly operational/internal delivery and
  // legacy unbound inbound replies. Client-directed delivery is rejected by
  // evaluateWithRun() below because an organization FK may become NULL after
  // an owner is hard-deleted; treating that as active would revive stale work.
  if (organizationId === null || organizationId === undefined) {
    return { active: true, epoch: 0 };
  }
  if (!Number.isSafeInteger(Number(organizationId)) || Number(organizationId) <= 0) {
    return { active: false, epoch: null };
  }
  return withPrimary(async () => {
    const [rows] = await db.query(
      `SELECT status, deleted_at, outbound_delivery_epoch
         FROM organizations
        WHERE id = ?
        LIMIT 1`,
      [Number(organizationId)],
    );
    const row = rows[0];
    return {
      active: Boolean(row && row.status === 'active'
        && (row.deleted_at === null || row.deleted_at === undefined)),
      epoch: row ? Number(row.outbound_delivery_epoch || 0) : null,
    };
  });
}

async function isOrganizationActive(organizationId) {
  return (await getOrganizationDeliveryState(organizationId)).active;
}

function assertChannel(channel, { allowAll = false } = {}) {
  const allowed = allowAll ? PREFERENCE_CHANNELS : CHANNELS;
  if (!allowed.includes(channel)) {
    throw new ValidationError(`channel must be one of: ${allowed.join(', ')}`);
  }
  return channel;
}

function assertMessageClass(messageClass) {
  if (!MESSAGE_CLASSES.includes(messageClass)) {
    throw new ValidationError(`messageClass must be one of: ${MESSAGE_CLASSES.join(', ')}`);
  }
  return messageClass;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  if (value === null || value === undefined) return '';
  let digits = String(value).trim().replace(/^whatsapp:/i, '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // WhatsApp's historical Mexican mobile form used +521 followed by ten
  // digits. Treat it as the same destination as canonical +52.
  if (digits.startsWith('521') && digits.length === 13) digits = `52${digits.slice(3)}`;
  return digits;
}

function destinationMatches(client, channel, destination) {
  if (channel === 'email') {
    return normalizeEmail(client.email) !== ''
      && normalizeEmail(client.email) === normalizeEmail(destination);
  }
  return normalizePhone(client.phone) !== ''
    && normalizePhone(client.phone) === normalizePhone(destination);
}

/**
 * Evaluate the live client/contact/preference state using the supplied query
 * runner. Call this immediately before transport I/O for the narrowest
 * practical opt-out race window.
 */
async function evaluateWithRun(run, {
  organizationId,
  clientId,
  channel,
  destination,
  messageClass,
}) {
  assertChannel(channel);
  assertMessageClass(messageClass);
  if (organizationId === null || organizationId === undefined) {
    return { allowed: false, code: BLOCK_CODES.ORGANIZATION_REQUIRED };
  }
  if (!(await isOrganizationActive(organizationId))) {
    return { allowed: false, code: BLOCK_CODES.ORGANIZATION_INACTIVE };
  }
  if (!Number.isSafeInteger(Number(clientId)) || Number(clientId) <= 0) {
    return { allowed: false, code: BLOCK_CODES.CLIENT_NOT_FOUND };
  }

  const [rows] = await run(
    `SELECT c.id, c.organization_id, c.status, c.email, c.phone,
            c.email_contact_epoch, c.phone_contact_epoch,
            EXISTS (
              SELECT 1
                FROM client_dnd_preferences dnd
               WHERE dnd.client_id = c.id
                 AND dnd.organization_id <=> c.organization_id
                 AND dnd.channel IN ('all', ?)
                 AND dnd.opt_out = 1
            ) AS opted_out,
            EXISTS (
              SELECT 1
                FROM subscriber_consents consent
               WHERE consent.client_id = c.id
                 AND consent.organization_id <=> c.organization_id
                 AND consent.purpose = 'marketing'
                 AND consent.communication_channel = ?
                 AND consent.withdrawn_at IS NULL
                 AND consent.communication_contact_epoch = CASE
                   WHEN consent.communication_channel = 'email' THEN c.email_contact_epoch
                   ELSE c.phone_contact_epoch
                 END
            ) AS has_marketing_consent
       FROM clients c
      WHERE c.id = ? AND c.organization_id <=> ?
        AND c.deleted_at IS NULL
      LIMIT 1`,
    [channel, channel, Number(clientId), organizationId ?? null],
  );

  const client = rows[0];
  if (!client) return { allowed: false, code: BLOCK_CODES.CLIENT_NOT_FOUND };
  if (client.status === 'inactive') {
    return { allowed: false, code: BLOCK_CODES.CLIENT_INACTIVE };
  }
  if (!destinationMatches(client, channel, destination)) {
    return { allowed: false, code: BLOCK_CODES.CONTACT_MISMATCH };
  }
  if (client.opted_out) {
    return { allowed: false, code: BLOCK_CODES.OPTED_OUT };
  }
  if (messageClass === 'marketing' && !client.has_marketing_consent) {
    return { allowed: false, code: BLOCK_CODES.CONSENT_REQUIRED };
  }
  return {
    allowed: true,
    code: null,
    contactEpoch: Number(channel === 'email'
      ? client.email_contact_epoch
      : client.phone_contact_epoch) || 0,
  };
}

async function evaluateClientCommunication(options) {
  const orgId = options.organizationId;
  const execute = () => evaluateWithRun(db.query.bind(db), options);
  return withTenant(orgId, execute);
}

function blockedResult(code) {
  return {
    success: false,
    skipped: true,
    code,
    error: 'Client communication preference blocks this delivery.',
  };
}

/**
 * Upsert one mutable veto using an existing transaction/query runner.
 * Opting out also withdraws every active marketing grant for the affected
 * channel(s), so clearing the veto later cannot resurrect stale consent.
 * Opting back in removes only the veto; marketing still needs a new explicit
 * consent record.
 */
async function writePreferenceWithRun(run, {
  organizationId,
  clientId,
  channel,
  optOut,
  quietHoursStart = null,
  quietHoursEnd = null,
  reason = null,
}) {
  assertChannel(channel, { allowAll: true });

  const [clients] = await run(
    `SELECT id FROM clients
      WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL
      LIMIT 1 FOR UPDATE`,
    [Number(clientId), organizationId ?? null],
  );
  if (!clients[0]) throw new NotFoundError('Client');

  if (optOut) {
    const channelPredicate = channel === 'all'
      ? "communication_channel IN ('email','sms','whatsapp')"
      : 'communication_channel = ?';
    const params = [Number(clientId), organizationId ?? null];
    if (channel !== 'all') params.push(channel);
    await run(
      `UPDATE subscriber_consents
          SET withdrawn_at = COALESCE(withdrawn_at, NOW())
        WHERE client_id = ? AND organization_id <=> ?
          AND purpose = 'marketing' AND withdrawn_at IS NULL
          AND ${channelPredicate}`,
      params,
    );
  }

  // A channel-specific opt-in must also clear an older blanket veto or the
  // requested channel would remain blocked even though the API reported the
  // update as successful. First materialize vetoes for the OTHER channels so
  // clearing the blanket row cannot accidentally opt them in as a side effect.
  if (!optOut && channel !== 'all') {
    for (const otherChannel of CHANNELS.filter(candidate => candidate !== channel)) {
      await run(
        `INSERT INTO client_dnd_preferences
           (organization_id, client_id, channel, opt_out, reason)
         SELECT ?, ?, ?, 1, 'Preserved from blanket opt-out'
          WHERE EXISTS (
            SELECT 1 FROM client_dnd_preferences blanket
             WHERE blanket.client_id = ? AND blanket.organization_id <=> ?
               AND blanket.channel = 'all' AND blanket.opt_out = 1
          )
         ON DUPLICATE KEY UPDATE
           organization_id = VALUES(organization_id),
           opt_out = 1,
           reason = VALUES(reason)`,
        [
          organizationId ?? null,
          Number(clientId),
          otherChannel,
          Number(clientId),
          organizationId ?? null,
        ],
      );
    }
    await run(
      `UPDATE client_dnd_preferences
          SET opt_out = 0,
              reason = 'Superseded by a channel-specific opt-in'
        WHERE client_id = ? AND organization_id <=> ?
          AND channel = 'all' AND opt_out = 1`,
      [Number(clientId), organizationId ?? null],
    );
  }

  // `all=false` means the client removed the blanket communication veto, not
  // merely that the synthetic `all` row changed state. Clear every exact
  // channel veto as well so the effective result matches the API choice.
  // This still does NOT create marketing consent; marketing remains blocked
  // until a fresh affirmative channel-specific grant is recorded.
  if (!optOut && channel === 'all') {
    await run(
      `UPDATE client_dnd_preferences
          SET opt_out = 0,
              reason = 'Client opted back in to communications'
        WHERE client_id = ? AND organization_id <=> ?
          AND channel IN ('email','sms','whatsapp') AND opt_out = 1`,
      [Number(clientId), organizationId ?? null],
    );
  }

  await run(
    `INSERT INTO client_dnd_preferences
       (organization_id, client_id, channel, opt_out,
        quiet_hours_start, quiet_hours_end, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       organization_id = VALUES(organization_id),
       opt_out = VALUES(opt_out),
       quiet_hours_start = VALUES(quiet_hours_start),
       quiet_hours_end = VALUES(quiet_hours_end),
       reason = VALUES(reason)`,
    [
      organizationId ?? null,
      Number(clientId),
      channel,
      optOut ? 1 : 0,
      quietHoursStart || null,
      quietHoursEnd || null,
      reason || null,
    ],
  );

  const [rows] = await run(
    `SELECT * FROM client_dnd_preferences
      WHERE client_id = ? AND channel = ? AND organization_id <=> ?`,
    [Number(clientId), channel, organizationId ?? null],
  );
  return rows[0] || null;
}

async function setClientPreferences({ organizationId, clientId, preferences }) {
  if (!Array.isArray(preferences) || preferences.length === 0) {
    throw new ValidationError('At least one communication preference is required');
  }

  const operation = async () => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const results = [];
      for (const preference of preferences) {
        results.push(await writePreferenceWithRun(conn.execute.bind(conn), {
          organizationId,
          clientId,
          ...preference,
        }));
      }
      await conn.commit();
      return results;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  };

  return withTenant(organizationId, operation);
}

module.exports = {
  CHANNELS,
  PREFERENCE_CHANNELS,
  MESSAGE_CLASSES,
  BLOCK_CODES,
  assertChannel,
  assertMessageClass,
  evaluateWithRun,
  evaluateClientCommunication,
  blockedResult,
  getOrganizationDeliveryState,
  isOrganizationActive,
  writePreferenceWithRun,
  setClientPreferences,
};
