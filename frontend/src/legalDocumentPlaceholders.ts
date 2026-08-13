// Keep this list in the same order as legalDocumentService.SUPPORTED_PLACEHOLDERS.
// Both legal-document template editing and MX source authoring render this
// shared value so operators see the exact placeholders the API accepts.
export const LEGAL_DOCUMENT_PLACEHOLDERS = [
  'date',
  'client.name',
  'client.email',
  'client.phone',
  'client.address',
  'client.rfc',
  'client.curp',
  'client.razon_social',
  'contract.id',
  'contract.start_date',
  'contract.connection_type',
  'contract.contract_template_mx_id',
  'contract.mx_contract_environment',
  'plan.name',
  'plan.download',
  'plan.upload',
  'plan.price',
  'order.number',
  'order.address',
  'org.name',
  'org.legal_name',
  'org.phone',
  'org.email',
  'org.rfc',
  'org.razon_social',
  'org.profeco_registro',
  'org.carta_derechos_url',
] as const;

export const LEGAL_DOCUMENT_PLACEHOLDER_HELP = LEGAL_DOCUMENT_PLACEHOLDERS
  .map(path => `{{${path}}}`)
  .join(' ');
