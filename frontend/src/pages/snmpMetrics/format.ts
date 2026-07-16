// =============================================================================
// FireISP 5.0 — SNMP fleet-glance formatting helpers
// =============================================================================
// Shared between the SnmpMetrics fleet-glance/history page and DeviceDetail's
// SNMP tab ("reuse the fleet-card metric formatting"), so the same reading
// always renders the same way wherever it's shown.

/** Formats an SNMP percentage metric (cpu_usage / memory_usage), e.g. "42.0 %". */
export function fmtPct(val: number | string | null): string {
  if (val == null) return '—';
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)} %`;
}

/** Formats an SNMP wireless signal_strength reading in dBm. */
export function fmtSignal(val: number | string | null): string {
  if (val == null) return '—';
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  return `${n} dBm`;
}

/** Formats an SNMP ICMP latency_ms reading. */
export function fmtLatency(val: number | string | null): string {
  if (val == null) return '—';
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)} ms`;
}

/**
 * Formats an SNMP `uptime_ticks` value (sysUpTime, TimeTicks = 1/100s) as a
 * compact human string, e.g. "12d 4h", "3h 20m", "45m".
 */
export function fmtUptimeTicks(ticks: number | string | null): string {
  if (ticks == null) return '—';
  const n = Number(ticks);
  if (!Number.isFinite(n) || n < 0) return '—';
  const totalSeconds = Math.floor(n / 100);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Minimal structural shape of i18next's `t()` — avoids a hard dependency on
 * the `i18next` package's type exports for this small pure-logic module. */
type TFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Formats an ISO timestamp as a compact, translated "time ago" string
 * relative to now, e.g. "just now", "5m ago", "3h ago", "2d ago".
 */
export function fmtRelativeTime(iso: string | null, t: TFn, now: number = Date.now()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diffSeconds = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSeconds < 60) return t('snmpMetrics.relativeTime.justNow');
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return t('snmpMetrics.relativeTime.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('snmpMetrics.relativeTime.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('snmpMetrics.relativeTime.daysAgo', { count: days });
}
