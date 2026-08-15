// =============================================================================
// FireISP 5.0 — DSAR (Data Subject Access Request) Route
// =============================================================================
// Produces a read-only JSON export of the enumerated, tenant-scoped datasets
// held for a client. Collections are streamed with keyset pagination so the
// server never silently truncates a response or loads an unbounded result set
// from MySQL in one query.
//
// This is an access/export mechanism, not an automatic erasure mechanism.
// Cancellation/erasure requests require a case-specific retention and legal-
// hold review; this route never deletes or anonymizes operational, fiscal, or
// statutory records.
// =============================================================================

'use strict';

const { Router } = require('express');
const { exportLimiter } = require('../middleware/rateLimit');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { NotFoundError, ValidationError } = require('../utils/errors');

const router = Router();

// A page is the largest collection fragment retained in application memory.
// The completed HTTP response may contain any number of pages.
const EXPORT_CHUNK_SIZE = 1000;

router.use(authenticate);
router.use(orgScope);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

function clientCollectionDescriptors(clientId, orgId) {
  return [
    {
      key: 'contacts',
      alias: 'contact',
      from: `contacts contact
             JOIN clients subject_client
               ON subject_client.id = contact.client_id`,
      where: `contact.client_id = ?
              AND subject_client.id = ?
              AND subject_client.organization_id = ?`,
      params: [clientId, clientId, orgId],
      select: `contact.id, contact.first_name, contact.last_name, contact.email,
               contact.phone, contact.role, contact.is_primary, contact.created_at`,
    },
    {
      key: 'mxProfiles',
      alias: 'mx_profile',
      from: `client_mx_profiles mx_profile
             JOIN clients subject_client
               ON subject_client.id = mx_profile.client_id`,
      where: `mx_profile.client_id = ?
              AND subject_client.id = ?
              AND subject_client.organization_id = ?`,
      params: [clientId, clientId, orgId],
      select: `mx_profile.id, mx_profile.rfc, mx_profile.curp,
               mx_profile.razon_social, mx_profile.regimen_fiscal,
               mx_profile.uso_cfdi_default AS uso_cfdi,
               mx_profile.codigo_postal_fiscal AS zip_code,
               mx_profile.colonia, mx_profile.municipio,
               mx_profile.exterior_number, mx_profile.interior_number,
               mx_profile.created_at, mx_profile.updated_at,
               mx_profile.deleted_at`,
    },
    {
      key: 'contracts',
      alias: 'contract',
      from: 'contracts contract',
      where: 'contract.client_id = ? AND contract.organization_id = ?',
      params: [clientId, orgId],
      select: `contract.id, contract.plan_id, contract.status, contract.start_date,
               contract.end_date, contract.price_override AS monthly_price,
               contract.connection_type, contract.created_at`,
    },
    {
      key: 'invoices',
      alias: 'invoice',
      from: 'invoices invoice',
      where: 'invoice.client_id = ? AND invoice.organization_id = ?',
      params: [clientId, orgId],
      select: `invoice.id, invoice.invoice_number, invoice.total, invoice.currency,
               invoice.status, invoice.due_date, invoice.issued_at,
               invoice.created_at`,
    },
    {
      key: 'payments',
      alias: 'payment',
      from: 'payments payment',
      where: 'payment.client_id = ? AND payment.organization_id = ?',
      params: [clientId, orgId],
      select: `payment.id, payment.amount, payment.currency,
               payment.payment_method, payment.status,
               payment.payment_date AS paid_at, payment.created_at`,
    },
    {
      key: 'tickets',
      alias: 'ticket',
      from: 'tickets ticket',
      where: 'ticket.client_id = ? AND ticket.organization_id = ?',
      params: [clientId, orgId],
      select: `ticket.id, ticket.subject, ticket.status, ticket.priority,
               ticket.created_at, ticket.resolved_at`,
    },
    {
      key: 'connectionLogs',
      alias: 'session_log',
      from: 'connection_logs session_log',
      where: 'session_log.client_id = ? AND session_log.organization_id = ?',
      params: [clientId, orgId],
      select: `session_log.id, session_log.organization_id, session_log.client_id,
               session_log.contract_id, session_log.nas_id, session_log.username,
               COALESCE(session_log.acct_session_id, session_log.session_id) AS radius_session_id,
               session_log.session_instance_id,
               COALESCE(session_log.framed_ip, session_log.ip_address) AS assigned_ipv4,
               COALESCE(session_log.framed_ipv6_prefix,
                        session_log.ipv6_delegated_prefix,
                        session_log.ipv6_address) AS assigned_ipv6,
               session_log.nas_ip_address, session_log.nas_port_id,
               session_log.called_station_id, session_log.calling_station_id,
               session_log.event_type AS latest_status,
               session_log.event_at AS session_started_at,
               session_log.last_accounting_at, session_log.last_accounting_received_at,
               CASE WHEN session_log.event_type = 'stop'
                    THEN COALESCE(session_log.last_accounting_at, session_log.event_at)
                    ELSE NULL END AS session_ended_at,
               session_log.acct_delay_seconds, session_log.bytes_in,
               session_log.bytes_out, session_log.packets_in,
               session_log.packets_out, session_log.session_duration,
               session_log.terminate_cause, session_log.stack_type`,
    },
    {
      key: 'radiusAccountingEvents',
      alias: 'accounting_event',
      from: 'radius_accounting_events accounting_event',
      // Direct ownership is preferred. Older/compatibility evidence may not
      // carry client_id, so an exact same-org contract, connection-log id, or
      // lifecycle UUID is also an unambiguous subject anchor.
      where: `accounting_event.organization_id = ?
              AND (
                accounting_event.client_id = ?
                OR EXISTS (
                  SELECT 1 FROM contracts subject_contract
                   WHERE subject_contract.id = accounting_event.contract_id
                     AND subject_contract.organization_id = ?
                     AND subject_contract.client_id = ?
                )
                OR EXISTS (
                  SELECT 1 FROM connection_logs subject_session
                   WHERE subject_session.organization_id = ?
                     AND subject_session.client_id = ?
                     AND (
                       (accounting_event.connection_log_id IS NOT NULL
                        AND subject_session.id = accounting_event.connection_log_id)
                       OR
                       (accounting_event.session_instance_id IS NOT NULL
                        AND subject_session.session_instance_id = accounting_event.session_instance_id)
                     )
                )
              )`,
      params: [orgId, clientId, orgId, clientId, orgId, clientId],
      select: `accounting_event.id, accounting_event.organization_id,
               accounting_event.client_id, accounting_event.contract_id,
               accounting_event.connection_log_id, accounting_event.nas_id,
               accounting_event.username, accounting_event.acct_session_id AS radius_session_id,
               accounting_event.session_instance_id, accounting_event.status_type,
               accounting_event.event_at, accounting_event.observed_at,
               accounting_event.nas_ip_address, accounting_event.nas_port_id,
               accounting_event.called_station_id, accounting_event.calling_station_id,
               accounting_event.framed_ip AS assigned_ipv4,
               accounting_event.framed_ipv6_prefix AS assigned_ipv6,
               accounting_event.bytes_in, accounting_event.bytes_out,
               accounting_event.packets_in, accounting_event.packets_out,
               accounting_event.session_duration, accounting_event.terminate_cause,
               accounting_event.acct_delay_seconds`,
    },
    {
      key: 'cgnatAttributionBindings',
      alias: 'binding',
      from: 'cgnat_attribution_bindings binding',
      // A DSAR is subject-linked. Public-tuple-only correlation is never used
      // because it could disclose another subscriber's allocation.
      where: `binding.organization_id = ?
              AND (
                binding.client_id = ?
                OR EXISTS (
                  SELECT 1 FROM contracts subject_contract
                   WHERE subject_contract.id = binding.contract_id
                     AND subject_contract.organization_id = ?
                     AND subject_contract.client_id = ?
                )
                OR EXISTS (
                  SELECT 1 FROM connection_logs subject_session
                   WHERE subject_session.organization_id = ?
                     AND subject_session.client_id = ?
                     AND (subject_session.id = binding.connection_log_id
                       OR subject_session.session_instance_id = binding.session_instance_id)
                )
              )`,
      params: [orgId, clientId, orgId, clientId, orgId, clientId],
      select: `binding.id, binding.organization_id, binding.client_id,
               binding.contract_id, binding.connection_log_id, binding.username,
               binding.radius_session_id, binding.session_instance_id,
               binding.binding_type, binding.private_ipv4,
               binding.private_port_start, binding.private_port_end,
               binding.public_ipv4, binding.public_port_start,
               binding.public_port_end, binding.protocol,
               binding.allocated_at, binding.released_at,
               binding.exporter_id, binding.nat_instance_id,
               binding.nat_pool_id, binding.nat_realm,
               binding.allocation_received_at, binding.release_received_at,
               binding.metadata_complete, binding.integrity_hash`,
    },
    {
      key: 'cgnatAttributionEvents',
      alias: 'binding_event',
      from: `cgnat_binding_events binding_event
             JOIN cgnat_attribution_bindings binding
               ON binding.id = binding_event.binding_id
              AND binding.organization_id = binding_event.organization_id`,
      where: `binding_event.organization_id = ?
              AND (
                binding.client_id = ?
                OR EXISTS (
                  SELECT 1 FROM contracts subject_contract
                   WHERE subject_contract.id = binding.contract_id
                     AND subject_contract.organization_id = ?
                     AND subject_contract.client_id = ?
                )
                OR EXISTS (
                  SELECT 1 FROM connection_logs subject_session
                   WHERE subject_session.organization_id = ?
                     AND subject_session.client_id = ?
                     AND (subject_session.id = binding.connection_log_id
                       OR subject_session.session_instance_id = binding.session_instance_id)
                )
              )`,
      params: [orgId, clientId, orgId, clientId, orgId, clientId],
      select: `binding_event.id, binding_event.organization_id,
               binding_event.binding_id, binding_event.event_type,
               binding_event.binding_key, binding_event.exporter_id,
               binding_event.exporter_boot_id, binding_event.event_id,
               binding_event.sequence_number, binding_event.sequence_status,
               binding_event.device_recorded_at, binding_event.received_at,
               binding_event.clock_offset_ms,
               binding_event.clock_uncertainty_ms,
               binding_event.records_lost_before,
               binding_event.allocated_at, binding_event.released_at,
               binding_event.integrity_hash`,
    },
    {
      key: 'radiusAccountingUsageDaily',
      alias: 'usage_day',
      from: 'radius_accounting_usage_daily usage_day',
      where: `usage_day.organization_id = ?
              AND (
                usage_day.client_id = ?
                OR EXISTS (
                  SELECT 1 FROM contracts subject_contract
                   WHERE subject_contract.id = usage_day.contract_id
                     AND subject_contract.organization_id = ?
                     AND subject_contract.client_id = ?
                )
                OR EXISTS (
                  SELECT 1 FROM connection_logs subject_session
                   WHERE subject_session.organization_id = ?
                     AND subject_session.client_id = ?
                     AND subject_session.session_instance_id = usage_day.session_instance_id
                )
              )`,
      params: [orgId, clientId, orgId, clientId, orgId, clientId],
      select: `usage_day.id, usage_day.organization_id, usage_day.client_id,
               usage_day.contract_id, usage_day.connection_log_id,
               usage_day.nas_id, usage_day.username,
               usage_day.session_instance_id, usage_day.usage_date,
               usage_day.bytes_in_delta, usage_day.bytes_out_delta,
               usage_day.packets_in_delta, usage_day.packets_out_delta,
               usage_day.duration_delta, usage_day.is_complete,
               usage_day.anomaly_count, usage_day.anomaly_reason,
               usage_day.first_event_at, usage_day.last_event_at`,
    },
    {
      key: 'ipAssignments',
      alias: 'ip_assignment',
      from: 'ip_assignments ip_assignment',
      where: 'ip_assignment.client_id = ? AND ip_assignment.organization_id = ?',
      params: [clientId, orgId],
      select: `ip_assignment.id, ip_assignment.ip_address,
               ip_assignment.prefix_len, ip_assignment.mac_address,
               ip_assignment.type, ip_assignment.status,
               ip_assignment.assigned_at,
               ip_assignment.expires_at AS released_at`,
    },
    {
      key: 'aiReplyLogs',
      alias: 'ai_reply',
      from: `ai_reply_logs ai_reply
             JOIN tickets subject_ticket
               ON subject_ticket.id = ai_reply.ticket_id`,
      where: `subject_ticket.client_id = ?
              AND subject_ticket.organization_id = ?
              AND ai_reply.organization_id = ?`,
      params: [clientId, orgId, orgId],
      // Draft/final text is responsive subject data. Internal prompts,
      // topology context, and prompt hashes are intentionally not exported.
      select: `ai_reply.id, ai_reply.ticket_id, ai_reply.action,
               ai_reply.confidence, ai_reply.classification,
               ai_reply.draft_text, ai_reply.final_text,
               ai_reply.created_at`,
    },
  ];
}

