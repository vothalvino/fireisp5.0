// =============================================================================
// FireISP 5.0 — User Management
// =============================================================================
// Admin-only page at /users. Provides:
//   • Paginated user table with group and status filters
//   • "New User" button → modal form (name, email, password, group, org
//     access, phone, status)
//   • Edit button per row → update name/email/group/org access/phone/status
//   • Archived tab → Restore, or Edit group (PATCH /users/:id/group) to
//     reassign an archived user's group without restoring them — deliberately
//     narrow: no name/email/status/org fields, since restoring is the path
//     for a full edit
//   • 2FA setup wizard for the currently logged-in user (POST /2fa/setup → QR →
//     enter TOTP code → POST /2fa/verify) and disable (POST /2fa/disable)
//
// Users belong to a "group" (roles.id, migration 378) which governs their
// permission set; the legacy `role` field is a server-maintained mirror of
// the group's `kind` and is never sent from this page — only `group_id` is.
// Each user also has explicit organization access (`organization_ids`),
// synced via POST/PUT/PATCH /users and prefilled via GET /users/:id/organizations.
// =============================================================================

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { authedFetch, tokenStore } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { Pagination } from '@/components/Pagination';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface User {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  group_id: number | null;
  phone: string | null;
  status: string;
  totp_enabled: boolean | number;
  last_login_at: string | null;
  created_at: string;
  deleted_at?: string | null;
}

