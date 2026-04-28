// =============================================================================
// FireISP 5.0 — ChangelogPanel (P3.8)
// =============================================================================
// Bell icon with unread badge + slide-in "What's New" panel.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

const LS_KEY = 'fireisp_changelog_seen';
const API_URL = '/api/v1/changelog';

export interface ChangelogEntry {
  id: string;
  date: string;
  title: string;
  body: string;
  tags: string[];
}

async function fetchChangelog(): Promise<ChangelogEntry[]> {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('Failed to load changelog');
  const body = (await res.json()) as { data: ChangelogEntry[] };
  return body.data ?? [];
}

function getSeenId(): string {
  try {
    return localStorage.getItem(LS_KEY) ?? '';
  } catch {
    return '';
  }
}

function setSeenId(id: string): void {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch { /* ignore */ }
}

export function ChangelogPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [seenId, setSeenIdState] = useState(getSeenId);

  const { data: entries = [] } = useQuery<ChangelogEntry[]>({
    queryKey: ['changelog'],
    queryFn: fetchChangelog,
    staleTime: 1000 * 60 * 10,
  });

  const unreadCount = entries.filter((e) => {
    if (!seenId) return true;
    const seenEntry = entries.find((x) => x.id === seenId);
    if (!seenEntry) return true;
    return new Date(e.date) > new Date(seenEntry.date);
  }).length;

  const markAllRead = useCallback(() => {
    if (entries.length > 0) {
      const newestId = entries[0].id;
      setSeenId(newestId);
      setSeenIdState(newestId);
    }
  }, [entries]);

  const handleOpen = () => setOpen(true);

  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  return (
    <>
      <button
        onClick={handleOpen}
        aria-label={t('changelog.title')}
        style={styles.bellBtn}
        data-testid="changelog-bell"
      >
        🔔
        {unreadCount > 0 && (
          <span style={styles.badge} data-testid="changelog-badge">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Overlay */}
      {open && (
        <div
          style={styles.overlay}
          onClick={handleClose}
          aria-hidden="true"
          data-testid="changelog-overlay"
        />
      )}

      {/* Slide-in panel */}
      <div
        style={{
          ...styles.panel,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={t('changelog.title')}
        data-testid="changelog-panel"
      >
        <div style={styles.panelHeader}>
          <h2 style={styles.panelTitle}>{t('changelog.title')}</h2>
          <div style={styles.headerActions}>
            <button
              onClick={markAllRead}
              style={styles.markBtn}
              data-testid="changelog-mark-all-read"
            >
              {t('changelog.markAllRead')}
            </button>
            <button
              onClick={handleClose}
              style={styles.closeBtn}
              aria-label={t('changelog.close')}
              data-testid="changelog-close"
            >
              ✕
            </button>
          </div>
        </div>

        <div style={styles.entryList}>
          {entries.length === 0 && (
            <p style={styles.emptyMsg}>{t('changelog.noEntries')}</p>
          )}
          {entries.map((entry) => (
            <div key={entry.id} style={styles.entry} data-testid="changelog-entry">
              <div style={styles.entryMeta}>
                <span style={styles.entryDate}>
                  {new Date(entry.date).toLocaleDateString()}
                </span>
                {!seenId || (entries.find((x) => x.id === seenId) && new Date(entry.date) > new Date(entries.find((x) => x.id === seenId)!.date)) ? (
                  <span style={styles.newBadge}>{t('changelog.newBadge')}</span>
                ) : null}
              </div>
              <h3 style={styles.entryTitle}>{entry.title}</h3>
              <p style={styles.entryBody}>{entry.body}</p>
              <div style={styles.tagList}>
                {entry.tags.map((tag) => (
                  <span key={tag} style={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bellBtn: {
    position: 'relative',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1.2rem',
    padding: '0 4px',
    color: 'var(--text-primary)',
  },
  badge: {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    background: 'var(--color-danger, #e53e3e)',
    color: '#fff',
    borderRadius: '999px',
    fontSize: '0.65rem',
    fontWeight: 700,
    minWidth: '16px',
    height: '16px',
    lineHeight: '16px',
    textAlign: 'center',
    padding: '0 3px',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.3)',
    zIndex: 999,
  },
  panel: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: '360px',
    maxWidth: '100vw',
    background: 'var(--bg-card, #fff)',
    color: 'var(--text-primary, #111)',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    transition: 'transform 0.25s ease',
    overflowY: 'auto',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    borderBottom: '1px solid var(--border-color, #e5e7eb)',
  },
  panelTitle: {
    margin: 0,
    fontSize: '1rem',
    fontWeight: 600,
  },
  headerActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  markBtn: {
    background: 'none',
    border: '1px solid var(--border-color, #e5e7eb)',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '0.75rem',
    cursor: 'pointer',
    color: 'var(--text-secondary, #555)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1rem',
    cursor: 'pointer',
    color: 'var(--text-secondary, #555)',
    padding: '4px',
  },
  entryList: {
    flex: 1,
    padding: '8px',
    overflowY: 'auto',
  },
  emptyMsg: {
    color: 'var(--text-secondary, #888)',
    textAlign: 'center',
    marginTop: '32px',
    fontSize: '0.875rem',
  },
  entry: {
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '8px',
    background: 'var(--bg-surface, #f9fafb)',
    border: '1px solid var(--border-color, #e5e7eb)',
  },
  entryMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  entryDate: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary, #888)',
  },
  newBadge: {
    background: 'var(--color-accent, #3b82f6)',
    color: '#fff',
    borderRadius: '4px',
    fontSize: '0.65rem',
    fontWeight: 700,
    padding: '1px 6px',
  },
  entryTitle: {
    margin: '0 0 4px',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: 'var(--text-primary, #111)',
  },
  entryBody: {
    margin: '0 0 8px',
    fontSize: '0.8rem',
    color: 'var(--text-secondary, #555)',
    lineHeight: 1.5,
  },
  tagList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  tag: {
    background: 'var(--bg-card, #e5e7eb)',
    color: 'var(--text-secondary, #555)',
    borderRadius: '999px',
    fontSize: '0.65rem',
    padding: '2px 8px',
    border: '1px solid var(--border-color, #d1d5db)',
  },
};
