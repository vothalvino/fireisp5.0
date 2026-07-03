// =============================================================================
// FireISP Operations Console — model logic tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import {
  DEMO_MODEL, resolveModel, buildRealModel, hasRealData, buildChart, buildChartFromSeries,
  mapSite, mapDevice,
  type SummaryData, type MrrRow, type AlertEvent, type OverdueInvoice, type ThroughputSeries,
  type SiteRow, type DeviceRow,
} from '../consoleModel';

const summary = (total: number, active: number): SummaryData => ({
  clients: { total, active },
  contracts: { total: 9, active: 7, suspended: 2 },
  revenue_30d: { outstanding: '0', collected: '0', total_invoiced: '0' },
  tickets: { total: 5, open_count: 3 },
  devices: { total: 20, monitored: 17 },
});

describe('demo↔real gate', () => {
  it('is demo when there is no summary', () => {
    expect(hasRealData(undefined)).toBe(false);
    expect(resolveModel({}).isDemo).toBe(true);
    expect(resolveModel({}).kpis.activeClients.value).toBe('12,847');
  });

  it('is demo when the system has zero clients', () => {
    expect(hasRealData(summary(0, 0))).toBe(false);
    expect(resolveModel({ summary: summary(0, 0) })).toBe(DEMO_MODEL);
  });

  it('switches to real once the first client exists', () => {
    expect(hasRealData(summary(1, 1))).toBe(true);
    const m = resolveModel({ summary: summary(10, 8) });
    expect(m.isDemo).toBe(false);
    expect(m.kpis.activeClients.value).toBe('8');
  });

  it('labels demo MRR with the org currency', () => {
    const usd = resolveModel({ orgCurrency: 'USD' });
    expect(usd.isDemo).toBe(true);
    expect(usd.kpis.mrr.code).toBe('USD');
    // Default (MXN) returns the shared DEMO_MODEL unchanged.
    expect(resolveModel({ orgCurrency: 'MXN' })).toBe(DEMO_MODEL);
  });
});

