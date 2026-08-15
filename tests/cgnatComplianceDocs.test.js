'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('privacy-minimal CGNAT attribution documentation', () => {
  const mexico = read('docs/compliance-mexico.md');
  const operations = read('docs/connection-logging-compliance.md');
  const privacy = read('docs/privacy.md');
  const readme = read('README.md');
  const featureList = read('isp-platform-features.md');

  test('does not represent CGNAT attribution as an express universal LMTR mandate', () => {
    expect(mexico).toContain('do not expressly enumerate');
    expect(mexico).toContain('does not label this control a universal Article 183 requirement');
    expect(operations).toMatch(/The LMTR does not expressly enumerate\s+CGNAT address\/port bindings/);
    expect(featureList).not.toMatch(/Mandatory IP-to-subscriber mapping log retention/);
    expect(featureList).not.toMatch(/Traffic interception capability readiness/);
    expect(featureList).not.toMatch(/court order ready/i);
    expect(featureList).toMatch(/LMTR.*current governing federal telecommunications statute/);
    expect(featureList).not.toMatch(/LFTR\*\* \u2014 governing law/);
    expect(featureList).not.toMatch(/WORM audit_logs/);
  });

  test('defines a source-only binding with no destination or content collection', () => {
    for (const document of [mexico, operations, privacy, readme]) {
      expect(document).toMatch(/no destination|omit destination|deliberately (?:has|have) no destination/i);
      expect(document).toMatch(/packet payload|application content/i);
    }
    expect(operations).toContain('cgnat_attribution_bindings');
    expect(operations).toContain('cgnat_attribution:ingest');
    expect(operations).toContain('POST /connection-logs/cgnat-attribution/bindings/ingest');
    expect(operations).toContain('GET /connection-logs/cgnat-attribution/exporters');
    expect(operations).toContain('PUT /connection-logs/cgnat-attribution/exporters');
    expect(operations).toContain('POST /connection-logs/ip-attribution/lookup');
    expect(operations).toContain('POST /connection-logs/ip-attribution/export');
    expect(operations).toContain('{ "bindings": [ ... ] }');
    expect(operations).toMatch(/Omitting this health evidence makes the stored record\s+incomplete/);
    expect(operations).toMatch(/`event_id` unique within that registered exporter and\s+`exporter_boot_id` epoch/);
    expect(operations).not.toMatch(/globally unique source `event_id`/);
  });

  test('limits the evidentiary statement to a subscriber account and access session', () => {
    expect(mexico).toMatch(/It does not prove which\s+human used the connection/);
    expect(operations).toMatch(/It does not\s+prove the identity of the human/);
    expect(operations).toMatch(/`matched`[\s\S]*`unavailable`[\s\S]*`ambiguous`/);
  });

  test('distinguishes direct public-address lookup from shared CGNAT lookup', () => {
    expect(operations).toMatch(/public address plus an exact UTC instant/);
    expect(operations).toMatch(/port and protocol are required because the\s+public address is shared/);
    expect(operations).toMatch(/first normalized lifecycle evidence for that exact public IP/);
    expect(operations).toMatch(/at or after both its NAS event time and its server\s+receipt time/);
    expect(operations).toMatch(/strictly before both\s+the Stop event time and its receipt time/);
    expect(operations).toMatch(/latest\s+normalized accounting event time and its receipt time must cover the instant/);
    expect(mexico).toMatch(/omits source port and transport protocol because they are not\s+discriminators/);
  });

  test('requires the canonical tenant RADIUS lifecycle identity on every binding event', () => {
    expect(operations).toMatch(/`session_instance_id`, required on every allocate and release record/);
    expect(operations).toContain('`POST /api/v1/radius/accounting/tenant`');
    expect(operations).toMatch(/same-organization, to own the private address, and to cover the\s+allocation interval/);
    expect(operations).not.toMatch(/Optional client\/contract\/username\/RADIUS-session values/);
    expect(privacy).toMatch(/Required canonical `session_instance_id` from tenant RADIUS ingest/);
    expect(readme).toMatch(/Every allocate\/release\s+event requires that tenant-owned session UUID/);
  });

  test('fails closed when a translator needs the remote destination to disambiguate', () => {
    expect(operations).toMatch(/exclusive-source-tuple invariant/);
    expect(operations).toMatch(/distinguishes them only by remote destination[\s\S]*unsupported/);
    expect(operations).toMatch(/Do not solve that incompatibility by collecting destination/);
  });

  test('keeps incident exporter epochs fail-closed', () => {
    expect(operations).toMatch(/Incident counters are deliberately cumulative/);
    expect(operations).toMatch(/newly versioned exporter identity\/epoch/);
    expect(operations).toMatch(/old-epoch evidence remains unavailable/);
    expect(operations).toMatch(/Do not\s+zero the old counters/);
    expect(operations).toMatch(/clean\s+retired epoch/);
    expect(operations).toMatch(/between collection approval and retirement/);
    expect(operations).toMatch(/instant at or after retirement is unavailable/);
    expect(operations).toMatch(/boot transition never silently resumes/);
    expect(operations).toMatch(/returning boot identifier nor a successor `exporter_boot_id`/);
    expect(operations).toMatch(/establish a new provably empty baseline/);
  });

  test('uses a corrected certain horizon and admits no v1 heartbeat continuity', () => {
    expect(operations).toMatch(/clock_offset_ms = raw device clock - UTC/);
    expect(operations).toMatch(/subtracts that offset from `device_recorded_at`, then subtracts\s+`clock_uncertainty_ms`/);
    expect(operations).toMatch(/V1 has no checkpoint or heartbeat event/);
    expect(operations).toMatch(/quiet feed eventually becomes stale/);
    expect(operations).toMatch(/long configured block\s+lifetime as proof of continuous coverage/);
    expect(mexico).toMatch(/V1 has no\s+heartbeat\/checkpoint/);
    expect(readme).toMatch(/only corrected time minus uncertainty advances the certain\s+coverage horizon/);
  });

  test('documents the frozen credential split and complete API walkthrough', () => {
    expect(operations).toContain("API_BASE='https://isp.example.com/api/v1'");
    expect(operations).toContain('--header "Authorization: Bearer ${USER_JWT}"');
    expect(operations).toContain('--header "X-API-Key: ${CGNAT_COLLECTOR_API_KEY}"');
    expect(operations).toContain('"authoritative_baseline_confirmed": true');
    expect(operations).toContain('"session_instance_id": "${SESSION_INSTANCE_ID}"');
    expect(operations).toContain('"event_type": "allocate"');
    expect(operations).toContain('"event_type": "release"');
    expect(operations).toContain('/regulatory-compliance/gov-data-requests/${DIRECT_CASE_ID}/process');
    expect(operations).toContain('"gov_data_request_id": ${DIRECT_CASE_ID}');
    expect(operations).toContain('"gov_data_request_id": ${CGNAT_CASE_ID}');
    expect(operations).toContain('/connection-logs/ip-attribution/lookup');
    expect(operations).toContain('/connection-logs/ip-attribution/export');
    expect(operations).toContain('X-Evidence-SHA256');
    expect(operations).toContain('/connection-logs/cgnat-attribution/exporters/${EXPORTER_CONFIG_ID}/release-recovery');
    expect(operations).toContain('"collector_api_token_id": ${RECOVERY_TOKEN_ID}');
    expect(operations).toMatch(/recovery token is\s+forbidden from allocating/);
  });

  test('requires a reconciled empty starting baseline', () => {
    expect(operations).toContain('`authoritative_baseline_confirmed=true`');
    expect(operations).toContain('`baseline_reference`');
    expect(operations).toMatch(/drain and\s+reconcile the covered pool/);
    expect(operations).toMatch(/new\s+`exporter_boot_id` sequence at 0 or 1/);
    expect(operations).toMatch(/does not\s+import a nonempty translator snapshot or historical live allocations/);
    expect(operations).toMatch(/`allocated_at` predates baseline confirmation is rejected/);
  });

  test('states the synchronous sink capacity boundary', () => {
    expect(operations).toMatch(/synchronous HTTP\/MySQL sink is for measured low-volume/);
    expect(operations).toMatch(/carrier-scale unsampled per-connection/);
    expect(operations).toMatch(/durable\s+queue\/normalizer and a dedicated partitioned append\/search store/);
    expect(operations).toMatch(/HTTP success means completeness/);
  });

  test('states the installation-wide retention boundary', () => {
    expect(operations).toMatch(/one installation-wide setting/);
    expect(operations).toMatch(/tenants requiring divergent schedules must use separate\s+deployments/);
    expect(operations).toMatch(/capped at 24 calendar months/);
    expect(operations).toMatch(/active, scoped case hold may remain longer/);
    expect(mexico).toMatch(/product retention variable is installation-wide/);
    expect(privacy).toMatch(/Divergent tenant schedules require separate deployments/);
  });

  test('requires tenant- and case-gated legal-response access', () => {
    expect(operations).toMatch(/validated\s+`gov_data_request_id` from the same organization/);
    expect(operations).toContain('`ip_attribution.view` and `ip_attribution.export`');
    expect(operations).toContain('`cgnat_attribution.manage`');
    expect(operations).toContain('must never run an unscoped cross-tenant lookup');
    expect(operations).toMatch(/case, actor, query, outcome/);
    expect(operations).toMatch(/legal hold|preservation hold/i);
    expect(operations).toMatch(/result must match that subject or the lookup is forbidden/);
    expect(operations).toMatch(/data-subject access export is a separate, audited privacy-response path/);
    expect(operations).toContain('`clients.view`, `dsar_requests.manage`, and `connection_logs.export`');
    expect(operations).toMatch(/not\s+a public-tuple search/);
  });
});

describe.each(['.env.example', '.env.prod.example'])('%s CGNAT settings', (file) => {
  const env = read(file);

  test('uses only privacy-minimal CGNAT collector settings', () => {
    expect(env).toContain('CGNAT_ATTRIBUTION_RETENTION_MONTHS=24');
    expect(env).toContain('CGNAT_ATTRIBUTION_INGEST_REQUESTS_PER_MINUTE=120');
    expect(env).toContain('CGNAT_ATTRIBUTION_MAX_BATCH=500');
    expect(env).toContain('CGNAT_ATTRIBUTION_MAX_CLOCK_SKEW_SECONDS=300');
    expect(env).toContain('CGNAT_ATTRIBUTION_SESSION_GRACE_SECONDS=900');
    expect(env).toContain('CGNAT_ATTRIBUTION_STALE_MINUTES=15');
    expect(env).toContain('CGNAT_ATTRIBUTION_OPEN_BINDING_STALE_HOURS=24');
    expect(env).toContain('CGNAT_ATTRIBUTION_OPEN_PORT_BLOCK_STALE_DAYS=31');
  });
});
