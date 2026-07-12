// =============================================================================
// FireISP 5.0 — User Groups (UCRM-style)
// =============================================================================
// Standalone page at /roles. "Roles" ARE the user groups: a group carries a
// `kind` (the built-in persona it's based on — billing/support/technician/
// readonly; only the seeded system groups may carry kind 'admin') plus a
// freeform permission set edited through a UCRM-style matrix:
//   - one row per module that has CRUD (view/create/update/delete) slugs,
//     with a Denied / View / Edit radio choice, or an auto "Custom" state
//     when the current selection doesn't match any preset
//   - a "Special permissions" section listing every non-CRUD slug (export,
//     manage, send, run, scan, execute, ...) as a checkbox, grouped by module
// Saving the matrix is a single bulk PUT /roles/{id}/permissions (REPLACE
// semantics) instead of many per-permission POST/DELETE round-trips.
//
// admin-kind groups ('admin', 'super_admin') pass the legacy RBAC bypass
// (users.role === 'admin') regardless of what's in role_permissions, so the
// backend rejects edits to their permission set (403) — the matrix renders
// read-only with a notice for those groups instead of a form.
//
// All user-facing strings live under the `userGroups.*` i18n namespace
// (en/es/pt-BR). Client-side fallback error text (used only when the backend
// response doesn't include a proper JSON error message) is threaded through
// as an explicit parameter from the calling component instead of being
// hardcoded in the module-level fetch helpers below, since hooks (and
// therefore `t()`) aren't available outside a component.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RoleKind = 'admin' | 'billing' | 'support' | 'technician' | 'readonly';

