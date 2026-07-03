// =============================================================================
// FireISP 5.0 — Network throughput aggregation
// =============================================================================
// Turns raw SNMP interface octet-counter samples into an org-wide throughput
// series (in/out bit-rate per time bucket) plus peak/avg/p95 in Gbps.
//
// SNMP ifInOctets/ifOutOctets are CUMULATIVE counters, so throughput is the
// per-interface delta between consecutive polls divided by elapsed time. Deltas
// that go backwards (counter reset, device reboot, or 32-bit wrap) are dropped
// rather than guessed. Within a bucket each interface's rate samples are
// averaged, then interface averages are summed → the bucket's aggregate rate.
// =============================================================================

/**
 * @param {Array<{iface:string, t:number, inO:number, outO:number}>} samples
 *        t = epoch ms; inO/outO = raw counter bytes. Order-independent.
 * @param {{fromMs:number, toMs:number, buckets:number}} opts
 * @returns {{points:Array<{ts:string,in_bps:number,out_bps:number}>,
 *            peak_gbps:number, avg_gbps:number, p95_gbps:number, has_data:boolean}}
 */
function aggregateThroughput(samples, { fromMs, toMs, buckets }) {
  const nBuckets = Math.max(1, buckets | 0);
  const width = (toMs - fromMs) / nBuckets || 1;

  // Group samples by interface (device_id:ifIndex).
  const byIface = new Map();
  for (const s of samples || []) {
    if (!s || s.iface == null) continue;
    if (!byIface.has(s.iface)) byIface.set(s.iface, []);
    byIface.get(s.iface).push(s);
  }

  // Per bucket, per interface: sum of rate samples + count (for averaging).
  const perBucketIface = Array.from({ length: nBuckets }, () => new Map());
  let hasData = false;

  for (const [iface, arr] of byIface) {
    arr.sort((a, b) => a.t - b.t);
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1];
      const b = arr[i];
      const dtSec = (b.t - a.t) / 1000;
      if (dtSec <= 0) continue;
      // Attribute the rate to the bucket of the interval's END sample.
      if (b.t < fromMs || b.t >= toMs) continue;
      const dIn = b.inO - a.inO;
      const dOut = b.outO - a.outO;
      // Both counters going backwards = full reset/wrap → nothing to learn.
      if (dIn < 0 && dOut < 0) continue;
      const bi = Math.min(nBuckets - 1, Math.floor((b.t - fromMs) / width));
      const m = perBucketIface[bi];
      let e = m.get(iface);
      if (!e) { e = { in: 0, inN: 0, out: 0, outN: 0 }; m.set(iface, e); }
      // Drop only the direction whose counter reset/wrapped (delta < 0), rather
      // than clamping it to a spurious 0 that would dent the average.
      if (dIn >= 0) { e.in += dIn * 8 / dtSec; e.inN += 1; hasData = true; }
      if (dOut >= 0) { e.out += dOut * 8 / dtSec; e.outN += 1; hasData = true; }
    }
  }

  const inTotals = new Array(nBuckets).fill(0);
  const outTotals = new Array(nBuckets).fill(0);
  const inActive = new Array(nBuckets).fill(false);
  for (let bi = 0; bi < nBuckets; bi++) {
    for (const e of perBucketIface[bi].values()) {
      if (e.inN > 0) { inTotals[bi] += e.in / e.inN; inActive[bi] = true; }
      if (e.outN > 0) { outTotals[bi] += e.out / e.outN; }
    }
  }

  const points = [];
  for (let bi = 0; bi < nBuckets; bi++) {
    points.push({
      ts: new Date(fromMs + bi * width + width / 2).toISOString(),
      in_bps: Math.round(inTotals[bi]),
      out_bps: Math.round(outTotals[bi]),
    });
  }

  // Stats over buckets that actually carry data (don't dilute avg with gaps).
  const active = [];
  for (let bi = 0; bi < nBuckets; bi++) {
    if (inActive[bi]) active.push(inTotals[bi]);
  }
  const toGbps = (bps) => Math.round((bps / 1e9) * 100) / 100;
  let peak = 0;
  let avg = 0;
  let p95 = 0;
  if (active.length > 0) {
    peak = Math.max(...active);
    avg = active.reduce((s, v) => s + v, 0) / active.length;
    const sorted = active.slice().sort((a, b) => a - b);
    p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }

  return {
    points,
    peak_gbps: toGbps(peak),
    avg_gbps: toGbps(avg),
    p95_gbps: toGbps(p95),
    has_data: hasData,
  };
}

module.exports = { aggregateThroughput };
