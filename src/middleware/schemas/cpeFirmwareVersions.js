// =============================================================================
// FireISP 5.0 — CPE Firmware Version Validation Schemas (§8.1)
// =============================================================================

const createCpeFirmwareVersion = {
  manufacturer: { type: 'string', required: true, min: 1, max: 100 },
  model_name: { type: 'string', required: true, min: 1, max: 100 },
  version: { type: 'string', required: true, min: 1, max: 64 },
  firmware_url: { type: 'string', required: true, min: 1, max: 512 },
  file_size_bytes: { type: 'number', min: 0 },
  checksum: { type: 'string', max: 128 },
  checksum_type: { type: 'string', enum: ['md5', 'sha1', 'sha256'] },
  is_stable: { type: 'boolean' },
  release_notes: { type: 'string', max: 10000 },
};

const updateCpeFirmwareVersion = {
  manufacturer: { type: 'string', min: 1, max: 100 },
  model_name: { type: 'string', min: 1, max: 100 },
  version: { type: 'string', min: 1, max: 64 },
  firmware_url: { type: 'string', min: 1, max: 512 },
  file_size_bytes: { type: 'number', min: 0 },
  checksum: { type: 'string', max: 128 },
  checksum_type: { type: 'string', enum: ['md5', 'sha1', 'sha256'] },
  is_stable: { type: 'boolean' },
  release_notes: { type: 'string', max: 10000 },
};

module.exports = { createCpeFirmwareVersion, updateCpeFirmwareVersion };