interface Role {
  id: number;
  name: string;
  description: string | null;
  kind: RoleKind;
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

interface RoleWriteBody {
  name?: string;
  description?: string;
  kind?: RoleKind;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 50;

/** The four personas a *custom* group may be based on — 'admin' is reserved
 * for the built-in system groups (see module docblock). Display labels come
 * from the `userGroups.kind.*` i18n keys (see KindBadge / GroupModal). */
const ASSIGNABLE_KIND_VALUES: RoleKind[] = ['billing', 'support', 'technician', 'readonly'];
const ALL_KIND_VALUES: RoleKind[] = ['admin', 'billing', 'support', 'technician', 'readonly'];

const KIND_COLORS: Record<string, { bg: string; color: string }> = {
  admin: { bg: '#fee2e2', color: '#991b1b' },
  billing: { bg: '#dbeafe', color: '#1e40af' },
  technician: { bg: '#d1fae5', color: '#065f46' },
  support: { bg: '#ede9fe', color: '#5b21b6' },
  readonly: { bg: '#f3f4f6', color: '#374151' },
};

const CRUD_ACTIONS = new Set(['view', 'create', 'update', 'delete']);

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

function apiErrorMessage(res: { error?: unknown }, fallback: string): string {
  const err = res.error as { error?: { message?: string } } | undefined;
  return err?.error?.message ?? fallback;
}

async function fetchRoles(page: number, fallbackMessage: string): Promise<RolesResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/roles', { params: { query: query as never } });
  if (res.error) throw new Error(apiErrorMessage(res, fallbackMessage));
  return res.data as unknown as RolesResponse;
}

async function fetchRoleDetail(id: number, fallbackMessage: string): Promise<RoleDetail> {
  const res = await api.GET('/roles/{id}', { params: { path: { id } } });
  if (res.error) throw new Error(apiErrorMessage(res, fallbackMessage));
  return (res.data as unknown as { data: RoleDetail }).data;
}

async function fetchAllPermissions(fallbackMessage: string): Promise<Permission[]> {
  const res = await api.GET('/roles/permissions');
  if (res.error) throw new Error(apiErrorMessage(res, fallbackMessage));
  return (res.data as unknown as { data: Permission[] }).data;
}

async function createRole(body: RoleWriteBody, fallbackMessage: string): Promise<Role> {
  const res = await api.POST('/roles', { body: body as never });
  if (res.error) throw new Error(apiErrorMessage(res, fallbackMessage));
  return (res.data as unknown as { data: Role }).data;
}

async function updateRole(id: number, body: RoleWriteBody, fallbackMessage: string): Promise<void> {
  const res = await api.PUT('/roles/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error(apiErrorMessage(res, fallbackMessage));
}

async function deleteRole(id: number, fallbackMessage: string): Promise<void> {
  const res = await api.DELETE('/roles/{id}', { params: { path: { id } } });
  if (res.error) throw new Error(apiErrorMessage(res, fallbackMessage));
}

async function setRolePermissions(roleId: number, permissionIds: number[], fallbackMessage: string): Promise<Permission[]> {
  const res = await api.PUT('/roles/{id}/permissions' as never, {
    params: { path: { id: roleId } },
    body: { permission_ids: permissionIds } as never,
  } as never);
  if ((res as { error?: unknown }).error) {
    throw new Error(apiErrorMessage(res as { error?: unknown }, fallbackMessage));
  }
  return ((res as { data?: { data?: Permission[] } }).data?.data ?? []);
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function KindBadge({ kind }: { kind: string }) {
  const { t } = useTranslation();
  const c = KIND_COLORS[kind] ?? { bg: '#f3f4f6', color: '#374151' };
  const label = (ALL_KIND_VALUES as string[]).includes(kind) ? t(`userGroups.kind.${kind}`) : kind;
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
      {label}
    </span>
  );
}

function SystemBadge() {
  const { t } = useTranslation();
  return (
    <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
      🔒 {t('userGroups.table.system')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Group form modal (create + edit)
// ---------------------------------------------------------------------------

interface GroupModalProps {
  role: Role | null;
  groups: Role[];
  onClose: () => void;
  onSaved: () => void;
}

function GroupModal({ role, groups, onClose, onSaved }: GroupModalProps) {
  const { t } = useTranslation();
  const isEdit = role !== null;
  const isSystemEdit = isEdit && !!role.is_system;

  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [kind, setKind] = useState<RoleKind>(
    role && (ASSIGNABLE_KIND_VALUES as string[]).includes(role.kind) ? role.kind : 'billing',
  );
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState('');

  const saveFailedGeneric = t('userGroups.modal.saveFailedGeneric');

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const body: RoleWriteBody = { description: description.trim() };
        if (!isSystemEdit) {
          body.name = name.trim();
          body.kind = kind;
        }
        await updateRole(role.id, body, saveFailedGeneric);
        return;
      }

      const created = await createRole({
        name: name.trim(),
        description: description.trim() || undefined,
        kind,
      }, saveFailedGeneric);

      if (templateId) {
        const template = await fetchRoleDetail(Number(templateId), t('userGroups.permissions.loadError'));
        const ids = template.permissions.map(p => p.id);
        if (ids.length > 0) {
          await setRolePermissions(created.id, ids, saveFailedGeneric);
        }
      }
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : saveFailedGeneric),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isSystemEdit && !name.trim()) {
      setError(t('userGroups.modal.nameRequiredError'));
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
        aria-label={isEdit ? t('userGroups.modal.editAriaLabel', { name: role.name }) : t('userGroups.modal.createAriaLabel')}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>
            {isEdit ? `📝 ${t('userGroups.modal.editTitle', { name: role.name })}` : `🛡️ ${t('userGroups.modal.createTitle')}`}
          </h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label={t('userGroups.modal.close')}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          {isSystemEdit && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {t('userGroups.modal.systemNotice')}
            </p>
          )}

          {isSystemEdit ? (
            <div style={modalStyles.label}>
              {t('userGroups.modal.nameLabel')}
              <span style={{ fontWeight: 400, color: 'var(--text-primary)' }}>{role.name}</span>
            </div>
          ) : (
            <label style={modalStyles.label}>
              {t('userGroups.modal.nameLabel')} <RequiredMark />
              <input
                style={modalStyles.input}
                type="text"
                maxLength={100}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('userGroups.modal.namePlaceholder')}
                required
              />
            </label>
          )}

          {isSystemEdit ? (
            <div style={modalStyles.label}>
              {t('userGroups.modal.basedOnLabel')}
              <span style={{ fontWeight: 400, color: 'var(--text-primary)' }}>
                {(ALL_KIND_VALUES as string[]).includes(role.kind) ? t(`userGroups.kind.${role.kind}`) : role.kind}
              </span>
            </div>
          ) : (
            <label style={modalStyles.label}>
              {t('userGroups.modal.basedOnLabel')} <RequiredMark />
              <select style={modalStyles.select} value={kind} onChange={e => setKind(e.target.value as RoleKind)}>
                {ASSIGNABLE_KIND_VALUES.map(value => (
                  <option key={value} value={value}>{t(`userGroups.kind.${value}`)}</option>
                ))}
              </select>
            </label>
          )}

          <label style={modalStyles.label}>
            {t('userGroups.modal.descriptionLabel')}
            <textarea
              style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' }}
              maxLength={500}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </label>

          {!isEdit && (
            <label style={modalStyles.label}>
              {t('userGroups.modal.startFromLabel')}
              <select style={modalStyles.select} value={templateId} onChange={e => setTemplateId(e.target.value)}>
                <option value="">{t('userGroups.modal.startFromNone')}</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
          )}

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              {t('common.cancel')}
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : isEdit ? t('userGroups.modal.saveChanges') : t('userGroups.modal.createSubmit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UCRM-style permission matrix
// ---------------------------------------------------------------------------

type ModuleState = 'denied' | 'view' | 'edit' | 'custom';

interface ModuleGroup {
  module: string;
  crud: Permission[];
  special: Permission[];
}

/** Action is always the slug segment after the LAST dot (e.g. 'view' in both
 * 'clients.view' and, within the aggregated 'billing' module, 'invoice_settings.view'
 * or 'late_fee_rules.view'). The catalog's `module` column groups many distinct
 * entity slug-prefixes under one module (e.g. module 'billing' holds invoices.*,
 * payments.*, invoice_settings.*, late_fee_rules.*, ...), so action extraction
 * must not assume the slug starts with the module name — it never does for most
 * of those prefixes. */
function actionOf(p: Permission): string {
  const dot = p.slug.lastIndexOf('.');
  return dot === -1 ? p.slug : p.slug.slice(dot + 1);
}

/** All of a module's CRUD ids whose action is exactly 'view' — since a module
 * aggregates several entity prefixes, this is frequently more than one
 * permission id (e.g. billing's invoices.view + payments.view + ...). */
function viewIdsOf(group: ModuleGroup): Set<number> {
  return new Set(group.crud.filter(p => actionOf(p) === 'view').map(p => p.id));
}

function groupCatalog(catalog: Permission[]): ModuleGroup[] {
  const map = new Map<string, ModuleGroup>();
  for (const p of catalog) {
    const moduleName = p.module || 'other';
    let group = map.get(moduleName);
    if (!group) {
      group = { module: moduleName, crud: [], special: [] };
      map.set(moduleName, group);
    }
    if (CRUD_ACTIONS.has(actionOf(p))) group.crud.push(p);
    else group.special.push(p);
  }
  return [...map.values()].sort((a, b) => a.module.localeCompare(b.module));
}

/** Denied = none of the module's CRUD ids (across every entity prefix in the
 * module) are selected. View = the selected CRUD subset equals EXACTLY the
 * module's full "all .view slugs" set — which may span several prefixes
 * (e.g. module 'billing' -> invoices.view + payments.view + invoice_settings.view
 * + ...), not just a single slug. Edit = every CRUD slug of the module (every
 * prefix, every action) is selected. Anything else — including a module with
 * no `.view` slug at all — is Custom. */
function deriveModuleState(group: ModuleGroup, selectedIds: Set<number>): ModuleState {
  const selectedCrud = group.crud.filter(p => selectedIds.has(p.id));
  if (selectedCrud.length === 0) return 'denied';
  const viewIds = viewIdsOf(group);
  const isExactlyAllViews = viewIds.size > 0 &&
    selectedCrud.length === viewIds.size &&
    selectedCrud.every(p => viewIds.has(p.id));
  if (isExactlyAllViews) return 'view';
  if (selectedCrud.length === group.crud.length) return 'edit';
  return 'custom';
}

function moduleLabel(module: string): string {
  return module.replace(/_/g, ' ');
}

interface PermissionMatrixModalProps {
  role: Role;
  onClose: () => void;
}

function PermissionMatrixModal({ role, onClose }: PermissionMatrixModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // admin-kind groups pass the legacy RBAC bypass regardless of what's in
  // role_permissions — the backend rejects PUT /roles/{id}/permissions for
  // them (403), so the matrix is presentational-only here.
  const readOnly = role.kind === 'admin';

  const permissionsLoadError = t('userGroups.permissions.loadError');

  const detailQ = useQuery({
    queryKey: ['roles', role.id, 'detail'],
    queryFn: () => fetchRoleDetail(role.id, permissionsLoadError),
  });
  const catalogQ = useQuery({
    queryKey: ['roles', 'permission-catalog'],
    queryFn: () => fetchAllPermissions(permissionsLoadError),
  });

  const [selectedIds, setSelectedIds] = useState<Set<number> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (detailQ.data && selectedIds === null) {
      setSelectedIds(new Set(detailQ.data.permissions.map(p => p.id)));
    }
  }, [detailQ.data, selectedIds]);

  const catalog = catalogQ.data ?? [];
  const groups = useMemo(() => groupCatalog(catalog), [catalog]);
  const matrixGroups = groups.filter(g => g.crud.length > 0);
  const specialGroups = groups.filter(g => g.special.length > 0);
  const currentIds = selectedIds ?? new Set<number>();

  // Only ever touches `group.crud` ids for the toggled module — special
  // (non-CRUD) checkboxes, and every other module's current CRUD selection
  // (including one left in Custom), are untouched, so the save payload never
  // silently normalizes anything the user didn't explicitly change here.
  function applyModuleState(group: ModuleGroup, newState: 'denied' | 'view' | 'edit') {
    setSelectedIds(prev => {
      const next = new Set(prev ?? []);
      group.crud.forEach(p => next.delete(p.id));
      if (newState === 'view') {
        viewIdsOf(group).forEach(id => next.add(id));
      } else if (newState === 'edit') {
        group.crud.forEach(p => next.add(p.id));
      }
      return next;
    });
  }

  function toggleSpecial(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const saveFailedGeneric = t('userGroups.permissions.saveFailedGeneric');

  const saveMutation = useMutation({
    mutationFn: () => setRolePermissions(role.id, Array.from(currentIds), saveFailedGeneric),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles', role.id, 'detail'] });
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : saveFailedGeneric),
  });

  const loading = detailQ.isLoading || catalogQ.isLoading || selectedIds === null;
  const loadFailed = detailQ.isError || catalogQ.isError;

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 720 }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('userGroups.permissions.ariaLabel', { name: role.name })}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>🔐 {t('userGroups.permissions.title', { name: role.name })}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label={t('userGroups.permissions.close')}>✕</button>
        </div>

        {readOnly && (
          <p style={{
            margin: '0 0 1rem', fontSize: '0.82rem', padding: '0.5rem 0.75rem',
            background: 'var(--badge-bg, #eff6ff)', color: 'var(--text-secondary)',
            border: '1px solid var(--border)', borderRadius: 6,
          }}>
            {t('userGroups.permissions.readOnlyNotice')}
          </p>
        )}

        {error && <p style={modalStyles.error}>{error}</p>}

        <div style={{ maxHeight: 480, overflowY: 'auto', padding: '0.25rem 0' }}>
          {loading ? (
            <p style={styles.msg}>{t('common.loading')}</p>
          ) : loadFailed ? (
            <p style={styles.msgError}>{t('userGroups.permissions.loadError')}</p>
          ) : catalog.length === 0 ? (
            <p style={styles.msg}>{t('userGroups.permissions.empty')}</p>
          ) : (
            <>
              {matrixGroups.length > 0 && (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>{t('userGroups.permissions.columnModule')}</th>
                      <th style={styles.th}>{t('userGroups.permissions.stateDenied')}</th>
                      <th style={styles.th}>{t('userGroups.permissions.stateView')}</th>
                      <th style={styles.th}>{t('userGroups.permissions.stateEdit')}</th>
                      <th style={styles.th}>{t('userGroups.permissions.stateCustom')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrixGroups.map(group => {
                      const state = deriveModuleState(group, currentIds);
                      const radioName = `module-${group.module}`;
                      return (
                        <tr key={group.module} style={styles.tr}>
                          <td style={{ ...styles.td, fontWeight: 600, textTransform: 'capitalize' }}>
                            {moduleLabel(group.module)}
                          </td>
                          <td style={styles.td}>
                            <input
                              type="radio"
                              name={radioName}
                              aria-label={`${group.module} — ${t('userGroups.permissions.stateDenied')}`}
                              checked={state === 'denied'}
                              disabled={readOnly || saveMutation.isPending}
                              onChange={() => applyModuleState(group, 'denied')}
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              type="radio"
                              name={radioName}
                              aria-label={`${group.module} — ${t('userGroups.permissions.stateView')}`}
                              checked={state === 'view'}
                              disabled={readOnly || saveMutation.isPending}
                              onChange={() => applyModuleState(group, 'view')}
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              type="radio"
                              name={radioName}
                              aria-label={`${group.module} — ${t('userGroups.permissions.stateEdit')}`}
                              checked={state === 'edit'}
                              disabled={readOnly || saveMutation.isPending}
                              onChange={() => applyModuleState(group, 'edit')}
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              type="radio"
                              name={radioName}
                              aria-label={`${group.module} — ${t('userGroups.permissions.stateCustom')}`}
                              checked={state === 'custom'}
                              disabled
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {specialGroups.length > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    {t('userGroups.permissions.specialsHeading')}
                  </h3>
                  {specialGroups.map(group => (
                    <div key={group.module} style={{ marginBottom: '0.75rem' }}>
                      <h4 style={{
                        margin: '0.5rem 0 0.25rem', fontSize: '0.78rem', textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                      }}>
                        {moduleLabel(group.module)}
                      </h4>
                      {group.special.map(p => (
                        <label key={p.id} style={modalStyles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={currentIds.has(p.id)}
                            disabled={readOnly || saveMutation.isPending}
                            onChange={() => toggleSpecial(p.id)}
                          />
                          {p.description || p.slug}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={modalStyles.actions}>
          <button type="button" style={styles.btnSecondary} onClick={onClose}>
            {readOnly ? t('userGroups.permissions.close') : t('common.cancel')}
          </button>
          {!readOnly && (
            <button
              type="button"
              style={styles.btnPrimary}
              disabled={saveMutation.isPending || loading}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? t('common.saving') : t('userGroups.permissions.saveChanges')}
            </button>
          )}
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
  const { t } = useTranslation();
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-label={t('userGroups.deleteConfirmAriaLabel')}
      >
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>{t('userGroups.deleteConfirmNo')}</button>
          <button onClick={onConfirm} style={styles.btnDanger}>{t('userGroups.deleteConfirmYes')}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoleList component (User groups)
// ---------------------------------------------------------------------------

export function RoleList() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [permRole, setPermRole] = useState<Role | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const rolesQ = useQuery({
    queryKey: ['roles', page],
    queryFn: () => fetchRoles(page, t('userGroups.loadError')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRole(id, t('userGroups.deleteFailedGeneric')),
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
        <h1 style={styles.pageTitle}>👥 {t('userGroups.pageTitle')}</h1>
        {meta && <span style={styles.countBadge}>{t('userGroups.totalBadge', { count: meta.total })}</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          {t('userGroups.newGroup')}
        </button>
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {deleteMutation.error instanceof Error ? deleteMutation.error.message : t('userGroups.deleteFailedGeneric')}
        </p>
      )}

      <div style={styles.tableCard}>
        {rolesQ.isLoading ? (
          <p style={styles.msg}>{t('common.loading')}</p>
        ) : rolesQ.error ? (
          <p style={styles.msgError}>{t('userGroups.loadError')}</p>
        ) : roles.length === 0 ? (
          <p style={styles.msg}>{t('userGroups.empty')}</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[
                      t('common.id'),
                      t('userGroups.table.name'),
                      t('userGroups.table.kind'),
                      t('userGroups.table.description'),
                      t('userGroups.table.system'),
                      t('userGroups.table.actions'),
                    ].map(h => <th key={h} style={styles.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {roles.map(r => (
                    <tr key={r.id} style={styles.tr}>
                      <td style={styles.td}>#{r.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{r.name}</td>
                      <td style={styles.td}><KindBadge kind={r.kind} /></td>
                      <td style={styles.td}>{r.description ?? '—'}</td>
                      <td style={styles.td}>{r.is_system ? <SystemBadge /> : '—'}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditRole(r)} title={t('userGroups.action.editTitle')}>
                          ✏️ {t('common.edit')}
                        </button>
                        <button style={styles.actionBtn} onClick={() => setPermRole(r)} title={t('userGroups.action.permissionsTitle')}>
                          🔐 {t('userGroups.action.permissions')}
                        </button>
                        {!r.is_system && (
                          <button
                            style={{ ...styles.actionBtn, color: '#991b1b' }}
                            onClick={() => setDeleteId(r.id)}
                            title={t('userGroups.action.deleteTitle')}
                          >
                            🗑 {t('common.delete')}
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
                  {t('pagination.prevPage')}
                </button>
                <span style={styles.pageInfo}>{t('pagination.pageInfo', { page, total: meta.totalPages })}</span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                  disabled={page === meta.totalPages}
                >
                  {t('pagination.nextPage')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showNew && (
        <GroupModal role={null} groups={roles} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}
      {editRole && (
        <GroupModal role={editRole} groups={roles} onClose={() => setEditRole(null)} onSaved={invalidate} />
      )}
      {permRole && (
        <PermissionMatrixModal role={permRole} onClose={() => setPermRole(null)} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message={t('userGroups.deleteConfirm')}
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
