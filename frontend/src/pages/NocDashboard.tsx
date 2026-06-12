// =============================================================================
// FireISP 5.0 — NOC Dashboard (§12)
// =============================================================================
// Operational view with 6 panels: Network Health, Active Alarms, Ongoing
// Outages, Ticket Queue, Recent Events, and SLA Compliance.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NetworkHealth {
  devices_up: number;
  devices_down: number;
  devices_total: number;
  uptime_pct: number | null;
}

interface AlarmSummary {
  data: Array<{ severity: string; count: number }>;
}

interface OngoingOutage {
  id: number;
  title: string;
  severity: string;
  started_at: string | null;
  affected_clients_count: number | null;
}

interface OutagesResponse {
  data: OngoingOutage[];
}

interface TicketQueueItem {
  status: string;
  count: number;
}

interface TicketQueueResponse {
  data: TicketQueueItem[];
}

interface NocEvent {
  id: number;
  event_type: string;
  description: string | null;
  created_at: string;
}

interface EventsResponse {
  data: NocEvent[];
}

interface SlaCompliance {
  total_tickets: number;
  breached_tickets: number;
  compliance_pct: number | null;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchHealth(): Promise<NetworkHealth> {
  const res = await api.GET('/noc/health' as never, {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load network health');
  return (res as { data: unknown }).data as unknown as NetworkHealth;
}

async function fetchAlarms(): Promise<AlarmSummary> {
  const res = await api.GET('/noc/alarms' as never, {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load alarms');
  return (res as { data: unknown }).data as unknown as AlarmSummary;
}

async function fetchOutages(): Promise<OutagesResponse> {
  const res = await api.GET('/noc/outages' as never, {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load outages');
  return (res as { data: unknown }).data as unknown as OutagesResponse;
}

async function fetchTicketQueue(): Promise<TicketQueueResponse> {
  const res = await api.GET('/noc/ticket-queue' as never, {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load ticket queue');
  return (res as { data: unknown }).data as unknown as TicketQueueResponse;
}

async function fetchEvents(): Promise<EventsResponse> {
  const res = await api.GET('/noc/events' as never, {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load events');
  return (res as { data: unknown }).data as unknown as EventsResponse;
}

async function fetchSlaCompliance(): Promise<SlaCompliance> {
  const res = await api.GET('/noc/sla-compliance' as never, {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load SLA compliance');
  return (res as { data: unknown }).data as unknown as SlaCompliance;
}

// ---------------------------------------------------------------------------
// Panel component
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  borderRadius: 8,
  border: '1px solid var(--border)',
  padding: '1rem',
  minHeight: 160,
  display: 'flex',
  flexDirection: 'column',
};

function Panel({ title, children, loading, error }: {
  title: string;
  children: React.ReactNode;
  loading?: boolean;
  error?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div style={panelStyle}>
      <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
        {title}
      </h3>
      {loading ? (
        <span style={{ color: 'var(--text-secondary)' }}>{t('common.loading')}</span>
      ) : error ? (
        <span style={{ color: '#dc2626' }}>{t('common.loadError')}</span>
      ) : children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Severity badge
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    critical: { bg: '#fee2e2', color: '#991b1b' },
    high:     { bg: '#fef3c7', color: '#92400e' },
    medium:   { bg: '#dbeafe', color: '#1e40af' },
    low:      { bg: '#d1fae5', color: '#065f46' },
  };
  const s = colors[severity] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg,
      color: s.color,
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: '0.72rem',
      fontWeight: 600,
      textTransform: 'capitalize',
    }}>
      {severity}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function NocDashboard() {
  const { t } = useTranslation();

  const healthQ = useQuery({ queryKey: ['noc', 'health'], queryFn: fetchHealth });
  const alarmsQ = useQuery({ queryKey: ['noc', 'alarms'], queryFn: fetchAlarms });
  const outagesQ = useQuery({ queryKey: ['noc', 'outages'], queryFn: fetchOutages });
  const queueQ = useQuery({ queryKey: ['noc', 'ticketQueue'], queryFn: fetchTicketQueue });
  const eventsQ = useQuery({ queryKey: ['noc', 'events'], queryFn: fetchEvents });
  const slaQ = useQuery({ queryKey: ['noc', 'slaCompliance'], queryFn: fetchSlaCompliance });

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 16,
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('noc.title')}</h1>
      </div>

      <div style={gridStyle}>
        {/* Panel 1: Network Health */}
        <Panel
          title={t('noc.networkHealth')}
          loading={healthQ.isLoading}
          error={!!healthQ.error}
        >
          {healthQ.data && (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#059669' }}>
                  {healthQ.data.devices_up}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('noc.devicesUp')}</div>
              </div>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#dc2626' }}>
                  {healthQ.data.devices_down}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('noc.devicesDown')}</div>
              </div>
              {healthQ.data.uptime_pct !== null && (
                <div>
                  <div style={{ fontSize: '2rem', fontWeight: 700 }}>
                    {healthQ.data.uptime_pct?.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Uptime</div>
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* Panel 2: Active Alarms */}
        <Panel
          title={t('noc.alarms')}
          loading={alarmsQ.isLoading}
          error={!!alarmsQ.error}
        >
          {alarmsQ.data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {alarmsQ.data.data.length === 0 ? (
                <span style={{ color: 'var(--text-secondary)' }}>{t('common.noResults')}</span>
              ) : (
                alarmsQ.data.data.map(a => (
                  <div key={a.severity} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <SeverityBadge severity={a.severity} />
                    <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{a.count}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </Panel>

        {/* Panel 3: Ongoing Outages */}
        <Panel
          title={t('noc.outages')}
          loading={outagesQ.isLoading}
          error={!!outagesQ.error}
        >
          {outagesQ.data && (
            outagesQ.data.data.length === 0 ? (
              <span style={{ color: '#059669' }}>{t('noc.noOutages')}</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {outagesQ.data.data.slice(0, 5).map(o => (
                  <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.85rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title}</span>
                    <SeverityBadge severity={o.severity} />
                  </div>
                ))}
              </div>
            )
          )}
        </Panel>

        {/* Panel 4: Ticket Queue */}
        <Panel
          title={t('noc.ticketQueue')}
          loading={queueQ.isLoading}
          error={!!queueQ.error}
        >
          {queueQ.data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {queueQ.data.data.length === 0 ? (
                <span style={{ color: 'var(--text-secondary)' }}>{t('common.noResults')}</span>
              ) : (
                queueQ.data.data.map(q => (
                  <div key={q.status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', textTransform: 'capitalize' }}>{q.status.replace(/_/g, ' ')}</span>
                    <span style={{ fontWeight: 700 }}>{q.count}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </Panel>

        {/* Panel 5: Recent Events */}
        <Panel
          title={t('noc.events')}
          loading={eventsQ.isLoading}
          error={!!eventsQ.error}
        >
          {eventsQ.data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {eventsQ.data.data.length === 0 ? (
                <span style={{ color: 'var(--text-secondary)' }}>{t('common.noResults')}</span>
              ) : (
                eventsQ.data.data.slice(0, 5).map(ev => (
                  <div key={ev.id} style={{ fontSize: '0.82rem', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                    <div style={{ fontWeight: 600 }}>{ev.event_type}</div>
                    {ev.description && (
                      <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.description}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </Panel>

        {/* Panel 6: SLA Compliance */}
        <Panel
          title={t('noc.slaCompliance')}
          loading={slaQ.isLoading}
          error={!!slaQ.error}
        >
          {slaQ.data && (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: slaQ.data.compliance_pct !== null && slaQ.data.compliance_pct >= 90 ? '#059669' : '#dc2626' }}>
                  {slaQ.data.compliance_pct !== null ? `${slaQ.data.compliance_pct.toFixed(1)}%` : t('common.na')}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('noc.compliancePct')}</div>
              </div>
              <div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{slaQ.data.total_tickets}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total</div>
              </div>
              {slaQ.data.breached_tickets > 0 && (
                <div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>{slaQ.data.breached_tickets}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Breached</div>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
