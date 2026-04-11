// =============================================================================
// FireISP 5.0 — File Validation Schemas
// =============================================================================

const createFile = {
  entity_type: { type: 'string', required: true, enum: ['device', 'client', 'ticket', 'organization', 'backup'] },
  entity_id: { type: 'number', required: true, min: 1 },
  category: { type: 'string', enum: ['document', 'photo', 'config_backup', 'invoice_pdf', 'contract_pdf', 'report', 'other'] },
  filename: { type: 'string', required: true, min: 1, max: 255 },
  mime_type: { type: 'string', max: 100 },
  size_bytes: { type: 'number', min: 0 },
  notes: { type: 'string', max: 5000 },
};

const updateFile = {
  category: { type: 'string', enum: ['document', 'photo', 'config_backup', 'invoice_pdf', 'contract_pdf', 'report', 'other'] },
  filename: { type: 'string', min: 1, max: 255 },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createFile, updateFile };
