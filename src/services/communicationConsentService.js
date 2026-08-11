// =============================================================================
// Installation communication-consent evidence
// =============================================================================
// Marketing permission is affirmative and channel-specific.  The mutable DND
// table remains an additional delivery veto; it is not treated as proof of
// consent.  This service is called from the same transaction that captures the
// customer's handoff signature so a signature can never commit without its
// corresponding communication choices (and vice versa).

const { ValidationError } = require('../utils/errors');

const COMMUNICATION_CHANNELS = ['email', 'sms', 'whatsapp'];

function validateChoices(choices) {
  if (!choices || typeof choices !== 'object' || Array.isArray(choices)) {
    throw new ValidationError('communication_opt_ins is required for the customer handoff signature');
  }
  for (const channel of COMMUNICATION_CHANNELS) {
    if (typeof choices[channel] !== 'boolean') {
      throw new ValidationError(`communication_opt_ins.${channel} must be a boolean`);
    }
  }
  return Object.fromEntries(COMMUNICATION_CHANNELS.map(channel => [channel, choices[channel]]));
}

async function recordSignedChoices(run, {
  organizationId,
  clientId,
  serviceOrderId,
  workOrderId,
  signedDocumentId,
  capturedBy,
  ipAddress,
  notice,
  choices,
}) {
  const normalized = validateChoices(choices);

  const [clients] = await run(
    `SELECT email, phone FROM clients
      WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL LIMIT 1`,
    [clientId, organizationId],
  );
  const client = clients[0];
  if (!client) throw new ValidationError('The document client no longer exists');
  if (normalized.email && !client.email) {
    throw new ValidationError('Email marketing cannot be enabled because the client has no email address');
  }
  if ((normalized.sms || normalized.whatsapp) && !client.phone) {
    throw new ValidationError('SMS or WhatsApp marketing cannot be enabled because the client has no phone number');
  }

  // A newly-confirmed channel-by-channel choice supersedes an older blanket
  // DND choice.  The three channel rows written below remain authoritative.
  await run(
    `INSERT INTO client_dnd_preferences
       (organization_id, client_id, channel, opt_out, reason)
     VALUES (?, ?, 'all', 0, ?)
     ON DUPLICATE KEY UPDATE organization_id = VALUES(organization_id),
       opt_out = 0, reason = VALUES(reason)`,
    [organizationId, clientId, 'Replaced by signed installation communication choices'],
  );

  for (const channel of COMMUNICATION_CHANNELS) {
    const granted = normalized[channel];

    // End any prior affirmative grant for this channel before recording the
    // new decision.  Historical rows remain append-only evidence.
    await run(
      `UPDATE subscriber_consents
          SET withdrawn_at = COALESCE(withdrawn_at, NOW())
        WHERE client_id = ? AND purpose = 'marketing'
          AND organization_id <=> ?
          AND communication_channel = ? AND withdrawn_at IS NULL`,
      [clientId, organizationId, channel],
    );

    await run(
      `INSERT INTO client_dnd_preferences
         (organization_id, client_id, channel, opt_out, reason)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE organization_id = VALUES(organization_id),
         opt_out = VALUES(opt_out), reason = VALUES(reason)`,
      [
        organizationId,
        clientId,
        channel,
        granted ? 0 : 1,
        granted ? 'Granted during signed installation handoff' : 'Declined during signed installation handoff',
      ],
    );

    if (granted) {
      await run(
        `INSERT INTO subscriber_consents
           (organization_id, client_id, consent_version, purpose, given_at,
            ip_address, channel, document_hash, notes, communication_channel,
            source_context, service_order_id, work_order_id, signed_document_id, captured_by)
         VALUES (?, ?, ?, 'marketing', NOW(), ?, 'app', ?, ?, ?,
                 'installation_signature', ?, ?, ?, ?)`,
        [
          organizationId,
          clientId,
          notice.version,
          ipAddress || null,
          notice.hash,
          `Optional ${channel} promotional communications approved by the customer`,
          channel,
          serviceOrderId || null,
          workOrderId || null,
          signedDocumentId,
          capturedBy || null,
        ],
      );
    }
  }

  return normalized;
}

module.exports = { COMMUNICATION_CHANNELS, validateChoices, recordSignedChoices };
