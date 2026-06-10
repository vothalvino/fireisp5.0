// =============================================================================
// FireISP 5.0 — Communication Campaign Validation Schemas (§1.4)
// =============================================================================

const CHANNELS = ['email', 'sms', 'whatsapp'];

const createCommunicationCampaign = {
  name:          { type: 'string', required: true, min: 1, max: 200 },
  channel:       { type: 'string', required: true, enum: CHANNELS },
  template_id:   { type: 'number', min: 1 },
  filter_status: { type: 'string', max: 50 },
  filter_plan_id: { type: 'number', min: 1 },
  filter_tag:    { type: 'string', max: 100 },
  scheduled_at:  { type: 'string', max: 30 },
  notes:         { type: 'string', max: 65535 },
};

const updateCommunicationCampaign = Object.fromEntries(
  Object.entries(createCommunicationCampaign).map(([k, v]) => [k, { ...v, required: false }]),
);

const patchCommunicationCampaign = updateCommunicationCampaign;

module.exports = {
  createCommunicationCampaign,
  updateCommunicationCampaign,
  patchCommunicationCampaign,
  CHANNELS,
};
