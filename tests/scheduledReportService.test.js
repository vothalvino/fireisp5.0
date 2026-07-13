// =============================================================================
// FireISP 5.0 — Scheduled Report Service Tests
// =============================================================================
// Focused coverage for runSchedule()'s email-delivery leg, in particular the
// HTML-escaping fix for schedule.report_def_name (see src/services/
// scheduledReportService.js). Note: report_def_name is gated by
// generateReportData()'s hardcoded switch statement (~34 known slugs) before
// runSchedule ever reaches the email step — an unrecognized name throws
// 'Unknown report: ...' and processScheduledReports' outer catch swallows it
// without emailing anyone. That means an actually-malicious report_def_name
// cannot reach this sink through the current implementation; the escape is
// still correct defense-in-depth (protects any future, more permissive
// report-dispatch mechanism) and this suite verifies the happy-path wiring
// and the escaping helper's own behavior.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/reportService', () => ({
  agingReport: jest.fn(),
}));

jest.mock('../src/services/emailTransport', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const db = require('../src/config/database');
const reportService = require('../src/services/reportService');
const emailTransport = require('../src/services/emailTransport');
const { runSchedule } = require('../src/services/scheduledReportService');
const { escapeHtmlForTemplate } = require('../src/services/notificationService');

describe('scheduledReportService.runSchedule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('emails recipients with the report name embedded in subject and html', async () => {
    reportService.agingReport.mockResolvedValue({ rows: [{ client_id: 1, name: 'Alice', total: 100 }] });
    db.query
      .mockResolvedValueOnce([{ insertId: 5 }])       // INSERT INTO generated_reports
      .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE scheduled_reports

    const schedule = {
      id: 1,
      organization_id: 1,
      report_def_name: 'aging',
      format: 'csv',
      parameters: null,
      recipients: JSON.stringify(['ops@example.com']),
    };

    const result = await runSchedule(schedule);

    expect(result.reportId).toBe(5);
    expect(result.recipients).toBe(1);
    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 1,
        to: 'ops@example.com',
        subject: '[FireISP] Scheduled Report: aging',
        html: expect.stringContaining('<strong>aging</strong>'),
      }),
    );
  });

  test('the shared escapeHtmlForTemplate helper used for report_def_name correctly escapes HTML-significant characters', () => {
    // Direct unit coverage of the exact helper wired into
    // scheduledReportService.js's email html (import path verified above);
    // see the file-level comment for why report_def_name itself cannot
    // carry a live payload through the current generateReportData() switch.
    expect(escapeHtmlForTemplate('<script>alert(1)</script> Report'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt; Report');
    expect(escapeHtmlForTemplate("Tom & Jerry's Report")).toBe('Tom &amp; Jerry&#x27;s Report');
  });
});
