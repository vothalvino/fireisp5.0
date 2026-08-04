// =============================================================================
// FireISP 5.0 — Lead List (prospect pipeline) — §1.2
// =============================================================================
// CRUD for sales leads plus pipeline-stage summary and lead → client conversion.
// =============================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { Pagination } from '@/components/Pagination';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  extractApiError,
  overlay,
  modalBox,
  errorBox,
  labelStyle,
  inputStyle,
  submitBtn,
  cancelBtn,
} from '@/components/ClientFormModal';

interface Lead {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  status: string;
  estimated_value: number | null;
  assigned_to: number | null;
  converted_client_id: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  desired_plan_id: number | null;
  created_at: string;
}

interface LeadsResponse {
  data: Lead[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface LeadFormBody {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source: string;
  status: string;
  estimated_value?: number;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  desired_plan_id?: number;
}

// The network payload allows `null` for the nullable string fields (an
// explicit clear on edit — see handleSubmit) even though the controlled
// <input>'s `value` prop (bound to LeadFormBody, always a plain string in
// local form state) cannot.
type LeadSubmitBody = Omit<LeadFormBody, 'email' | 'phone' | 'company' | 'address' | 'city' | 'state' | 'zip_code' | 'desired_plan_id'> & {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  desired_plan_id?: number | null;
};

const SOURCES = ['website', 'referral', 'phone', 'walk_in', 'social', 'campaign', 'other'];
const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];

async function fetchLeads(page: number, pageSize: number): Promise<LeadsResponse> {
  const res = await api.GET('/leads', { params: { query: { page, limit: pageSize } as never } });
  if (res.error) throw new Error('Failed to load leads');
  return res.data as unknown as LeadsResponse;
}

async function fetchPipeline(): Promise<Record<string, number>> {
  const res = await api.GET('/leads/pipeline');
  if (res.error) throw new Error('Failed to load pipeline');
  return (res.data as unknown as { data: Record<string, number> }).data;
}

interface PlanOption { id: number; name: string }

async function fetchPlansLookup(): Promise<PlanOption[]> {
  const res = await api.GET('/plans', {
    params: { query: { limit: 200, order_by: 'name', order: 'ASC' } as never },
  });
  if (res.error) return [];
  return (res.data as unknown as { data: PlanOption[] }).data ?? [];
}

// ---------------------------------------------------------------------------
// Feasibility desk check — GET /leads/:id/feasibility
// ---------------------------------------------------------------------------
interface FeasibilityZone { id?: number; name?: string; zone_type?: string; status?: string; max_download_mbps?: number | null; max_upload_mbps?: number | null; error?: string }
interface FeasibilityAp { device_id: number; ap_name: string; distance_km: number; frequency_mhz: number | null; sector_azimuth_deg: number | null; signal_min_dbm: number | null; link_capacity_min_mbps: number | null }
interface FeasibilityOdf { id: number; name: string; site_name: string; distance_km: number; port_count: number; ports_tracked: number; free_ports: number }
interface FeasibilityResult {
  has_coordinates: boolean;
  coverage_zones: FeasibilityZone[];
  wireless: FeasibilityAp[];
  ftth: FeasibilityOdf[];
}

async function fetchFeasibility(leadId: number): Promise<FeasibilityResult> {
  const res = await (api.GET as unknown as (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown }>)(
    '/leads/{id}/feasibility', { params: { path: { id: leadId } } },
  );
  if (res.error) throw new Error('Failed to run the feasibility check');
  return (res.data as { data: FeasibilityResult }).data;
}

function FeasibilityModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['lead-feasibility', lead.id], queryFn: () => fetchFeasibility(lead.id) });
  const km = (v: number) => `${Number(v).toFixed(2)} km`;
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('leads.feasibility.title')}>
      <div style={{ ...modalBox, width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>{t('leads.feasibility.title')}</h3>
        <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{lead.name}</p>
        {q.isLoading && <p>{t('common.loading')}</p>}
        {q.isError && <p style={{ color: '#ef4444' }}>{(q.error as Error).message}</p>}
        {q.data && !q.data.has_coordinates && (
          <p style={{ color: 'var(--text-secondary)' }}>{t('leads.feasibility.noCoordinates')}</p>
        )}
        {q.data?.has_coordinates && (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <section>
              <h4 style={{ margin: '0 0 0.5rem' }}>{t('leads.feasibility.zones')}</h4>
              {q.data.coverage_zones.length === 0 && <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('leads.feasibility.noZones')}</p>}
              {q.data.coverage_zones.map((z, i) => (
                <p key={z.id ?? i} style={{ margin: '2px 0' }}>
                  {z.error
                    ? <span style={{ color: '#ef4444' }}>{z.error}</span>
                    : <>✔ {z.name} · {z.zone_type} · {z.status}{z.max_download_mbps ? ` · ≤${z.max_download_mbps}/${z.max_upload_mbps ?? '—'} Mbps` : ''}</>}
                </p>
              ))}
            </section>
            <section>
              <h4 style={{ margin: '0 0 0.5rem' }}>{t('leads.feasibility.wireless')}</h4>
              {q.data.wireless.length === 0 && <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('leads.feasibility.noAps')}</p>}
              {q.data.wireless.map(ap => (
                <p key={`${ap.device_id}-${ap.sector_azimuth_deg}`} style={{ margin: '2px 0' }}>
                  📡 {ap.ap_name} — {km(ap.distance_km)}
                  {ap.frequency_mhz ? ` · ${ap.frequency_mhz} MHz` : ''}
                  {ap.sector_azimuth_deg !== null ? ` · az ${ap.sector_azimuth_deg}°` : ''}
                </p>
              ))}
              <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t('leads.feasibility.losNote')}</p>
            </section>
            <section>
              <h4 style={{ margin: '0 0 0.5rem' }}>{t('leads.feasibility.ftth')}</h4>
              {q.data.ftth.length === 0 && <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('leads.feasibility.noFtth')}</p>}
              {q.data.ftth.map(f => (
                <p key={f.id} style={{ margin: '2px 0' }}>
                  🔌 {f.name} ({f.site_name}) — {km(f.distance_km)} ·{' '}
                  {f.ports_tracked > 0
                    ? t('leads.feasibility.freePorts', { free: f.free_ports, total: f.ports_tracked })
                    : t('leads.feasibility.portsUntracked', { total: f.port_count })}
                </p>
              ))}
            </section>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" style={cancelBtn} onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}

function LeadFormModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Lead;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<LeadFormBody>({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    company: initial?.company ?? '',
    source: initial?.source ?? 'other',
    status: initial?.status ?? 'new',
    estimated_value: initial?.estimated_value ?? undefined,
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    zip_code: initial?.zip_code ?? '',
    desired_plan_id: initial?.desired_plan_id ?? undefined,
  });
  const [error, setError] = useState('');
  const { data: plans = [] } = useQuery({ queryKey: ['plans-lookup'], queryFn: fetchPlansLookup, staleTime: 60_000 });

  const mutation = useMutation({
    mutationFn: async (body: LeadSubmitBody) => {
      if (mode === 'create') {
        const { error } = await api.POST('/leads', { body: body as never });
        if (error) throw new Error(extractApiError(error, 'Failed to create lead'));
      } else {
        const { error } = await api.PUT('/leads/{id}', {
          params: { path: { id: initial!.id } },
          body: body as never,
        });
        if (error) throw new Error(extractApiError(error, 'Failed to update lead'));
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to save lead'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    const body: LeadSubmitBody = { name: form.name.trim(), source: form.source, status: form.status };

    // Optional string fields: on create there's nothing to clear yet, so a
    // blank field is simply omitted. On edit, a field the technician just
    // BLANKED (previously non-empty on `initial`, now empty) must be sent as
    // an explicit `null` — validate() and BaseModel.update both treat an
    // omitted key as "not part of this PATCH/PUT" (old value survives), while
    // `null` is validation-safe for these optional/nullable columns and
    // actually clears them (see .claude/agent-memory
    // patch-diff-explicit-clear-vs-omit.md).
    (['email', 'phone', 'company', 'address', 'city', 'state', 'zip_code'] as const).forEach(key => {
      const value = (form[key] ?? '').trim();
      const original = (initial?.[key] ?? '').toString().trim();
      if (value) {
        body[key] = value;
      } else if (mode === 'edit' && original) {
        body[key] = null;
      }
    });

    if (form.estimated_value !== undefined && !Number.isNaN(form.estimated_value)) body.estimated_value = Number(form.estimated_value);
    // Same explicit-clear-vs-omit contract as the string fields above.
    if (form.desired_plan_id) {
      body.desired_plan_id = form.desired_plan_id;
    } else if (mode === 'edit' && initial?.desired_plan_id) {
      body.desired_plan_id = null;
    }
    setError('');
    mutation.mutate(body);
  }

  const title = mode === 'create' ? 'New Lead' : `Edit ${initial?.name ?? 'Lead'}`;
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...modalBox, width: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{title}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} type="text" value={form.name} autoFocus
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />

          <label style={labelStyle}>Email</label>
          <input style={inputStyle} type="email" value={form.email}
            onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />

          <label style={labelStyle}>Phone</label>
          <input style={inputStyle} type="text" value={form.phone}
            onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />

          <label style={labelStyle}>Company</label>
          <input style={inputStyle} type="text" value={form.company}
            onChange={e => setForm(p => ({ ...p, company: e.target.value }))} />

          <label style={labelStyle}>{t('leads.addressField', 'Address')}</label>
          <input style={inputStyle} type="text" value={form.address}
            onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>{t('leads.cityField', 'City')}</label>
              <input style={inputStyle} type="text" value={form.city}
                onChange={e => setForm(p => ({ ...p, city: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('leads.stateField', 'State')}</label>
              <input style={inputStyle} type="text" value={form.state}
                onChange={e => setForm(p => ({ ...p, state: e.target.value }))} />
            </div>
          </div>

          <label style={labelStyle}>{t('leads.zipCodeField', 'ZIP / Postal Code')}</label>
          <input style={inputStyle} type="text" value={form.zip_code}
            onChange={e => setForm(p => ({ ...p, zip_code: e.target.value }))} />

          <label style={labelStyle}>Source</label>
          <select style={inputStyle} value={form.source}
            onChange={e => setForm(p => ({ ...p, source: e.target.value }))}>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <label style={labelStyle}>Pipeline stage</label>
          <select style={inputStyle} value={form.status}
            onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <label style={labelStyle}>Estimated value</label>
          <input style={inputStyle} type="number" min={0} step="0.01" value={form.estimated_value ?? ''}
            onChange={e => setForm(p => ({ ...p, estimated_value: e.target.value ? Number(e.target.value) : undefined }))} />

          <label style={labelStyle}>{t('leads.desiredPlan')}</label>
          <select style={inputStyle} value={form.desired_plan_id ?? ''}
            onChange={e => setForm(p => ({ ...p, desired_plan_id: e.target.value ? Number(e.target.value) : undefined }))}>
            <option value="">{t('leads.desiredPlanNone')}</option>
            {plans.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function LeadList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [feasibilityLead, setFeasibilityLead] = useState<Lead | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const canCreate = can(user, 'leads.create');
  const canUpdate = can(user, 'leads.update');
  const canConvert = can(user, 'clients.create');

  const { data, isLoading, error } = useQuery({
    queryKey: ['leads', page, pageSize],
    queryFn: () => fetchLeads(page, pageSize),
  });
  const { data: pipeline } = useQuery({ queryKey: ['leads', 'pipeline'], queryFn: fetchPipeline });

  const convertMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error: e } = await api.POST('/leads/{id}/convert', { params: { path: { id } }, body: {} as never });
      if (e) throw new Error(extractApiError(e, 'Failed to convert lead'));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leads'] });
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Leads</h2>
        {canCreate && (
          <button type="button" style={submitBtn} onClick={() => setShowCreate(true)}>+ New Lead</button>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
        Capture prospects and move them through the sales pipeline. Won leads can be converted into clients.
      </p>

      {pipeline && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
          {STAGES.map(stage => (
            <span key={stage} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: '0.8rem',
              background: 'var(--bg-subtle)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}>
              {stage}: <strong>{pipeline[stage] ?? 0}</strong>
            </span>
          ))}
        </div>
      )}

      {isLoading && <p>Loading…</p>}
      {error && <div style={errorBox}>{(error as Error).message}</div>}

      {data && (
        <>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th style={{ padding: '8px' }}>Name</th>
              <th style={{ padding: '8px' }}>Company</th>
              <th style={{ padding: '8px' }}>Source</th>
              <th style={{ padding: '8px' }}>Stage</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Est. value</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No leads yet.</td></tr>
            )}
            {data.data.map(l => (
              <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>{l.name}</td>
                <td style={{ padding: '8px' }}>{l.company ?? '—'}</td>
                <td style={{ padding: '8px', textTransform: 'capitalize' }}>{l.source.replace('_', ' ')}</td>
                <td style={{ padding: '8px', textTransform: 'capitalize' }}>{l.status}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{l.estimated_value ?? '—'}</td>
                <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" style={{ ...cancelBtn, padding: '4px 10px', marginRight: 6 }}
                    onClick={() => setFeasibilityLead(l)}>{t('leads.feasibility.button')}</button>
                  {canUpdate && (
                    <button type="button" style={{ ...cancelBtn, padding: '4px 10px', marginRight: 6 }}
                      onClick={() => setEditLead(l)}>Edit</button>
                  )}
                  {canConvert && !l.converted_client_id && (
                    <button type="button" style={{ ...submitBtn, padding: '4px 10px' }}
                      disabled={convertMutation.isPending}
                      onClick={() => convertMutation.mutate(l.id)}>Convert</button>
                  )}
                  {l.converted_client_id && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Client #{l.converted_client_id}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <Pagination
          page={page}
          totalPages={data?.meta?.totalPages ?? 1}
          total={data?.meta?.total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        />
        </>
      )}

      {showCreate && (
        <LeadFormModal mode="create" onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}
      {feasibilityLead && (
        <FeasibilityModal lead={feasibilityLead} onClose={() => setFeasibilityLead(null)} />
      )}
      {editLead && (
        <LeadFormModal mode="edit" initial={editLead} onClose={() => setEditLead(null)} onSaved={refresh} />
      )}
    </div>
  );
}
