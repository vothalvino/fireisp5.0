// =============================================================================
// FireISP 5.0 — Regulatory Compliance Page (Section 16)
// =============================================================================
// Multi-tab page covering Mexico regulatory compliance:
//   1. Consent Management  — subscriber ARCO consent records
//   2. DSAR Requests       — data subject access requests
//   3. Identity Verification — CURP/RFC identity verification records
//   4. Phone & Numbering   — IFT phone number inventory + portability
//   5. Universal Service   — USO obligations + rural coverage
//   6. Consumer Protection — service modification notices + contract templates
//   7. Data Residency      — storage country config + compliance check
//   8. Audit & Export      — audit log export + report access logs
//
// All data fetched from /api/v1/regulatory-compliance/*, /api/v1/numbering-management/*,
// /api/v1/universal-service/*, /api/v1/consumer-protection/*, /api/v1/data-residency,
// /api/v1/audit-logs/*
// =============================================================================

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { readCsrfCookie } from '@/api/csrf';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  MxContractEnvironmentBadge,
  type MxContractEnvironment,
  type MxContractSourceStatus,
} from '@/components/MxContractEnvironment';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'consent' | 'dsar' | 'identity' | 'numbering' | 'uso' | 'consumer' | 'residency' | 'audit';

interface ConsentRecord {
  id: number;
  client_id: number;
  purpose: string;
  channel: string | null;
  communication_channel: string | null;
  consent_version: string | null;
  given_at: string | null;
  withdrawn_at: string | null;
}

const CONSENT_PURPOSES = ['service_delivery', 'marketing', 'analytics', 'third_party_sharing', 'lawful_retention'] as const;
const CONSENT_CHANNELS = ['paper', 'phone', 'email', 'web', 'app'] as const;
const COMMUNICATION_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
// Mirrors dsar_requests.request_type ENUM exactly — a value outside it is a 422.
const DSAR_REQUEST_TYPES = ['access', 'erasure', 'portability', 'rectification', 'restriction'] as const;

interface DsarRequest {
  id: number;
  request_type: string;
  status: string;
  due_at: string | null;
  legal_hold: boolean | number;
}

interface IdentityRecord {
  id: number;
  client_id: number;
  id_type: string;
  status: string;
  curp_checksum_valid: boolean | null;
}

interface PhoneNumber {
  id: number;
  phone_number: string;
  number_type: string;
  status: string;
  lada: string | null;
}

interface UsoObligation {
  id: number;
  obligation_type: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  actual_value: number | null;
  target_value: number | null;
}

interface ServiceModification {
  id: number;
  notice_type: string;
  effective_date: string | null;
  status: string;
  notice_required_days: number | null;
}

type ContractTemplateMxStatus = MxContractSourceStatus;

interface ContractTemplateMxRecord {
  id: number;
  template_name: string;
  template_body: string | null;
  version: string;
  ift_registration_number: string | null;
  registered_at: string | null;
  status: ContractTemplateMxStatus;
  environment: MxContractEnvironment;
}

interface ContractTemplateMxPageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface DataResidencyConfig {
  primary_storage_country: string;
  compliance_status: string;
  cross_border_transfers_allowed: boolean | number;
  last_compliance_check: string | null;
}

interface ReportAccessLog {
  id: number;
  report_type: string;
  accessed_at: string | null;
  user_id: number;
}