function writeResponseChunk(res, chunk) {
  if (res.destroyed) return Promise.reject(new Error('DSAR export client disconnected'));
  if (res.write(chunk)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.removeListener('drain', onDrain);
      res.removeListener('error', onError);
      res.removeListener('close', onClose);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (err) => { cleanup(); reject(err); };
    const onClose = () => { cleanup(); reject(new Error('DSAR export client disconnected')); };
    res.once('drain', onDrain);
    res.once('error', onError);
    res.once('close', onClose);
  });
}

async function snapshotCollection(descriptor) {
  const [[snapshot]] = await db.query(
    `SELECT MAX(${descriptor.alias}.id) AS max_id
       FROM ${descriptor.from}
      WHERE ${descriptor.where}`,
    descriptor.params,
  );
  return snapshot?.max_id ?? null;
}

async function streamCollection(res, descriptor, maxId) {
  if (maxId === null || maxId === undefined) return 0;

  let cursor = 0;
  let rowCount = 0;
  let first = true;

  while (true) {
    const [rows] = await db.query(
      `SELECT ${descriptor.select}
         FROM ${descriptor.from}
        WHERE ${descriptor.where}
          AND ${descriptor.alias}.id > ?
          AND ${descriptor.alias}.id <= ?
        ORDER BY ${descriptor.alias}.id ASC
        LIMIT ${EXPORT_CHUNK_SIZE}`,
      [...descriptor.params, cursor, maxId],
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      await writeResponseChunk(res, `${first ? '' : ','}${JSON.stringify(row)}`);
      first = false;
      rowCount += 1;
    }

    const nextCursor = rows[rows.length - 1].id;
    if (String(nextCursor) === String(cursor)) {
      throw new Error(`DSAR ${descriptor.key} cursor did not advance`);
    }
    cursor = nextCursor;

    if (rows.length < EXPORT_CHUNK_SIZE || String(cursor) === String(maxId)) break;
  }

  return rowCount;
}

