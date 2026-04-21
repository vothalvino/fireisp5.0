// =============================================================================
// FireISP 5.0 — IFT Statistical Report Validation Schemas
// =============================================================================
//
// Field names mirror the columns in `ift_statistical_reports` (migrations 079
// and 157) so values posted through the API are actually persisted. See
// `docs/ift-statistical-report-schema-review.md` for the IFT field mapping.
//
// All `subscribers_by_*` and `coverage_localities` payloads are accepted as
// JSON-serialized strings (consistent with the convention used elsewhere in
// this project for JSON columns going through the simple validator).

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Period identifiers: YYYY-Qn (quarterly) or YYYY-MM (monthly), max 10 chars.
const REPORT_PERIOD_PATTERN = /^\d{4}-(?:Q[1-4]|(?:0[1-9]|1[0-2]))$/;

const createIftStatisticalReport = {
  concession_title_id: { type: 'number', min: 1 },
  report_period: { type: 'string', required: true, max: 10, pattern: REPORT_PERIOD_PATTERN },
  period_start: { type: 'string', required: true, pattern: ISO_DATE_PATTERN },
  period_end: { type: 'string', required: true, pattern: ISO_DATE_PATTERN },
  total_subscribers: { type: 'number', min: 0 },
  subscribers_by_speed_tier: { type: 'string', max: 5000 },
  subscribers_by_state: { type: 'string', max: 5000 },
  subscribers_by_municipality: { type: 'string', max: 10000 },
  subscribers_by_technology: { type: 'string', max: 5000 },
  subscribers_by_customer_type: { type: 'string', max: 5000 },
  subscribers_by_payment_modality: { type: 'string', max: 5000 },
  coverage_localities: { type: 'string', max: 20000 },
  coverage_municipalities: { type: 'number', min: 0 },
  avg_download_speed_mbps: { type: 'number', min: 0 },
  avg_upload_speed_mbps: { type: 'number', min: 0 },
  revenue_total: { type: 'number', min: 0 },
  filing_id: { type: 'number', min: 1 },
  filed_at: { type: 'string', max: 32 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['draft', 'final', 'filed'] },
};

const updateIftStatisticalReport = {
  concession_title_id: { type: 'number', min: 1 },
  report_period: { type: 'string', max: 10, pattern: REPORT_PERIOD_PATTERN },
  period_start: { type: 'string', pattern: ISO_DATE_PATTERN },
  period_end: { type: 'string', pattern: ISO_DATE_PATTERN },
  total_subscribers: { type: 'number', min: 0 },
  subscribers_by_speed_tier: { type: 'string', max: 5000 },
  subscribers_by_state: { type: 'string', max: 5000 },
  subscribers_by_municipality: { type: 'string', max: 10000 },
  subscribers_by_technology: { type: 'string', max: 5000 },
  subscribers_by_customer_type: { type: 'string', max: 5000 },
  subscribers_by_payment_modality: { type: 'string', max: 5000 },
  coverage_localities: { type: 'string', max: 20000 },
  coverage_municipalities: { type: 'number', min: 0 },
  avg_download_speed_mbps: { type: 'number', min: 0 },
  avg_upload_speed_mbps: { type: 'number', min: 0 },
  revenue_total: { type: 'number', min: 0 },
  filing_id: { type: 'number', min: 1 },
  filed_at: { type: 'string', max: 32 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['draft', 'final', 'filed'] },
};

module.exports = { createIftStatisticalReport, updateIftStatisticalReport };
