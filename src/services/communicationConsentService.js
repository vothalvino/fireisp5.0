// =============================================================================
// Installation communication-consent evidence
// =============================================================================
// Marketing permission is affirmative and channel-specific.  The mutable DND
// table remains an additional delivery veto; it is not treated as proof of
// consent.  This service is called from the same transaction that captures the
// customer's handoff signature so a signature can never commit without its
// corresponding communication choices (and vice versa).

const { ValidationError } = require('../utils/errors');
const communicationPreferences = require('./clientCommunicationPreferenceService');

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
    `SELECT status, email, phone, email_contact_epoch, phone_contact_epoch FROM clients
      WHERE id = ? AND organization_id <=> ? AND deleted_at IS NULL
      LIMIT 1 FOR UPDATE`,
    [clientId, organizationId],
  );
  const client = clients[0];
  if (!client) throw new ValidationError('The document client no longer exists');
  if (client.status === 'inactive') {
    throw new ValidationError('Communication choices cannot be granted for an inactive client');
  }
  if (normalized.email && !client.email) {
    throw new ValidationError('Email marketing cannot be enabled because the client has no email address');
  }
  if ((normalized.sms || normalized.whatsapp) && !client.phone) {
    throw new ValidationError('SMS or WhatsApp marketing cannot be enabled because the client has no phone number');
  }

  // A newly-confirmed channel-by-channel choice supersedes an older blanket
  // DND choice.  The three channel rows written below remain authoritative.
  await communicationPreferences.writePreferenceWithRun(run, {
    organizationId,
    clientId,
    channel: 'all',
    optOut: false,
    reason: 'Replaced by signed installation communication choices',
  });

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

    await communicationPreferences.writePreferenceWithRun(run, {
      organizationId,
      clientId,
      channel,
      optOut: !granted,
      reason: granted
        ? 'Granted during signed installation handoff'
        : 'Declined during signed installation handoff',
    });

    if (granted) {
      await run(
        `INSERT INTO subscriber_consents
           (organization_id, client_id, consent_version, purpose, given_at,
            ip_address, channel, document_hash, notes, communication_channel,
            source_context, service_order_id, work_order_id, signed_document_id,
            captured_by, communication_contact_epoch)
         VALUES (?, ?, ?, 'marketing', NOW(), ?, 'app', ?, ?, ?,
                 'installation_signature', ?, ?, ?, ?, ?)`,
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
          channel === 'email' ? client.email_contact_epoch : client.phone_contact_epoch,
        ],
      );
    }
  }

  return normalized;
}

module.exports = { COMMUNICATION_CHANNELS, validateChoices, recordSignedChoices };
