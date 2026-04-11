// =============================================================================
// FireISP 5.0 — Regulatory Filing Validation Schemas
// =============================================================================

const createRegulatoryFiling = {
  concession_title_id: { type: 'number', min: 1 },
  filing_type: { type: 'string', required: true, enum: ['annual_report', 'quarterly_report', 'spectrum_fee', 'coverage_report', 'quality_report', 'tariff_update', 'infrastructure_report', 'service_modification', 'other'] },
  period_start: { type: 'string' },
  period_end: { type: 'string' },
  submitted_at: { type: 'string' },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['pending', 'filed', 'accepted', 'rejected', 'overdue'] },
};

const updateRegulatoryFiling = {
  concession_title_id: { type: 'number', min: 1 },
  filing_type: { type: 'string', enum: ['annual_report', 'quarterly_report', 'spectrum_fee', 'coverage_report', 'quality_report', 'tariff_update', 'infrastructure_report', 'service_modification', 'other'] },
  period_start: { type: 'string' },
  period_end: { type: 'string' },
  submitted_at: { type: 'string' },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['pending', 'filed', 'accepted', 'rejected', 'overdue'] },
};

module.exports = { createRegulatoryFiling, updateRegulatoryFiling };
