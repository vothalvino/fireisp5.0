// =============================================================================
// FireISP 5.0 — Operations Console
// =============================================================================
// The operations overview dashboard (replaces the former AdminDashboard at "/").
// A single dense screen: KPI row, network throughput, live events, sites/POPs,
// and a filterable device table — built on the FireISP UI kit + design tokens.
//
// Data gate: while the system is empty (no real clients yet) the console shows
// the design's polished DEMO numbers so a fresh install looks alive. Once the
// first client exists it auto-switches to live /dashboard/* + /alerts/events
// data mapped into the same view-model. See consoleModel.ts.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useWebSocket } from '@/api/useWebSocket';
import { Button, Badge, Modal, Field } from '@/components/ui';
import {
  resolveModel, buildChart, type Range,
  type SummaryData, type MrrRow, type DeviceHealthData, type OverdueInvoice, type AlertEvent, type EventModel,
} from './operations-console/consoleModel';
import { KpiRow, ThroughputChart, LiveEvents, SitesStrip, DeviceTable, type DeviceFilter } from './operations-console/consoleWidgets';
import './operations-console/console.css';

// ---------------------------------------------------------------------------
// Fetch helpers — typed api client (auth + silent-refresh middleware)
// ---------------------------------------------------------------------------

async function fetchSummary(): Promise<SummaryData> {
  const res = await api.GET('/dashboard/summary');
  if (res.error) throw new Error('Failed to load summary');
  return (res.data as unknown as { data: SummaryData }).data;
}
async function fetchMrr(): Promise<MrrRow[]> {
  const res = await api.GET('/dashboard/mrr');
  if (res.error) throw new Error('Failed to load MRR');
  return (res.data as unknown as { data: MrrRow[] }).data;
}
async function fetchDeviceHealth(): Promise<DeviceHealthData> {
  const res = await api.GET('/dashboard/device-health');
  if (res.error) throw new Error('Failed to load device health');
  return (res.data as unknown as { data: DeviceHealthData }).data;
}
async function fetchOverdue(): Promise<OverdueInvoice[]> {
  const res = await api.GET('/dashboard/overdue');
  if (res.error) throw new Error('Failed to load overdue invoices');
  return (res.data as unknown as { data: OverdueInvoice[] }).data;
}
// Events are best-effort: a missing endpoint or a role without devices.view must
// not break the console — fall back to an empty feed.
async function fetchEvents(): Promise<AlertEvent[]> {
  try {
    const res = await api.GET('/alerts/events' as never, { params: { query: { limit: 12 } as never } } as never) as { error?: unknown; data?: unknown };
    if (res.error) return [];
    const d = (res.data as { data?: unknown })?.data;
    return Array.isArray(d) ? (d as AlertEvent[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtClock(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

const DEMO_TICKET_BASE = 38;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OperationsConsole() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Live-data queries (auto-refresh keeps the "live" feel once real).
  const summaryQ = useQuery({ queryKey: ['dashboard-summary'], queryFn: fetchSummary, refetchInterval: 30_000 });
  const mrrQ = useQuery({ queryKey: ['dashboard-mrr'], queryFn: fetchMrr, refetchInterval: 60_000 });
  const healthQ = useQuery({ queryKey: ['dashboard-device-health'], queryFn: fetchDeviceHealth, refetchInterval: 60_000 });
  const overdueQ = useQuery({ queryKey: ['dashboard-overdue'], queryFn: fetchOverdue, refetchInterval: 60_000 });
  const eventsQ = useQuery({ queryKey: ['alerts-events'], queryFn: fetchEvents, refetchInterval: 30_000 });

  // Live notifications → silently refresh KPIs (proven pattern from AdminDashboard).
  const { lastMessage: liveEvent } = useWebSocket('notifications');
  useEffect(() => {
    if (!liveEvent) return;
    const ev = liveEvent.event;
    if (ev === 'invoice' || ev === 'payment' || ev === 'overdue') {
      void qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
      void qc.invalidateQueries({ queryKey: ['dashboard-overdue'] });
    } else if (ev === 'ticket') {
      void qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    }
  }, [liveEvent, qc]);

  const model = useMemo(
    () => resolveModel({
      summary: summaryQ.data,
      mrr: mrrQ.data,
      health: healthQ.data,
      overdue: overdueQ.data,
      events: eventsQ.data,
    }),
    [summaryQ.data, mrrQ.data, healthQ.data, overdueQ.data, eventsQ.data],
  );

  // View state
  const [range, setRange] = useState<Range>('24H');
  const [filter, setFilter] = useState<DeviceFilter>('All');
  const [query, setQuery] = useState('');

  // Demo-only local interactions (new-ticket simulation)
  const [created, setCreated] = useState(0);
  const [localEvents, setLocalEvents] = useState<EventModel[]>([]);

  // New-ticket modal
  const [modalOpen, setModalOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState<'Low' | 'Normal' | 'High'>('Normal');
  const [err, setErr] = useState('');

  // ⌘K / Ctrl-K focuses the device search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        document.getElementById('fi-device-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const chart = useMemo(() => buildChart(7, range), [range]);

  // Compose the rendered model, folding in demo-only local interactions.
  const kpis = model.isDemo
    ? { ...model.kpis, openTickets: { ...model.kpis.openTickets, value: String(DEMO_TICKET_BASE + created) } }
    : model.kpis;
  const events = model.isDemo ? [...localEvents, ...model.events] : model.events;

  function onNewTicket() {
    if (model.isDemo) {
      setSubject(''); setPriority('Normal'); setErr('');
      setModalOpen(true);
    } else {
      navigate('/tickets');
    }
  }

  function createTicket() {
    if (!subject.trim()) { setErr('Subject is required'); return; }
    const id = 8842 + created;
    setLocalEvents([{ time: fmtClock(), level: 'accent', pre: 'ticket.create · ', strong: '#' + id, post: ' · ' + priority }, ...localEvents]);
    setCreated(created + 1);
    setSubject(''); setPriority('Normal'); setErr('');
    setModalOpen(false);
  }

  return (
    <div className="fi-console" data-screen-label="Operations Console">
      {/* Header */}
      <div className="fi-main-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 className="fi-main-title">Operations Overview</h1>
          <span className="fi-main-sub">Network operations · auto-refresh 30s</span>
        </div>
        {model.isDemo && (
          <Badge tone="warning" style={{ alignSelf: 'center' }}>
            <span title="Sample data — the console switches to live figures once your first client is added.">Demo data</span>
          </Badge>
        )}
        <div className="fi-spacer" />
        <Button onClick={onNewTicket}>New ticket</Button>
      </div>

      {/* KPI row */}
      <KpiRow kpis={kpis} />

      {/* Throughput + live events */}
      <div className="fi-row">
        <div className="grow"><ThroughputChart range={range} onRange={setRange} chart={chart} /></div>
        <div className="side"><LiveEvents events={events} /></div>
      </div>

      {/* Sites & POPs */}
      <SitesStrip sites={model.sites} />

      {/* Devices */}
      <div>
        {/* Search field feeds the device table filter; ⌘K focuses it. */}
        <div style={{ marginBottom: 'var(--sp-3)' }}>
          <Field
            label="Search devices"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, IP, or type…  (⌘K)"
            id="fi-device-search"
            style={{ maxWidth: 360 }}
          />
        </div>
        <DeviceTable devices={model.devices} filter={filter} onFilter={setFilter} query={query} />
      </div>

      {/* New-ticket modal (demo simulation) */}
      <Modal
        open={modalOpen}
        title="New ticket"
        onClose={() => { setModalOpen(false); setErr(''); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setModalOpen(false); setErr(''); }}>Cancel</Button>
            <Button onClick={createTicket}>Create ticket</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', minWidth: 'min(420px, 78vw)' }}>
          <Field
            label="Subject"
            value={subject}
            placeholder="Short summary of the issue…"
            required
            error={err}
            onChange={(e) => { setSubject(e.target.value); if (err) setErr(''); }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 'var(--sp-2)', color: 'var(--text-secondary)' }}>Priority</div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              {(['Low', 'Normal', 'High'] as const).map((p) => (
                <Button key={p} size="sm" variant={priority === p ? 'primary' : 'secondary'} onClick={() => setPriority(p)}>{p}</Button>
              ))}
            </div>
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Demo: adds a live entry to the events feed and bumps the open-ticket count.
          </span>
        </div>
      </Modal>
    </div>
  );
}

export default OperationsConsole;
