// =============================================================================
// FireISP 5.0 — PROFECO Complaint Export Service (P3.12)
// =============================================================================
// Generates structured PROFECO complaint reports for quarterly regulatory
// submissions to Mexico's Procuraduría Federal del Consumidor.
//
// Supported output formats:
//   • json — full detail report (default)
//   • csv  — flat CSV suitable for PROFECO's internal tracking spreadsheets
// =============================================================================

const db = require('../config/database');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Converts an array of plain objects to a CSV string.
 * Values containing commas, quotes, or newlines are quoted and escaped.
 */
function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape  = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Export builder
// ---------------------------------------------------------------------------

/**
 * Builds a PROFECO complaint report for the given organisation and date range.
 *
 * @param {number}  organizationId
 * @param {object}  opts
 * @param {string}  [opts.dateFrom]  ISO date string (inclusive lower bound on reported_at)
 * @param {string}  [opts.dateTo]    ISO date string (inclusive upper bound on reported_at)
 * @param {string}  [opts.status]    Filter to a single status value
 * @param {string}  [opts.format]    'json' (default) | 'csv'
 * @returns {Promise<{ format: string, filename: string, contentType: string, data: string|object }>}
 */
async function buildReport(organizationId, {
  dateFrom,
  dateTo,
  status,
  format = 'json',
} = {}) {
  let sql = `
    SELECT
      pc.id,
      pc.folio_profeco,
      pc.consumer_name,
      pc.consumer_email,
      pc.consumer_phone,
      pc.service_type,
      pc.category,
      pc.status,
      pc.description,
      pc.resolution_requested,
      pc.company_response,
      pc.reported_at,
      pc.resolved_at,
      pc.created_at,
      c.name       AS client_name,
      c.email      AS client_email,
      t.subject    AS ticket_title,
      u.first_name AS submitted_by_first_name,
      u.last_name  AS submitted_by_last_name
    FROM  profeco_complaints pc
    LEFT  JOIN clients c ON c.id = pc.client_id
    LEFT  JOIN tickets t ON t.id = pc.ticket_id
    LEFT  JOIN users   u ON u.id = pc.submitted_by
    WHERE pc.organization_id = ?
      AND pc.deleted_at IS NULL
  `;
  const params = [organizationId];

  if (dateFrom) {
    sql += ' AND pc.reported_at >= ?';
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += ' AND pc.reported_at <= ?';
    params.push(dateTo);
  }
  if (status) {
    sql += ' AND pc.status = ?';
    params.push(status);
  }

  sql += ' ORDER BY pc.reported_at DESC, pc.id DESC';

  const [rows] = await db.queryReplica(sql, params);

  // Summary counts by status
  const summary = { recibida: 0, en_tramite: 0, resuelta: 0, archivada: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(summary, row.status)) {
      summary[row.status]++;
    }
  }

  const now      = new Date().toISOString();
  const dateSufx = now.slice(0, 10);

  if (format === 'csv') {
    // Flatten to a simplified row set suitable for a spreadsheet
    const flat = rows.map(r => ({
      id:                   r.id,
      folio_profeco:        r.folio_profeco ?? '',
      consumer_name:        r.consumer_name,
      consumer_email:       r.consumer_email ?? '',
      consumer_phone:       r.consumer_phone ?? '',
      service_type:         r.service_type,
      category:             r.category,
      status:               r.status,
      description:          r.description,
      resolution_requested: r.resolution_requested ?? '',
      company_response:     r.company_response ?? '',
      reported_at:          r.reported_at ? new Date(r.reported_at).toISOString() : '',
      resolved_at:          r.resolved_at ? new Date(r.resolved_at).toISOString() : '',
      client_name:          r.client_name ?? '',
      client_email:         r.client_email ?? '',
      ticket_title:         r.ticket_title ?? '',
      submitted_by:         r.submitted_by_first_name
        ? `${r.submitted_by_first_name} ${r.submitted_by_last_name}`
        : '',
    }));

    return {
      format:      'csv',
      filename:    `profeco-complaints-${dateSufx}.csv`,
      contentType: 'text/csv',
      data:        toCsv(flat),
    };
  }

  // JSON format (default)
  return {
    format:      'json',
    filename:    `profeco-complaints-${dateSufx}.json`,
    contentType: 'application/json',
    data: {
      meta: {
        generatedAt:    now,
        organizationId: Number(organizationId),
        filters:        { dateFrom: dateFrom || null, dateTo: dateTo || null, status: status || null },
        totalComplaints: rows.length,
        summary,
      },
      complaints: rows,
    },
  };
}

module.exports = { buildReport, toCsv };
