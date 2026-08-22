// =============================================================================
// FireISP 5.0 — Security & Access Control Page (Section 17)
// =============================================================================
// Multi-tab page covering security management:
//   1. User Security    — WebAuthn credentials, password policy, admin IP allowlist
//   2. API Security     — API key rate limits
//   3. Network Security — Firewall rules, DDoS protection, blackhole routes,
//                         DNS blocklists, CPE security scans
//   4. Data Security    — Encryption key metadata, data masking, TLS config,
//                         secure deletion log
// =============================================================================

import { useState, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { readCsrfCookie } from '@/api/csrf';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'userSecurity' | 'apiSecurity' | 'networkSecurity' | 'dataSecurity';

interface WebAuthnCredential {
  id: number;
  credential_id: string;
  friendly_name: string | null;
  aaguid: string | null;
  created_at: string;
}

interface PasswordPolicy {
  min_length: number | null;
  require_uppercase: number;
  require_lowercase: number;
  require_digits: number;
  require_special_chars: number;
  max_repeated_chars: number | null;
  rotation_days: number | null;
  lockout_attempts: number | null;
  lockout_duration_minutes: number | null;
}

interface AdminIpEntry {
  id: number;
  cidr: string;
  description: string | null;
  is_active: number;
}

interface AdminIpStatus {
  enabled: boolean;
  source: 'environment' | 'database' | 'none';
  configurationValid: boolean;
  activeEntries: number;
  invalidEntries: number;
  currentIp: string | null;
  currentIpAllowed: boolean;
}

interface ApiKeyRateLimit {
  id: number;
  api_token_id: number;
  requests_per_minute: number | null;
  requests_per_hour: number | null;
  requests_per_day: number | null;
}

interface FirewallRule {
  id: number;
  name: string | null;
  action: string;
  protocol: string;
  direction: string | null;
  src_ip: string | null;
  dst_ip: string | null;
  is_active: number;
}

interface DdosRule {
  id: number;
  name: string | null;
  rule_type: string;
  target_prefix: string;
  action: string;
  is_active: number;
  triggered_at: string | null;
}

interface BlackholeRoute {
  id: number;
  prefix: string;
  reason: string;
  is_active: number;
  created_at: string;
  deactivated_at: string | null;
}

interface DnsBlocklist {
  id: number;
  domain: string;
  category: string;
  entry_type: string;
  threat_feed_source: string | null;
  is_active: number;
}

interface CpeSecurityScan {
  id: number;
  scan_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

interface EncryptionKeyMeta {
  id: number;
  key_id: string | null;
  algorithm: string | null;
  key_length_bits: number | null;
  status: string;
  rotated_at: string | null;
  expires_at: string | null;
}

interface DataMaskingRule {
  id: number;
  table_name: string;
  column_name: string;
  mask_type: string;
  is_active: number;
}

interface SecureDeletionLog {
  id: number;
  table_name: string;
  records_deleted: number;
  policy_applied: string | null;
  deleted_at: string;
}

interface TlsConfig {
  min_tls_version: string;
  recommended_tls_version: string;
  cipher_suites: string[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Simple fetch helper
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
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Keep the status-only fallback when a proxy returns a non-JSON error.
    }
    throw new Error(message);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const TABS: Tab[] = ['userSecurity', 'apiSecurity', 'networkSecurity', 'dataSecurity'];

export function SecurityAccessControlPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('userSecurity');

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: 16 }}>{t('securityAccessControl.title')}</h1>
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
            {t(`securityAccessControl.tabs.${tab}`)}
          </button>
        ))}
      </div>
      {activeTab === 'userSecurity' && <UserSecurityTab />}
      {activeTab === 'apiSecurity' && <ApiSecurityTab />}
      {activeTab === 'networkSecurity' && <NetworkSecurityTab />}
      {activeTab === 'dataSecurity' && <DataSecurityTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: User Security
// ---------------------------------------------------------------------------

function UserSecurityTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = useState<WebAuthnCredential[]>([]);
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  const [ipList, setIpList] = useState<AdminIpEntry[]>([]);
  const [ipStatus, setIpStatus] = useState<AdminIpStatus | null>(null);
  const [cidr, setCidr] = useState('');
  const [description, setDescription] = useState('');
  const [activateNow, setActivateNow] = useState(false);
  const [ipSaving, setIpSaving] = useState(false);
  const [ipError, setIpError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<{ data: WebAuthnCredential[] }>('/security-admin/webauthn'),
      apiFetch<{ data: PasswordPolicy }>('/security-admin/password-policy').catch(() => ({ data: null })),
      apiFetch<{ data: AdminIpEntry[] }>('/security-admin/admin-ip-allowlist'),
      apiFetch<{ data: AdminIpStatus }>('/security-admin/admin-ip-allowlist/status'),
    ])
      .then(([credRes, policyRes, ipRes, ipStatusRes]) => {
        setCredentials(credRes.data);
        setPolicy(policyRes.data);
        setIpList(ipRes.data);
        setIpStatus(ipStatusRes.data);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  if (loading) return <p>{t('common.loading')}</p>;
  if (error) return <p style={{ color: 'red' }}>{t('common.error')}: {error}</p>;

  const environmentManaged = ipStatus?.source === 'environment';

  async function reloadIpAllowlist() {
    const [listResponse, statusResponse] = await Promise.all([
      apiFetch<{ data: AdminIpEntry[] }>('/security-admin/admin-ip-allowlist'),
      apiFetch<{ data: AdminIpStatus }>('/security-admin/admin-ip-allowlist/status'),
    ]);
    setIpList(listResponse.data);
    setIpStatus(statusResponse.data);
    await queryClient.invalidateQueries({ queryKey: ['admin-ip-allowlist-status'] });
  }

  async function addIpEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIpSaving(true);
    setIpError(null);
    try {
      await apiFetch('/security-admin/admin-ip-allowlist', {
        method: 'POST',
        body: JSON.stringify({ cidr, description: description || null, is_active: activateNow }),
      });
      setCidr('');
      setDescription('');
      setActivateNow(false);
      await reloadIpAllowlist();
    } catch (err) {
      setIpError(err instanceof Error ? err.message : String(err));
    } finally {
      setIpSaving(false);
    }
  }

  async function toggleIpEntry(entry: AdminIpEntry) {
    setIpSaving(true);
    setIpError(null);
    try {
      await apiFetch(`/security-admin/admin-ip-allowlist/${entry.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !entry.is_active }),
      });
      await reloadIpAllowlist();
    } catch (err) {
      setIpError(err instanceof Error ? err.message : String(err));
    } finally {
      setIpSaving(false);
    }
  }

  async function deleteIpEntry(entry: AdminIpEntry) {
    if (!window.confirm(t('securityAccessControl.userSecurity.deleteConfirm', { cidr: entry.cidr }))) return;
    setIpSaving(true);
    setIpError(null);
    try {
      await apiFetch(`/security-admin/admin-ip-allowlist/${entry.id}`, { method: 'DELETE' });
      await reloadIpAllowlist();
    } catch (err) {
      setIpError(err instanceof Error ? err.message : String(err));
    } finally {
      setIpSaving(false);
    }
  }

  return (
    <div>
      <h2>{t('securityAccessControl.userSecurity.webauthn')}</h2>
      {credentials.length === 0
        ? <p>{t('securityAccessControl.userSecurity.noCredentials')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.userSecurity.credentialId')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.userSecurity.friendlyName')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.userSecurity.createdAt')}</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map(c => (
                <tr key={c.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{c.id}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace', fontSize: 12 }}>{c.credential_id.slice(0, 16)}…</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{c.friendly_name ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{c.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      <h2>{t('securityAccessControl.userSecurity.passwordPolicy')}</h2>
      {policy
        ? (
          <table style={{ borderCollapse: 'collapse', marginBottom: 24 }}>
            <tbody>
              <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: 'bold' }}>{t('securityAccessControl.userSecurity.minLength')}</td><td style={{ padding: '4px 0' }}>{policy.min_length ?? '—'}</td></tr>
              <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: 'bold' }}>{t('securityAccessControl.userSecurity.requireSpecialChars')}</td><td style={{ padding: '4px 0' }}>{policy.require_special_chars ? t('common.yes') : t('common.no')}</td></tr>
              <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: 'bold' }}>{t('securityAccessControl.userSecurity.maxRepeatedChars')}</td><td style={{ padding: '4px 0' }}>{policy.max_repeated_chars ?? '—'}</td></tr>
              <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: 'bold' }}>{t('securityAccessControl.userSecurity.rotationDays')}</td><td style={{ padding: '4px 0' }}>{policy.rotation_days ?? '—'}</td></tr>
              <tr><td style={{ padding: '4px 12px 4px 0', fontWeight: 'bold' }}>{t('securityAccessControl.userSecurity.lockoutAttempts')}</td><td style={{ padding: '4px 0' }}>{policy.lockout_attempts ?? '—'}</td></tr>
            </tbody>
          </table>
        )
        : <p>{t('securityAccessControl.userSecurity.noPolicyConfigured')}</p>
      }

      <h2 id="admin-ip-allowlist">{t('securityAccessControl.userSecurity.adminIpAllowlist')}</h2>
      <div
        role="status"
        style={{
          border: `1px solid ${ipStatus?.enabled ? '#15803d' : '#d97706'}`,
          borderLeftWidth: 4,
          borderRadius: 6,
          padding: '12px 14px',
          marginBottom: 16,
          background: ipStatus?.enabled ? '#f0fdf4' : '#fffbeb',
          color: '#1f2937',
        }}
      >
        <strong>
          {ipStatus?.enabled
            ? t('securityAccessControl.userSecurity.allowlistActive')
            : t('securityAccessControl.userSecurity.allowlistWarningTitle')}
        </strong>
        <div style={{ marginTop: 4 }}>
          {environmentManaged
            ? t('securityAccessControl.userSecurity.environmentManaged')
            : ipStatus?.enabled
              ? t('securityAccessControl.userSecurity.allowlistActiveDetail', { count: ipStatus.activeEntries })
              : t('securityAccessControl.userSecurity.allowlistWarningDetail')}
        </div>
        {ipStatus?.currentIp && (
          <div style={{ marginTop: 6 }}>
            {t('securityAccessControl.userSecurity.currentIp')}: <code>{ipStatus.currentIp}</code>
          </div>
        )}
        {ipStatus && !ipStatus.configurationValid && (
          <div style={{ marginTop: 6, color: '#b91c1c' }}>
            {t('securityAccessControl.userSecurity.invalidActiveEntries', { count: ipStatus.invalidEntries })}
          </div>
        )}
      </div>

      {!environmentManaged && (
        <form onSubmit={addIpEntry} style={{ display: 'grid', gap: 10, maxWidth: 620, marginBottom: 18 }}>
          <label>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{t('securityAccessControl.userSecurity.ipAddress')}</span>
            <input
              required
              value={cidr}
              onChange={event => setCidr(event.target.value)}
              placeholder={ipStatus?.currentIp || '203.0.113.5/32'}
              style={{ width: '100%', padding: '8px 10px' }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{t('common.description')}</span>
            <input
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder={t('securityAccessControl.userSecurity.descriptionPlaceholder')}
              style={{ width: '100%', padding: '8px 10px' }}
            />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={activateNow}
              onChange={event => setActivateNow(event.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>{t('securityAccessControl.userSecurity.activateNow')}</strong><br />
              <small>{t('securityAccessControl.userSecurity.activateSafety')}</small>
            </span>
          </label>
          <div>
            <button type="submit" disabled={ipSaving} style={{ padding: '8px 14px' }}>
              {ipSaving ? t('common.loading') : t('securityAccessControl.userSecurity.addEntry')}
            </button>
          </div>
        </form>
      )}

      {ipError && <p role="alert" style={{ color: '#b91c1c' }}>{ipError}</p>}
      {ipList.length === 0
        ? <p>{t('securityAccessControl.userSecurity.noIpEntries')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.userSecurity.ipAddress')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('common.description')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('common.status')}</th>
                {!environmentManaged && <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {ipList.map(e => (
                <tr key={e.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{e.cidr}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{e.description ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{e.is_active ? t('common.active') : t('common.inactive')}</td>
                  {!environmentManaged && (
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', display: 'flex', gap: 6 }}>
                      <button type="button" disabled={ipSaving} onClick={() => toggleIpEntry(e)}>
                        {e.is_active
                          ? t('securityAccessControl.userSecurity.deactivate')
                          : t('securityAccessControl.userSecurity.activate')}
                      </button>
                      <button type="button" disabled={ipSaving} onClick={() => deleteIpEntry(e)}>
                        {t('common.delete')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: API Security
// ---------------------------------------------------------------------------

function ApiSecurityTab() {
  const { t } = useTranslation();
  const [rateLimits, setRateLimits] = useState<ApiKeyRateLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ data: ApiKeyRateLimit[] }>('/security-admin/api-key-rate-limits')
      .then(res => { setRateLimits(res.data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  if (loading) return <p>{t('common.loading')}</p>;
  if (error) return <p style={{ color: 'red' }}>{t('common.error')}: {error}</p>;

  return (
    <div>
      <h2>{t('securityAccessControl.apiSecurity.rateLimits')}</h2>
      {rateLimits.length === 0
        ? <p>{t('securityAccessControl.apiSecurity.noRateLimits')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.apiSecurity.tokenId')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.apiSecurity.perMinute')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.apiSecurity.perHour')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.apiSecurity.perDay')}</th>
              </tr>
            </thead>
            <tbody>
              {rateLimits.map(r => (
                <tr key={r.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.api_token_id}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.requests_per_minute ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.requests_per_hour ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.requests_per_day ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Network Security
// ---------------------------------------------------------------------------

function NetworkSecurityTab() {
  const { t } = useTranslation();
  const [firewallRules, setFirewallRules] = useState<FirewallRule[]>([]);
  const [ddosRules, setDdosRules] = useState<DdosRule[]>([]);
  const [blackholeRoutes, setBlackholeRoutes] = useState<BlackholeRoute[]>([]);
  const [dnsBlocklists, setDnsBlocklists] = useState<DnsBlocklist[]>([]);
  const [cpeScans, setCpeScans] = useState<CpeSecurityScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<{ data: FirewallRule[] }>('/network-security/firewall-rules'),
      apiFetch<{ data: DdosRule[] }>('/network-security/ddos-protection'),
      apiFetch<{ data: BlackholeRoute[] }>('/network-security/blackhole-routes'),
      apiFetch<{ data: DnsBlocklist[] }>('/network-security/dns-blocklists'),
      apiFetch<{ data: CpeSecurityScan[] }>('/network-security/cpe-security-scans'),
    ])
      .then(([fwRes, ddosRes, bhRes, dnsRes, cpeRes]) => {
        setFirewallRules(fwRes.data);
        setDdosRules(ddosRes.data);
        setBlackholeRoutes(bhRes.data);
        setDnsBlocklists(dnsRes.data);
        setCpeScans(cpeRes.data);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  if (loading) return <p>{t('common.loading')}</p>;
  if (error) return <p style={{ color: 'red' }}>{t('common.error')}: {error}</p>;

  return (
    <div>
      <h2>{t('securityAccessControl.networkSecurity.firewallRules')}</h2>
      {firewallRules.length === 0
        ? <p>{t('securityAccessControl.networkSecurity.noFirewallRules')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.action')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.protocol')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.srcIp')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.dstIp')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {firewallRules.map(r => (
                <tr key={r.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}><span style={{ fontWeight: 'bold', color: r.action === 'deny' ? '#e44' : '#4a4' }}>{r.action}</span></td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.protocol}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{r.src_ip ?? '*'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{r.dst_ip ?? '*'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.is_active ? t('common.active') : t('common.inactive')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      <h2>{t('securityAccessControl.networkSecurity.ddosProtection')}</h2>
      {ddosRules.length === 0
        ? <p>{t('securityAccessControl.networkSecurity.noDdosRules')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.ruleType')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.targetPrefix')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.action')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {ddosRules.map(r => (
                <tr key={r.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.rule_type}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{r.target_prefix}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.action}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.is_active ? t('common.active') : t('common.inactive')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      <h2>{t('securityAccessControl.networkSecurity.blackholeRoutes')}</h2>
      {blackholeRoutes.length === 0
        ? <p>{t('securityAccessControl.networkSecurity.noBlackholeRoutes')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.targetPrefix')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.reason')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('common.status')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.deactivatedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {blackholeRoutes.map(r => (
                <tr key={r.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{r.prefix}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.reason}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.is_active ? t('common.active') : t('securityAccessControl.networkSecurity.released')}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.deactivated_at ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      <h2>{t('securityAccessControl.networkSecurity.dnsBlocklists')}</h2>
      {dnsBlocklists.length === 0
        ? <p>{t('securityAccessControl.networkSecurity.noDnsBlocklists')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.domain')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.category')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.entryType')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {dnsBlocklists.map(b => (
                <tr key={b.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{b.domain}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{b.category}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{b.entry_type}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{b.is_active ? t('common.active') : t('common.inactive')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      <h2>{t('securityAccessControl.networkSecurity.cpeScans')}</h2>
      {cpeScans.length === 0
        ? <p>{t('securityAccessControl.networkSecurity.noCpeScans')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.scanType')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('common.status')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.startedAt')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.networkSecurity.completedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {cpeScans.map(s => (
                <tr key={s.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{s.scan_type}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{s.status}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{s.started_at ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{s.completed_at ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Data Security
// ---------------------------------------------------------------------------

function DataSecurityTab() {
  const { t } = useTranslation();
  const [encryptionKeys, setEncryptionKeys] = useState<EncryptionKeyMeta[]>([]);
  const [maskingRules, setMaskingRules] = useState<DataMaskingRule[]>([]);
  const [deletionLog, setDeletionLog] = useState<SecureDeletionLog[]>([]);
  const [tlsConfig, setTlsConfig] = useState<TlsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<{ data: EncryptionKeyMeta[] }>('/data-security/encryption-keys'),
      apiFetch<{ data: DataMaskingRule[] }>('/data-security/data-masking'),
      apiFetch<{ data: SecureDeletionLog[] }>('/data-security/secure-deletion-log'),
      apiFetch<{ data: TlsConfig }>('/data-security/tls-config'),
    ])
      .then(([keyRes, maskRes, logRes, tlsRes]) => {
        setEncryptionKeys(keyRes.data);
        setMaskingRules(maskRes.data);
        setDeletionLog(logRes.data);
        setTlsConfig(tlsRes.data);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  if (loading) return <p>{t('common.loading')}</p>;
  if (error) return <p style={{ color: 'red' }}>{t('common.error')}: {error}</p>;

  return (
    <div>
      <h2>{t('securityAccessControl.dataSecurity.tlsConfig')}</h2>
      {tlsConfig && (
        <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, marginBottom: 24 }}>
          <p><strong>{t('securityAccessControl.dataSecurity.minTls')}:</strong> {tlsConfig.min_tls_version}</p>
          <p><strong>{t('securityAccessControl.dataSecurity.recommendedTls')}:</strong> {tlsConfig.recommended_tls_version}</p>
          <p style={{ color: '#555', fontStyle: 'italic' }}>{tlsConfig.notes}</p>
        </div>
      )}

      <h2>{t('securityAccessControl.dataSecurity.encryptionKeys')}</h2>
      {encryptionKeys.length === 0
        ? <p>{t('securityAccessControl.dataSecurity.noEncryptionKeys')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.dataSecurity.keyAlias')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.dataSecurity.algorithm')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('common.status')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.dataSecurity.rotatedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {encryptionKeys.map(k => (
                <tr key={k.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{k.key_id ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{k.algorithm ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{k.status}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{k.rotated_at ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      <h2>{t('securityAccessControl.dataSecurity.dataMasking')}</h2>
      {maskingRules.length === 0
        ? <p>{t('securityAccessControl.dataSecurity.noMaskingRules')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.dataSecurity.tableName')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.dataSecurity.columnName')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.dataSecurity.maskingType')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {maskingRules.map(r => (
                <tr key={r.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{r.table_name}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{r.column_name}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.mask_type}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{r.is_active ? t('common.active') : t('common.inactive')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      <h2>{t('securityAccessControl.dataSecurity.secureDeletionLog')}</h2>
      {deletionLog.length === 0
        ? <p>{t('securityAccessControl.dataSecurity.noDeletionLog')}</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.dataSecurity.tableNameCol')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.dataSecurity.recordsDeleted')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.dataSecurity.policyApplied')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #ccc' }}>{t('securityAccessControl.dataSecurity.deletedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {deletionLog.map(l => (
                <tr key={l.id}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{l.table_name}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{l.records_deleted}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{l.policy_applied ?? '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>{l.deleted_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}
