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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'consent' | 'dsar' | 'identity' | 'numbering' | 'uso' | 'consumer' | 'residency' | 'audit';

interface ConsentRecord {
  id: number;
  client_id: number;
  purpose: string;
  given_at: string | null;
  withdrawn_at: string | null;
}

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
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const TABS: Tab[] = ['consent', 'dsar', 'identity', 'numbering', 'uso', 'consumer', 'residency', 'audit'];

export default function RegulatoryCompliancePage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('consent');

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: 16 }}>{t('regulatoryCompliance.title')}</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(tab => (
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
      {activeTab === 'consumer' && <ConsumerTab />}
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
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: ConsentRecord[] }>('/regulatory-compliance/consent')
      .then(r => setConsents(r.data || []))
      .catch(() => setConsents([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2>{t('regulatoryCompliance.tabs.consent')}</h2>
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.clientId')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.purpose')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.givenAt')}</th>
              <th style={thStyle}>{t('regulatoryCompliance.consent.status')}</th>
            </tr>
          </thead>
          <tbody>
            {consents.map(c => (
              <tr key={c.id}>
                <td style={tdStyle}>{c.id}</td>
                <td style={tdStyle}>{c.client_id}</td>
                <td style={tdStyle}>{c.purpose}</td>
                <td style={tdStyle}>{c.given_at ? new Date(c.given_at).toLocaleDateString() : '-'}</td>
                <td style={tdStyle}>
                  {c.withdrawn_at
                    ? t('regulatoryCompliance.consent.withdrawn')
                    : t('regulatoryCompliance.consent.active')}
                </td>
              </tr>
            ))}
            {consents.length === 0 && (
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
// Tab: DSAR Requests
// ---------------------------------------------------------------------------

function DsarTab() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<DsarRequest[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: DsarRequest[] }>('/regulatory-compliance/dsar-requests')
      .then(r => setRequests(r.data || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2>{t('regulatoryCompliance.tabs.dsar')}</h2>
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
              </tr>
            ))}
            {requests.length === 0 && (
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
    </div>
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
