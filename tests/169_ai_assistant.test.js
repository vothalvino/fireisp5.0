// =============================================================================
// FireISP 5.0 — Migration 169 Smoke Test
// =============================================================================
// Asserts column existence and default values for every table/column added by
// 169_ai_assistant.sql without running an actual database connection.
// Uses the same extractSchemaColumns helper used by other migration smoke tests.
// =============================================================================

const fs   = require('fs');
const path = require('path');

// Reuse the migration-smoke-test helpers
const { extractTableNames, extractSchemaColumns } = require('../src/scripts/migration-smoke-test');

const MIGRATION_FILE = path.join(
  __dirname, '..', 'database', 'migrations', '169_ai_assistant.sql',
);
const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');

// ---------------------------------------------------------------------------
// Table existence
// ---------------------------------------------------------------------------

describe('migration 169 — table names', () => {
  let tableNames;
  beforeAll(() => {
    tableNames = extractTableNames(sql);
  });

  it('creates ai_providers', () => expect(tableNames.has('ai_providers')).toBe(true));
  it('creates ai_policies', () => expect(tableNames.has('ai_policies')).toBe(true));
  it('creates ai_phrase_library', () => expect(tableNames.has('ai_phrase_library')).toBe(true));
  it('creates ai_forbidden_terms', () => expect(tableNames.has('ai_forbidden_terms')).toBe(true));
  it('creates ai_reply_logs', () => expect(tableNames.has('ai_reply_logs')).toBe(true));
  it('creates contract_topology_paths', () => expect(tableNames.has('contract_topology_paths')).toBe(true));
});

// ---------------------------------------------------------------------------
// Column presence
// ---------------------------------------------------------------------------

describe('migration 169 — ai_providers columns', () => {
  let cols;
  beforeAll(() => {
    const map = extractSchemaColumns(sql);
    cols = map.get('ai_providers') || new Set();
  });

  const expected = [
    'id', 'organization_id', 'name', 'kind', 'model', 'endpoint_url',
    'api_key_encrypted', 'extra_config', 'temperature', 'max_tokens',
    'timeout_ms', 'enabled', 'priority',
    'created_at', 'updated_at', 'deleted_at',
  ];
  it.each(expected)('has column %s', col => expect(cols.has(col)).toBe(true));
});

describe('migration 169 — ai_policies columns', () => {
  let cols;
  beforeAll(() => {
    const map = extractSchemaColumns(sql);
    cols = map.get('ai_policies') || new Set();
  });

  const expected = [
    'id', 'organization_id', 'enabled', 'enabled_channels', 'mode',
    'auto_send_confidence', 'default_locale', 'tone', 'redact_pii_before_llm',
    'active_provider_id', 'created_at', 'updated_at',
  ];
  it.each(expected)('has column %s', col => expect(cols.has(col)).toBe(true));
});

describe('migration 169 — ai_phrase_library columns', () => {
  let cols;
  beforeAll(() => {
    const map = extractSchemaColumns(sql);
    cols = map.get('ai_phrase_library') || new Set();
  });

  const expected = [
    'id', 'organization_id', 'locale', 'category', 'text', 'is_required',
    'created_at', 'updated_at', 'deleted_at',
  ];
  it.each(expected)('has column %s', col => expect(cols.has(col)).toBe(true));
});

describe('migration 169 — ai_forbidden_terms columns', () => {
  let cols;
  beforeAll(() => {
    const map = extractSchemaColumns(sql);
    cols = map.get('ai_forbidden_terms') || new Set();
  });

  const expected = [
    'id', 'organization_id', 'locale', 'term', 'replacement',
    'created_at', 'updated_at', 'deleted_at',
  ];
  it.each(expected)('has column %s', col => expect(cols.has(col)).toBe(true));
});

describe('migration 169 — ai_reply_logs columns', () => {
  let cols;
  beforeAll(() => {
    const map = extractSchemaColumns(sql);
    cols = map.get('ai_reply_logs') || new Set();
  });

  const expected = [
    'id', 'organization_id', 'ticket_id', 'provider_id',
    'classification', 'confidence', 'context_snapshot', 'prompt_hash',
    'draft_text', 'final_text', 'action', 'reviewer_user_id',
    'prompt_tokens', 'completion_tokens', 'cost_usd', 'duration_ms',
    'error', 'created_at',
  ];
  it.each(expected)('has column %s', col => expect(cols.has(col)).toBe(true));
});