interface UsersResponse {
  data: User[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Group {
  id: number;
  name: string;
  description: string | null;
  kind: string | null;
  is_system: number | boolean;
}

interface GroupsResponse {
  data: Group[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Organization {
  id: number;
  name: string;
}

interface OrganizationsResponse {
  data: Organization[];
}

interface UserOrganization {
  id: number;
  name: string;
  membership_role: string;
}

interface UserOrganizationsResponse {
  data: UserOrganization[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';
const STATUSES = ['active', 'inactive'];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchUsers(page: number, pageSize: number, groupFilter: string, statusFilter: string): Promise<UsersResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
  if (groupFilter) params.set('group_id', groupFilter);
  if (statusFilter) params.set('status', statusFilter);
  const res = await fetch(`${API_BASE}/users?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load users');
  return res.json() as Promise<UsersResponse>;
}

// Archived tab — lists ONLY soft-deleted (archived) users. Same paginated
// shape as the normal list; rows carry `deleted_at`.
async function fetchArchivedUsers(page: number, pageSize: number): Promise<UsersResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(pageSize), only_deleted: 'true' });
  const res = await fetch(`${API_BASE}/users?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load archived users');
  return res.json() as Promise<UsersResponse>;
}

async function fetchGroups(): Promise<Group[]> {
  const res = await fetch(`${API_BASE}/roles?limit=100`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load groups');
  const json = (await res.json()) as GroupsResponse;
  return json.data;
}

async function fetchOrganizations(): Promise<Organization[]> {
  const res = await fetch(`${API_BASE}/organizations?limit=500`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load organizations');
  const json = (await res.json()) as OrganizationsResponse;
  return json.data;
}

async function fetchUserOrganizations(id: number): Promise<UserOrganization[]> {
  const res = await fetch(`${API_BASE}/users/${id}/organizations`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load organization access');
  const json = (await res.json()) as UserOrganizationsResponse;
  return json.data;
}

interface CreateUserBody {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  group_id: number;
  organization_ids: number[];
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
  const res = await authedFetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  group_id?: number;
  organization_ids?: number[];
  phone?: string | null;
  status?: string;
}

async function updateUser(id: number, body: UpdateUserBody): Promise<void> {
  const res = await authedFetch(`${API_BASE}/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Failed to update user'));
  }
}

// "Deleting" a staff user ARCHIVES it — soft-delete + forced status='inactive'
// in one statement (see src/models/User.js). The account is not gone; it can
// be brought back with restoreUser(), which returns INACTIVE and must be
// re-activated explicitly.
async function archiveUser(id: number): Promise<void> {
  const res = await authedFetch(`${API_BASE}/users/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Failed to archive user'));
  }
}

async function restoreUser(id: number): Promise<void> {
  const res = await authedFetch(`${API_BASE}/users/${id}/restore`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Failed to restore user'));
  }
}

// Reassigns an ARCHIVED user's group without restoring them (PATCH
// /users/:id/group). The backend 422s if the target is ACTIVE or the group
// id is unknown — those messages are surfaced verbatim via apiErrorMessage.
async function updateArchivedUserGroup(id: number, groupId: number): Promise<User> {
  const res = await authedFetch(`${API_BASE}/users/${id}/group`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_id: groupId }),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Failed to update group'));
  }
  const json = (await res.json()) as { data: User };
  return json.data;
}

interface TwoFASetupData {
  otpauth_url: string;
  secret: string;
  backup_codes?: string[];
}

async function setup2FA(): Promise<TwoFASetupData> {
  const res = await authedFetch(`${API_BASE}/2fa/setup`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to start 2FA setup');
  const json = (await res.json()) as { data: TwoFASetupData };
  return json.data;
}

async function verify2FA(code: string): Promise<{ backup_codes?: string[] }> {
  const res = await authedFetch(`${API_BASE}/2fa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Invalid code — please try again'));
  }
  const json = (await res.json()) as { data: { backup_codes?: string[] } };
  return json.data;
}

async function disable2FA(code: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/2fa/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

// Archive/restore are list-shrinking mutations — the row that made a page's
// last user disappear can strand `page` past the new `totalPages`, after
// which the query returns `data: []` and <Pagination> hides its controls
// (totalPages <= 1) with no way back. Generic guard for any paginated tab
// here: once the query settles, clamp `page` back down to the last real page.
function useClampPage(totalPages: number | undefined, page: number, setPage: (p: number) => void) {
  useEffect(() => {
    if (totalPages !== undefined && page > totalPages) {
      setPage(Math.max(1, totalPages));
    }
  }, [totalPages, page, setPage]);
}

// Assignable groups for a picker: system groups first (alphabetical among
// themselves), then custom groups alphabetically. Groups with no `kind`
// (pre-378 custom rows that never got a base persona) are EXCLUDED — the
// backend rejects assigning them with a 422, so offering them is a dead
// option. `keepId` re-includes one specific group even if kind-less, so an
// existing archived user's current (legacy) group still shows as selected.
function sortGroups(groups: Group[], keepId?: number | null): Group[] {
  return [...groups]
    .filter(g => g.kind != null || g.id === keepId)
    .sort((a, b) => {
      const aSys = a.is_system ? 0 : 1;
      const bSys = b.is_system ? 0 : 1;
      if (aSys !== bSys) return aSys - bSys;
      return a.name.localeCompare(b.name);
    });
}

function groupsById(groups: Group[]): Map<number, string> {
  return new Map(groups.map(g => [g.id, g.name]));
}

// Resolve the table's Group cell: prefer the group name, but fall back to the
// raw `role` mirror text if the id is unknown (e.g. group deleted, or the
// groups list hasn't loaded yet).
function groupLabel(user: User, names: Map<number, string>): string {
  if (user.group_id !== null && names.has(user.group_id)) {
    return names.get(user.group_id) as string;
  }
  return user.role;
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

// `role` drives the badge color (the kind mirror); `label` is the text shown
// (the resolved group name, falling back to the raw role mirror).
function RoleBadge({ role, label }: { role: string; label: string }) {
  const s = roleBg(role);
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 600,
    }}>
      {label}
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
// Organization access checklist (shared by create + edit modals)
// ---------------------------------------------------------------------------

interface OrgCheckboxListProps {
  organizations: Organization[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  loading?: boolean;
  disabled?: boolean;
}

function OrgCheckboxList({ organizations, selected, onToggle, loading, disabled }: OrgCheckboxListProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div style={{
        border: '1px solid var(--input-border)', borderRadius: 6,
        maxHeight: 160, overflowY: 'auto', padding: '6px 10px',
      }}>
        {loading ? (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('userList.newUserModal.orgLoading')}</span>
        ) : organizations.length === 0 ? (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('userList.newUserModal.noOrgs')}</span>
        ) : (
          organizations.map(org => (
            <label key={org.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={selected.has(org.id)}
                disabled={disabled}
                onChange={() => onToggle(org.id)}
              />
              {org.name}
            </label>
          ))
        )}
      </div>
      {!loading && selected.size === 0 && (
        <div style={{ color: '#dc2626', fontSize: '0.75rem', marginTop: 4 }}>
          {t('userList.newUserModal.orgHint')}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New User Modal
// ---------------------------------------------------------------------------

interface NewUserModalProps {
  onClose: () => void;
  onCreated: () => void;
  groups: Group[];
  organizations: Organization[];
  currentOrgId: number | null;
}

function NewUserModal({ onClose, onCreated, groups, organizations, currentOrgId }: NewUserModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    phone: '',
    status: 'active',
  });
  const [groupId, setGroupId] = useState<number | null>(null);
  const [orgIds, setOrgIds] = useState<Set<number>>(() => new Set(currentOrgId ? [currentOrgId] : []));
  const [err, setErr] = useState('');

  // Default the group to the system "support" group once the groups list loads.
  useEffect(() => {
    if (groupId !== null || groups.length === 0) return;
    const support = groups.find(g => g.is_system && g.name === 'support');
    setGroupId(support ? support.id : groups[0].id);
  }, [groups, groupId]);

  const toggleOrg = (id: number) => {
    setOrgIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const mutation = useMutation({
    mutationFn: () => {
      const body: CreateUserBody = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        password: form.password,
        group_id: Number(groupId),
        organization_ids: Array.from(orgIds),
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
                form.email.trim() && form.password.length >= 8 &&
                groupId !== null && orgIds.size > 0;

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
            <label style={labelStyle}>{t('userList.newUserModal.group')}</label>
            <select
              aria-label={t('userList.newUserModal.group')}
              style={inputStyle}
              value={groupId ?? ''}
              onChange={e => setGroupId(e.target.value ? Number(e.target.value) : null)}
            >
              {groupId === null && <option value="">{t('common.loading')}</option>}
              {sortGroups(groups).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
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

        <label style={labelStyle}>{t('userList.newUserModal.orgAccess')}</label>
        <OrgCheckboxList organizations={organizations} selected={orgIds} onToggle={toggleOrg} />

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
  groups: Group[];
  organizations: Organization[];
}

function EditUserModal({ user, onClose, onSaved, groups, organizations }: EditUserModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    phone: user.phone ?? '',
    status: user.status,
  });
  const [groupId, setGroupId] = useState<number | null>(user.group_id);
  const [orgIds, setOrgIds] = useState<Set<number> | null>(null);
  const [err, setErr] = useState('');

  const orgsQuery = useQuery({
    queryKey: ['users', user.id, 'organizations'],
    queryFn: () => fetchUserOrganizations(user.id),
  });

  // Prefill the checklist once the user's current org access loads.
  useEffect(() => {
    if (orgsQuery.data && orgIds === null) {
      setOrgIds(new Set(orgsQuery.data.map(o => o.id)));
    }
  }, [orgsQuery.data, orgIds]);

  const toggleOrg = (id: number) => {
    setOrgIds(prev => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const mutation = useMutation({
    mutationFn: () => {
      const body: UpdateUserBody = {};
      if (form.first_name.trim() !== user.first_name) body.first_name = form.first_name.trim() || user.first_name;
      if (form.last_name.trim() !== user.last_name) body.last_name = form.last_name.trim() || user.last_name;
      if (form.email.trim() !== user.email) body.email = form.email.trim() || user.email;
      if (groupId !== null && groupId !== user.group_id) body.group_id = groupId;
      if (form.status !== user.status) body.status = form.status;
      const trimmedPhone = form.phone.trim();
      const origPhone = user.phone ?? '';
      if (trimmedPhone !== origPhone) {
        // An explicitly cleared phone must be sent as `phone: null`, not
        // omitted — `trimmedPhone || undefined` would drop the key entirely
        // (JSON.stringify skips `undefined`), which the PATCH diff otherwise
        // reads as "unchanged" and the backend silently keeps the old value.
        // `null` passes validate() (optional fields skip further checks when
        // null) and `users.phone` is a nullable column, so this actually clears it.
        body.phone = trimmedPhone === '' ? null : trimmedPhone;
      }
      // Organization access always syncs on save — the backend replaces the
      // set wholesale ('owner' rows are preserved server-side).
      body.organization_ids = Array.from(orgIds ?? []);
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

  // Org access must have successfully prefilled before Save is allowed — if
  // GET /users/:id/organizations fails, `orgIds` stays null (see the effect
  // above) *until the user interacts with the checklist*, at which point
  // `toggleOrg` would otherwise seed a Set from an empty baseline and quietly
  // make `valid` true again with only the toggled org(s), silently wiping
  // every other organization the user actually had access to on save. Gate
  // explicitly on `orgsQuery.isError` (independent of `orgIds`) so a Save is
  // impossible until a prefill retry succeeds; the checklist is also
  // disabled during the error state so `orgIds` can't leave `null` at all.
  const valid = !orgsQuery.isError && orgIds !== null && orgIds.size > 0 && groupId !== null;

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
            <label style={labelStyle}>{t('userList.editUserModal.group')}</label>
            <select
              aria-label={t('userList.editUserModal.group')}
              style={inputStyle}
              value={groupId ?? ''}
              onChange={e => setGroupId(e.target.value ? Number(e.target.value) : null)}
            >
              {groupId === null && <option value="">{t('userList.editUserModal.selectGroupPlaceholder')}</option>}
              {sortGroups(groups).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
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

        <label style={labelStyle}>{t('userList.editUserModal.orgAccess')}</label>
        {orgsQuery.isError && (
          <div style={{ ...errStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{t('userList.editUserModal.orgPrefillError')}</span>
            <button
              type="button"
              style={{ ...btnSecondary, padding: '2px 10px', fontSize: '0.78rem' }}
              onClick={() => orgsQuery.refetch()}
              disabled={orgsQuery.isFetching}
            >
              {orgsQuery.isFetching ? t('common.loading') : t('userList.editUserModal.retry')}
            </button>
          </div>
        )}
        <OrgCheckboxList
          organizations={organizations}
          selected={orgIds ?? new Set()}
          onToggle={toggleOrg}
          loading={orgsQuery.isLoading}
          disabled={orgsQuery.isError}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose}>Cancel</button>
          <button
            style={btnPrimary}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !valid}
          >
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Archive User Modal (soft-delete + forced 'inactive'; DELETE /users/:id)
// ---------------------------------------------------------------------------

interface ArchiveUserModalProps {
  targetUser: User;
  onClose: () => void;
  onArchived: () => void;
}

function ArchiveUserModal({ targetUser, onClose, onArchived }: ArchiveUserModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => archiveUser(targetUser.id),
    onSuccess: () => {
      // Prefix-matches both the main list (['users', ...]) and the Archived
      // tab's query (['users', 'archived', ...]) so the row moves immediately.
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onArchived();
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div style={modalOverlay} role="dialog" aria-modal="true" aria-label={t('userList.archiveModal.title')}>
      <div style={{ ...modalBox, width: 440 }}>
        <h3 style={{ margin: '0 0 0.75rem' }}>{t('userList.archiveModal.title')}</h3>
        {err && <div style={errStyle}>{err}</div>}
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 0, lineHeight: 1.5 }}>
          {t('userList.archiveModal.body', { name: `${targetUser.first_name} ${targetUser.last_name}` })}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose}>{t('common.cancel')}</button>
          <button
            style={{ ...btnPrimary, background: '#dc2626' }}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('userList.archiveModal.archiving') : t('userList.archiveModal.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Archived User Group Modal (PATCH /users/:id/group — reassigns an
// ARCHIVED user's group without restoring them). Deliberately narrow: unlike
// EditUserModal it exposes only the group select — name/email/status/org
// access are not editable here; restoring is the path for a full edit.
// ---------------------------------------------------------------------------

interface EditArchivedGroupModalProps {
  targetUser: User;
  groups: Group[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

function EditArchivedGroupModal({ targetUser, groups, onClose, onSaved }: EditArchivedGroupModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [groupId, setGroupId] = useState<number | null>(targetUser.group_id);
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => updateArchivedUserGroup(targetUser.id, Number(groupId)),
    onSuccess: () => {
      // Prefix-matches both the main list and the Archived tab's query, same
      // as archive/restore, so the row's Group cell reflects the change.
      queryClient.invalidateQueries({ queryKey: ['users'] });
      const name = `${targetUser.first_name} ${targetUser.last_name}`;
      const groupName = groups.find(g => g.id === groupId)?.name ?? '';
      onSaved(t('userList.archivedTab.groupUpdatedNotice', { name, group: groupName }));
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const valid = groupId !== null;

  return (
    <div style={modalOverlay} role="dialog" aria-modal="true" aria-label={t('userList.editGroupModal.title')}>
      <div style={{ ...modalBox, width: 420 }}>
        <h3 style={{ margin: '0 0 0.75rem' }}>{t('userList.editGroupModal.title')}</h3>
        {err && <div style={errStyle}>{err}</div>}

        <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 10 }}>
          {targetUser.first_name} {targetUser.last_name}
        </div>

        <label style={labelStyle}>{t('userList.editGroupModal.groupLabel')}</label>
        <select
          aria-label={t('userList.editGroupModal.groupLabel')}
          style={inputStyle}
          value={groupId ?? ''}
          onChange={e => setGroupId(e.target.value ? Number(e.target.value) : null)}
        >
          {groupId === null && <option value="">{t('userList.editUserModal.selectGroupPlaceholder')}</option>}
          {sortGroups(groups, groupId).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose}>{t('common.cancel')}</button>
          <button
            style={btnPrimary}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !valid}
          >
            {mutation.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Archived Tab — paginated table of archived (soft-deleted) users + Restore
// ---------------------------------------------------------------------------

interface ArchivedUsersTabProps {
  data?: UsersResponse;
  isLoading: boolean;
  error: Error | null;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  groupNames: Map<number, string>;
  groups: Group[];
}

function ArchivedUsersTab({
  data, isLoading, error, page, pageSize, onPageChange, onPageSizeChange, groupNames, groups,
}: ArchivedUsersTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [editGroupTarget, setEditGroupTarget] = useState<User | null>(null);

  const users = data?.data ?? [];
  const meta = data?.meta;

  const restoreMutation = useMutation({
    mutationFn: (id: number) => restoreUser(id),
    onSuccess: (_result, id) => {
      // Same prefix-match invalidation as archiving — refetches both the
      // Archived tab's own list and the main Users list, so the restored row
      // (now visible again, status 'inactive') appears there right away.
      queryClient.invalidateQueries({ queryKey: ['users'] });
      const target = users.find(u => u.id === id);
      const name = target ? `${target.first_name} ${target.last_name}` : '';
      setErr('');
      setNotice(t('userList.archivedTab.restoredNotice', { name }));
    },
    onError: (e: Error) => { setNotice(null); setErr(e.message); },
  });

  return (
    <div>
      {notice && (
        <div style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af',
          borderRadius: 6, padding: '8px 12px', marginBottom: '1rem',
          fontSize: '0.83rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span>{notice}</span>
          <button
            type="button"
            aria-label={t('userList.archivedTab.dismissNotice')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1e40af', fontWeight: 700, fontSize: '1rem', lineHeight: 1 }}
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      {err && <div style={errStyle}>{err}</div>}

      {isLoading && <p style={{ color: '#888' }}>{t('userList.archivedTab.loading')}</p>}
      {error && <p style={{ color: '#e00' }}>{t('userList.archivedTab.error')}</p>}
      {!isLoading && !error && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>{t('userList.table.name')}</th>
                  <th style={th}>{t('userList.table.email')}</th>
                  <th style={th}>{t('userList.table.group')}</th>
                  <th style={th}>{t('userList.archivedTab.table.archived')}</th>
                  <th style={th}>{t('userList.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ ...td, textAlign: 'center', color: '#888', padding: '2rem' }}>
                      {t('userList.archivedTab.empty')}
                    </td>
                  </tr>
                )}
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{u.first_name} {u.last_name}</span>
                    </td>
                    <td style={{ ...td, color: '#4b5563' }}>{u.email}</td>
                    <td style={td}>{groupLabel(u, groupNames)}</td>
                    <td style={td}>{fmt(u.deleted_at)}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {/* Group-only edit — does not restore the account. */}
                        <button
                          style={{ ...btnSecondary, fontSize: '0.78rem', padding: '4px 10px' }}
                          onClick={() => { setErr(''); setEditGroupTarget(u); }}
                        >
                          {t('userList.archivedTab.editGroup')}
                        </button>
                        {/* Only the row whose id matches the mutation's in-flight
                            variables shows the busy state — restoreMutation is
                            shared across every row, so gating on `isPending`
                            alone would disable/relabel every Restore button
                            while any single restore is running. */}
                        <button
                          style={{ ...btnSecondary, fontSize: '0.78rem', padding: '4px 10px' }}
                          onClick={() => restoreMutation.mutate(u.id)}
                          disabled={restoreMutation.isPending && restoreMutation.variables === u.id}
                        >
                          {restoreMutation.isPending && restoreMutation.variables === u.id
                            ? t('userList.archivedTab.restoring')
                            : t('userList.archivedTab.restore')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={meta?.totalPages ?? 1}
            total={meta?.total}
            pageSize={pageSize}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </>
      )}

      {editGroupTarget && (
        <EditArchivedGroupModal
          targetUser={editGroupTarget}
          groups={groups}
          onClose={() => setEditGroupTarget(null)}
          onSaved={(message) => { setErr(''); setNotice(message); }}
        />
      )}
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

type UserTab = 'users' | 'archived';

export function UserList() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState<UserTab>('users');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<User | null>(null);
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [show2FADisable, setShow2FADisable] = useState(false);
  const [archivedPage, setArchivedPage] = useState(1);
  const [archivedPageSize, setArchivedPageSize] = useState(25);

  const { data, isLoading, error } = useQuery({
    queryKey: ['users', page, pageSize, groupFilter, statusFilter],
    queryFn: () => fetchUsers(page, pageSize, groupFilter, statusFilter),
  });

  // Always fetched (not gated on the active tab) so the Archived tab's count
  // badge is available without an extra round trip when the user switches —
  // one small paginated request is cheap, and its query key still gets
  // refetched by the archive/restore mutations' ['users'] invalidation.
  const archivedQuery = useQuery({
    queryKey: ['users', 'archived', archivedPage, archivedPageSize],
    queryFn: () => fetchArchivedUsers(archivedPage, archivedPageSize),
  });

  // Clamp both tabs' page state after a list-shrinking mutation (archive on
  // the last row of the last page, restore on the last archived page) would
  // otherwise strand `page` past the new `totalPages` with no way back.
  useClampPage(data?.meta.totalPages, page, setPage);
  useClampPage(archivedQuery.data?.meta.totalPages, archivedPage, setArchivedPage);

  // Fetched once (React Query caches by key) and shared by the filter select
  // and both modals, so the Group picker and table labels stay consistent.
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups });
  const organizationsQuery = useQuery({ queryKey: ['organizations'], queryFn: fetchOrganizations });

  const groups = groupsQuery.data ?? [];
  const organizations = organizationsQuery.data ?? [];
  const groupNames = groupsById(groups);

  const users = data?.data ?? [];
  const meta = data?.meta;

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
          {tab === 'users' && (
            <button style={btnPrimary} onClick={() => setShowNew(true)}>{t('userList.newUser')}</button>
          )}
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

      {/* Sub-tabs */}
      <div style={tabStrip} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'users'}
          style={tabBtnStyle(tab === 'users')}
          onClick={() => setTab('users')}
        >
          {t('userList.tabs.users')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'archived'}
          style={tabBtnStyle(tab === 'archived')}
          onClick={() => setTab('archived')}
        >
          {t('userList.tabs.archived')}
          {archivedQuery.data?.meta && (
            <span style={tabBadge}>{archivedQuery.data.meta.total}</span>
          )}
        </button>
      </div>

      {tab === 'archived' ? (
        <ArchivedUsersTab
          data={archivedQuery.data}
          isLoading={archivedQuery.isLoading}
          error={archivedQuery.error}
          page={archivedPage}
          pageSize={archivedPageSize}
          onPageChange={setArchivedPage}
          onPageSizeChange={(size) => { setArchivedPageSize(size); setArchivedPage(1); }}
          groupNames={groupNames}
          groups={groups}
        />
      ) : (
      <>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select aria-label={t('userList.filterGroup')} style={filterSelect} value={groupFilter} onChange={handleFilterChange(setGroupFilter)}>
          <option value="">{t('userList.allGroups')}</option>
          {sortGroups(groups).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select aria-label={t('userList.filterStatus')} style={filterSelect} value={statusFilter} onChange={handleFilterChange(setStatusFilter)}>
          <option value="">{t('userList.allStatuses')}</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(groupFilter || statusFilter) && (
          <button style={btnSecondary} onClick={() => { setGroupFilter(''); setStatusFilter(''); setPage(1); }}>
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
                  <th style={th}>{t('userList.table.group')}</th>
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
                    <td style={td}><RoleBadge role={u.role} label={groupLabel(u, groupNames)} /></td>
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
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          style={{ ...btnSecondary, fontSize: '0.78rem', padding: '4px 10px' }}
                          onClick={() => setEditUser(u)}
                        >
                          {t('common.edit')}
                        </button>
                        {/* The backend rejects self-archive (422) — archiving
                            your own account would lock you out instantly, with
                            no admin left to restore it. Disable it client-side
                            too rather than let the confirm dialog's "restore
                            later" promise mislead the acting admin. */}
                        <button
                          style={{
                            ...btnSecondary, fontSize: '0.78rem', padding: '4px 10px',
                            borderColor: '#dc2626', color: '#dc2626',
                            ...(u.id === currentUser?.id ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                          }}
                          onClick={() => setArchiveTarget(u)}
                          disabled={u.id === currentUser?.id}
                          title={u.id === currentUser?.id ? t('userList.archiveSelfDisabledTitle') : undefined}
                        >
                          {t('userList.archiveAction')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination
            page={page}
            totalPages={meta?.totalPages ?? 1}
            total={meta?.total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </>
      )}
      </>
      )}

      {/* Modals */}
      {showNew && (
        <NewUserModal
          onClose={() => setShowNew(false)}
          onCreated={() => setShowNew(false)}
          groups={groups}
          organizations={organizations}
          currentOrgId={currentUser?.organization_id ?? null}
        />
      )}
      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={() => setEditUser(null)}
          groups={groups}
          organizations={organizations}
        />
      )}
      {archiveTarget && (
        <ArchiveUserModal
          targetUser={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onArchived={() => setArchiveTarget(null)}
        />
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
const tabStrip: React.CSSProperties = {
  display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: '1rem',
};
function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: '0.85rem', fontWeight: active ? 700 : 500,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    marginBottom: -1,
  };
}
const tabBadge: React.CSSProperties = {
  marginLeft: 6, background: 'var(--bg-body)', color: 'var(--text-muted)',
  borderRadius: 10, padding: '1px 7px', fontSize: '0.72rem', fontWeight: 700,
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
