// =============================================================================
// FireISP 5.0 — SNMP fleet-glance formatting helper tests
// =============================================================================
import { describe, it, expect, vi } from 'vitest';
import { fmtUptimeTicks, fmtRelativeTime, fmtPct, fmtSignal, fmtLatency, normalizeCpuSpark } from './format';

describe('normalizeCpuSpark', () => {
  const VB_H = 24;

  it('keeps every y-coordinate within the viewBox for values across the whole 0-100 range', () => {
    // 95% previously clipped off the bottom of a vbH=24 viewBox when the raw
    // percentage was plotted verbatim (Sparkline plots y=v by design).
    const points = normalizeCpuSpark([10, 50, 95], VB_H);
    expect(points).toHaveLength(3);
    for (const y of points) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(VB_H);
    }
  });

  it('higher CPU values map to a smaller y (visually higher, since SVG y grows downward)', () => {
    const [yLow, yMid, yHigh] = normalizeCpuSpark([10, 50, 95], VB_H);
    expect(yHigh).toBeLessThan(yMid);
    expect(yMid).toBeLessThan(yLow);
  });

  it('clamps out-of-range values instead of producing an out-of-viewBox y', () => {
    const points = normalizeCpuSpark([-10, 150], VB_H);
    for (const y of points) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(VB_H);
    }
  });

  it('drops null/invalid entries rather than plotting them as 0 (which would read as "idle")', () => {
    const points = normalizeCpuSpark([10, null, 'bad', 50], VB_H);
    expect(points).toHaveLength(2);
  });

  it('returns an empty array for no data', () => {
    expect(normalizeCpuSpark([], VB_H)).toEqual([]);
  });
});

describe('fmtPct', () => {
  it('formats a numeric percentage to one decimal', () => {
    expect(fmtPct(42)).toBe('42.0 %');
  });
  it('accepts a DECIMAL-as-string value', () => {
    expect(fmtPct('87.5')).toBe('87.5 %');
  });
  it('renders null as an em dash', () => {
    expect(fmtPct(null)).toBe('—');
  });
});

describe('fmtSignal', () => {
  it('formats a signal reading in dBm', () => {
    expect(fmtSignal(-62)).toBe('-62 dBm');
  });
  it('renders null as an em dash', () => {
    expect(fmtSignal(null)).toBe('—');
  });
});

describe('fmtLatency', () => {
  it('formats a latency reading to one decimal', () => {
    expect(fmtLatency(12)).toBe('12.0 ms');
  });
  it('renders null as an em dash', () => {
    expect(fmtLatency(null)).toBe('—');
  });
});

describe('fmtUptimeTicks', () => {
  it('formats days + hours for a multi-day uptime', () => {
    // 12 days, 4 hours, in hundredths of a second
    const ticks = (12 * 86400 + 4 * 3600) * 100;
    expect(fmtUptimeTicks(ticks)).toBe('12d 4h');
  });

  it('formats hours + minutes when under a day', () => {
    const ticks = (3 * 3600 + 20 * 60) * 100;
    expect(fmtUptimeTicks(ticks)).toBe('3h 20m');
  });

  it('formats minutes only when under an hour', () => {
    const ticks = (45 * 60) * 100;
    expect(fmtUptimeTicks(ticks)).toBe('45m');
  });

  it('renders null as an em dash', () => {
    expect(fmtUptimeTicks(null)).toBe('—');
  });

  it('renders a negative value as an em dash (never a bogus uptime)', () => {
    expect(fmtUptimeTicks(-100)).toBe('—');
  });

  it('accepts string-encoded BIGINT values', () => {
    expect(fmtUptimeTicks(String((45 * 60) * 100))).toBe('45m');
  });
});

describe('fmtRelativeTime', () => {
  const t = vi.fn((key: string, opts?: Record<string, unknown>) => {
    if (opts && 'count' in opts) return `${key}:${opts.count}`;
    return key;
  });

  it('renders "just now" for very recent timestamps', () => {
    const now = Date.parse('2026-07-16T12:00:00.000Z');
    const iso = '2026-07-16T11:59:45.000Z';
    expect(fmtRelativeTime(iso, t, now)).toBe('snmpMetrics.relativeTime.justNow');
  });

  it('renders minutes-ago for < 1 hour', () => {
    const now = Date.parse('2026-07-16T12:00:00.000Z');
    const iso = '2026-07-16T11:45:00.000Z';
    expect(fmtRelativeTime(iso, t, now)).toBe('snmpMetrics.relativeTime.minutesAgo:15');
  });

  it('renders hours-ago for < 1 day', () => {
    const now = Date.parse('2026-07-16T12:00:00.000Z');
    const iso = '2026-07-16T09:00:00.000Z';
    expect(fmtRelativeTime(iso, t, now)).toBe('snmpMetrics.relativeTime.hoursAgo:3');
  });

  it('renders days-ago for >= 1 day', () => {
    const now = Date.parse('2026-07-16T12:00:00.000Z');
    const iso = '2026-07-14T12:00:00.000Z';
    expect(fmtRelativeTime(iso, t, now)).toBe('snmpMetrics.relativeTime.daysAgo:2');
  });

  it('renders null as an em dash', () => {
    expect(fmtRelativeTime(null, t)).toBe('—');
  });
});
