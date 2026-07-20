// =============================================================================
// FireISP 5.0 — Scheduled Report Service
// =============================================================================
// Generates reports per schedule and emails them to recipients.
// =============================================================================

const db = require('../config/database');
const reportService = require('./reportService');
const emailTransport = require('./emailTransport');
const logger = require('../utils/logger');
// schedule.report_def_name (below) is DB-stored text interpolated raw into
// the HTML report-delivery email — escape it.
const { escapeHtmlForTemplate: esc } = require('./notificationService');

/**
 * Process all due scheduled reports.
 * Finds enabled schedules where next_run_at <= NOW(), generates report, emails recipients.
 */
async function processScheduledReports() {
  const [schedules] = await db.query(`
    SELECT sr.*, o.name AS org_name
    FROM scheduled_reports sr
    JOIN organizations o ON o.id = sr.organization_id
    WHERE sr.is_enabled = 1
      AND sr.deleted_at IS NULL
      AND (sr.next_run_at IS NULL OR sr.next_run_at <= NOW())
  `);

  let processed = 0;
  let failed = 0;

  for (const schedule of schedules) {
    try {
      await runSchedule(schedule);
      processed++;
    } catch (err) {
      logger.error({ err, scheduleId: schedule.id }, 'Scheduled report failed');
      await db.query(
        'UPDATE scheduled_reports SET last_run_at = NOW(), last_status = \'failed\' WHERE id = ?',
        [schedule.id],
      );
      failed++;
    }
  }

  return { processed, failed, total: schedules.length };
}

/**
 * Run a single schedule: generate report data, format, insert history, email.
 */
async function runSchedule(schedule) {
  const params = schedule.parameters ? JSON.parse(schedule.parameters) : {};
  const recipients = schedule.recipients ? JSON.parse(schedule.recipients) : [];

  // Generate report data
  const data = await generateReportData(schedule.organization_id, schedule.report_def_name, params);

  // Format content
  const { buffer, contentType, extension } = await formatReport(data, schedule.report_def_name, schedule.format);

  // Insert history record
  const [histResult] = await db.query(
    `INSERT INTO generated_reports
       (organization_id, scheduled_report_id, report_def_name, format, status, generated_at)
     VALUES (?, ?, ?, ?, 'completed', NOW())`,
    [schedule.organization_id, schedule.id, schedule.report_def_name, schedule.format],
  );
  const reportId = histResult.insertId;

  // Email recipients
  if (recipients.length > 0) {
    for (const email of recipients) {
      try {
        await emailTransport.sendEmail({
          organizationId: schedule.organization_id,
          to: email,
          subject: `[FireISP] Scheduled Report: ${schedule.report_def_name}`,
          html: `<p>Your scheduled report <strong>${esc(schedule.report_def_name)}</strong> is attached.</p>
                 <p>Generated: ${new Date().toLocaleString()}</p>`,
          attachments: [{
            filename: `${schedule.report_def_name}-${new Date().toISOString().slice(0, 10)}.${extension}`,
            content: buffer,
            contentType,
          }],
        });
      } catch (emailErr) {
        logger.warn({ emailErr, email }, 'Failed to email report');
      }
    }
  }

  // Update schedule last_run_at and next_run_at (simple: add 1 hour for now)
  await db.query(
    `UPDATE scheduled_reports
     SET last_run_at = NOW(), last_status = 'completed',
         next_run_at = DATE_ADD(NOW(), INTERVAL 1 HOUR)
     WHERE id = ?`,
    [schedule.id],
  );

  return { reportId, recipients: recipients.length };
}

/**
 * Generate report data by dispatching to reportService.
 */
async function generateReportData(organizationId, reportName, params) {
  const from = params.from;
  const to = params.to;
  const months = params.months ? parseInt(params.months, 10) : 12;

  switch (reportName) {
    case 'aging': return reportService.agingReport(organizationId, params);
    case 'financial': return reportService.financialSummary(organizationId, { from, to });
    case 'technicians': return reportService.technicianReport(organizationId, { from, to });
    case 'subscriber-growth': return reportService.subscriberGrowthReport(organizationId, { months });
    case 'revenue-by-period': return reportService.revenueByPeriod(organizationId, params);
    case 'revenue-by-plan': return reportService.revenueByPlan(organizationId, { from, to });
    case 'revenue-by-region': return reportService.revenueByRegion(organizationId, { from, to });
    case 'revenue-by-agent': return reportService.revenueByAgent(organizationId, { from, to });
    case 'cash-flow': return reportService.cashFlowReport(organizationId, { from, to });
    case 'payment-methods': return reportService.paymentMethodBreakdown(organizationId, { from, to });
    case 'churn-revenue': return reportService.churnRevenueImpact(organizationId, { months });
    case 'agent-commissions': return reportService.agentCommissions(organizationId, params);
    case 'tax-summary': return reportService.taxSummary(organizationId, { from, to });
    case 'sat-export': return reportService.satExport(organizationId, { from, to });
    case 'subscriber-counts': return reportService.subscriberCounts(organizationId, { from, to });
    case 'arpu': return reportService.arpuReport(organizationId, { months });
    case 'bandwidth-utilization': return reportService.bandwidthUtilization(organizationId, params);
    case 'top-consumers': return reportService.topConsumers(organizationId, params);
    case 'uptime-by-area': return reportService.uptimeByArea(organizationId, params);
    case 'mttr': return reportService.mttrReport(organizationId, { from, to });
    case 'installation-completion': return reportService.installationCompletion(organizationId, { from, to });
    case 'congested-links': return reportService.congestedLinks(organizationId, params);
    case 'sfp-lifespan': return reportService.sfpLifespan(organizationId);
    case 'optical-degradation': return reportService.opticalDegradation(organizationId, params);
    case 'device-reboots': return reportService.deviceReboots(organizationId, params);
    case 'snmp-poll-success': return reportService.snmpPollSuccess(organizationId, params);
    case 'alert-frequency': return reportService.alertFrequency(organizationId, params);
    case 'capacity-forecast': return reportService.capacityForecast(organizationId, params);
    case 'pon-utilization': return reportService.ponUtilization(organizationId);
    case 'data-retention-compliance': return reportService.dataRetentionCompliance(organizationId);
    case 'ip-assignment-log': return reportService.ipAssignmentLog(organizationId, params);
    case 'subscriber-identity': return reportService.subscriberIdentity(organizationId, { from, to });
    case 'interception-readiness': return reportService.interceptionReadiness(organizationId);
    case 'regulatory-export': return reportService.regulatoryExport(organizationId, { from, to });
    default:
      throw new Error(`Unknown report: ${reportName}`);
  }
}