async function logDsarExportAccess(req, status, counts = {}, failureCode = null) {
  const parameters = {
    client_id: Number(req.params.id),
    export_version: '2.0',
    status,
    complete_for_enumerated_datasets: status === 'completed',
    collection_counts: counts,
    authentication: req.user?.apiTokenId ? 'api_token' : 'user_session',
    api_token_id: req.user?.apiTokenId || null,
    actor_email: req.user?.email || null,
    failure_code: failureCode,
  };

  await db.withPrimaryContext(() => db.query(
    `INSERT INTO report_access_logs
       (organization_id, user_id, api_token_id, report_type, entity_type, entity_id,
        parameters, ip_address, user_agent, accessed_at)
     VALUES (?, ?, ?, 'dsar_client_export', 'clients', ?, ?, ?, ?, NOW())`,
    [req.orgId, req.user?.id || null, req.user?.apiTokenId || null,
      Number(req.params.id), JSON.stringify(parameters),
      req.ip || null, req.get('user-agent') || null],
  ));
}

/**
 * GET /dsar/clients/:id
 *
 * Streams every row in the enumerated datasets that is attributable to the
 * client within the authenticated organization as of each collection's
 * snapshot boundary. No collection is silently truncated.
 */
router.get(
  '/clients/:id',
  exportLimiter,
  requirePermission('clients.view'),
  requirePermission('dsar_requests.manage'),
  requirePermission('connection_logs.export'),
  async (req, res, next) => {
    let auditStarted = false;
    const counts = {};
    try {
      const { id } = req.params;
      if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
        throw new ValidationError('Invalid client id');
      }
      const clientId = Number(id);
      const orgId = req.orgId;
      const generatedAt = new Date().toISOString();

      const [[client]] = await db.query(
        `SELECT id, name, email, phone, client_type, locale, tax_id, curp,
                address, city, state, zip_code, country, notes, status,
                created_at, updated_at, deleted_at
           FROM clients
          WHERE id = ? AND organization_id = ?`,
        [clientId, orgId],
      );
      if (!client) throw new NotFoundError('Client');

      // Record the attempt before querying or emitting the remaining personal
      // data. A matching completed/failed entry below makes partial exports
      // visible without mutating or deleting the access ledger.
      await logDsarExportAccess(req, 'started');
      auditStarted = true;

      const [[mxProfile = null]] = await db.query(
        `SELECT profile.id, profile.rfc, profile.curp, profile.razon_social,
                profile.regimen_fiscal, profile.uso_cfdi_default AS uso_cfdi,
                profile.codigo_postal_fiscal AS zip_code, profile.colonia,
                profile.municipio, profile.exterior_number,
                profile.interior_number, profile.created_at,
                profile.updated_at, profile.deleted_at
           FROM client_mx_profiles profile
           JOIN clients subject_client ON subject_client.id = profile.client_id
          WHERE profile.client_id = ?
            AND subject_client.id = ?
            AND subject_client.organization_id = ?
            AND profile.deleted_at IS NULL
          ORDER BY profile.id DESC
          LIMIT 1`,
        [clientId, clientId, orgId],
      );

      // Resolve every collection boundary before sending headers. Schema or
      // database failures can therefore use the normal structured API error
      // path, and later inserts cannot extend a long-running export forever.
      const descriptors = clientCollectionDescriptors(clientId, orgId);
      const collectionSnapshots = new Map();
      for (const descriptor of descriptors) {
        collectionSnapshots.set(descriptor.key, await snapshotCollection(descriptor));
      }

      res.status(200);
      res.type('application/json');
      await writeResponseChunk(res, `{"data":{"client":${JSON.stringify(client)},"mxProfile":${JSON.stringify(mxProfile || null)}`);

      for (const descriptor of descriptors) {
        await writeResponseChunk(res, `,"${descriptor.key}":[`);
        counts[descriptor.key] = await streamCollection(
          res,
          descriptor,
          collectionSnapshots.get(descriptor.key),
        );
        await writeResponseChunk(res, ']');
      }

      // A successful sensitive export must be attributable even for isolated
      // tenant databases, so the access ledger is deliberately written in the
      // primary control plane with both user and API-token context.
      await logDsarExportAccess(req, 'completed', counts);

      const meta = {
        generatedAt,
        requestedBy: req.user && req.user.email,
        clientId: Number(id),
        organizationId: Number(orgId),
        version: '2.0',
        completeForEnumeratedDatasets: true,
        collectionCounts: counts,
        scope: {
          description: 'Selected FireISP operational datasets attributable to this client in this organization',
          organizationScoped: true,
          connectionAttribution: 'Direct client ID or unambiguous same-organization contract/session linkage',
          compatibilityViews: 'mxProfile is the current profile; mxProfiles contains every held profile row',
          allStorageSystemsCovered: false,
        },
        cancellation: {
          automaticDeletionPerformed: false,
          handling: 'review_required',
          notice: 'Cancellation or erasure requires a documented retention and legal-hold review; this export does not delete or anonymize records.',
        },
      };

      await writeResponseChunk(res, `},"meta":${JSON.stringify(meta)}}`);
      return res.end();
    } catch (err) {
      if (auditStarted) {
        try {
          await logDsarExportAccess(req, 'failed', counts, err.code || err.name || 'UNKNOWN');
        } catch (_auditErr) {
          // The started record remains durable. Preserve the original failure
          // and never turn a partial stream into a valid-looking document.
        }
      }
      if (res.headersSent) {
        if (!res.destroyed) res.destroy(err);
        return undefined;
      }
      return next(err);
    }
  },
);

/**
 * GET /dsar/requests
 *
 * Convenience listing of all DSAR requests for the authenticated organisation.
 * The full CRUD is at /regulatory-compliance/dsar-requests; this endpoint
 * provides a quick read-only view under the existing /dsar prefix.
 */
router.get('/requests', requirePermission('dsar_requests.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, (parseInt(page, 10) - 1) * safeLimit);

    const [rows] = await db.query(
      `SELECT * FROM dsar_requests WHERE organization_id = ? ORDER BY requested_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [req.orgId],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM dsar_requests WHERE organization_id = ?',
      [req.orgId],
    );

    res.json({ data: rows, meta: { total: countResult[0].total, page: parseInt(page, 10), limit: parseInt(limit, 10) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
