'use strict';

const {
  normalizeBinding,
  normalizeLookup,
  normalizeExporterConfig,
  canonicalJson,
  certainlyCoversInstant,
  sequenceState,
  attributionToCsv,
} = require('../src/services/cgnatAttributionService');

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function allocation(overrides = {}) {
  const allocatedAt = iso(-60000);
  return {
    event_type: 'allocate',
    binding_key: 'binding-1',
    binding_type: 'single_port',
    private_ipv4: '10.0.0.10',
    private_port_start: 5000,
    private_port_end: 5000,
    public_ipv4: '8.8.8.8',
    public_port_start: 45000,
    public_port_end: 45000,
    protocol: 'tcp',
    allocated_at: allocatedAt,
    released_at: null,
    exporter_id: 'edge-1',
    exporter_boot_id: 'boot-a',
    nat_instance_id: 'nat-1',
    nat_pool_id: 'pool-1',
    nat_realm: 'internet',
    event_id: 'event-1',
    sequence_number: 0,
    device_recorded_at: allocatedAt,
    clock_offset_ms: 0,
    clock_uncertainty_ms: 0,
    records_lost_before: 0,
    session_instance_id: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}

describe('privacy-minimal CGNAT attribution validation', () => {
  it('accepts an active single-port allocation and normalizes TCP', () => {
    const row = normalizeBinding(allocation());
    expect(row.released_at).toBeNull();
    expect(row.protocol).toBe(6);
  });

  it('accepts an exclusive UDP port block without private ports', () => {
    const row = normalizeBinding(allocation({
      binding_type: 'port_block', private_port_start: null, private_port_end: null,
      public_port_start: 20000, public_port_end: 20999, protocol: 17,
    }));
    expect(row.binding_type).toBe('port_block');
    expect(row.protocol).toBe(17);
  });

  it.each(['destination_ip', 'destination_port', 'url', 'content', 'bytes'])(
    'rejects prohibited field %s',
    field => expect(() => normalizeBinding(allocation({ [field]: 'forbidden' })))
      .toThrow(/Unknown bindings/),
  );

  it.each(['10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1'])(
    'rejects non-global public address %s',
    public_ipv4 => expect(() => normalizeBinding(allocation({ public_ipv4 })))
      .toThrow(/Invalid public_ipv4/),
  );

  it('rejects unsupported ICMP attribution', () => {
    expect(() => normalizeBinding(allocation({ protocol: 'icmp' }))).toThrow(/Invalid protocol/);
  });

  it('rejects destination/control Unicode in ASCII evidence identifiers', () => {
    expect(() => normalizeBinding(allocation({ exporter_id: 'borde-ñ' })))
      .toThrow(/Invalid exporter_id/);
    expect(() => normalizeBinding(allocation({ event_id: 'event\n2' })))
      .toThrow(/Invalid event_id/);
  });

  it('validates the device-clock sign and uncertainty relation', () => {
    expect(() => normalizeBinding(allocation({
      device_recorded_at: iso(-50000), clock_offset_ms: 0, clock_uncertainty_ms: 1,
    }))).toThrow(/internally inconsistent/);
  });

  it('derives corrected time and a conservative certain-coverage horizon', () => {
    const row = normalizeBinding(allocation({
      allocated_at: '2026-08-01T00:00:00.000Z',
      device_recorded_at: '2026-08-01T00:05:00.000Z',
      clock_offset_ms: 300000, clock_uncertainty_ms: 1000,
    }));
    expect(row.corrected_device_at.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(row.coverage_horizon_at.toISOString()).toBe('2026-07-31T23:59:59.000Z');
  });

  it('rejects unknown lookup fields and partial CGNAT tuples', () => {
    const observed_at = iso(-1000);
    expect(() => normalizeLookup({ gov_data_request_id: 1, public_ipv4: '8.8.8.8',
      public_port: 443, observed_at })).toThrow(/Incomplete public tuple/);
    expect(() => normalizeLookup({ gov_data_request_id: 1, public_ipv4: '8.8.8.8',
      observed_at, destination_ip: '1.1.1.1' })).toThrow(/Unknown body fields/);
  });

  it('requires enabled inventory to be required, exclusive, purposeful and baselined', () => {
    const base = { exporter_id: 'edge-1', nat_instance_id: 'nat-1', nat_pool_id: 'pool-1',
      nat_pool_record_id: 1, collector_api_token_id: 2, nat_realm: 'internet',
      purpose_reference: 'approved policy 123', tuple_exclusivity_confirmed: true,
      authoritative_baseline_confirmed: true, baseline_reference: 'snapshot 2026-08-15',
      is_required: true, enabled: true };
    expect(normalizeExporterConfig(base).enabled).toBe(true);
    expect(() => normalizeExporterConfig({ ...base, is_required: false })).toThrow(/must be required/);
    expect(() => normalizeExporterConfig({ ...base, baseline_reference: null })).toThrow(/baseline/);
  });
});

describe('fail-closed interval, sequence and snapshot helpers', () => {
  it('uses canonical key ordering for reproducible evidence hashes', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } }))
      .toBe(canonicalJson({ a: { x: 3, y: 2 }, z: 1 }));
  });

  it('does not claim certainty inside either clock-uncertainty boundary', () => {
    const row = { allocated_at: '2026-08-15T00:00:00.000Z',
      released_at: '2026-08-15T00:10:00.000Z',
      allocation_clock_uncertainty_ms: 1000, release_clock_uncertainty_ms: 2000 };
    expect(certainlyCoversInstant(row, '2026-08-15T00:00:00.500Z')).toBe(false);
    expect(certainlyCoversInstant(row, '2026-08-15T00:00:01.000Z')).toBe(true);
    expect(certainlyCoversInstant(row, '2026-08-15T00:09:58.000Z')).toBe(false);
  });

  it('faults arbitrary first sequence and a returning prior boot', () => {
    const binding = normalizeBinding(allocation({ sequence_number: 9 }));
    expect(sequenceState({}, binding)).toMatchObject({ status: 'gap', missing: 8 });
    expect(sequenceState({ last_exporter_boot_id: 'boot-b',
      last_corrected_device_at: iso(-120000) }, binding, { bootSeenBefore: true }))
      .toMatchObject({ status: 'out_of_order', advances: false });
  });

  it('faults even a clean 0/1 sequence after a boot change', () => {
    const nextBoot = normalizeBinding(allocation({ exporter_boot_id: 'boot-b',
      sequence_number: 0 }));
    expect(sequenceState({ last_exporter_boot_id: 'boot-a',
      last_corrected_device_at: iso(-120000) }, nextBoot))
      .toMatchObject({ status: 'gap', advances: false });
  });

  it('exports case and evidence provenance without any destination field', () => {
    const csv = attributionToCsv({ gov_data_request_id: 9, status: 'unavailable',
      reason: 'clock_boundary_uncertainty', candidate_count: 1,
      attributionMethod: null, evidence_snapshot_hash: null,
      authorization: { authority_name: 'Authority', authority_ref: 'REF-1',
        legal_basis_hash: 'a'.repeat(64), request_row_hash: 'b'.repeat(64) },
      query: { public_ipv4: '8.8.8.8', public_port: 443, protocol: 'tcp',
        observed_at: '2026-08-15T00:00:00.000Z' } });
    expect(csv).toContain('authority_ref');
    expect(csv).toContain('candidate_count');
    expect(csv).not.toMatch(/destination|url|content/i);
  });
});
