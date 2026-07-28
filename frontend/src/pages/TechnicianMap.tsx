// =============================================================================
// FireISP 5.0 — Technician Live Map
// =============================================================================
// The GPS tracking backend was complete and had ZERO frontend consumers at
// BOTH ends: nothing displayed technician positions and nothing posted them.
// A dispatcher wanting the nearest technician for an emergency had to phone
// around.
//
// This page is both halves:
//   * the dispatch view — poll GET /positions, render markers
//   * the technician view — browser geolocation POSTing breadcrumbs
//
// The spec calls this "requires mobile app". That is WRONG and worth stating
// plainly: browser geolocation works on any phone, and the native app is a
// separate, deliberately-deferred thing. A technician opens this page in
// Chrome on their handset and the dispatcher sees them.
//
// Map plumbing is copied from TopologyMapPage — same leaflet + CircleMarker
// pattern, same OSM tiles — rather than inventing a second convention.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, CircleMarker, Popup, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapTiles } from '@/components/MapTiles';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { styles } from './crudStyles';

interface Position {
  user_id: number;
  latitude: string | number;
  longitude: string | number;
  accuracy_m: number | null;
  recorded_at: string;
  first_name: string | null;
  last_name: string | null;
}

// Mexico-ish, matching the topology map's fallback: a sensible view when no
// technician has reported yet, rather than the middle of the Atlantic.
const FALLBACK_CENTER: [number, number] = [23.6345, -102.5528];
const DEFAULT_ZOOM = 5;
const POLL_MS = 30_000;
// Older than this and the dot is a stale last-known position, not "where they
// are". Saying so is the difference between a useful map and a misleading one.
const STALE_AFTER_MS = 10 * 60 * 1000;

async function fetchPositions(): Promise<Position[]> {
  const res = await api.GET('/technician-tracking/positions', {});
  if (res.error) throw new Error('Failed to load positions');
  return ((res.data as unknown as { data: Position[] }).data) ?? [];
}

async function postBreadcrumb(lat: number, lng: number, accuracy: number | null): Promise<void> {
  const res = await api.POST('/technician-tracking/breadcrumb', {
    body: { latitude: lat, longitude: lng, accuracy_m: accuracy } as never,
  });
  if ((res as { error?: unknown }).error) throw new Error('Failed to send position');
}

const name = (p: Position) =>
  [p.first_name, p.last_name].filter(Boolean).join(' ') || `#${p.user_id}`;

const minutesAgo = (iso: string) => Math.round((Date.now() - new Date(iso).getTime()) / 60000);

