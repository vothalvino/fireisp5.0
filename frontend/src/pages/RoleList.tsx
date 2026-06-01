// =============================================================================
// FireISP 5.0 — Roles & Permissions Management
// =============================================================================
// Standalone page at /roles. Lists RBAC roles with a "New Role" create modal,
// per-row Edit and Delete (soft-delete, blocked for system roles), and a
// "Permissions" editor that assigns/removes individual permissions. All
// mutations go through the typed `api` client + React Query, invalidating the
// ['roles'] query so the list refreshes automatically.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Role {
  id: number;
  name: string;
  description: string | null;
  is_system: number | boolean;
}

interface RolesResponse {
  data: Role[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Permission {
  id: number;
  slug: string;
  description: string | null;
  module?: string | null;
}

interface RoleDetail extends Role {
  permissions: Permission[];
}

interface RoleBody {
  name: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchRoles(page: number): Promise<RolesResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/roles', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load roles');
  return res.data as unknown as RolesResponse;
}

async function fetchRoleDetail(id: number): Promise<RoleDetail> {
  const res = await api.GET('/roles/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to load role');
  return (res.data as unknown as { data: RoleDetail }).data;
}

async function fetchAllPermissions(): Promise<Permission[]> {
  const res = await api.GET('/roles/permissions');
  if (res.error) throw new Error('Failed to load permissions');
  return (res.data as unknown as { data: Permission[] }).data;
}

async function createRole(body: RoleBody): Promise<void> {
  const res = await api.POST('/roles', { body: body as never });
  if (res.error) throw new Error('Failed to create role');
}

async function updateRole(id: number, body: RoleBody): Promise<void> {
  const res = await api.PUT('/roles/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update role');
}

async function deleteRole(id: number): Promise<void> {
  const res = await api.DELETE('/roles/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete role');
}

async function assignPermission(roleId: number, permissionId: number): Promise<void> {
  const res = await api.POST('/roles/{id}/permissions', {
    params: { path: { id: roleId } },
    body: { permission_id: permissionId } as never,
  });
  if (res.error) throw new Error('Failed to assign permission');
}

async function removePermission(roleId: number, permissionId: number): Promise<void> {
  const res = await api.DELETE('/roles/{id}/permissions/{permissionId}', {
    params: { path: { id: roleId, permissionId } },
  });
  if (res.error) throw new Error('Failed to remove permission');
}

// ---------------------------------------------------------------------------
// Role form modal (create + edit)
// ---------------------------------------------------------------------------

interface RoleModalProps {
  role: Role | null;
  onClose: () => void;
  onSaved: () => void;
}

function RoleModal({ role, onClose, onSaved }: RoleModalProps) {
  const isEdit = role !== null;
  const [form, setForm] = useState({
    name: role?.name ?? '',
    description: role?.description ?? '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const body: RoleBody = { name: form.name.trim() };
      if (form.description) body.description = form.description.trim();
      return isEdit ? updateRole(role.id, body) : createRole(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save role. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit role ${role.name}` : 'New role'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Role #${role.id}` : '🛡️ New Role'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={100}
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder='e.g. "Support Agent"'
              required
            />
          </label>

          <label style={modalStyles.label}>
            Description
            <textarea
              style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' }}
              maxLength={500}
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
            />
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permission editor modal
// ---------------------------------------------------------------------------

interface PermissionModalProps {
  role: Role;
  onClose: () => void;
}

function PermissionModal({ role, onClose }: PermissionModalProps) {
  const queryClient = useQueryClient();

  const detailQ = useQuery({
    queryKey: ['roles', role.id, 'detail'],
    queryFn: () => fetchRoleDetail(role.id),
  });

  const catalogQ = useQuery({
    queryKey: ['roles', 'permission-catalog'],
    queryFn: fetchAllPermissions,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ permissionId, assigned }: { permissionId: number; assigned: boolean }) =>
      assigned ? removePermission(role.id, permissionId) : assignPermission(role.id, permissionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles', role.id, 'detail'] });
    },
  });

  const assignedIds = new Set((detailQ.data?.permissions ?? []).map(p => p.id));
  const catalog = catalogQ.data ?? [];

  // Group catalog by module for readability.
  const grouped = catalog.reduce<Record<string, Permission[]>>((acc, p) => {
    const key = p.module || 'other';
    (acc[key] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 560 }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Permissions for ${role.name}`}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>🔐 Permissions — {role.name}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {toggleMutation.isError && (
          <p style={modalStyles.error}>Failed to update permission. Please try again.</p>
        )}

        <div style={{ maxHeight: 420, overflowY: 'auto', padding: '0.25rem 0' }}>
          {detailQ.isLoading || catalogQ.isLoading ? (
            <p style={styles.msg}>Loading…</p>
          ) : detailQ.error || catalogQ.error ? (
            <p style={styles.msgError}>Failed to load permissions.</p>
          ) : catalog.length === 0 ? (
            <p style={styles.msg}>No permissions are defined.</p>
          ) : (
            Object.keys(grouped).sort().map(module => (
              <div key={module} style={{ marginBottom: '0.75rem' }}>
                <h3 style={{ margin: '0.5rem 0 0.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  {module}
                </h3>
                {grouped[module].map(p => {
                  const assigned = assignedIds.has(p.id);
                  return (
                    <label
                      key={p.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.2rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}
                    >
                      <input
                        type="checkbox"
                        checked={assigned}
                        disabled={toggleMutation.isPending}
                        onChange={() => toggleMutation.mutate({ permissionId: p.id, assigned })}
                      />
                      <span style={{ fontFamily: 'monospace' }}>{p.slug}</span>
                      {p.description && <span style={{ color: 'var(--text-muted)' }}>— {p.description}</span>}
                    </label>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div style={modalStyles.actions}>
          <button type="button" style={styles.btnPrimary} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-label="Confirm action"
      >
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>No, go back</button>
          <button onClick={onConfirm} style={styles.btnDanger}>Yes, confirm</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoleList component
// ---------------------------------------------------------------------------

export function RoleList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [permRole, setPermRole] = useState<Role | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const rolesQ = useQuery({
    queryKey: ['roles', page],
    queryFn: () => fetchRoles(page),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRole(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['roles'] });
  }

  const roles = rolesQ.data?.data ?? [];
  const meta = rolesQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🛡️ Roles & Permissions</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Role
        </button>
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Action failed. System roles cannot be deleted.
        </p>
      )}

      <div style={styles.tableCard}>
        {rolesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : rolesQ.error ? (
          <p style={styles.msgError}>Failed to load roles.</p>
        ) : roles.length === 0 ? (
          <p style={styles.msg}>No roles found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Description', 'System', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {roles.map(r => (
                    <tr key={r.id} style={styles.tr}>
                      <td style={styles.td}>#{r.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{r.name}</td>
                      <td style={styles.td}>{r.description ?? '—'}</td>
                      <td style={styles.td}>{r.is_system ? '🔒 Yes' : 'No'}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditRole(r)} title="Edit this role">
                          ✏️ Edit
                        </button>
                        <button style={styles.actionBtn} onClick={() => setPermRole(r)} title="Manage permissions">
                          🔐 Permissions
                        </button>
                        {!r.is_system && (
                          <button
                            style={{ ...styles.actionBtn, color: '#991b1b' }}
                            onClick={() => setDeleteId(r.id)}
                            title="Delete this role"
                          >
                            🗑 Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Prev
                </button>
                <span style={styles.pageInfo}>Page {page} of {meta.totalPages}</span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                  disabled={page === meta.totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showNew && (
        <RoleModal role={null} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}
      {editRole && (
        <RoleModal role={editRole} onClose={() => setEditRole(null)} onSaved={invalidate} />
      )}
      {permRole && (
        <PermissionModal role={permRole} onClose={() => setPermRole(null)} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this role? It will be soft-deleted and removed from the list."
          onConfirm={() => {
            deleteMutation.mutate(deleteId);
            setDeleteId(null);
          }}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
