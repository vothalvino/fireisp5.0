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
// =============================================================================

export interface TrafficSample {
  t: string;
  in_octets: number | string | null;
  out_octets: number | string | null;
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
  return {
    inBps: deltaToRate(a.in_octets, a.t, b.in_octets, b.t),
    outBps: deltaToRate(a.out_octets, a.t, b.out_octets, b.t),
  };
}

/** Formats a bits/sec value as a human Kbps/Mbps/Gbps string. */
export function fmtBps(bps: number | null): string {
  if (bps == null || !Number.isFinite(bps)) return '—';
  if (bps < 1000) return `${bps.toFixed(0)} bps`;
  if (bps < 1000 ** 2) return `${(bps / 1000).toFixed(1)} Kbps`;
  if (bps < 1000 ** 3) return `${(bps / 1000 ** 2).toFixed(2)} Mbps`;
  return `${(bps / 1000 ** 3).toFixed(3)} Gbps`;
}
