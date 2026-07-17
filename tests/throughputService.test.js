// =============================================================================
// FireISP 5.0 — throughputService.aggregateThroughput tests
// =============================================================================
const { aggregateThroughput, deviceThroughput } = require('../src/services/throughputService');

describe('aggregateThroughput', () => {
  it('returns has_data=false and zeroed stats for no samples', () => {
    const r = aggregateThroughput([], { fromMs: 0, toMs: 10000, buckets: 1 });
    expect(r.has_data).toBe(false);
    expect(r.peak_gbps).toBe(0);
    expect(r.avg_gbps).toBe(0);
    expect(r.p95_gbps).toBe(0);
    expect(r.peak_bps).toBe(0);
    expect(r.avg_bps).toBe(0);
    expect(r.p95_bps).toBe(0);
    expect(r.points).toHaveLength(1);
    expect(r.points[0].in_bps).toBe(0);
  });

  it('computes bit-rate from a counter delta (bytes*8/seconds)', () => {
    // 1,000,000 bytes in over 1s = 8,000,000 bps; 500,000 out = 4,000,000 bps.
    const samples = [
      { iface: '1:1', t: 0, inO: 0, outO: 0 },
      { iface: '1:1', t: 1000, inO: 1_000_000, outO: 500_000 },
    ];
    const r = aggregateThroughput(samples, { fromMs: 0, toMs: 10000, buckets: 1 });
    expect(r.has_data).toBe(true);
    expect(r.points[0].in_bps).toBe(8_000_000);
    expect(r.points[0].out_bps).toBe(4_000_000);
    expect(r.peak_gbps).toBe(0.01); // 8e6/1e9 = 0.008 → rounded 0.01
    // Raw-bps stats keep the sub-10-Mbps precision the Gbps rounding destroys.
    expect(r.peak_bps).toBe(8_000_000);
    expect(r.avg_bps).toBe(8_000_000);
    expect(r.p95_bps).toBe(8_000_000);
  });

  it('sums bit-rates across interfaces within a bucket', () => {
    const samples = [
      { iface: '1:1', t: 0, inO: 0, outO: 0 },
      { iface: '1:1', t: 1000, inO: 1_000_000, outO: 0 },
      { iface: '2:1', t: 0, inO: 0, outO: 0 },
      { iface: '2:1', t: 1000, inO: 1_000_000, outO: 0 },
    ];
    const r = aggregateThroughput(samples, { fromMs: 0, toMs: 10000, buckets: 1 });
    // Two interfaces each 8,000,000 bps → 16,000,000 bps aggregate.
    expect(r.points[0].in_bps).toBe(16_000_000);
  });

  it('drops a counter reset (both counters going backwards)', () => {
    const samples = [
      { iface: '1:1', t: 0, inO: 5_000_000, outO: 5_000_000 },
      { iface: '1:1', t: 1000, inO: 10, outO: 10 },      // reboot/reset → skip
      { iface: '1:1', t: 2000, inO: 1_000_010, outO: 10 }, // 1,000,000 in over 1s
    ];
    const r = aggregateThroughput(samples, { fromMs: 0, toMs: 10000, buckets: 1 });
    // Only the second interval counts: 8,000,000 bps in, 0 out.
    expect(r.points[0].in_bps).toBe(8_000_000);
    expect(r.points[0].out_bps).toBe(0);
  });

  it('drops only the reset direction on a single-counter wrap', () => {
    const samples = [
      { iface: '1:1', t: 0, inO: 4_000_000_000, outO: 0 },
      // ingress counter wrapped/reset (delta < 0) but egress advanced +1,000,000 over 1s.
      { iface: '1:1', t: 1000, inO: 10, outO: 1_000_000 },
    ];
    const r = aggregateThroughput(samples, { fromMs: 0, toMs: 10000, buckets: 1 });
    expect(r.points[0].in_bps).toBe(0);            // ingress dropped, not a spurious 0-drag
    expect(r.points[0].out_bps).toBe(8_000_000);   // egress still counted
    expect(r.has_data).toBe(true);
  });

  it('places samples into the correct time buckets', () => {
    const samples = [
      { iface: '1:1', t: 0, inO: 0, outO: 0 },
      { iface: '1:1', t: 1000, inO: 1_000_000, outO: 0 }, // ends at t=1000 → bucket 0
      { iface: '1:1', t: 6000, inO: 3_000_000, outO: 0 }, // ends at t=6000 → bucket 1
    ];
    // window 0..10000, 2 buckets of 5000ms each.
    const r = aggregateThroughput(samples, { fromMs: 0, toMs: 10000, buckets: 2 });
    expect(r.points).toHaveLength(2);
    expect(r.points[0].in_bps).toBe(8_000_000);            // 1e6 bytes / 1s
    // bucket 1: (3,000,000 - 1,000,000) bytes over 5s = 400,000 B/s = 3,200,000 bps
    expect(r.points[1].in_bps).toBe(3_200_000);
  });

  it('ignores a lone sample with no delta partner', () => {
    const r = aggregateThroughput(
      [{ iface: '1:1', t: 500, inO: 12345, outO: 6789 }],
      { fromMs: 0, toMs: 10000, buckets: 1 },
    );
    expect(r.has_data).toBe(false);
    expect(r.points[0].in_bps).toBe(0);
  });
});

describe('deviceThroughput', () => {
  it('computes per-device in+out bit-rate keyed by device', () => {
    const samples = [
      { device: 1, iface: '1:1', t: 0, inO: 0, outO: 0 },
      { device: 1, iface: '1:1', t: 1000, inO: 1_000_000, outO: 500_000 }, // 8M in + 4M out
      { device: 2, iface: '2:1', t: 0, inO: 0, outO: 0 },
      { device: 2, iface: '2:1', t: 1000, inO: 250_000, outO: 0 },          // 2M in
    ];
    const r = deviceThroughput(samples, { fromMs: 0, toMs: 10000, buckets: 1 });
    expect(r['1'].tp_bps).toBe(12_000_000);
    expect(r['2'].tp_bps).toBe(2_000_000);
    expect(r['1'].series).toHaveLength(1);
  });

  it('omits devices that have no usable delta', () => {
    const r = deviceThroughput(
      [{ device: 5, iface: '5:1', t: 0, inO: 100, outO: 100 }],
      { fromMs: 0, toMs: 10000, buckets: 1 },
    );
    expect(r['5']).toBeUndefined();
  });
});