// ---------------------------------------------------------------------------
// Simple fetch helper — mirrors Reports.tsx apiFetch pattern
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const orgId = localStorage.getItem('orgId');
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(orgId && { 'X-Org-Id': orgId }),
      ...(readCsrfCookie() ? { 'X-CSRF-Token': readCsrfCookie()! } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const TABS: Tab[] = ['consent', 'dsar', 'identity', 'numbering', 'uso', 'consumer', 'residency', 'audit'];

export default function RegulatoryCompliancePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('consent');

  // /consumer-protection/* is MX-locale-gated (404 REGION_DISABLED otherwise) —
  // hide its tab for global-locale orgs instead of rendering it as forever-empty.
  const visibleTabs = user?.organization_locale === 'MX'
    ? TABS
    : TABS.filter(tab => tab !== 'consumer');

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: 16 }}>
        {t(user?.organization_locale === 'MX'
          ? 'regulatoryCompliance.titleMx'
          : 'regulatoryCompliance.title')}
      </h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {visibleTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              fontWeight: activeTab === tab ? 'bold' : 'normal',
              padding: '6px 12px',
              border: activeTab === tab ? '2px solid #4a90e2' : '1px solid #ccc',
              borderRadius: 4,
              background: activeTab === tab ? '#eaf3ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            {t(`regulatoryCompliance.tabs.${tab}`)}
          </button>
        ))}
      </div>
      {activeTab === 'consent' && <ConsentTab />}
      {activeTab === 'dsar' && <DsarTab />}
      {activeTab === 'identity' && <IdentityTab />}
      {activeTab === 'numbering' && <NumberingTab />}
      {activeTab === 'uso' && <UsoTab />}
      {activeTab === 'consumer' && user?.organization_locale === 'MX' && <ConsumerTab />}
      {activeTab === 'residency' && <ResidencyTab />}
      {activeTab === 'audit' && <AuditTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Consent Management
// ---------------------------------------------------------------------------

function ConsentTab() {
  const { t } = useTranslation();
  // PrivateRoute lets readonly and technician onto this page as well as the
  // intended billing role, and migration 321 grants those two only
  // subscriber_consents.view. Withdraw needs .manage, which ONLY admin has —
  // so an ungated button 403s for every non-admin who can see this tab.
  const { user } = useAuth();
  const canCreate = can(user, 'subscriber_consents.create');
  const canManage = can(user, 'subscriber_consents.manage');
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  // In-person / phone signups get recorded by staff — the portal only covers
  // channel 'web'. Defaults match that: paper + service_delivery.
  const [form, setForm] = useState({
    client_id: '', purpose: 'service_delivery', channel: 'paper',
    communication_channel: 'email', consent_version: '', notes: '',
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    apiFetch<{ data: ConsentRecord[] }>('/regulatory-compliance/consent')
      .then(r => setConsents(r.data || []))
      .catch(() => setConsents([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch('/regulatory-compliance/consent', {
        method: 'POST',
        body: JSON.stringify({
          client_id: Number(form.client_id),
          purpose: form.purpose,
          channel: form.channel,
          ...(form.purpose === 'marketing'
            ? { communication_channel: form.communication_channel }
            : {}),
          consent_version: form.consent_version.trim(),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        }),
      });
      setMsg({ ok: true, text: t('regulatoryCompliance.consent.created') });
      setForm(f => ({ ...f, client_id: '', notes: '' }));
      load();
    } catch {
      setMsg({ ok: false, text: t('regulatoryCompliance.consent.createError') });
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: number) {
    setMsg(null);
    try {
      await apiFetch(`/regulatory-compliance/consent/${id}/withdraw`, { method: 'PUT' });
      load();
    } catch {
      setMsg({ ok: false, text: t('regulatoryCompliance.consent.withdrawError') });
    }
  }

  const fld: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 };
  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4 };

  return (
    <div>
      <h2>{t('regulatoryCompliance.tabs.consent')}</h2>

      {canCreate && (
      <form onSubmit={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16, padding: 12, border: '1px solid #ddd', borderRadius: 6 }}>
        <label style={fld}>{t('regulatoryCompliance.consent.clientId')}
          <input style={inp} type="number" min={1} required value={form.client_id}
            onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))} />
        </label>
        <label style={fld}>{t('regulatoryCompliance.consent.purpose')}
          <select style={inp} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}>
            {CONSENT_PURPOSES.map(p => <option key={p} value={p}>{t(`regulatoryCompliance.consent.purposes.${p}`)}</option>)}
          </select>
        </label>
        <label style={fld}>{t('regulatoryCompliance.consent.captureMethod', 'Capture method')}
          <select style={inp} value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
            {CONSENT_CHANNELS.map(c => <option key={c} value={c}>{t(`regulatoryCompliance.consent.channels.${c}`)}</option>)}
          </select>
        </label>
        {form.purpose === 'marketing' && (
          <label style={fld}>{t('regulatoryCompliance.consent.communicationChannel', 'Promotional channel')}
            <select style={inp} value={form.communication_channel}
              onChange={e => setForm(f => ({ ...f, communication_channel: e.target.value }))}>
              {COMMUNICATION_CHANNELS.map(channel => (
                <option key={channel} value={channel}>{t(`communicationOptIn.channels.${channel}`)}</option>
              ))}
            </select>
          </label>
        )}
        <label style={fld}>{t('regulatoryCompliance.consent.version')}
          <input style={inp} required maxLength={20} value={form.consent_version}
            onChange={e => setForm(f => ({ ...f, consent_version: e.target.value }))} />
        </label>
        <label style={{ ...fld, flexGrow: 1 }}>{t('regulatoryCompliance.consent.notes')}
          <input style={inp} maxLength={2000} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </label>
        <button type="submit" disabled={busy} style={{ padding: '7px 16px', background: '#4a90e2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          {t('regulatoryCompliance.consent.create')}
        </button>
        {msg && <span style={{ color: msg.ok ? '#2e7d32' : '#c62828', fontSize: 13 }}>{msg.text}</span>}
      </form>
      )}

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.clientId')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.purpose')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.captureMethod', 'Capture method')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.communicationChannel', 'Promotional channel')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.version')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.givenAt')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.status')}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {consents.map(c => (
              <tr key={c.id}>
                <td style={tdStyle}>{c.id}</td>
                <td style={tdStyle}>{c.client_id}</td>
                <td style={tdStyle}>{c.purpose}</td>
                <td style={tdStyle}>{c.channel ?? '-'}</td>
                <td style={tdStyle}>{c.communication_channel ?? '-'}</td>
                <td style={tdStyle}>{c.consent_version ?? '-'}</td>
                <td style={tdStyle}>{c.given_at ? new Date(c.given_at).toLocaleDateString() : '-'}</td>
                <td style={tdStyle}>
                  {c.withdrawn_at
                    ? t('regulatoryCompliance.consent.withdrawn')
                    : t('regulatoryCompliance.consent.active')}
                </td>
                <td style={tdStyle}>
                  {canManage && !c.withdrawn_at && (
                    <button onClick={() => withdraw(c.id)} style={{ padding: '3px 10px', fontSize: 12, border: '1px solid #c62828', color: '#c62828', background: 'transparent', borderRadius: 4, cursor: 'pointer' }}>
                      {t('regulatoryCompliance.consent.withdraw')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {consents.length === 0 && (
              <tr>
                <td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: '#999' }}>
                  {t('common.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: DSAR Requests
// ---------------------------------------------------------------------------

function DsarTab() {
  const { t } = useTranslation();
  // The tab was read-only: the fulfil/reject routes existed with no UI at all,
  // so a DSAR could be logged and never closed while its 30-day statutory clock
  // ran. Migration 432 gives billing .manage; without these controls that grant
  // would be a permission with nowhere to use it.
  const { user } = useAuth();
  const canCreate = can(user, 'dsar_requests.create');
  const canManage = can(user, 'dsar_requests.manage');

  const [requests, setRequests] = useState<DsarRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ client_id: '', request_type: 'access', notes: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    apiFetch<{ data: DsarRequest[] }>('/regulatory-compliance/dsar-requests')
      .then(r => setRequests(r.data || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch('/regulatory-compliance/dsar-requests', {
        method: 'POST',
        body: JSON.stringify({
          client_id: Number(form.client_id),
          request_type: form.request_type,
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        }),
      });
      setMsg({ ok: true, text: t('regulatoryCompliance.dsar.created') });
      setForm(f => ({ ...f, client_id: '', notes: '' }));
      load();
    } catch {
      setMsg({ ok: false, text: t('regulatoryCompliance.dsar.createError') });
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: number, action: 'fulfill' | 'reject') {
    setMsg(null);
    try {
      await apiFetch(`/regulatory-compliance/dsar-requests/${id}/${action}`, { method: 'PUT' });
      load();
    } catch {
      setMsg({ ok: false, text: t('regulatoryCompliance.dsar.resolveError') });
    }
  }

  const fld: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 };
  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4 };
  // A request already closed one way must not offer either action again.
  const isOpen = (s: string) => s === 'pending' || s === 'in_review' || s === 'legal_hold';

  return (
    <div>
      <h2>{t('regulatoryCompliance.tabs.dsar')}</h2>

      {canCreate && (
        <form onSubmit={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16, padding: 12, border: '1px solid #ddd', borderRadius: 6 }}>
          <label style={fld}>{t('regulatoryCompliance.dsar.clientId')}
            <input style={inp} type="number" min={1} required value={form.client_id}
              onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))} />
          </label>
          <label style={fld}>{t('regulatoryCompliance.dsar.requestType')}
            <select style={inp} value={form.request_type} onChange={e => setForm(f => ({ ...f, request_type: e.target.value }))}>
              {DSAR_REQUEST_TYPES.map(rt => (
                <option key={rt} value={rt}>{t(`regulatoryCompliance.dsar.types.${rt}`)}</option>
              ))}
            </select>
          </label>
          <label style={{ ...fld, flexGrow: 1 }}>{t('regulatoryCompliance.dsar.notes')}
            <input style={inp} maxLength={2000} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </label>
          <button type="submit" disabled={busy} style={{ padding: '7px 16px', background: '#4a90e2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            {t('regulatoryCompliance.dsar.create')}
          </button>
          {msg && <span style={{ color: msg.ok ? '#2e7d32' : '#c62828', fontSize: 13 }}>{msg.text}</span>}
        </form>
      )}

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>{t('regulatoryCompliance.dsar.requestType')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.dsar.status')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.dsar.dueAt')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.dsar.legalHold')}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {requests.map(r => (
              <tr key={r.id}>
                <td style={tdStyle}>{r.id}</td>
                <td style={tdStyle}>{r.request_type}</td>
                <td style={tdStyle}>{r.status}</td>
                <td style={tdStyle}>{r.due_at ? new Date(r.due_at).toLocaleDateString() : '-'}</td>
                <td style={tdStyle}>{r.legal_hold ? t('common.yes') : t('common.no')}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {canManage && isOpen(r.status) && (
                    <>
                      <button onClick={() => resolve(r.id, 'fulfill')} style={{ padding: '3px 10px', fontSize: 12, marginRight: 6, border: '1px solid #2e7d32', color: '#2e7d32', background: 'transparent', borderRadius: 4, cursor: 'pointer' }}>
                        {t('regulatoryCompliance.dsar.fulfill')}
                      </button>
                      <button onClick={() => resolve(r.id, 'reject')} style={{ padding: '3px 10px', fontSize: 12, border: '1px solid #c62828', color: '#c62828', background: 'transparent', borderRadius: 4, cursor: 'pointer' }}>
                        {t('regulatoryCompliance.dsar.reject')}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: '#999' }}>
                  {t('common.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Identity Verification
// ---------------------------------------------------------------------------

function IdentityTab() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<IdentityRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: IdentityRecord[] }>('/regulatory-compliance/identity-verification')
      .then(r => setRecords(r.data || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2>{t('regulatoryCompliance.tabs.identity')}</h2>
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>{t('regulatoryCompliance.identity.clientId')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.identity.idType')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.identity.status')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.identity.checksumValid')}</th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id}>
                <td style={tdStyle}>{r.id}</td>
                <td style={tdStyle}>{r.client_id}</td>
                <td style={tdStyle}>{r.id_type}</td>
                <td style={tdStyle}>{r.status}</td>
                <td style={tdStyle}>
                  {r.curp_checksum_valid === null
                    ? '-'
                    : r.curp_checksum_valid
                    ? t('common.yes')
                    : t('common.no')}
                </td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#999' }}>
                  {t('common.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Phone & Numbering
// ---------------------------------------------------------------------------

function NumberingTab() {
  const { t } = useTranslation();
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: PhoneNumber[] }>('/numbering-management/phone-numbers')
      .then(r => setNumbers(r.data || []))
      .catch(() => setNumbers([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2>{t('regulatoryCompliance.tabs.numbering')}</h2>
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>{t('regulatoryCompliance.numbering.phoneNumber')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.numbering.type')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.numbering.status')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.numbering.lada')}</th>
            </tr>
          </thead>
          <tbody>
            {numbers.map(n => (
              <tr key={n.id}>
                <td style={tdStyle}>{n.phone_number}</td>
                <td style={tdStyle}>{n.number_type}</td>
                <td style={tdStyle}>{n.status}</td>
                <td style={tdStyle}>{n.lada || '-'}</td>
              </tr>
            ))}
            {numbers.length === 0 && (
              <tr>
                <td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: '#999' }}>
                  {t('common.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Universal Service Obligations
// ---------------------------------------------------------------------------

function UsoTab() {
  const { t } = useTranslation();
  const [obligations, setObligations] = useState<UsoObligation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: UsoObligation[] }>('/universal-service/uso-obligations')
      .then(r => setObligations(r.data || []))
      .catch(() => setObligations([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2>{t('regulatoryCompliance.tabs.uso')}</h2>
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>{t('regulatoryCompliance.uso.type')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.uso.status')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.uso.period')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.uso.progress')}</th>
            </tr>
          </thead>
          <tbody>
            {obligations.map(o => (
              <tr key={o.id}>
                <td style={tdStyle}>{o.id}</td>
                <td style={tdStyle}>{o.obligation_type}</td>
                <td style={tdStyle}>{o.status}</td>
                <td style={tdStyle}>
                  {o.period_start} {o.period_start && o.period_end ? '–' : ''} {o.period_end}
                </td>
                <td style={tdStyle}>
                  {o.actual_value ?? '-'} / {o.target_value ?? '-'}
                </td>
              </tr>
            ))}
            {obligations.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#999' }}>
                  {t('common.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Consumer Protection
// ---------------------------------------------------------------------------

function ConsumerTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [notices, setNotices] = useState<ServiceModification[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: ServiceModification[] }>('/consumer-protection/service-modifications')
      .then(r => setNotices(r.data || []))
      .catch(() => setNotices([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2>{t('regulatoryCompliance.tabs.consumer')}</h2>
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>{t('regulatoryCompliance.consumer.noticeType')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consumer.effectiveDate')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consumer.status')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consumer.noticeDays')}</th>
            </tr>
          </thead>
          <tbody>
            {notices.map(n => (
              <tr key={n.id}>
                <td style={tdStyle}>{n.id}</td>
                <td style={tdStyle}>{n.notice_type}</td>
                <td style={tdStyle}>
                  {n.effective_date ? new Date(n.effective_date).toLocaleDateString() : '-'}
                </td>
                <td style={tdStyle}>{n.status}</td>
                <td style={tdStyle}>{n.notice_required_days ?? '-'}</td>
              </tr>
            ))}
            {notices.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#999' }}>
                  {t('common.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <ContractTemplateMxRegistry
        canView={can(user, 'contract_templates_mx.view')}
        canCreate={can(user, 'contract_templates_mx.create')}
        canUpdate={can(user, 'contract_templates_mx.update')}
        organizationId={user?.organization_id ?? null}
      />
    </div>
  );
}

function emptyContractTemplateMxForm(environment: MxContractEnvironment) {
  return {
    template_name: '',
    template_body: '',
    version: '1.0',
    ift_registration_number: '',
    registered_at: '',
    status: 'draft' as ContractTemplateMxStatus,
    environment,
  };
}

function ContractTemplateMxRegistry({ canView, canCreate, canUpdate, organizationId }: {
  canView: boolean; canCreate: boolean; canUpdate: boolean; organizationId: number | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [records, setRecords] = useState<ContractTemplateMxRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [registryPage, setRegistryPage] = useState(1);
  const [registryMeta, setRegistryMeta] = useState<ContractTemplateMxPageMeta>({
    total: 0,
    page: 1,
    limit: 100,
    totalPages: 1,
  });
  const [editing, setEditing] = useState<ContractTemplateMxRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [contractEnvironment, setContractEnvironment] = useState<MxContractEnvironment | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(false);
  const [environmentSaving, setEnvironmentSaving] = useState(false);
  const [environmentError, setEnvironmentError] = useState('');
  const [form, setForm] = useState(() => emptyContractTemplateMxForm('sandbox'));
  const [externalRegistrationConfirmed, setExternalRegistrationConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function load(page = registryPage) {
    if (!canView) return;
    setLoading(true);
    setLoadError('');
    apiFetch<{ data: ContractTemplateMxRecord[]; meta?: ContractTemplateMxPageMeta }>(
      `/consumer-protection/contract-templates-mx?page=${page}&limit=100&order_by=id&order=ASC`,
    )
      .then(r => {
        const nextRecords = (r.data || []).map(record => ({
          ...record,
          // All records predating the environment feature were real-registration
          // evidence and are migration-backfilled to production.
          environment: record.environment ?? 'production' as MxContractEnvironment,
        }));
        setRecords(nextRecords);
        setRegistryMeta(r.meta ?? {
          total: nextRecords.length,
          page,
          limit: 100,
          totalPages: 1,
        });
      })
      .catch((err: unknown) => {
        setRecords([]);
        setRegistryMeta({ total: 0, page, limit: 100, totalPages: 1 });
        setLoadError(err instanceof Error && !/^HTTP \d+$/.test(err.message)
          ? err.message
          : t('regulatoryCompliance.consumer.registry.loadError'));
      })
      .finally(() => setLoading(false));
  }

  function loadEnvironment() {
    if (!canView) return;
    setContractEnvironment(null);
    setEnvironmentLoading(true);
    setEnvironmentError('');
    apiFetch<{ data: { contract_environment: MxContractEnvironment } }>(
      '/consumer-protection/contract-environment',
    )
      .then(response => {
        const environment = response.data?.contract_environment;
        if (environment !== 'sandbox' && environment !== 'production') throw new Error('invalid environment');
        setContractEnvironment(environment);
      })
      .catch(() => setEnvironmentError(t('regulatoryCompliance.consumer.registry.environment.loadError')))
      .finally(() => setEnvironmentLoading(false));
  }

  useEffect(() => {
    setRegistryPage(1);
  }, [organizationId]);

  useEffect(() => {
    load(registryPage);
  }, [canView, organizationId, registryPage]);

  useEffect(() => {
    loadEnvironment();
  }, [canView, organizationId]);

  async function changeContractEnvironment(nextEnvironment: MxContractEnvironment) {
    if (!contractEnvironment) return;
    if (nextEnvironment === contractEnvironment) return;
    if (nextEnvironment === 'production' && !window.confirm(
      t('regulatoryCompliance.consumer.registry.environment.productionConfirmation'),
    )) return;

    setEnvironmentSaving(true);
    setEnvironmentError('');
    try {
      const response = await apiFetch<{ data: { contract_environment: MxContractEnvironment } }>(
        '/consumer-protection/contract-environment',
        { method: 'PUT', body: JSON.stringify({ contract_environment: nextEnvironment }) },
      );
      const savedEnvironment = response.data?.contract_environment;
      if (savedEnvironment !== 'sandbox' && savedEnvironment !== 'production') {
        throw new Error(t('regulatoryCompliance.consumer.registry.environment.saveError'));
      }
      setContractEnvironment(savedEnvironment);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mx-contract-environment', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['document-templates', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['contract-templates-mx', organizationId] }),
      ]);
      load();
    } catch (error) {
      setEnvironmentError(error instanceof Error && !/^HTTP \d+$/.test(error.message)
        ? error.message
        : t('regulatoryCompliance.consumer.registry.environment.saveError'));
    } finally {
      setEnvironmentSaving(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyContractTemplateMxForm(contractEnvironment ?? 'sandbox'));
    setExternalRegistrationConfirmed(false);
    setSaveMessage(null);
    setShowForm(true);
  }

  function openEdit(record: ContractTemplateMxRecord) {
    setEditing(record);
    setForm({
      template_name: record.template_name,
      template_body: record.template_body || '',
      version: record.version,
      ift_registration_number: record.ift_registration_number || '',
      registered_at: record.registered_at ? String(record.registered_at).slice(0, 10) : '',
      status: record.status,
      environment: record.environment,
    });
    setExternalRegistrationConfirmed(record.status === 'registered');
    setSaveMessage(null);
    setShowForm(true);
  }

  const sourceFrozen = Boolean(editing && ['sandbox_ready', 'registered', 'expired', 'revoked'].includes(editing.status));
  const registeringNow = form.environment === 'production'
    && form.status === 'registered'
    && editing?.status !== 'registered';
  const allowedStatuses: ContractTemplateMxStatus[] = form.environment === 'sandbox'
    ? editing?.status === 'sandbox_ready'
      ? ['sandbox_ready']
      : ['draft', 'sandbox_ready']
    : editing?.status === 'registered'
      ? ['registered', 'expired', 'revoked']
      : editing?.status === 'expired'
        ? ['expired']
        : editing?.status === 'revoked'
          ? ['revoked']
          : ['draft', 'submitted', 'registered'];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaveMessage(null);
    if (!form.template_name.trim() || !form.version.trim() || !form.template_body.trim()) {
      setSaveMessage({ ok: false, text: t('regulatoryCompliance.consumer.registry.requiredFields') });
      return;
    }
    if (form.environment === 'production' && form.status === 'registered'
        && (!form.ift_registration_number.trim() || !form.registered_at || !externalRegistrationConfirmed)) {
      setSaveMessage({ ok: false, text: t('regulatoryCompliance.consumer.registry.registrationRequired') });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        template_name: form.template_name,
        template_body: form.template_body,
        version: form.version,
        ift_registration_number: form.environment === 'production'
          ? form.ift_registration_number.trim() || null
          : null,
        registered_at: form.environment === 'production' ? form.registered_at || null : null,
        status: form.status,
        ...(!editing && { environment: form.environment }),
      };
      await apiFetch(
        editing
          ? `/consumer-protection/contract-templates-mx/${editing.id}`
          : '/consumer-protection/contract-templates-mx',
        { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) },
      );
      setSaveMessage({ ok: true, text: t('regulatoryCompliance.consumer.registry.saved') });
      setShowForm(false);
      setEditing(null);
      load();
    } catch (err) {
      setSaveMessage({
        ok: false,
        text: err instanceof Error && !/^HTTP \d+$/.test(err.message)
          ? err.message
          : t('regulatoryCompliance.consumer.registry.saveError'),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return null;

  return (
    <section style={{ marginTop: 32 }} aria-labelledby="mx-template-registry-title">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h3 id="mx-template-registry-title" style={{ margin: 0 }}>
          {t('regulatoryCompliance.consumer.registry.title')}
        </h3>
        {canCreate && (
          <button type="button" style={{ padding: '6px 12px' }} onClick={openCreate}>
            {t('regulatoryCompliance.consumer.registry.create')}
          </button>
        )}
      </div>
      <div style={{
        margin: '12px 0',
        padding: '12px 14px',
        border: `1px solid ${contractEnvironment === 'production' ? '#f59e0b' : 'var(--border-color, #d1d5db)'}`,
        borderRadius: 8,
        background: contractEnvironment === 'production' ? '#fffbeb' : 'var(--bg-secondary, #f8fafc)',
      }}>
        <strong>{t('regulatoryCompliance.consumer.registry.environment.label')}</strong>
        {environmentLoading && (
          <p role="status" style={{ margin: '8px 0 0', color: 'var(--text-secondary)' }}>
            {t('common.loading')}
          </p>
        )}
        {!environmentLoading && contractEnvironment && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <label htmlFor="mx-contract-environment" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              {t('regulatoryCompliance.consumer.registry.environment.label')}
            </label>
            <select
              id="mx-contract-environment"
              aria-label={t('regulatoryCompliance.consumer.registry.environment.label')}
              value={contractEnvironment}
              disabled={!canUpdate || environmentSaving}
              onChange={event => void changeContractEnvironment(event.target.value as MxContractEnvironment)}
              style={{ padding: '6px 10px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: 6 }}
            >
              <option value="sandbox">{t('regulatoryCompliance.consumer.registry.environment.sandboxOption')}</option>
              <option value="production">{t('regulatoryCompliance.consumer.registry.environment.productionOption')}</option>
            </select>
            <MxContractEnvironmentBadge environment={contractEnvironment} />
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
              {environmentSaving
                ? t('common.saving')
                : t(`regulatoryCompliance.consumer.registry.environment.${contractEnvironment}Summary`)}
            </span>
          </div>
        )}
        <p style={{ margin: '8px 0 0', color: contractEnvironment === 'production' ? '#92400e' : 'var(--text-secondary)', fontSize: '0.8rem' }}>
          {t('regulatoryCompliance.consumer.registry.environment.explanation')}
        </p>
        {environmentError && (
          <div style={{ marginTop: 8 }}>
            <p role="alert" style={{ color: '#b91c1c', margin: 0 }}>{environmentError}</p>
            <button type="button" onClick={loadEnvironment} style={{ marginTop: 6 }}>
              {t('common.retry')}
            </button>
          </div>
        )}
      </div>
      <p>{t('regulatoryCompliance.consumer.registry.explanation')}</p>
      <p style={{ padding: 10, border: '1px solid #d6a700', background: '#fff9db' }}>
        {t('regulatoryCompliance.consumer.registry.externalWarning')}
      </p>

      {loadError && <p role="alert" style={{ color: '#b91c1c' }}>{loadError}</p>}
      {loading ? <p>{t('common.loading')}</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thStyle}>{t('regulatoryCompliance.consumer.registry.name')}</th>
                <th style={thStyle}>{t('regulatoryCompliance.consumer.registry.environment.sourceEnvironment')}</th>
                <th style={thStyle}>{t('regulatoryCompliance.consumer.registry.version')}</th>
                <th style={thStyle}>{t('regulatoryCompliance.consumer.registry.registrationNumber')}</th>
                <th style={thStyle}>{t('regulatoryCompliance.consumer.registry.registrationDate')}</th>
                <th style={thStyle}>{t('regulatoryCompliance.consumer.registry.status')}</th>
                <th style={thStyle}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {records.map(record => (
                <tr key={record.id}>
                  <td style={tdStyle}>{record.template_name}</td>
                  <td style={tdStyle}><MxContractEnvironmentBadge environment={record.environment} /></td>
                  <td style={tdStyle}>{record.version}</td>
                  <td style={tdStyle}>{record.ift_registration_number || '—'}</td>
                  <td style={tdStyle}>{record.registered_at ? String(record.registered_at).slice(0, 10) : '—'}</td>
                  <td style={tdStyle}>{t(`regulatoryCompliance.consumer.registry.statuses.${record.status}`)}</td>
                  <td style={tdStyle}>
                    {canUpdate && (
                      <button type="button" onClick={() => openEdit(record)}>
                        {t('common.edit')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!records.length && !loadError && (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#777' }}>{t('common.noResults')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {registryMeta.totalPages > 1 && (
        <nav
          aria-label={t('regulatoryCompliance.consumer.registry.paginationLabel')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}
        >
          <button
            type="button"
            disabled={loading || registryPage <= 1}
            onClick={() => setRegistryPage(page => Math.max(1, page - 1))}
          >
            {t('common.prev')}
          </button>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
            {t('regulatoryCompliance.consumer.registry.pageSummary', {
              page: registryMeta.page,
              totalPages: registryMeta.totalPages,
              total: registryMeta.total,
            })}
          </span>
          <button
            type="button"
            disabled={loading || registryPage >= registryMeta.totalPages}
            onClick={() => setRegistryPage(page => Math.min(registryMeta.totalPages, page + 1))}
          >
            {t('common.next')}
          </button>
        </nav>
      )}

      {showForm && (
        <form onSubmit={save} style={{ marginTop: 20, maxWidth: 760, display: 'grid', gap: 12 }}>
          <h4 style={{ margin: 0 }}>
            {editing ? t('regulatoryCompliance.consumer.registry.edit') : t('regulatoryCompliance.consumer.registry.create')}
          </h4>
          <label>
            {t('regulatoryCompliance.consumer.registry.environment.sourceEnvironment')} *
            <select
              aria-label={t('regulatoryCompliance.consumer.registry.environment.sourceEnvironment')}
              value={form.environment}
              disabled={Boolean(editing)}
              onChange={event => {
                const environment = event.target.value as MxContractEnvironment;
                setForm(current => ({
                  ...current,
                  environment,
                  status: 'draft',
                  ift_registration_number: '',
                  registered_at: '',
                }));
                setExternalRegistrationConfirmed(false);
              }}
            >
              <option value="sandbox">{t('regulatoryCompliance.consumer.registry.environment.sandboxOption')}</option>
              <option value="production">{t('regulatoryCompliance.consumer.registry.environment.productionOption')}</option>
            </select>
          </label>
          <p style={{
            margin: 0,
            padding: 10,
            border: `1px solid ${form.environment === 'sandbox' ? '#b45309' : '#15803d'}`,
            background: form.environment === 'sandbox' ? '#fffbeb' : '#f0fdf4',
            color: form.environment === 'sandbox' ? '#78350f' : '#14532d',
            fontWeight: 600,
          }}>
            {t(`regulatoryCompliance.consumer.registry.environment.${form.environment}SourceWarning`)}
          </p>
          <label>
            {t('regulatoryCompliance.consumer.registry.name')} *
            <input
              aria-label={t('regulatoryCompliance.consumer.registry.name')}
              value={form.template_name}
              readOnly={sourceFrozen}
              onChange={e => setForm(f => ({ ...f, template_name: e.target.value }))}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <label>
            {t('regulatoryCompliance.consumer.registry.version')} *
            <input
              aria-label={t('regulatoryCompliance.consumer.registry.version')}
              value={form.version}
              readOnly={sourceFrozen}
              onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <label>
            {t('regulatoryCompliance.consumer.registry.exactText')} *
            <textarea
              aria-label={t('regulatoryCompliance.consumer.registry.exactText')}
              value={form.template_body}
              readOnly={sourceFrozen}
              onChange={e => setForm(f => ({ ...f, template_body: e.target.value }))}
              rows={12}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }}
            />
          </label>
          {form.environment === 'production' && (
            <>
              <label>
                {t('regulatoryCompliance.consumer.registry.registrationNumber')}
                <input
                  aria-label={t('regulatoryCompliance.consumer.registry.registrationNumber')}
                  value={form.ift_registration_number}
                  readOnly={sourceFrozen}
                  onChange={e => setForm(f => ({ ...f, ift_registration_number: e.target.value }))}
                  style={{ display: 'block', width: '100%', boxSizing: 'border-box' }}
                />
              </label>
              <label>
                {t('regulatoryCompliance.consumer.registry.registrationDate')}
                <input
                  aria-label={t('regulatoryCompliance.consumer.registry.registrationDate')}
                  type="date"
                  value={form.registered_at}
                  readOnly={sourceFrozen}
                  onChange={e => setForm(f => ({ ...f, registered_at: e.target.value }))}
                />
              </label>
            </>
          )}
          <label>
            {t('regulatoryCompliance.consumer.registry.status')}
            <select
              aria-label={t('regulatoryCompliance.consumer.registry.status')}
              value={form.status}
              onChange={e => {
                setForm(f => ({ ...f, status: e.target.value as ContractTemplateMxStatus }));
                setExternalRegistrationConfirmed(false);
              }}
            >
              {allowedStatuses.map(status => (
                <option key={status} value={status}>{t(`regulatoryCompliance.consumer.registry.statuses.${status}`)}</option>
              ))}
            </select>
          </label>
          {registeringNow && (
            <label style={{ padding: 10, border: '1px solid #d6a700', background: '#fff9db' }}>
              <input
                type="checkbox"
                checked={externalRegistrationConfirmed}
                onChange={e => setExternalRegistrationConfirmed(e.target.checked)}
              />{' '}
              {t('regulatoryCompliance.consumer.registry.confirmExternalRegistration')}
            </label>
          )}
          {sourceFrozen && <p>{t('regulatoryCompliance.consumer.registry.frozenEvidence')}</p>}
          {editing && <p>{t('regulatoryCompliance.consumer.registry.environment.immutable')}</p>}
          {saveMessage && (
            <p role="alert" style={{ color: saveMessage.ok ? '#166534' : '#b91c1c' }}>{saveMessage.text}</p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            <button type="button" onClick={() => { setShowForm(false); setSaveMessage(null); }}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
      {!showForm && saveMessage && (
        <p role="status" style={{ color: saveMessage.ok ? '#166534' : '#b91c1c' }}>{saveMessage.text}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tab: Data Residency
// ---------------------------------------------------------------------------

function ResidencyTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<DataResidencyConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: DataResidencyConfig }>('/data-residency')
      .then(r => setConfig(r.data))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  const runCheck = async () => {
    setChecking(true);
    try {
      await apiFetch('/data-residency/check', { method: 'POST' });
      const r = await apiFetch<{ data: DataResidencyConfig }>('/data-residency');
      setConfig(r.data);
    } catch {
      // ignore — config stays as-is
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      <h2>{t('regulatoryCompliance.tabs.residency')}</h2>
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : config ? (
        <div style={{ maxWidth: 480 }}>
          <p>
            <strong>{t('regulatoryCompliance.residency.primaryCountry')}:</strong>{' '}
            {config.primary_storage_country}
          </p>
          <p>
            <strong>{t('regulatoryCompliance.residency.complianceStatus')}:</strong>{' '}
            {config.compliance_status}
          </p>
          <p>
            <strong>{t('regulatoryCompliance.residency.crossBorder')}:</strong>{' '}
            {config.cross_border_transfers_allowed ? t('common.yes') : t('common.no')}
          </p>
          <p>
            <strong>{t('regulatoryCompliance.residency.lastCheck')}:</strong>{' '}
            {config.last_compliance_check
              ? new Date(config.last_compliance_check).toLocaleString()
              : t('regulatoryCompliance.residency.neverChecked')}
          </p>
          <button
            onClick={runCheck}
            disabled={checking}
            style={{ padding: '6px 14px', marginTop: 8 }}
          >
            {checking ? t('common.loading') : t('regulatoryCompliance.residency.runCheck')}
          </button>
        </div>
      ) : (
        <p>{t('regulatoryCompliance.residency.noConfig')}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Audit & Export
// ---------------------------------------------------------------------------

function AuditTab() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<ReportAccessLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: ReportAccessLog[] }>('/audit-logs/report-access-logs')
      .then(r => setLogs(r.data || []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  const handleExport = () => {
    const token = localStorage.getItem('token');
    const orgId = localStorage.getItem('orgId');
    const url = '/api/v1/audit-logs/export';
    const headers = new Headers({
      Authorization: `Bearer ${token || ''}`,
      'X-Org-Id': orgId || '',
    });
    fetch(url, { headers })
      .then(r => r.json())
      .then((data: unknown) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'audit-export.json';
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => {
        // ignore download errors
      });
  };

  return (
    <div>
      <h2>{t('regulatoryCompliance.tabs.audit')}</h2>
      <button
        onClick={handleExport}
        style={{ padding: '6px 14px', marginBottom: 16 }}
      >
        {t('regulatoryCompliance.audit.exportLogs')}
      </button>
      <h3>{t('regulatoryCompliance.audit.reportAccessLogs')}</h3>
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>{t('regulatoryCompliance.audit.reportType')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.audit.accessedAt')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.audit.userId')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id}>
                <td style={tdStyle}>{l.id}</td>
                <td style={tdStyle}>{l.report_type}</td>
                <td style={tdStyle}>
                  {l.accessed_at ? new Date(l.accessed_at).toLocaleString() : '-'}
                </td>
                <td style={tdStyle}>{l.user_id}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: '#999' }}>
                  {t('common.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared table cell styles
// ---------------------------------------------------------------------------

const thStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  padding: '8px 10px',
  textAlign: 'left',
  background: '#f5f5f5',
  fontWeight: 600,
  fontSize: '0.875rem',
};

const tdStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  padding: '7px 10px',
  fontSize: '0.875rem',
};
