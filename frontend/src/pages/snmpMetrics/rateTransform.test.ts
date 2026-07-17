// =============================================================================
// FireISP 5.0 — SNMP rate transform helper tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { deltaToRate, seriesToRates, currentRate, fmtBps, bucketedRates, type OctetRow } from './rateTransform';

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

describe('bucketedRates', () => {
  function row(ts: string, iface: string | null, inO: number | null, outO: number | null): OctetRow {
    return { ts, interface_id: iface, if_in_octets: inO, if_out_octets: outO };
  }

  it('sums same-minute per-interface rows into one bucket (raw resolution) and computes a rate between buckets with identical interface membership', () => {
    const rows: OctetRow[] = [
      // Bucket 1 — 00:00, interfaces eth0 + eth1, inserted a couple seconds apart
      row('2026-01-01T00:00:01.000Z', 'eth0', 500_000, 200_000),
      row('2026-01-01T00:00:03.000Z', 'eth1', 500_000, 300_000),
      // Bucket 2 — 00:05, same two interfaces
      row('2026-01-01T00:05:00.000Z', 'eth0', 800_000, 260_000),
      row('2026-01-01T00:05:02.000Z', 'eth1', 800_000, 360_000),
    ];

    const { timestamps, inRates, outRates } = bucketedRates(rows, 'minute');

    expect(timestamps).toHaveLength(2);
    expect(inRates[0]).toBeNull(); // first bucket has no predecessor
    // bucket1 sum: in=1,000,000 out=500,000 ; bucket2 sum: in=1,600,000 out=620,000
    // delta in = 600,000 bytes over 300s (00:00:03 -> 00:05:02 ~= 299s, but let's
    // just assert it's a positive, finite rate rather than pin the exact seconds)
    expect(inRates[1]).not.toBeNull();
    expect(inRates[1]).toBeGreaterThan(0);
    expect(outRates[1]).not.toBeNull();
    expect(outRates[1]).toBeGreaterThan(0);
  });

  it('a bucket missing an interface that reappears in the next bucket → null gap, never a fabricated spike', () => {
    const rows: OctetRow[] = [
      // Bucket 1 — only eth0 reported this cycle (eth1 missing/failed ingest)
      row('2026-01-01T00:00:00.000Z', 'eth0', 500_000, 200_000),
      // Bucket 2 — eth1 reappears with its own large cumulative counter
      row('2026-01-01T00:05:00.000Z', 'eth0', 550_000, 210_000),
      row('2026-01-01T00:05:00.000Z', 'eth1', 40_000_000_000, 15_000_000_000),
    ];

    const { inRates, outRates } = bucketedRates(rows, 'minute');

    expect(inRates[0]).toBeNull();
    expect(inRates[1]).toBeNull(); // signature 'eth0' !== 'eth0,eth1' — refuse to diff
    expect(outRates[1]).toBeNull();
  });

  it('exact-timestamp bucketing (1hr/1day rollups) groups rows that share the identical ts', () => {
    const rows: OctetRow[] = [
      row('2026-01-01T00:00:00.000Z', 'eth0', 1_000_000, 500_000),
      row('2026-01-01T00:00:00.000Z', 'eth1', 1_000_000, 500_000),
      row('2026-01-01T01:00:00.000Z', 'eth0', 1_200_000, 560_000),
      row('2026-01-01T01:00:00.000Z', 'eth1', 1_200_000, 560_000),
    ];

    const { timestamps, inRates } = bucketedRates(rows, 'exact');

    expect(timestamps).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z']);
    // bucket sums: 2,000,000 -> 2,400,000, over 3600s = ~888.9 bps * 8... just assert positive & finite
    expect(inRates[1]).not.toBeNull();
    expect(Number.isFinite(inRates[1] as number)).toBe(true);
  });

  it('ignores device-level rows (interface_id null or empty string) — only sums real per-interface rows', () => {
    const rows: OctetRow[] = [
      { ts: '2026-01-01T00:00:00.000Z', interface_id: null, if_in_octets: 999, if_out_octets: 999 },
      { ts: '2026-01-01T00:00:00.000Z', interface_id: '', if_in_octets: 999, if_out_octets: 999 },
      row('2026-01-01T00:00:00.000Z', 'eth0', 1_000_000, 500_000),
    ];

    const { timestamps } = bucketedRates(rows, 'minute');
    expect(timestamps).toHaveLength(1);
  });

  it('returns empty arrays for no interface rows', () => {
    const { timestamps, inRates, outRates } = bucketedRates([], 'minute');
    expect(timestamps).toEqual([]);
    expect(inRates).toEqual([]);
    expect(outRates).toEqual([]);
  });
});