/**
 * Format report data as CSV, XLSX, or PDF buffer.
 */
async function formatReport(data, reportName, format) {
  const rows = data.rows || data.details || data.months || data.technicians || [];

  if (format === 'csv') {
    const csv = toCSV(rows);
    return { buffer: Buffer.from(csv, 'utf8'), contentType: 'text/csv', extension: 'csv' };
  }

  if (format === 'xlsx') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(reportName);
    if (rows.length > 0) {
      ws.columns = Object.keys(rows[0]).map(k => ({ header: k, key: k }));
      ws.addRows(rows);
    }
    const buffer = await wb.xlsx.writeBuffer();
    return { buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
  }

  if (format === 'pdf') {
    const PDFDocument = require('pdfkit');
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: 'application/pdf', extension: 'pdf' }));
      doc.on('error', reject);

      doc.fontSize(16).text(`Report: ${reportName}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(10);

      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        doc.text(headers.join(' | '));
        doc.moveDown(0.3);
        for (const row of rows.slice(0, 100)) {
          doc.text(headers.map(h => fmtCell(row[h] ?? '')).join(' | '));
        }
        if (rows.length > 100) doc.text(`... and ${rows.length - 100} more rows`);
      } else {
        doc.text('No data for this report.');
      }

      doc.end();
    });
  }

  throw new Error(`Unsupported format: ${format}`);
}

// DATE/DATETIME columns arrive from mysql2 as JS Date objects; String(d) dumps
// the full "Wed Aug 12 2026 00:00:00 GMT+0000 (…)" form into report cells (CSV
// and the PDF branch above — XLSX is safe, exceljs date-types Date instances).
// A DATE column is UTC midnight → render the bare day; else keep date+time.
function fmtCell(v) {
  if (!(v instanceof Date)) return String(v ?? '');
  const iso = v.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/**
 * Convert array of objects to CSV string.
 */
function toCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = v => {
    const s = fmtCell(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

/**
 * Run an on-demand report: generate data, format, insert into generated_reports.
 * Used by POST /reports/generate and POST /scheduled-reports/:id/run.
 *
 * @param {object} opts
 * @param {number} opts.organizationId
 * @param {string} opts.reportDefName  - report slug (e.g. 'aging', 'revenue-by-period')
 * @param {string} opts.format         - 'csv' | 'xlsx' | 'pdf'
 * @param {object} opts.parameters     - optional runtime params { from, to, months, ... }
 * @param {number|null} opts.scheduledReportId - null for pure on-demand
 * @param {number|null} opts.generatedBy       - user id who triggered
 * @returns {{ reportId: number, status: string }}
 */
async function runOnDemand({ organizationId, reportDefName, format = 'csv', parameters = {}, scheduledReportId = null, generatedBy = null }) {
  // Insert a pending history row first so we always have a record
  const [pendingResult] = await db.query(
    `INSERT INTO generated_reports
       (organization_id, scheduled_report_id, report_def_name, format, status, generated_by, generated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, NOW())`,
    [organizationId, scheduledReportId, reportDefName, format, generatedBy],
  );
  const reportId = pendingResult.insertId;

  try {
    const data = await generateReportData(organizationId, reportDefName, parameters);
    // formatReport is async (xlsx/pdf use streams)
    await formatReport(data, reportDefName, format); // result not stored — buffer returned to caller
    await db.query(
      'UPDATE generated_reports SET status = \'completed\' WHERE id = ?',
      [reportId],
    );
    return { reportId, status: 'completed' };
  } catch (err) {
    await db.query(
      'UPDATE generated_reports SET status = \'failed\', error_message = ? WHERE id = ?',
      [err.message, reportId],
    );
    throw err;
  }
}

module.exports = {
  processScheduledReports,
  runSchedule,
  generateReportData,
  formatReport,
  toCSV,
  runOnDemand,
};
