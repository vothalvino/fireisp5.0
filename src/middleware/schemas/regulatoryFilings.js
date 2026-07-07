// =============================================================================
// FireISP 5.0 — Regulatory Filing Validation Schemas
// =============================================================================

const createRegulatoryFiling = {
  concession_title_id: { type: 'number', min: 1 },
  filing_type: { type: 'string', required: true, enum: ['annual_report', 'quarterly_stats', 'tariff_registration', 'qos_report', 'coverage_report', 'spectrum_usage', 'other'] },
  period_start: { type: 'string' },
  period_end: { type: 'string' },
  filed_at: { type: 'string' },
  acknowledgement_number: { type: 'string', max: 100 },
  document_file_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['pending', 'filed', 'accepted', 'rejected', 'overdue'] },
};

const updateRegulatoryFiling = {
  concession_title_id: { type: 'number', min: 1 },
  filing_type: { type: 'string', enum: ['annual_report', 'quarterly_stats', 'tariff_registration', 'qos_report', 'coverage_report', 'spectrum_usage', 'other'] },
  period_start: { type: 'string' },
  period_end: { type: 'string' },
  filed_at: { type: 'string' },
  acknowledgement_number: { type: 'string', max: 100 },
  document_file_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['pending', 'filed', 'accepted', 'rejected', 'overdue'] },
};

module.exports = { createRegulatoryFiling, updateRegulatoryFiling };