describe('real mapping', () => {
  const mrr: MrrRow[] = [{ currency: 'MXN', active_contracts: 7, mrr: '4280000', arpu: '600' }];

  it('formats MRR into a compact value + unit + currency code', () => {
    const m = buildRealModel({ summary: summary(10, 8), mrr });
    expect(m.kpis.mrr.value).toBe('4.28');
    expect(m.kpis.mrr.unit).toBe('M');
    expect(m.kpis.mrr.code).toBe('MXN');
  });

  const multiCcy: MrrRow[] = [
    { currency: 'MXN', active_contracts: 40, mrr: '1000000', arpu: '600' },
    { currency: 'USD', active_contracts: 3, mrr: '50000', arpu: '900' },
  ];

  it('shows MRR in the organization currency, never a cross-currency sum', () => {
    const m = buildRealModel({ summary: summary(10, 8), mrr: multiCcy, orgCurrency: 'MXN' });
    // 1.00M MXN (the org's own row) — NOT 1.05M mixing pesos + dollars.
    expect(m.kpis.mrr.value).toBe('1.00');
    expect(m.kpis.mrr.unit).toBe('M');
    expect(m.kpis.mrr.code).toBe('MXN');
  });

  it('picks the org currency row even when it is not the largest', () => {
    const m = buildRealModel({ summary: summary(10, 8), mrr: multiCcy, orgCurrency: 'USD' });
    expect(m.kpis.mrr.value).toBe('50.0');
    expect(m.kpis.mrr.unit).toBe('K');
    expect(m.kpis.mrr.code).toBe('USD');
  });

  it('shows 0 in the org currency when no MRR row matches it', () => {
    const m = buildRealModel({ summary: summary(10, 8), mrr: multiCcy, orgCurrency: 'EUR' });
    expect(m.kpis.mrr.value).toBe('0');
    expect(m.kpis.mrr.code).toBe('EUR');
  });

  it('maps devices online/total from the summary', () => {
    const m = buildRealModel({ summary: summary(10, 8) });
    expect(m.kpis.devicesOnline.online).toBe(17);
    expect(m.kpis.devicesOnline.total).toBe(20);
  });

  it('maps alert severity/status to event levels', () => {
    const events: AlertEvent[] = [
      { severity: 'critical', status: 'open', rule_name: 'CPU high', device_name: 'rtr-1', created_at: '2026-07-02T14:31:58Z' },
      { severity: 'high', status: 'resolved', rule_name: 'Link', device_name: 'sw-2', created_at: '2026-07-02T14:00:00Z' },
      { severity: 'low', rule_name: 'Info', created_at: '2026-07-02T13:00:00Z' },
    ];
    const m = buildRealModel({ summary: summary(10, 8), events });
    expect(m.events).toHaveLength(3);
    expect(m.events[0].level).toBe('danger');   // critical
    expect(m.events[1].level).toBe('success');  // resolved wins
    expect(m.events[2].level).toBe('accent');   // low/info
    expect(m.events[0].strong).toBe('rtr-1');
  });

  it('caps the overdue count at "100+" when the endpoint saturates its LIMIT 100', () => {
    const many: OverdueInvoice[] = Array.from({ length: 100 }, (_, i) => ({
      id: i, invoice_number: `INV-${i}`, total: '100', currency: 'MXN',
      due_date: '2026-01-01', client_id: 1, first_name: 'A', last_name: 'B', days_overdue: 40,
    }));
    const m = buildRealModel({ summary: summary(500, 480), overdue: many });
    expect(m.kpis.overdue.value).toBe('100+');
    expect(m.kpis.overdue.note).toBe('past due · top 100');
  });

  it('labels a small overdue list "past due" (not "> 30d") and counts exactly', () => {
    const few: OverdueInvoice[] = [
      { id: 1, invoice_number: 'INV-1', total: '1000', currency: 'MXN', due_date: '2026-06-30', client_id: 1, first_name: 'A', last_name: 'B', days_overdue: 3 },
      { id: 2, invoice_number: 'INV-2', total: '500', currency: 'MXN', due_date: '2026-06-20', client_id: 2, first_name: 'C', last_name: 'D', days_overdue: 13 },
    ];
    const m = buildRealModel({ summary: summary(10, 8), overdue: few });
    expect(m.kpis.overdue.value).toBe('2');
    expect(m.kpis.overdue.note).toBe('past due');
    expect(m.kpis.overdue.amount).toBe('1.5K'); // 1000 + 500 MXN
  });

  it('never mixes currencies in the overdue amount', () => {
    const mixed: OverdueInvoice[] = [
      { id: 1, invoice_number: 'INV-1', total: '1000000', currency: 'MXN', due_date: '2026-06-01', client_id: 1, first_name: 'A', last_name: 'B', days_overdue: 40 },
      { id: 2, invoice_number: 'INV-2', total: '5000', currency: 'USD', due_date: '2026-06-01', client_id: 2, first_name: 'C', last_name: 'D', days_overdue: 40 },
    ];
    const m = buildRealModel({ summary: summary(10, 8), overdue: mixed });
    // Dominant (MXN) bucket only — 1,000,000 → "1.00M"; the 5,000 USD is not added in.
    expect(m.kpis.overdue.amount).toBe('1.00M');
  });

  it('tolerates a non-array events payload without throwing', () => {
    // A malformed endpoint response (object instead of array) must not crash.
    const m = buildRealModel({ summary: summary(10, 8), events: {} as unknown as AlertEvent[] });
    expect(m.events).toEqual([]);
  });

  it('starts real mode with empty site/device panels (no live source yet)', () => {
    const m = buildRealModel({ summary: summary(10, 8) });
    expect(m.sites).toEqual([]);
    expect(m.devices).toEqual([]);
  });
});

