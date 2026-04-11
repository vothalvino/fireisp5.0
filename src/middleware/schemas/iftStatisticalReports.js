// =============================================================================
// FireISP 5.0 — IFT Statistical Report Validation Schemas
// =============================================================================

const createIftStatisticalReport = {
  concession_title_id: { type: 'number', min: 1 },
  report_period: { type: 'string', required: true, max: 20 },
  subscribers_count: { type: 'number', min: 0 },
  subscribers_by_speed_tier: { type: 'string', max: 5000 },
  avg_download_speed: { type: 'number', min: 0 },
  avg_upload_speed: { type: 'number', min: 0 },
  revenue: { type: 'number', min: 0 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['draft', 'final', 'filed'] },
};

const updateIftStatisticalReport = {
  report_period: { type: 'string', max: 20 },
  subscribers_count: { type: 'number', min: 0 },
  subscribers_by_speed_tier: { type: 'string', max: 5000 },
  avg_download_speed: { type: 'number', min: 0 },
  avg_upload_speed: { type: 'number', min: 0 },
  revenue: { type: 'number', min: 0 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['draft', 'final', 'filed'] },
};

module.exports = { createIftStatisticalReport, updateIftStatisticalReport };
