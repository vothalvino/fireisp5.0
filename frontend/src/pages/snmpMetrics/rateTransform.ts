// =============================================================================
// FireISP 5.0 — SNMP traffic rate transform helpers
// =============================================================================
// SNMP interface counters (if_in_octets / if_out_octets) are monotonic
// positions, not rates — plotting them directly is meaningless to a user
// ("is 4,830,201,552 good or bad?"). These pure helpers turn a counter series
// into bits/sec deltas, which is what "Throughput" actually means.
//
// Rules (do not relax without re-reading the brief this file was born from):
//   - A negative delta (counter wrap, or the device rebooted and reset its
//     counters) becomes a `null` gap — NEVER a fabricated/absolute-valued
//     rate. A gap in a line chart is honest; a wrong number is not.
//   - A missing sample (null value on either side) also produces `null`.
//   - The very first sample in any series has no predecessor, so its rate is
//     always `null`.
//   - A fleet traffic_samples pair is a SUM across every interface reporting
//     that poll cycle. The poller logs-and-swallows per-interface ingest
//     failures, so two samples for the same device can legitimately sum a
//     DIFFERENT set of interfaces (one dropped out, or one that was missing
//     reappears). A negative-delta guard alone only catches an interface
//     disappearing (the sum goes down); an interface REAPPEARING makes the
//     sum jump by that interface's entire multi-month cumulative counter —
//     a normal-looking positive delta that would fabricate a multi-Gbps
//     spike. `currentRate()` refuses to compute a rate at all when the two
//     samples' `interface_signature` don't match exactly — same "honest
//     gap" treatment as a negative delta.
// =============================================================================

export interface TrafficSample {
  t: string;
  in_octets: number | string | null;
  out_octets: number | string | null;
  /** Exact set of interface ids summed into this sample (from the backend's
   * `GROUP_CONCAT(DISTINCT interface_id ORDER BY interface_id)`), e.g.
   * `"1,2,3"`. Two samples are only comparable — safe to diff — when this
   * string matches exactly. Optional so callers/tests that don't care about
   * this guard (e.g. a single, already-verified-comparable pair) can omit
   * it; `undefined === undefined` still allows the comparison through. */
  interface_signature?: string | null;
}

/**
 * Converts a byte-counter delta between two timestamped samples into a
 * bits/sec rate. Returns `null` when either value is missing, the
 * timestamps don't advance, or the counter went backwards.
 */
export function deltaToRate(
  prevValue: number | string | null,
  prevTs: string,
  curValue: number | string | null,
  curTs: string,
): number | null {
  if (prevValue == null || curValue == null) return null;
  const prev = Number(prevValue);
  const cur = Number(curValue);
  if (!Number.isFinite(prev) || !Number.isFinite(cur)) return null;

  const deltaSeconds = (new Date(curTs).getTime() - new Date(prevTs).getTime()) / 1000;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return null;

  const deltaBytes = cur - prev;
  if (deltaBytes < 0) return null; // counter wrap / device reboot — never fabricate a rate

  return (deltaBytes * 8) / deltaSeconds; // bits per second
}

/**
 * Transforms a whole timestamped counter series (raw octet positions) into
 * a same-length array of bits/sec rates. The first element is always
 * `null` (no prior sample to diff against). This works for raw 5-min
 * samples as well as 1hr/1day rollup rows — each rollup row's counter value
 * is itself an average over its period, so the delta between consecutive
 * rows still approximates the per-period volume.
 */
export function seriesToRates(
  timestamps: string[],
  values: (number | string | null)[],
): (number | null)[] {
  if (values.length === 0) return [];
  const rates: (number | null)[] = [null];
  for (let i = 1; i < values.length; i++) {
    rates.push(deltaToRate(values[i - 1], timestamps[i - 1], values[i], timestamps[i]));
  }
  return rates;
}

/**
 * Computes the current in/out bits/sec rate from up to two chronologically
 * ordered (oldest first) traffic samples. Returns `{ inBps: null, outBps:
 * null }` when fewer than two samples are available — there is nothing to
 * diff against yet.
 */
export function currentRate(samples: TrafficSample[]): { inBps: number | null; outBps: number | null } {
  if (samples.length < 2) return { inBps: null, outBps: null };
  const [a, b] = samples;

  // Interface membership changed between the two samples (one dropped out
  // or reappeared) — the sums aren't comparable. Treat as a gap, exactly
  // like a negative delta, rather than risk a fabricated spike from a
  // reappearing interface's full cumulative counter landing in the delta.
  if (a.interface_signature !== b.interface_signature) {
    return { inBps: null, outBps: null };
  }

  return {
    inBps: deltaToRate(a.in_octets, a.t, b.in_octets, b.t),
    outBps: deltaToRate(a.out_octets, a.t, b.out_octets, b.t),
  };
}

