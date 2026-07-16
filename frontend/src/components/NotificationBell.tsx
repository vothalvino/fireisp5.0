// =============================================================================
// FireISP 5.0 — Staff notification bell (topbar)
// =============================================================================
// Polls the unread count (60s + on focus), shows recent notifications in a
// dropdown, marks read on click and deep-links via entity_type/entity_id.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';

interface NotificationRow {
  id: number;
  title: string;
  body: string | null;
  type: string;
  entity_type: string | null;
  entity_id: number | null;
  is_read: number | boolean;
  created_at: string;
}

/** Deep-link target per entity family; null = no navigation. */
function entityRoute(n: NotificationRow): string | null {
  if (!n.entity_type) return null;
  switch (n.entity_type) {
    case 'tickets': return n.entity_id ? `/tickets/${n.entity_id}` : '/tickets';
    case 'work_orders': return '/work-orders';
    case 'invoices': return n.entity_id ? `/invoices/${n.entity_id}` : '/invoices';
    case 'sites': return n.entity_id ? `/sites/${n.entity_id}` : '/sites';
    default: return null;
  }
}

function timeAgo(iso: string, locale: string): string {
  const secs = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (secs < 3600) return rtf.format(-Math.floor(secs / 60), 'minute');
  if (secs < 86400) return rtf.format(-Math.floor(secs / 3600), 'hour');
  return rtf.format(-Math.floor(secs / 86400), 'day');
}

export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: async () => {
      const res = await api.GET('/notifications/unread-count' as never);
      if ((res as { error?: unknown }).error) return 0;
      return ((res as { data?: { data?: { count?: number } } }).data?.data?.count) ?? 0;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: items = [] } = useQuery({
    queryKey: ['notifications-list'],
    queryFn: async () => {
      const res = await api.GET('/notifications' as never, { params: { query: { limit: 15 } as never } } as never);
      if ((res as { error?: unknown }).error) return [];
      return (((res as { data?: { data?: NotificationRow[] } }).data?.data) ?? []) as NotificationRow[];
    },
    enabled: open,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    qc.invalidateQueries({ queryKey: ['notifications-list'] });
  }

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      await api.POST(`/notifications/{id}/read` as never, { params: { path: { id } as never } } as never);
    },
    onSettled: refresh,
  });

  const markAll = useMutation({
    mutationFn: async () => {
      await api.POST('/notifications/read-all' as never);
    },
    onSettled: refresh,
  });

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleItemClick(n: NotificationRow) {
    if (!n.is_read) markRead.mutate(n.id);
    const to = entityRoute(n);
    setOpen(false);
    if (to) navigate(to);
  }

  return (
    <div ref={rootRef} className="notif-bell-root">
      <button
        className="notif-bell-btn"
        aria-label={t('notifications.bellLabel', { count: unread })}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
          <path d="M10 20a2.2 2.2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label={t('notifications.title')}>
          <div className="notif-panel-head">
            <span>{t('notifications.title')}</span>
            {unread > 0 && (
              <button className="notif-mark-all" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          <ul className="notif-list">
            {items.length === 0 && <li className="notif-empty">{t('notifications.empty')}</li>}
            {items.map(n => (
              <li key={n.id}>
                <button
                  className={`notif-item${n.is_read ? '' : ' unread'}`}
                  onClick={() => handleItemClick(n)}
                >
                  <span className="notif-item-title">{n.title}</span>
                  {n.body && <span className="notif-item-body">{n.body}</span>}
                  <span className="notif-item-time">{timeAgo(n.created_at, i18n.language)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