export function TechnicianMap() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Posting a breadcrumb needs technician_tracking.INGEST, which support and
  // readonly do not hold (migration 298) even though they can VIEW the map.
  // An ungated share button would ask them for GPS permission and then 403.
  const canShare = can(user, 'technician_tracking.ingest');
  const positionsQ = useQuery({
    queryKey: ['technician-positions'],
    queryFn: fetchPositions,
    refetchInterval: POLL_MS,
  });

  // ---- Technician side: share my position -----------------------------------
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  useEffect(() => () => {
    // Stop the GPS watch if the page unmounts while sharing — leaving it
    // running drains a technician's battery for nothing.
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
  }, []);

  function toggleSharing() {
    setShareError(null);
    if (sharing) {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setSharing(false);
      return;
    }
    if (!navigator.geolocation) {
      setShareError(t('technicianMap.noGeolocation'));
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        postBreadcrumb(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null)
          .then(() => { setLastSent(new Date().toISOString()); setShareError(null); })
          .catch(() => setShareError(t('technicianMap.sendError')));
      },
      // A denied permission or a timeout must SAY so. Silently sharing nothing
      // is how a technician believes dispatch can see them when it cannot.
      (err) => setShareError(err.code === err.PERMISSION_DENIED
        ? t('technicianMap.permissionDenied')
        : t('technicianMap.positionError')),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    setSharing(true);
  }

  // Number(null) and Number('') are both 0, which IS finite — so a bare
  // isFinite check lets a missing coordinate through and plots the technician
  // at 0,0, in the Atlantic off Ghana. Reject the empty cases explicitly.
  const usable = (v: string | number | null | undefined) =>
    v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const positions = (positionsQ.data ?? []).filter(p => usable(p.latitude) && usable(p.longitude));
  const center: [number, number] = positions.length > 0
    ? [Number(positions[0].latitude), Number(positions[0].longitude)]
    : FALLBACK_CENTER;

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ marginBottom: 4 }}>{t('technicianMap.title')}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
        {t('technicianMap.description')}
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        {canShare && (
          <button style={sharing ? styles.btnSecondary : styles.btnPrimary} onClick={toggleSharing}>
            {sharing ? t('technicianMap.stopSharing') : t('technicianMap.startSharing')}
          </button>
        )}
        {sharing && !shareError && (
          <span style={{ fontSize: 13, color: '#065f46' }}>
            {lastSent
              ? t('technicianMap.sharingSince', { time: new Date(lastSent).toLocaleTimeString() })
              : t('technicianMap.waitingForFix')}
          </span>
        )}
        {shareError && <span style={{ fontSize: 13, color: '#991b1b' }}>{shareError}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {t('technicianMap.autoRefresh')}
        </span>
      </div>

      {positionsQ.isLoading && <p>{t('common.loading')}</p>}
      {positionsQ.isError && <p style={{ color: '#991b1b' }}>{t('technicianMap.loadError')}</p>}
      {!positionsQ.isLoading && !positionsQ.isError && positions.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          {t('technicianMap.noPositions')}
        </p>
      )}

      <MapContainer center={center} zoom={DEFAULT_ZOOM} style={{ height: 520, borderRadius: 8 }}>
        <MapTiles />
        {positions.map(p => {
          const stale = Date.now() - new Date(p.recorded_at).getTime() > STALE_AFTER_MS;
          return (
            <CircleMarker
              key={p.user_id}
              center={[Number(p.latitude), Number(p.longitude)]}
              radius={8}
              pathOptions={{ color: stale ? '#9ca3af' : '#2563eb', fillOpacity: stale ? 0.35 : 0.8 }}
            >
              <Tooltip>{name(p)}</Tooltip>
              <Popup>
                <strong>{name(p)}</strong><br />
                {t('technicianMap.lastSeen', { minutes: minutesAgo(p.recorded_at) })}
                {stale && <><br /><em>{t('technicianMap.staleWarning')}</em></>}
                {p.accuracy_m != null && <><br />{t('technicianMap.accuracy', { m: p.accuracy_m })}</>}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {positions.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <table style={table}>
            <thead><tr>
              <th style={th}>{t('technicianMap.technician')}</th>
              <th style={th}>{t('technicianMap.lastReport')}</th>
              <th style={th}>{t('technicianMap.accuracyCol')}</th>
            </tr></thead>
            <tbody>
              {positions.map(p => {
                const stale = Date.now() - new Date(p.recorded_at).getTime() > STALE_AFTER_MS;
                return (
                  <tr key={p.user_id}>
                    <td style={td}>{name(p)}</td>
                    <td style={{ ...td, color: stale ? '#b45309' : undefined }}>
                      {t('technicianMap.lastSeen', { minutes: minutesAgo(p.recorded_at) })}
                      {stale && ` — ${t('technicianMap.stale')}`}
                    </td>
                    <td style={td}>{p.accuracy_m != null ? `${p.accuracy_m} m` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px', background: 'var(--bg-subtle, #f9fafb)',
  borderBottom: '1px solid var(--border, #e5e7eb)', fontWeight: 600,
};
const td: React.CSSProperties = { padding: '7px 12px', borderBottom: '1px solid var(--border, #f3f4f6)' };

export default TechnicianMap;
