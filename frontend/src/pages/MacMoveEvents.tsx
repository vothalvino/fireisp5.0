// =============================================================================
// FireISP 5.0 — MAC Move Events
// =============================================================================
// Read-only table page at /mac-move-events. Shows MAC address move detection
// events recorded by the RADIUS stack. Paginated, no create/edit/delete.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MacMoveEvent {
  id: number;
  organization_id: number;
  username: string;
  old_mac: string;
  new_mac: string;
  old_nas_id: number | null;
  new_nas_id: number | null;
  detected_at: string;
}

interface MacMoveEventsResponse {
  data: MacMoveEvent[];
  meta: { total: number; page: number; limit: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchMacMoveEvents(page: number): Promise<MacMoveEventsResponse> {
  const res = await api.GET('/radius/mac-move-events', { params: { query: { page, limit: PAGE_SIZE } as never } });
  if (res.error) throw new Error('Failed to load MAC move events');
  return res.data as unknown as MacMoveEventsResponse;
}

// ---------------------------------------------------------------------------
// MacMoveEvents component
// ---------------------------------------------------------------------------

export function MacMoveEvents() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const eventsQ = useQuery({
    queryKey: ['mac-move-events', page],
    queryFn: () => fetchMacMoveEvents(page),
  });

  const events = eventsQ.data?.data ?? [];
  const meta = eventsQ.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('mac_move_events.title', 'MAC Move Events')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {eventsQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : eventsQ.error ? (
          <p style={styles.msgError}>{t('mac_move_events.error', 'Failed to load MAC move events.')}</p>
        ) : events.length === 0 ? (
          <p style={styles.msg}>{t('mac_move_events.empty', 'No MAC move events found.')}</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Username', 'Old MAC', 'New MAC', 'Old NAS ID', 'New NAS ID', 'Detected At'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} style={styles.tr}>
                      <td style={styles.td}>#{ev.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{ev.username}</td>
                      <td style={styles.td}>{ev.old_mac}</td>
                      <td style={styles.td}>{ev.new_mac}</td>
                      <td style={styles.td}>{ev.old_nas_id ?? '—'}</td>
                      <td style={styles.td}>{ev.new_nas_id ?? '—'}</td>
                      <td style={styles.td}>{new Date(ev.detected_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={styles.pagination}>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  &larr; Prev
                </button>
                <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next &rarr;
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
