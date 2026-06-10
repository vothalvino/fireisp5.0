// =============================================================================
// FireISP 5.0 — Win-back Campaign Validation Schemas (§1.2)
// =============================================================================

const STATUSES = ['draft', 'active', 'paused', 'completed'];
const SEGMENTS = ['all_cancelled', 'cancelled_30d', 'cancelled_90d', 'high_value'];

const createWinbackCampaign = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  status: { type: 'string', enum: STATUSES },
  target_segment: { type: 'string', enum: SEGMENTS },
  offer_description: { type: 'string', max: 65535 },
  discount_percent: { type: 'number', min: 0, max: 100 },
  message_template_id: { type: 'number', min: 1 },
  start_date: { type: 'string', max: 10 },
  end_date: { type: 'string', max: 10 },
  notes: { type: 'string', max: 65535 },
};

const updateWinbackCampaign = Object.fromEntries(
  Object.entries(createWinbackCampaign).map(([k, v]) => [k, { ...v, required: false }]),
);

const patchWinbackCampaign = updateWinbackCampaign;

module.exports = {
  createWinbackCampaign, updateWinbackCampaign, patchWinbackCampaign, STATUSES, SEGMENTS,
};
