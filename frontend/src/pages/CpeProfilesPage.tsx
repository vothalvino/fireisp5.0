// =============================================================================
// FireISP 5.0 — CPE Profiles Page (§8.2)
// =============================================================================
// Tabbed page:
//   Tab 1: Profiles — list/create/edit with parent selection, plan linkage, vendor targeting
//   Tab 2: Parameter Mappings — for selected profile: list/add/remove mappings
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CpeProfile {
  id: number;
  name: string;
  description: string | null;
  manufacturer: string | null;
  model_name: string | null;
  parent_profile_id: number | null;
  plan_id: number | null;
  wifi_ssid_template: string | null;
  wifi_band: string | null;
  wan_mode: string | null;
  status: string;
  organization_id: number | null;
}

interface ProfileListResponse {
  data: CpeProfile[];
  meta: { total: number; page: number; limit: number };
}

interface CpeParameterMapping {
  id: number;
  cpe_profile_id: number;
  parameter_path: string;
  source_type: string;
  source_field: string | null;
  static_value: string | null;
}

interface MappingListResponse {
  data: CpeParameterMapping[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

const tabStyle = (active: boolean) => ({
  padding: '8px 20px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
  background: active ? '#2563eb' : '#f3f4f6',
  color: active ? '#fff' : '#374151',
  marginRight: 8,
});

// ---------------------------------------------------------------------------
// Profiles Tab
// ---------------------------------------------------------------------------

function ProfilesTab({ onSelectProfile }: { onSelectProfile: (p: CpeProfile) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    manufacturer: '',
    model_name: '',
    wifi_ssid_template: '',
    wifi_band: 'dual',
    wan_mode: 'pppoe',
    status: 'active',
  });
  const [createError, setCreateError] = useState('');

  const { data, isLoading, error } = useQuery<ProfileListResponse>({
    queryKey: ['cpe-profiles', page],
    queryFn: async () => {
      const res = await api.GET('/cpe-profiles' as never, {
        params: { query: { page, limit: PAGE_SIZE } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load profiles');
      return (res as { data: unknown }).data as unknown as ProfileListResponse;
    },
  });

  const createMut = useMutation({
    mutationFn: async (body: typeof form) => {
      const res = await api.POST('/cpe-profiles' as never, { body } as never);
      if ((res as { error?: unknown }).error) throw new Error('Create failed');
      return (res as { data: unknown }).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cpe-profiles'] });
      setShowCreate(false);
      setForm({ name: '', description: '', manufacturer: '', model_name: '', wifi_ssid_template: '', wifi_band: 'dual', wan_mode: 'pppoe', status: 'active' });
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/cpe-profiles/{id}' as never, { params: { path: { id } } } as never);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cpe-profiles'] }),
  });

  const profiles = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ color: '#6b7280' }}>{total} {t('cpeProfiles.profiles.title')}</span>
        <button style={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          + {t('cpeProfiles.profiles.newProfile')}
        </button>
      </div>

      {isLoading && <p>{t('common.loading')}</p>}
      {error && <p style={{ color: '#dc2626' }}>{t('cpeProfiles.profiles.error')}</p>}

      {!isLoading && profiles.length === 0 && (
        <p style={{ color: '#6b7280' }}>{t('cpeProfiles.profiles.empty')}</p>
      )}

      {profiles.length > 0 && (
        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>{t('cpeProfiles.profiles.name')}</th>
                <th style={styles.th}>{t('cpeProfiles.profiles.manufacturer')}</th>
                <th style={styles.th}>{t('cpeProfiles.profiles.wifiBand')}</th>
                <th style={styles.th}>{t('cpeProfiles.profiles.wanMode')}</th>
                <th style={styles.th}>{t('cpeProfiles.profiles.status')}</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => (
                <tr key={p.id} style={styles.tr}>
                  <td style={styles.td}>{p.id}</td>
                  <td style={styles.td}>
                    <button
                      style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
                      onClick={() => onSelectProfile(p)}
                    >
                      {p.name}
                    </button>
                    {p.organization_id === null && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#9ca3af' }}>(global)</span>
                    )}
                  </td>
                  <td style={styles.td}>{p.manufacturer ?? '—'}</td>
                  <td style={styles.td}>{p.wifi_band ?? '—'}</td>
                  <td style={styles.td}>{p.wan_mode ?? '—'}</td>
                  <td style={styles.td}>{p.status}</td>
                  <td style={styles.td}>
                    <button style={styles.btnDanger} onClick={() => { if (confirm('Delete this profile?')) deleteMut.mutate(p.id); }}>
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button style={styles.btnSecondary} disabled={page <= 1} onClick={() => setPage(prev => prev - 1)}>
            {t('common.prev')}
          </button>
          <span style={{ padding: '6px 12px' }}>{page} / {totalPages}</span>
          <button style={styles.btnSecondary} disabled={page >= totalPages} onClick={() => setPage(prev => prev + 1)}>
            {t('common.next')}
          </button>
        </div>
      )}

      {showCreate && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <h3 style={{ marginTop: 0 }}>{t('cpeProfiles.profiles.createTitle')}</h3>
            {createError && <p style={{ color: '#dc2626' }}>{createError}</p>}
            <label style={modalStyles.label}>{t('cpeProfiles.profiles.name')}<RequiredMark /></label>
            <input style={modalStyles.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeProfiles.profiles.manufacturer')}</label>
            <input style={modalStyles.input} value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeProfiles.profiles.wifiSsid')}</label>
            <input style={modalStyles.input} placeholder="MyNet-{{serial}}" value={form.wifi_ssid_template} onChange={e => setForm(f => ({ ...f, wifi_ssid_template: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeProfiles.profiles.wifiBand')}</label>
            <select style={modalStyles.input} value={form.wifi_band} onChange={e => setForm(f => ({ ...f, wifi_band: e.target.value }))}>
              <option value="2.4GHz">2.4 GHz</option>
              <option value="5GHz">5 GHz</option>
              <option value="dual">Dual Band</option>
            </select>
            <label style={modalStyles.label}>{t('cpeProfiles.profiles.wanMode')}</label>
            <select style={modalStyles.input} value={form.wan_mode} onChange={e => setForm(f => ({ ...f, wan_mode: e.target.value }))}>
              <option value="dhcp">DHCP</option>
              <option value="pppoe">PPPoE</option>
              <option value="static">Static</option>
            </select>
            <label style={modalStyles.label}>{t('cpeProfiles.profiles.status')}</label>
            <select style={modalStyles.input} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="draft">Draft</option>
            </select>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button style={styles.btnPrimary} disabled={createMut.isPending} onClick={() => createMut.mutate(form)}>
                {createMut.isPending ? t('common.saving') : t('common.save')}
              </button>
              <button style={styles.btnSecondary} onClick={() => { setShowCreate(false); setCreateError(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parameter Mappings Tab
// ---------------------------------------------------------------------------

function MappingsTab({ profile }: { profile: CpeProfile | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ parameter_path: '', source_type: 'static', source_field: '', static_value: '' });
  const [createError, setCreateError] = useState('');

  const { data, isLoading, error } = useQuery<MappingListResponse>({
    queryKey: ['cpe-profile-mappings', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const res = await api.GET('/cpe-profiles/{id}/mappings' as never, {
        params: { path: { id: profile!.id } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load mappings');
      return (res as { data: unknown }).data as unknown as MappingListResponse;
    },
  });

  const createMut = useMutation({
    mutationFn: async (body: typeof form) => {
      const res = await api.POST('/cpe-profiles/{id}/mappings' as never, {
        params: { path: { id: profile!.id } as never },
        body,
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Create failed');
      return (res as { data: unknown }).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cpe-profile-mappings', profile?.id] });
      setShowCreate(false);
      setForm({ parameter_path: '', source_type: 'static', source_field: '', static_value: '' });
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (mappingId: number) => {
      await api.DELETE('/cpe-profiles/{id}/mappings/{mappingId}' as never, {
        params: { path: { id: profile!.id, mappingId } },
      } as never);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cpe-profile-mappings', profile?.id] }),
  });

  if (!profile) {
    return <p style={{ color: '#6b7280' }}>{t('cpeProfiles.mappings.empty')}</p>;
  }

  const mappings = data?.data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ color: '#374151', fontWeight: 600 }}>{profile.name}</span>
        <button style={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          + {t('cpeProfiles.mappings.newMapping')}
        </button>
      </div>

      {isLoading && <p>{t('common.loading')}</p>}
      {error && <p style={{ color: '#dc2626' }}>{t('cpeProfiles.mappings.error')}</p>}

      {!isLoading && mappings.length === 0 && (
        <p style={{ color: '#6b7280' }}>No mappings for this profile.</p>
      )}

      {mappings.length > 0 && (
        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{t('cpeProfiles.mappings.parameterPath')}</th>
                <th style={styles.th}>{t('cpeProfiles.mappings.sourceType')}</th>
                <th style={styles.th}>{t('cpeProfiles.mappings.sourceField')} / {t('cpeProfiles.mappings.staticValue')}</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map(m => (
                <tr key={m.id} style={styles.tr}>
                  <td style={styles.td}><code style={{ fontSize: 12 }}>{m.parameter_path}</code></td>
                  <td style={styles.td}>{m.source_type}</td>
                  <td style={styles.td}>{m.source_type === 'static' ? m.static_value : m.source_field}</td>
                  <td style={styles.td}>
                    <button style={styles.btnDanger} onClick={() => { if (confirm('Delete mapping?')) deleteMut.mutate(m.id); }}>
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <h3 style={{ marginTop: 0 }}>{t('cpeProfiles.mappings.createTitle')}</h3>
            {createError && <p style={{ color: '#dc2626' }}>{createError}</p>}
            <label style={modalStyles.label}>{t('cpeProfiles.mappings.parameterPath')}<RequiredMark /></label>
            <input style={modalStyles.input} placeholder="Device.WiFi.SSID.1.SSID" value={form.parameter_path} onChange={e => setForm(f => ({ ...f, parameter_path: e.target.value }))} />
            <label style={modalStyles.label}>{t('cpeProfiles.mappings.sourceType')}<RequiredMark /></label>
            <select style={modalStyles.input} value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))}>
              <option value="static">Static</option>
              <option value="contract_field">Contract Field</option>
              <option value="plan_field">Plan Field</option>
              <option value="device_field">Device Field</option>
            </select>
            {form.source_type === 'static' ? (
              <>
                <label style={modalStyles.label}>{t('cpeProfiles.mappings.staticValue')}</label>
                <input style={modalStyles.input} value={form.static_value} onChange={e => setForm(f => ({ ...f, static_value: e.target.value }))} />
              </>
            ) : (
              <>
                <label style={modalStyles.label}>{t('cpeProfiles.mappings.sourceField')}</label>
                <input style={modalStyles.input} value={form.source_field} onChange={e => setForm(f => ({ ...f, source_field: e.target.value }))} />
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button style={styles.btnPrimary} disabled={createMut.isPending} onClick={() => createMut.mutate(form)}>
                {createMut.isPending ? t('common.saving') : t('common.save')}
              </button>
              <button style={styles.btnSecondary} onClick={() => { setShowCreate(false); setCreateError(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

type TabKey = 'profiles' | 'mappings';

export function CpeProfilesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('profiles');
  const [selectedProfile, setSelectedProfile] = useState<CpeProfile | null>(null);

  const handleSelectProfile = (p: CpeProfile) => {
    setSelectedProfile(p);
    setTab('mappings');
  };

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: '0 0 4px' }}>{t('cpeProfiles.title')}</h1>
      <p style={{ color: '#6b7280', marginTop: 0, marginBottom: 24 }}>{t('cpeProfiles.subtitle')}</p>

      <div style={{ marginBottom: 24 }}>
        {(['profiles', 'mappings'] as TabKey[]).map(k => (
          <button key={k} style={tabStyle(tab === k)} onClick={() => setTab(k)}>
            {t(`cpeProfiles.tabs.${k}`)}
            {k === 'mappings' && selectedProfile && (
              <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.8 }}>— {selectedProfile.name}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'profiles' && <ProfilesTab onSelectProfile={handleSelectProfile} />}
      {tab === 'mappings' && <MappingsTab profile={selectedProfile} />}
    </div>
  );
}