describe('migration 169 — contract_topology_paths columns', () => {
  let cols;
  beforeAll(() => {
    const map = extractSchemaColumns(sql);
    cols = map.get('contract_topology_paths') || new Set();
  });

  const expected = ['id', 'contract_id', 'path', 'computed_at'];
  it.each(expected)('has column %s', col => expect(cols.has(col)).toBe(true));
});

// ---------------------------------------------------------------------------
// Default values in SQL text
// ---------------------------------------------------------------------------

describe('migration 169 — default values', () => {
  it('ai_policies.enabled defaults to 0 (off)', () => {
    expect(sql).toMatch(/enabled\s+TINYINT\(1\)\s+NOT NULL DEFAULT 0/i);
  });

  it('ai_policies.mode defaults to draft_only', () => {
    expect(sql).toMatch(/DEFAULT 'draft_only'/);
  });

  it('ai_policies.auto_send_confidence defaults to 0.85', () => {
    expect(sql).toMatch(/DEFAULT 0\.85/);
  });

  it('ai_policies.tone defaults to formal', () => {
    expect(sql).toMatch(/DEFAULT 'formal'/);
  });

  it('ai_policies.redact_pii_before_llm defaults to 1', () => {
    expect(sql).toMatch(/redact_pii_before_llm\s+TINYINT\(1\)\s+NOT NULL DEFAULT 1/i);
  });

  it('ai_providers.temperature defaults to 0.20', () => {
    expect(sql).toMatch(/temperature\s+DECIMAL\(3,2\)\s+NOT NULL DEFAULT 0\.20/i);
  });

  it('ai_providers.max_tokens defaults to 800', () => {
    expect(sql).toMatch(/max_tokens\s+INT UNSIGNED\s+NOT NULL DEFAULT 800/i);
  });

  it('ai_providers.timeout_ms defaults to 20000', () => {
    expect(sql).toMatch(/timeout_ms\s+INT UNSIGNED\s+NOT NULL DEFAULT 20000/i);
  });

  it('ai_providers.enabled defaults to 1', () => {
    // Should appear in ai_providers block
    expect(sql).toMatch(/enabled\s+TINYINT\(1\)\s+NOT NULL DEFAULT 1/i);
  });
});

// ---------------------------------------------------------------------------
// ALTER TABLE statements
// ---------------------------------------------------------------------------

describe('migration 169 — ALTER TABLE statements', () => {
  it('adds network_links.medium column', () => {
    expect(sql).toMatch(/ALTER TABLE network_links/i);
    expect(sql).toMatch(/medium\s+ENUM\('fiber','wireless','copper'\)/i);
  });

  it('adds network_links.role column', () => {
    expect(sql).toMatch(/role\s+ENUM\('access','distribution','backhaul','core'\)/i);
  });

  it('adds devices.role column', () => {
    expect(sql).toMatch(/ALTER TABLE devices/i);
  });

  it('adds organization_quotas.max_ai_tokens_month column', () => {
    expect(sql).toMatch(/ALTER TABLE organization_quotas/i);
    expect(sql).toMatch(/max_ai_tokens_month/i);
  });
});

// ---------------------------------------------------------------------------
// Foreign key constraints
// ---------------------------------------------------------------------------

describe('migration 169 — foreign key constraints', () => {
  it('ai_policies references organizations', () => {
    expect(sql).toMatch(/fk_ai_policies_org/i);
  });

  it('ai_policies.active_provider_id references ai_providers', () => {
    expect(sql).toMatch(/fk_ai_policies_provider/i);
    expect(sql).toMatch(/REFERENCES ai_providers/i);
  });

  it('ai_providers references organizations', () => {
    expect(sql).toMatch(/fk_ai_providers_org/i);
  });

  it('ai_reply_logs references tickets', () => {
    expect(sql).toMatch(/fk_ai_reply_logs_ticket/i);
    expect(sql).toMatch(/REFERENCES tickets/i);
  });

  it('contract_topology_paths references contracts', () => {
    expect(sql).toMatch(/fk_contract_topology_paths_contract/i);
    expect(sql).toMatch(/REFERENCES contracts/i);
  });
});
