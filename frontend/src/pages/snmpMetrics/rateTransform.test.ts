// =============================================================================
// FireISP 5.0 — SNMP rate transform helper tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { deltaToRate, seriesToRates, currentRate, fmtBps } from './rateTransform';

describe('deltaToRate', () => {
  it('computes a normal positive delta as a bits/sec rate', () => {
    // 1,000,000 bytes over 10 seconds = 800,000 bits/sec
    const rate = deltaToRate(1_000_000, '2026-01-01T00:00:00.000Z', 2_000_000, '2026-01-01T00:00:10.000Z');
    expect(rate).toBe(800_000);
  });

  it('converts the rate to the expected Mbps magnitude via fmtBps', () => {
    const rate = deltaToRate(0, '2026-01-01T00:00:00.000Z', 12_500_000, '2026-01-01T00:00:10.000Z');
    // 12.5MB over 10s = 10,000,000 bits/sec = 10 Mbps
    expect(rate).toBe(10_000_000);
    expect(fmtBps(rate)).toBe('10.00 Mbps');
  });

  it('returns null (a gap) for a negative delta — counter wrap or device reboot', () => {
    const rate = deltaToRate(5_000_000, '2026-01-01T00:00:00.000Z', 1_000_000, '2026-01-01T00:00:10.000Z');
    expect(rate).toBeNull();
  });

  it('returns null when either value is missing', () => {
    expect(deltaToRate(null, '2026-01-01T00:00:00.000Z', 100, '2026-01-01T00:00:10.000Z')).toBeNull();
    expect(deltaToRate(100, '2026-01-01T00:00:00.000Z', null, '2026-01-01T00:00:10.000Z')).toBeNull();
  });

  it('returns null when the timestamps do not advance (zero or negative elapsed time)', () => {
    expect(deltaToRate(100, '2026-01-01T00:00:00.000Z', 200, '2026-01-01T00:00:00.000Z')).toBeNull();
    expect(deltaToRate(100, '2026-01-01T00:00:10.000Z', 200, '2026-01-01T00:00:00.000Z')).toBeNull();
  });

  it('accepts string-encoded DECIMAL/BIGINT values (mysql2 returns some counters as strings)', () => {
    const rate = deltaToRate('1000000', '2026-01-01T00:00:00.000Z', '2000000', '2026-01-01T00:00:10.000Z');
    expect(rate).toBe(800_000);
  });
});

describe('seriesToRates', () => {
  it('returns a same-length array with a leading null (no predecessor for the first sample)', () => {
    const timestamps = ['2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z', '2026-01-01T00:10:00.000Z'];
    const values = [1_000_000, 1_600_000, 1_000_000]; // last one wraps
    const rates = seriesToRates(timestamps, values);
    expect(rates).toHaveLength(3);
    expect(rates[0]).toBeNull();
    expect(rates[1]).toBeCloseTo((600_000 * 8) / 300, 5);
    expect(rates[2]).toBeNull(); // negative delta → gap, never fabricated
  });

  it('returns an empty array for an empty series', () => {
    expect(seriesToRates([], [])).toEqual([]);
  });

  it('single sample → no rate (array of just [null])', () => {
    const rates = seriesToRates(['2026-01-01T00:00:00.000Z'], [1_000_000]);
    expect(rates).toEqual([null]);
  });
});

describe('currentRate', () => {
  it('computes in/out rates from two chronological samples', () => {
    const { inBps, outBps } = currentRate([
      { t: '2026-01-01T00:00:00.000Z', in_octets: 1_000_000, out_octets: 500_000 },
      { t: '2026-01-01T00:00:10.000Z', in_octets: 2_000_000, out_octets: 600_000 },
    ]);
    expect(inBps).toBe(800_000);
    expect(outBps).toBe(80_000);
  });

  it('single sample → no rate', () => {
    const { inBps, outBps } = currentRate([
      { t: '2026-01-01T00:00:00.000Z', in_octets: 1_000_000, out_octets: 500_000 },
    ]);
    expect(inBps).toBeNull();
    expect(outBps).toBeNull();
  });

  it('no samples → no rate', () => {
    const { inBps, outBps } = currentRate([]);
    expect(inBps).toBeNull();
    expect(outBps).toBeNull();
  });

  it('identical interface_signature pair → computes the correct rate', () => {
    const { inBps, outBps } = currentRate([
      { t: '2026-01-01T00:00:00.000Z', in_octets: 1_000_000, out_octets: 500_000, interface_signature: '1,2,3' },
      { t: '2026-01-01T00:00:10.000Z', in_octets: 2_000_000, out_octets: 600_000, interface_signature: '1,2,3' },
    ]);
    expect(inBps).toBe(800_000);
    expect(outBps).toBe(80_000);
  });

  it('a REAPPEARING interface (different interface_signature) → null, never a fabricated spike', () => {
    // Interface "4" was missing from the first bucket (dropped that poll)
    // and reappears in the second — its own multi-month cumulative counter
    // lands in the SUM, producing a huge but non-negative "delta" that the
    // negative-delta guard alone would NOT catch. The signature mismatch
    // must short-circuit before any delta math runs.
    const { inBps, outBps } = currentRate([
      { t: '2026-01-01T00:00:00.000Z', in_octets: 1_000_000, out_octets: 500_000, interface_signature: '1,2,3' },
      { t: '2026-01-01T00:00:10.000Z', in_octets: 50_000_000_000, out_octets: 20_000_000_000, interface_signature: '1,2,3,4' },
    ]);
    expect(inBps).toBeNull();
    expect(outBps).toBeNull();
  });

  it('a DISAPPEARING interface (different interface_signature, lower sum) → null via the signature check (not just the negative-delta guard)', () => {
    const { inBps, outBps } = currentRate([
      { t: '2026-01-01T00:00:00.000Z', in_octets: 5_000_000, out_octets: 2_000_000, interface_signature: '1,2,3,4' },
      { t: '2026-01-01T00:00:10.000Z', in_octets: 1_000_000, out_octets: 500_000, interface_signature: '1,2,3' },
    ]);
    expect(inBps).toBeNull();
    expect(outBps).toBeNull();
  });

  it('samples with no interface_signature at all (single-interface device history, not a fleet sum) still compute normally', () => {
    const { inBps, outBps } = currentRate([
      { t: '2026-01-01T00:00:00.000Z', in_octets: 1_000_000, out_octets: 500_000 },
      { t: '2026-01-01T00:00:10.000Z', in_octets: 2_000_000, out_octets: 600_000 },
    ]);
    expect(inBps).toBe(800_000);
    expect(outBps).toBe(80_000);
  });
});

describe('fmtBps', () => {
  it('formats sub-Kbps as bps', () => {
    expect(fmtBps(500)).toBe('500 bps');
  });
  it('formats Kbps', () => {
    expect(fmtBps(1_500)).toBe('1.5 Kbps');
  });
  it('formats Mbps', () => {
    expect(fmtBps(5_000_000)).toBe('5.00 Mbps');
  });
  it('formats Gbps', () => {
    expect(fmtBps(2_500_000_000)).toBe('2.500 Gbps');
  });
  it('renders null as an em dash', () => {
    expect(fmtBps(null)).toBe('—');
  });
});