describe('live panels (sessions / sites / devices)', () => {
  const site = (name: string, total: number, online: number): SiteRow => ({
    id: 1, name, device_count: total, devices_online: online,
  });

  it('maps a fully-up site to util 100 / ok', () => {
    const m = mapSite(site('Norte', 5, 5));
    expect(m).toEqual({ code: 'NOR', util: 100, status: 'ok' });
  });

  it('maps a partly-down site to warn, majority-down to crit', () => {
    expect(mapSite(site('Poniente', 5, 4)).status).toBe('warn'); // 80%
    expect(mapSite(site('Poniente', 5, 4)).util).toBe(80);
    expect(mapSite(site('Bajio', 5, 1)).status).toBe('crit');    // 20%
  });

  it('maps a site with no devices to util 0 / ok', () => {
    expect(mapSite(site('Empty', 0, 0))).toEqual({ code: 'EMP', util: 0, status: 'ok' });
  });

  it('uses word initials for multi-word site names so codes stay distinct', () => {
    expect(mapSite(site('POP Norte', 4, 4)).code).toBe('PN');
    expect(mapSite(site('POP Sur', 4, 4)).code).toBe('PS');
  });

  const dev = (over: Partial<DeviceRow>): DeviceRow => ({
    id: 1, name: 'bras-01', status: 'online', ip_address: '10.0.0.1', type: 'router',
    manufacturer: 'MikroTik', model: 'CCR', role: 'core', last_poll_error: null,
    cpu: 28, clients: 8420, ...over,
  });

  it('maps an online device with derived sub / type label / formatted clients', () => {
    const m = mapDevice(dev({}));
    expect(m.status).toBe('online');
    expect(m.sub).toBe('MikroTik · Core');
    expect(m.type).toBe('Router');
    expect(m.clients).toBe('8,420');
    expect(m.cpu).toBe(28);
    expect(m.tp).toBe('—');       // no per-device throughput source yet
    expect(m.uptime).toBe('—');
    expect(m.spark).toBeNull();
  });

  it('derives degraded from maintenance or a poll error, offline from status', () => {
    expect(mapDevice(dev({ status: 'offline', cpu: null })).status).toBe('offline');
    expect(mapDevice(dev({ status: 'maintenance' })).status).toBe('degraded');
    expect(mapDevice(dev({ status: 'online', last_poll_error: 'timeout' })).status).toBe('degraded');
    expect(mapDevice(dev({ status: 'offline', cpu: null })).cpu).toBeNull();
  });

  it('labels the device sub with the type label (not a raw enum) when role is null', () => {
    const m = mapDevice(dev({ role: null, type: 'ptmp_ap', manufacturer: 'Ubiquiti' }));
    expect(m.sub).toBe('Ubiquiti · PTMP'); // not "Ubiquiti · Ptmp_ap"
  });

  it('wires sessions/sites/devices into the real model, with a session fallback', () => {
    const m = buildRealModel({
      summary: summary(10, 8),
      sessions: { value: '1,284', note: 'RADIUS · 93% of base' },
      sitesData: [site('Norte', 5, 5), site('Bajio', 5, 1)],
      devicesData: [dev({}), dev({ id: 2, name: 'ptmp-2', status: 'offline', cpu: null, clients: 0 })],
    });
    expect(m.kpis.liveSessions).toEqual({ value: '1,284', note: 'RADIUS · 93% of base' });
    expect(m.sites).toHaveLength(2);
    expect(m.devices).toHaveLength(2);
    expect(m.devices[1].clients).toBe('0');

    // No sessions payload → placeholder.
    const m2 = buildRealModel({ summary: summary(10, 8) });
    expect(m2.kpis.liveSessions).toEqual({ value: '—', note: 'RADIUS' });
    expect(m2.sites).toEqual([]);
    expect(m2.devices).toEqual([]);
  });
});

describe('throughput chart', () => {
  it('is deterministic for a given range', () => {
    expect(buildChart(7, '24H')).toEqual(buildChart(7, '24H'));
  });

  it('differs across ranges', () => {
    expect(buildChart(7, '1H').inLine).not.toBe(buildChart(7, '7D').inLine);
  });

  it('produces path data and stats', () => {
    const c = buildChart(7, '24H');
    expect(c.inLine.startsWith('M')).toBe(true);
    expect(c.inArea.endsWith('Z')).toBe(true);
    expect(Number(c.peak)).toBeGreaterThan(0);
    expect(c.commit).toBe(68);
  });

  it('builds paths + Gbps stats from a real SNMP series (commit null)', () => {
    const series: ThroughputSeries = {
      points: [
        { ts: '2026-07-02T00:00:00Z', in_bps: 0, out_bps: 0 },
        { ts: '2026-07-02T00:15:00Z', in_bps: 8_000_000_000, out_bps: 4_000_000_000 },
      ],
      peak_gbps: 8, avg_gbps: 4, p95_gbps: 7.6, has_data: true,
    };
    const c = buildChartFromSeries(series);
    expect(c.inLine.startsWith('M')).toBe(true);
    expect(c.inArea.endsWith('Z')).toBe(true);
    expect(c.peak).toBe('8.00');
    expect(c.avg).toBe('4.00');
    expect(c.p95).toBe('7.60');
    expect(c.commit).toBeNull();
  });
});