/** A single device-history row's counter fields, as needed for bucketing. */
export interface OctetRow {
  ts: string;
  interface_id: string | null;
  if_in_octets: number | string | null;
  if_out_octets: number | string | null;
}

/**
 * Groups a device's per-interface counter rows into per-time-bucket sums,
 * then computes a bits/sec rate between consecutive buckets — mirroring the
 * fleet endpoint's SQL-side bucketing (COUNT/GROUP_CONCAT DISTINCT
 * interface_id), done here client-side since a single device's history rows
 * arrive ungrouped (one row per interface per poll, `interface_id !== null
 * && interface_id !== ''`; device-level rows must be filtered out by the
 * caller before calling this).
 *
 * `bucketing`:
 *   - `'minute'` — bucket by `Math.floor(ts / 60s)`. Use for raw 5-min
 *     samples: each interface's row is inserted with its own `NOW()`, so
 *     rows from the same poll cycle can land a second or two apart.
 *   - `'exact'` — bucket by the literal `ts` string. Use for 1hr/1day
 *     rollup rows, which already share the exact same `period_start` for
 *     a given period — no per-row jitter to absorb.
 *
 * Same "honest gap" rule as `currentRate()`: a bucket-pair whose
 * `interface_signature` (sorted, comma-joined interface ids) differs — an
 * interface dropped out of or reappeared in the poll — produces `null`
 * for that point, never a fabricated rate from a reappearing interface's
 * full cumulative counter landing in the delta.
 */
export function bucketedRates(
  rows: OctetRow[],
  bucketing: 'minute' | 'exact',
): { timestamps: string[]; inRates: (number | null)[]; outRates: (number | null)[] } {
  const buckets = new Map<string, { t: string; inSum: number; outSum: number; ifaces: Set<string> }>();

  for (const row of rows) {
    if (row.interface_id == null || row.interface_id === '') continue; // device-level row, not a per-interface one
    const key = bucketing === 'minute'
      ? String(Math.floor(new Date(row.ts).getTime() / 60_000))
      : row.ts;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { t: row.ts, inSum: 0, outSum: 0, ifaces: new Set() };
      buckets.set(key, bucket);
    }
    if (row.if_in_octets != null) {
      const n = Number(row.if_in_octets);
      if (Number.isFinite(n)) bucket.inSum += n;
    }
    if (row.if_out_octets != null) {
      const n = Number(row.if_out_octets);
      if (Number.isFinite(n)) bucket.outSum += n;
    }
    bucket.ifaces.add(row.interface_id);
    // Keep the latest timestamp seen in this bucket as its representative x.
    if (new Date(row.ts).getTime() > new Date(bucket.t).getTime()) bucket.t = row.ts;
  }

  const ordered = Array.from(buckets.values())
    .map(b => ({
      t: b.t,
      in_octets: b.inSum,
      out_octets: b.outSum,
      interface_signature: Array.from(b.ifaces).sort().join(','),
    }))
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

  const timestamps = ordered.map(b => b.t);
  const inRates: (number | null)[] = [];
  const outRates: (number | null)[] = [];

  for (let i = 0; i < ordered.length; i++) {
    if (i === 0) {
      inRates.push(null);
      outRates.push(null);
      continue;
    }
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (prev.interface_signature !== cur.interface_signature) {
      inRates.push(null);
      outRates.push(null);
      continue;
    }
    inRates.push(deltaToRate(prev.in_octets, prev.t, cur.in_octets, cur.t));
    outRates.push(deltaToRate(prev.out_octets, prev.t, cur.out_octets, cur.t));
  }

  return { timestamps, inRates, outRates };
}

/** Formats a bits/sec value as a human Kbps/Mbps/Gbps string. */
export function fmtBps(bps: number | null): string {
  if (bps == null || !Number.isFinite(bps)) return '—';
  if (bps < 1000) return `${bps.toFixed(0)} bps`;
  if (bps < 1000 ** 2) return `${(bps / 1000).toFixed(1)} Kbps`;
  if (bps < 1000 ** 3) return `${(bps / 1000 ** 2).toFixed(2)} Mbps`;
  return `${(bps / 1000 ** 3).toFixed(3)} Gbps`;
}
