// =============================================================================
// FireISP 5.0 — User Management
// =============================================================================
// Admin-only page at /users. Provides:
//   • Paginated user table with role and status filters
//   • "New User" button → modal form (name, email, password, role, phone, status)
//   • Edit button per row → update name/email/role/phone/status
//   • 2FA setup wizard for the currently logged-in user (POST /2fa/setup → QR →
//     enter TOTP code → POST /2fa/verify) and disable (POST /2fa/disable)
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { tokenStore } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface User {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  phone: string | null;
  status: string;
  totp_enabled: boolean | number;
  last_login_at: string | null;
  created_at: string;
}

interface UsersResponse {
  data: User[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';
const PAGE_SIZE = 25;
const ROLES = ['admin', 'billing', 'support', 'technician'];
const STATUSES = ['active', 'inactive'];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchUsers(page: number, roleFilter: string, statusFilter: string): Promise<UsersResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (roleFilter) params.set('role', roleFilter);
  if (statusFilter) params.set('status', statusFilter);
  const res = await fetch(`${API_BASE}/users?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load users');
  return res.json() as Promise<UsersResponse>;
}

interface CreateUserBody {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  role: string;
  phone?: string;
  status?: string;
}

// The API returns errors as { error: { message, details?: [{ field, message }] } }.
// Surface the message (or joined validation details) — the old code read `err.error`
// as a string, so `new Error(err.error)` stringified the object to "[object Object]".
export function apiErrorMessage(json: unknown, fallback: string): string {
  const e = (json as { error?: { message?: string; details?: Array<{ message?: string }> } })?.error;
  const details = e?.details?.map((d) => d.message).filter(Boolean).join(', ');
  return details || e?.message || fallback;
}

async function createUser(body: CreateUserBody): Promise<void> {
  const res = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Failed to create user'));
  }
}

interface UpdateUserBody {
  first_name?: string;
  last_name?: string;
  email?: string;
  role?: string;
  phone?: string;
  status?: string;
}

async function updateUser(id: number, body: UpdateUserBody): Promise<void> {
  const res = await fetch(`${API_BASE}/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Failed to update user'));
  }
}

interface TwoFASetupData {
  otpauth_url: string;
  secret: string;
  backup_codes?: string[];
}

async function setup2FA(): Promise<TwoFASetupData> {
  const res = await fetch(`${API_BASE}/2fa/setup`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to start 2FA setup');
  const json = (await res.json()) as { data: TwoFASetupData };
  return json.data;
}

async function verify2FA(code: string): Promise<{ backup_codes?: string[] }> {
  const res = await fetch(`${API_BASE}/2fa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Invalid code — please try again'));
  }
  const json = (await res.json()) as { data: { backup_codes?: string[] } };
  return json.data;
}

async function disable2FA(code: string): Promise<void> {
  const res = await fetch(`${API_BASE}/2fa/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Invalid code — 2FA not disabled'));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function roleBg(role: string): { bg: string; color: string } {
  const map: Record<string, { bg: string; color: string }> = {
    admin:      { bg: '#fee2e2', color: '#991b1b' },
    billing:    { bg: '#dbeafe', color: '#1e40af' },
    technician: { bg: '#d1fae5', color: '#065f46' },
    support:    { bg: '#ede9fe', color: '#5b21b6' },
  };
  return map[role] ?? { bg: '#f3f4f6', color: '#374151' };
}

function RoleBadge({ role }: { role: string }) {
  const s = roleBg(role);
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const active = status === 'active';
  return (
    <span style={{
      background: active ? '#d1fae5' : '#f3f4f6',
      color: active ? '#065f46' : '#6b7280',
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New User Modal
// ---------------------------------------------------------------------------

interface NewUserModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function NewUserModal({ onClose, onCreated }: NewUserModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    role: 'support',
    phone: '',
    status: 'active',
  });
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const body: CreateUserBody = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        status: form.status,
      };
      if (form.phone.trim()) body.phone = form.phone.trim();
      return createUser(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onCreated();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setForm(f => ({ ...f, [k]: e.target.value }));

  const valid = form.first_name.trim() && form.last_name.trim() &&
                form.email.trim() && form.password.length >= 8;

  return (
    <div style={modalOverlay}>
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 1rem' }}>New User</h3>
        {err && <div style={errStyle}>{err}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={labelStyle}>First Name *</label>
            <input style={inputStyle} value={form.first_name} onChange={set('first_name')} placeholder="First name" />
          </div>
          <div>
            <label style={labelStyle}>Last Name *</label>
            <input style={inputStyle} value={form.last_name} onChange={set('last_name')} placeholder="Last name" />
          </div>
        </div>

        <label style={labelStyle}>Email *</label>
        <input style={inputStyle} type="email" value={form.email} onChange={set('email')} placeholder="user@example.com" />

        <label style={labelStyle}>Password * (min 8 characters)</label>
        <input style={inputStyle} type="password" value={form.password} onChange={set('password')} placeholder="••••••••" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={labelStyle}>Role</label>
            <select style={inputStyle} value={form.role} onChange={set('role')}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={form.status} onChange={set('status')}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <label style={labelStyle}>Phone</label>
        <input style={inputStyle} value={form.phone} onChange={set('phone')} placeholder="+52 55 1234 5678 (optional)" />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose}>Cancel</button>
          <button
            style={btnPrimary}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !valid}
          >
            {mutation.isPending ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit User Modal
// ---------------------------------------------------------------------------

interface EditUserModalProps {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}

function EditUserModal({ user, onClose, onSaved }: EditUserModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    role: user.role,
    phone: user.phone ?? '',
    status: user.status,
  });
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const body: UpdateUserBody = {};
      if (form.first_name.trim() !== user.first_name) body.first_name = form.first_name.trim() || user.first_name;
      if (form.last_name.trim() !== user.last_name) body.last_name = form.last_name.trim() || user.last_name;
      if (form.email.trim() !== user.email) body.email = form.email.trim() || user.email;
      if (form.role !== user.role) body.role = form.role;
      if (form.status !== user.status) body.status = form.status;
      const origPhone = user.phone ?? '';
      if (form.phone.trim() !== origPhone) body.phone = form.phone.trim() || undefined;
      return updateUser(user.id, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onSaved();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div style={modalOverlay}>
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 1rem' }}>Edit User</h3>
        {err && <div style={errStyle}>{err}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={labelStyle}>First Name</label>
            <input style={inputStyle} value={form.first_name} onChange={set('first_name')} />
          </div>
          <div>
            <label style={labelStyle}>Last Name</label>
            <input style={inputStyle} value={form.last_name} onChange={set('last_name')} />
          </div>
        </div>

        <label style={labelStyle}>Email</label>
        <input style={inputStyle} type="email" value={form.email} onChange={set('email')} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={labelStyle}>Role</label>
            <select style={inputStyle} value={form.role} onChange={set('role')}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={form.status} onChange={set('status')}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <label style={labelStyle}>Phone</label>
        <input style={inputStyle} value={form.phone} onChange={set('phone')} placeholder="+52 55 1234 5678 (optional)" />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose}>Cancel</button>
          <button
            style={btnPrimary}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2FA Setup Wizard (for the currently logged-in user)
// ---------------------------------------------------------------------------

interface TwoFASetupModalProps {
  onClose: () => void;
  onEnabled: () => void;
}

type SetupStep = 'init' | 'scan' | 'verify' | 'done';

function TwoFASetupModal({ onClose, onEnabled }: TwoFASetupModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<SetupStep>('init');
  const [setupData, setSetupData] = useState<TwoFASetupData | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSetup() {
    setLoading(true);
    setErr('');
    try {
      const data = await setup2FA();
      setSetupData(data);
      setStep('scan');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!code.trim()) return;
    setLoading(true);
    setErr('');
    try {
      const result = await verify2FA(code.trim());
      setBackupCodes(result.backup_codes ?? []);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setStep('done');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={modalOverlay}>
      <div style={{ ...modalBox, maxWidth: 480 }}>
        {step === 'init' && (
          <>
            <h3 style={{ margin: '0 0 0.75rem' }}>🔐 Enable Two-Factor Authentication</h3>
            <p style={{ color: '#555', fontSize: '0.88rem', lineHeight: 1.6 }}>
              Two-factor authentication adds an extra layer of security to your account.
              Once enabled, you'll need an authenticator app (Google Authenticator, Authy, etc.)
              to sign in.
            </p>
            {err && <div style={errStyle}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btnSecondary} onClick={onClose}>Cancel</button>
              <button style={btnPrimary} onClick={handleSetup} disabled={loading}>
                {loading ? 'Generating…' : 'Continue →'}
              </button>
            </div>
          </>
        )}

        {step === 'scan' && setupData && (
          <>
            <h3 style={{ margin: '0 0 0.75rem' }}>📱 Scan or copy the secret</h3>
            <p style={{ color: '#555', fontSize: '0.85rem', lineHeight: 1.5 }}>
              Open your authenticator app and either scan the QR code (if supported) or
              add the account manually using the secret key below.
            </p>

            <div style={{
              background: '#f9fafb', border: '1px solid #e5e7eb',
              borderRadius: 8, padding: '0.75rem', marginBottom: '0.75rem',
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
                Secret key (manual entry):
              </div>
              <div style={{
                fontFamily: 'monospace', fontSize: '0.95rem', letterSpacing: 1,
                wordBreak: 'break-all', color: '#1f2937',
              }}>
                {setupData.secret}
              </div>
            </div>

            <div style={{
              background: '#f9fafb', border: '1px solid #e5e7eb',
              borderRadius: 8, padding: '0.75rem', marginBottom: '1rem',
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
                OTPAuth URL (for QR scanning):
              </div>
              <div style={{ fontSize: '0.75rem', wordBreak: 'break-all', color: '#374151' }}>
                {setupData.otpauth_url}
              </div>
              <button
                style={{ ...btnSecondary, marginTop: 6, fontSize: '0.75rem', padding: '4px 10px' }}
                onClick={() => navigator.clipboard.writeText(setupData.otpauth_url).catch(() => undefined)}
              >
                Copy URL
              </button>
            </div>

            <label style={labelStyle}>Enter the 6-digit code from your app *</label>
            <input
              style={inputStyle}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              maxLength={6}
              inputMode="numeric"
            />
            {err && <div style={{ ...errStyle, marginTop: 6 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btnSecondary} onClick={onClose}>Cancel</button>
              <button
                style={btnPrimary}
                onClick={handleVerify}
                disabled={loading || code.length !== 6}
              >
                {loading ? 'Verifying…' : 'Enable 2FA'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <h3 style={{ margin: '0 0 0.75rem', color: '#065f46' }}>✅ 2FA Enabled</h3>
            <p style={{ color: '#555', fontSize: '0.88rem', lineHeight: 1.6 }}>
              Two-factor authentication is now active on your account.
              Save these backup codes in a safe place — each can only be used once if you lose access to your authenticator app.
            </p>
            {backupCodes.length > 0 && (
              <div style={{
                background: '#f9fafb', border: '1px solid #e5e7eb',
                borderRadius: 8, padding: '0.75rem', marginBottom: '1rem',
              }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>
                  Backup codes (save these now):
                </div>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr',
                  gap: 4, fontFamily: 'monospace', fontSize: '0.88rem',
                }}>
                  {backupCodes.map((c, i) => (
                    <span key={i} style={{ background: '#fff', padding: '3px 8px', borderRadius: 4, border: '1px solid #e5e7eb' }}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button style={btnPrimary} onClick={() => { onEnabled(); onClose(); }}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2FA Disable Modal (for the currently logged-in user)
// ---------------------------------------------------------------------------

interface TwoFADisableModalProps {
  onClose: () => void;
  onDisabled: () => void;
}

function TwoFADisableModal({ onClose, onDisabled }: TwoFADisableModalProps) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => disable2FA(code.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onDisabled();
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div style={modalOverlay}>
      <div style={{ ...modalBox, maxWidth: 420 }}>
        <h3 style={{ margin: '0 0 0.75rem' }}>Disable Two-Factor Authentication</h3>
        <p style={{ color: '#555', fontSize: '0.88rem', lineHeight: 1.6 }}>
          Enter the current 6-digit code from your authenticator app to disable 2FA on your account.
        </p>
        <label style={labelStyle}>Current TOTP code *</label>
        <input
          style={inputStyle}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          maxLength={6}
          inputMode="numeric"
        />
        {err && <div style={{ ...errStyle, marginTop: 6 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose}>Cancel</button>
          <button
            style={{ ...btnPrimary, background: '#dc2626' }}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || code.length !== 6}
          >
            {mutation.isPending ? 'Disabling…' : 'Disable 2FA'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function UserList() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [show2FADisable, setShow2FADisable] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['users', page, roleFilter, statusFilter],
    queryFn: () => fetchUsers(page, roleFilter, statusFilter),
  });

  const users = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  function handleFilterChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => {
      setter(e.target.value);
      setPage(1);
    };
  }

  // Find current user's entry in the table to reflect live 2FA status
  const myRow = users.find(u => u.id === currentUser?.id);
  const myTotpEnabled = myRow
    ? Boolean(myRow.totp_enabled)
    : Boolean(currentUser?.twofa_enabled);

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>🔑 {t('userList.title')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {myTotpEnabled ? (
            <button style={{ ...btnSecondary, borderColor: '#dc2626', color: '#dc2626' }} onClick={() => setShow2FADisable(true)}>
              🔐 {t('userList.disableMyTwoFA')}
            </button>
          ) : (
            <button style={{ ...btnSecondary, borderColor: '#059669', color: '#059669' }} onClick={() => setShow2FASetup(true)}>
              🔐 {t('userList.enableMyTwoFA')}
            </button>
          )}
          <button style={btnPrimary} onClick={() => setShowNew(true)}>{t('userList.newUser')}</button>
        </div>
      </div>

      {/* 2FA note */}
      <div style={{
        background: '#fffbeb', border: '1px solid #fde68a',
        borderRadius: 6, padding: '8px 12px', marginBottom: '1rem',
        fontSize: '0.8rem', color: '#92400e',
      }}>
        💡 <strong>Two-factor authentication</strong> is self-service — each user sets up or disables 2FA for their own account.
        Use the buttons above to manage 2FA for your account.
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select aria-label={t('userList.filterRole')} style={filterSelect} value={roleFilter} onChange={handleFilterChange(setRoleFilter)}>
          <option value="">{t('userList.allRoles')}</option>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select aria-label={t('userList.filterStatus')} style={filterSelect} value={statusFilter} onChange={handleFilterChange(setStatusFilter)}>
          <option value="">{t('userList.allStatuses')}</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(roleFilter || statusFilter) && (
          <button style={btnSecondary} onClick={() => { setRoleFilter(''); setStatusFilter(''); setPage(1); }}>
            {t('userList.clearFilters')}
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading && <p style={{ color: '#888' }}>{t('userList.loading')}</p>}
      {error && <p style={{ color: '#e00' }}>{t('userList.error')}</p>}
      {!isLoading && !error && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>{t('userList.table.name')}</th>
                  <th style={th}>{t('userList.table.email')}</th>
                  <th style={th}>{t('userList.table.role')}</th>
                  <th style={th}>{t('userList.table.status')}</th>
                  <th style={th}>{t('userList.table.twofa')}</th>
                  <th style={th}>{t('userList.table.lastLogin')}</th>
                  <th style={th}>{t('userList.table.created')}</th>
                  <th style={th}>{t('userList.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...td, textAlign: 'center', color: '#888', padding: '2rem' }}>
                      {t('userList.noUsers')}
                    </td>
                  </tr>
                )}
                {users.map(u => (
                  <tr
                    key={u.id}
                    style={{ background: u.id === currentUser?.id ? '#f0f9ff' : undefined }}
                  >
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>
                        {u.first_name} {u.last_name}
                      </span>
                      {u.id === currentUser?.id && (
                        <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#6b7280' }}>(you)</span>
                      )}
                    </td>
                    <td style={{ ...td, color: '#4b5563' }}>{u.email}</td>
                    <td style={td}><RoleBadge role={u.role} /></td>
                    <td style={td}><StatusBadge status={u.status} /></td>
                    <td style={td}>
                      <span style={{
                        background: u.totp_enabled ? '#d1fae5' : '#f3f4f6',
                        color: u.totp_enabled ? '#065f46' : '#9ca3af',
                        padding: '2px 8px', borderRadius: 12,
                        fontSize: '0.72rem', fontWeight: 600,
                      }}>
                        {u.totp_enabled ? '✓ on' : 'off'}
                      </span>
                    </td>
                    <td style={td}>{fmt(u.last_login_at)}</td>
                    <td style={td}>{fmt(u.created_at)}</td>
                    <td style={td}>
                      <button
                        style={{ ...btnSecondary, fontSize: '0.78rem', padding: '4px 10px' }}
                        onClick={() => setEditUser(u)}
                      >
                        {t('common.edit')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '1rem' }}>
              <button style={btnSecondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('clientList.prevPage')}</button>
              <span style={{ fontSize: '0.85rem', color: '#555' }}>
                {t('clientList.pageInfo', { page, total: totalPages })} ({meta?.total} users)
              </span>
              <button style={btnSecondary} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t('clientList.nextPage')}</button>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {showNew && (
        <NewUserModal onClose={() => setShowNew(false)} onCreated={() => setShowNew(false)} />
      )}
      {editUser && (
        <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSaved={() => setEditUser(null)} />
      )}
      {show2FASetup && (
        <TwoFASetupModal onClose={() => setShow2FASetup(false)} onEnabled={() => setShow2FASetup(false)} />
      )}
      {show2FADisable && (
        <TwoFADisableModal onClose={() => setShow2FADisable(false)} onDisabled={() => setShow2FADisable(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
  fontSize: '0.85rem', fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)',
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
};
const filterSelect: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid var(--input-border)',
  fontSize: '0.85rem', background: 'var(--input-bg)',
};
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', background: 'var(--bg-card)',
  borderRadius: 8, overflow: 'hidden',
  boxShadow: '0 0 0 1px var(--border)',
};
const th: React.CSSProperties = {
  padding: '10px 12px', textAlign: 'left', fontSize: '0.78rem',
  fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-body)',
  borderBottom: '1px solid var(--border)',
};
const td: React.CSSProperties = {
  padding: '10px 12px', fontSize: '0.85rem', color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-subtle)',
};
const modalOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalBox: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 10, padding: '1.5rem',
  width: 560, maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,.18)',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 3, marginTop: 10,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--input-border)',
  borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box',
};
const errStyle: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b',
  padding: '8px 12px', borderRadius: 6, fontSize: '0.83rem', marginBottom: 8,
};
