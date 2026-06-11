// =============================================================================
// FireISP 5.0 — ONU Whitelist Validation Schemas (§7.2)
// =============================================================================

const createOnuWhitelistEntry = {
  olt_device_id: { type: 'number', required: true, min: 1 },
  entry_type: { type: 'string', required: true, enum: ['mac', 'serial_number'] },
  entry_value: { type: 'string', required: true, min: 1, max: 64 },
  list_type: { type: 'string', enum: ['allow', 'block'] },
  device_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 1000 },
};

const updateOnuWhitelistEntry = {
  list_type: { type: 'string', enum: ['allow', 'block'] },
  device_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 1000 },
};

const patchOnuWhitelistEntry = Object.fromEntries(
  Object.entries(updateOnuWhitelistEntry).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createOnuWhitelistEntry, updateOnuWhitelistEntry, patchOnuWhitelistEntry };
