// =============================================================================
// FireISP 5.0 — QoS & Bandwidth Management (§10)
// =============================================================================
// Tabbed page covering:
//   1. Quality Classes      — quality_classes CRUD
//   2. Queue Tree Nodes     — queue_tree_nodes CRUD + export
//   3. Rate Limit Templates — rate_limit_templates CRUD + rate_string preview
//   4. Shaping Rules        — protocol_shaping_rules CRUD + export
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QualityClass {
  id: number;
  name: string;
  description: string | null;
  traffic_type: string;
  priority: number;
  dscp_mark: string | null;
  mikrotik_queue_kind: string;
  max_limit_pct: number | null;
  status: string;
}

interface QualityClassBody {
  name: string;
  description?: string;
  traffic_type?: string;
  priority?: number;
  dscp_mark?: string;
  mikrotik_queue_kind?: string;
  max_limit_pct?: number;
  status?: string;
}

interface QueueTreeNode {
  id: number;
  parent_id: number | null;
  name: string;
  queue_type: string;
  interface: string | null;
  max_limit_mbps: number | null;
  burst_limit_mbps: number | null;
  burst_threshold_mbps: number | null;
  burst_time_seconds: number | null;
  priority: number;
  queue_kind: string;
  sort_order: number;
  status: string;
}

interface QueueTreeNodeBody {
  parent_id?: number;
  name: string;
  queue_type?: string;
  interface?: string;
  max_limit_mbps?: number;
  burst_limit_mbps?: number;
  burst_threshold_mbps?: number;
  burst_time_seconds?: number;
  priority?: number;
  queue_kind?: string;
  sort_order?: number;
  status?: string;
}

interface RateLimitTemplate {
  id: number;
  name: string;
  service_type: string;
  radius_vendor: string;
  download_mbps: number;
  upload_mbps: number;
  burst_download_mbps: number | null;
  burst_upload_mbps: number | null;
  burst_threshold_mbps: number | null;
  burst_time_seconds: number | null;
  rate_string: string | null;
  status: string;
}

interface RateLimitTemplateBody {
  name: string;
  service_type?: string;
  radius_vendor?: string;
  download_mbps: number;
  upload_mbps: number;
  burst_download_mbps?: number;
  burst_upload_mbps?: number;
  burst_threshold_mbps?: number;
  burst_time_seconds?: number;
  status?: string;
}

interface ProtocolShapingRule {
  id: number;
  name: string;
  protocol: string;
  direction: string;
  dst_port_range: string | null;
  src_port_range: string | null;
  l7_pattern: string | null;
  action: string;
  limit_download_mbps: number | null;
  limit_upload_mbps: number | null;
  dscp_mark: string | null;
  priority: number;
  enabled: number;
  preset: string | null;
  notes: string | null;
}

interface ProtocolShapingRuleBody {
  name: string;
  protocol?: string;
  direction?: string;
  dst_port_range?: string;
  src_port_range?: string;
  l7_pattern?: string;
  action?: string;
  limit_download_mbps?: number;
  limit_upload_mbps?: number;
  dscp_mark?: string;
  priority?: number;
  enabled?: number;
  notes?: string;
}

interface ListResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const TRAFFIC_TYPES = ['voip', 'video', 'web', 'download', 'other'];
const QUEUE_KINDS_QC = ['pcq', 'sfq', 'fifo', 'red', 'sfb'];
const QUEUE_TYPES = ['tree', 'simple'];
const QUEUE_KINDS = ['pcq', 'sfq', 'fifo', 'red', 'sfb'];
const SERVICE_TYPES = ['pppoe', 'dhcp', 'hotspot', 'static', 'other'];
const RADIUS_VENDORS = ['mikrotik', 'cisco', 'juniper', 'generic'];
const PROTOCOLS = ['tcp', 'udp', 'icmp', 'any'];
const DIRECTIONS = ['download', 'upload', 'both'];
const ACTIONS = ['limit', 'drop', 'mark', 'throttle'];
const STATUSES = ['active', 'inactive'];

// ---------------------------------------------------------------------------
// API helpers — Quality Classes
// ---------------------------------------------------------------------------

async function fetchQualityClasses(page: number): Promise<ListResponse<QualityClass>> {
  const res = await api.GET('/quality-classes' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load quality classes');
  return (res as { data: unknown }).data as unknown as ListResponse<QualityClass>;
}

async function createQualityClass(body: QualityClassBody): Promise<void> {
  const res = await api.POST('/quality-classes' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create quality class');
}

async function updateQualityClass(id: number, body: Partial<QualityClassBody>): Promise<void> {
  const res = await api.PATCH('/quality-classes/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update quality class');
}

async function deleteQualityClass(id: number): Promise<void> {
  const res = await api.DELETE('/quality-classes/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete quality class');
}

// ---------------------------------------------------------------------------
// API helpers — Queue Tree Nodes
// ---------------------------------------------------------------------------

async function fetchQueueTreeNodes(page: number): Promise<ListResponse<QueueTreeNode>> {
  const res = await api.GET('/queue-tree-nodes' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load queue tree nodes');
  return (res as { data: unknown }).data as unknown as ListResponse<QueueTreeNode>;
}

async function createQueueTreeNode(body: QueueTreeNodeBody): Promise<void> {
  const res = await api.POST('/queue-tree-nodes' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create queue tree node');
}

async function updateQueueTreeNode(id: number, body: Partial<QueueTreeNodeBody>): Promise<void> {
  const res = await api.PATCH('/queue-tree-nodes/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update queue tree node');
}

async function deleteQueueTreeNode(id: number): Promise<void> {
  const res = await api.DELETE('/queue-tree-nodes/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete queue tree node');
}

async function exportQueueTreeConfig(): Promise<{ script: string; node_count: number }> {
  const res = await api.GET('/queue-tree-nodes/export/config' as never, {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to export queue tree config');
  return (res as { data: unknown }).data as unknown as { script: string; node_count: number };
}

// ---------------------------------------------------------------------------
// API helpers — Rate Limit Templates
// ---------------------------------------------------------------------------

async function fetchRateLimitTemplates(page: number): Promise<ListResponse<RateLimitTemplate>> {
  const res = await api.GET('/rate-limit-templates' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load rate limit templates');
  return (res as { data: unknown }).data as unknown as ListResponse<RateLimitTemplate>;
}

async function createRateLimitTemplate(body: RateLimitTemplateBody): Promise<void> {
  const res = await api.POST('/rate-limit-templates' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create rate limit template');
}

async function updateRateLimitTemplate(id: number, body: Partial<RateLimitTemplateBody>): Promise<void> {
  const res = await api.PATCH('/rate-limit-templates/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update rate limit template');
}

async function deleteRateLimitTemplate(id: number): Promise<void> {
  const res = await api.DELETE('/rate-limit-templates/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete rate limit template');
}

async function previewRateString(body: Partial<RateLimitTemplateBody>): Promise<string> {
  const res = await api.POST('/rate-limit-templates/preview' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to preview rate string');
  return ((res as { data: unknown }).data as { rate_string: string }).rate_string;
}

// ---------------------------------------------------------------------------
// API helpers — Protocol Shaping Rules
// ---------------------------------------------------------------------------

async function fetchProtocolShapingRules(page: number): Promise<ListResponse<ProtocolShapingRule>> {
  const res = await api.GET('/protocol-shaping-rules' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load protocol shaping rules');
  return (res as { data: unknown }).data as unknown as ListResponse<ProtocolShapingRule>;
}

async function createProtocolShapingRule(body: ProtocolShapingRuleBody): Promise<void> {
  const res = await api.POST('/protocol-shaping-rules' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create protocol shaping rule');
}

async function updateProtocolShapingRule(id: number, body: Partial<ProtocolShapingRuleBody>): Promise<void> {
  const res = await api.PATCH('/protocol-shaping-rules/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update protocol shaping rule');
}

async function deleteProtocolShapingRule(id: number): Promise<void> {
  const res = await api.DELETE('/protocol-shaping-rules/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete protocol shaping rule');
}

async function exportShapingRulesConfig(): Promise<{ script: string; rule_count: number }> {
  const res = await api.GET('/protocol-shaping-rules/export/config' as never, {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to export shaping rules config');
  return (res as { data: unknown }).data as unknown as { script: string; rule_count: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '0.4rem 1rem',
  border: 'none',
  borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
  background: 'transparent',
  cursor: 'pointer',
  fontWeight: active ? 700 : 400,
  color: active ? 'var(--primary)' : 'var(--text-secondary)',
});

function priorityColor(p: number): string {
  if (p <= 2) return '#dc2626';
  if (p <= 4) return '#d97706';
  if (p <= 6) return '#2563eb';
  return '#6b7280';
}

function downloadScript(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function QosBandwidthPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  type Tab = 'qualityClasses' | 'queueTree' | 'rateLimitTemplates' | 'shapingRules';
  const [tab, setTab] = useState<Tab>('qualityClasses');

  // ============================== QUALITY CLASSES ==============================

  const [qcPage, setQcPage] = useState(1);
  const qcQ = useQuery({
    queryKey: ['qos', 'qualityClasses', qcPage],
    queryFn: () => fetchQualityClasses(qcPage),
    enabled: tab === 'qualityClasses',
  });
  const [showQcModal, setShowQcModal] = useState(false);
  const [editingQc, setEditingQc] = useState<QualityClass | null>(null);
  const [qcForm, setQcForm] = useState<Partial<QualityClassBody>>({});
  const [qcErr, setQcErr] = useState('');

  function openQcModal(item?: QualityClass) {
    setEditingQc(item ?? null);
    setQcForm(item
      ? {
          name: item.name,
          description: item.description ?? '',
          traffic_type: item.traffic_type,
          priority: item.priority,
          dscp_mark: item.dscp_mark ?? '',
          mikrotik_queue_kind: item.mikrotik_queue_kind,
          max_limit_pct: item.max_limit_pct ?? undefined,
          status: item.status,
        }
      : { traffic_type: 'web', mikrotik_queue_kind: 'sfq', priority: 4, status: 'active' });
    setQcErr('');
    setShowQcModal(true);
  }

  const saveQcMut = useMutation({
    mutationFn: () => editingQc
      ? updateQualityClass(editingQc.id, qcForm)
      : createQualityClass(qcForm as QualityClassBody),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qos', 'qualityClasses'] }); setShowQcModal(false); },
    onError: (e: unknown) => setQcErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteQcMut = useMutation({
    mutationFn: deleteQualityClass,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qos', 'qualityClasses'] }),
  });

  const qcTotalPages = Math.ceil((qcQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== QUEUE TREE NODES ==============================

  const [qtPage, setQtPage] = useState(1);
  const qtQ = useQuery({
    queryKey: ['qos', 'queueTree', qtPage],
    queryFn: () => fetchQueueTreeNodes(qtPage),
    enabled: tab === 'queueTree',
  });
  const [showQtModal, setShowQtModal] = useState(false);
  const [editingQt, setEditingQt] = useState<QueueTreeNode | null>(null);
  const [qtForm, setQtForm] = useState<Partial<QueueTreeNodeBody>>({});
  const [qtErr, setQtErr] = useState('');
  const [exportingQt, setExportingQt] = useState(false);

  function openQtModal(item?: QueueTreeNode) {
    setEditingQt(item ?? null);
    setQtForm(item
      ? {
          name: item.name,
          parent_id: item.parent_id ?? undefined,
          queue_type: item.queue_type,
          interface: item.interface ?? '',
          max_limit_mbps: item.max_limit_mbps ?? undefined,
          burst_limit_mbps: item.burst_limit_mbps ?? undefined,
          burst_threshold_mbps: item.burst_threshold_mbps ?? undefined,
          burst_time_seconds: item.burst_time_seconds ?? undefined,
          priority: item.priority,
          queue_kind: item.queue_kind,
          sort_order: item.sort_order,
          status: item.status,
        }
      : { queue_type: 'tree', priority: 8, queue_kind: 'sfq', sort_order: 0, status: 'active' });
    setQtErr('');
    setShowQtModal(true);
  }

  const saveQtMut = useMutation({
    mutationFn: () => editingQt
      ? updateQueueTreeNode(editingQt.id, qtForm)
      : createQueueTreeNode(qtForm as QueueTreeNodeBody),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qos', 'queueTree'] }); setShowQtModal(false); },
    onError: (e: unknown) => setQtErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteQtMut = useMutation({
    mutationFn: deleteQueueTreeNode,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qos', 'queueTree'] }),
  });

  async function handleExportQueueTree() {
    setExportingQt(true);
    try {
      const result = await exportQueueTreeConfig();
      downloadScript('queue-tree.rsc', result.script);
    } finally {
      setExportingQt(false);
    }
  }

  const qtTotalPages = Math.ceil((qtQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== RATE LIMIT TEMPLATES ==============================

  const [rltPage, setRltPage] = useState(1);
  const rltQ = useQuery({
    queryKey: ['qos', 'rateLimitTemplates', rltPage],
    queryFn: () => fetchRateLimitTemplates(rltPage),
    enabled: tab === 'rateLimitTemplates',
  });
  const [showRltModal, setShowRltModal] = useState(false);
  const [editingRlt, setEditingRlt] = useState<RateLimitTemplate | null>(null);
  const [rltForm, setRltForm] = useState<Partial<RateLimitTemplateBody>>({});
  const [rltErr, setRltErr] = useState('');
  const [previewStr, setPreviewStr] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  function openRltModal(item?: RateLimitTemplate) {
    setEditingRlt(item ?? null);
    setRltForm(item
      ? {
          name: item.name,
          service_type: item.service_type,
          radius_vendor: item.radius_vendor,
          download_mbps: item.download_mbps,
          upload_mbps: item.upload_mbps,
          burst_download_mbps: item.burst_download_mbps ?? undefined,
          burst_upload_mbps: item.burst_upload_mbps ?? undefined,
          burst_threshold_mbps: item.burst_threshold_mbps ?? undefined,
          burst_time_seconds: item.burst_time_seconds ?? undefined,
          status: item.status,
        }
      : { service_type: 'pppoe', radius_vendor: 'mikrotik', download_mbps: 10, upload_mbps: 2, status: 'active' });
    setPreviewStr('');
    setRltErr('');
    setShowRltModal(true);
  }

  const saveRltMut = useMutation({
    mutationFn: () => editingRlt
      ? updateRateLimitTemplate(editingRlt.id, rltForm)
      : createRateLimitTemplate(rltForm as RateLimitTemplateBody),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qos', 'rateLimitTemplates'] }); setShowRltModal(false); },
    onError: (e: unknown) => setRltErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteRltMut = useMutation({
    mutationFn: deleteRateLimitTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qos', 'rateLimitTemplates'] }),
  });

  async function handlePreview() {
    setPreviewLoading(true);
    try {
      const s = await previewRateString(rltForm);
      setPreviewStr(s);
    } catch {
      setPreviewStr('—');
    } finally {
      setPreviewLoading(false);
    }
  }

  const rltTotalPages = Math.ceil((rltQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== PROTOCOL SHAPING RULES ==============================

  const [psrPage, setPsrPage] = useState(1);
  const psrQ = useQuery({
    queryKey: ['qos', 'shapingRules', psrPage],
    queryFn: () => fetchProtocolShapingRules(psrPage),
    enabled: tab === 'shapingRules',
  });
  const [showPsrModal, setShowPsrModal] = useState(false);
  const [editingPsr, setEditingPsr] = useState<ProtocolShapingRule | null>(null);
  const [psrForm, setPsrForm] = useState<Partial<ProtocolShapingRuleBody>>({});
  const [psrErr, setPsrErr] = useState('');
  const [exportingPsr, setExportingPsr] = useState(false);

  function openPsrModal(item?: ProtocolShapingRule) {
    setEditingPsr(item ?? null);
    setPsrForm(item
      ? {
          name: item.name,
          protocol: item.protocol,
          direction: item.direction,
          dst_port_range: item.dst_port_range ?? '',
          src_port_range: item.src_port_range ?? '',
          l7_pattern: item.l7_pattern ?? '',
          action: item.action,
          limit_download_mbps: item.limit_download_mbps ?? undefined,
          limit_upload_mbps: item.limit_upload_mbps ?? undefined,
          dscp_mark: item.dscp_mark ?? '',
          priority: item.priority,
          enabled: item.enabled,
          notes: item.notes ?? '',
        }
      : { protocol: 'tcp', direction: 'both', action: 'limit', priority: 8, enabled: 0 });
    setPsrErr('');
    setShowPsrModal(true);
  }

  const savePsrMut = useMutation({
    mutationFn: () => editingPsr
      ? updateProtocolShapingRule(editingPsr.id, psrForm)
      : createProtocolShapingRule(psrForm as ProtocolShapingRuleBody),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qos', 'shapingRules'] }); setShowPsrModal(false); },
    onError: (e: unknown) => setPsrErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deletePsrMut = useMutation({
    mutationFn: deleteProtocolShapingRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qos', 'shapingRules'] }),
  });

  async function handleExportShapingRules() {
    setExportingPsr(true);
    try {
      const result = await exportShapingRulesConfig();
      downloadScript('shaping-rules.rsc', result.script);
    } finally {
      setExportingPsr(false);
    }
  }

  const psrTotalPages = Math.ceil((psrQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.page}>
      {/* Page header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>{t('qosBandwidth.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            {t('qosBandwidth.subtitle')}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', display: 'flex', gap: '0.25rem' }}>
        {(['qualityClasses', 'queueTree', 'rateLimitTemplates', 'shapingRules'] as const).map(t2 => (
          <button key={t2} style={tabBtn(tab === t2)} onClick={() => setTab(t2)}>
            {t(`qosBandwidth.tabs.${t2}`)}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* TAB: Quality Classes */}
      {/* ================================================================ */}
      {tab === 'qualityClasses' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => openQcModal()}>
              + {t('qosBandwidth.qualityClasses.new')}
            </button>
          </div>
          {qcQ.isLoading && <p style={styles.msg}>{t('qosBandwidth.loading')}</p>}
          {qcQ.isError && <p style={styles.msgError}>{t('qosBandwidth.qualityClasses.loadError')}</p>}
          {qcQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('qosBandwidth.qualityClasses.name')}</th>
                      <th style={styles.th}>{t('qosBandwidth.qualityClasses.trafficType')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.qualityClasses.priority')}</th>
                      <th style={styles.th}>{t('qosBandwidth.qualityClasses.dscpMark')}</th>
                      <th style={styles.th}>{t('qosBandwidth.qualityClasses.queueKind')}</th>
                      <th style={styles.th}>{t('qosBandwidth.qualityClasses.status')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {qcQ.data.data.length === 0 && (
                      <tr><td colSpan={8} style={styles.msg}>{t('qosBandwidth.qualityClasses.noItems')}</td></tr>
                    )}
                    {qcQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.td}>{item.traffic_type}</td>
                        <td style={styles.tdNum}>
                          <span style={{ color: priorityColor(item.priority), fontWeight: 700 }}>{item.priority}</span>
                        </td>
                        <td style={styles.tdMono}>{item.dscp_mark ?? '—'}</td>
                        <td style={styles.td}>{item.mikrotik_queue_kind}</td>
                        <td style={styles.td}>
                          <span style={{ color: item.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {item.status}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openQcModal(item)}>
                            {t('qosBandwidth.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('qosBandwidth.confirmDelete'))) {
                                deleteQcMut.mutate(item.id);
                              }
                            }}
                          >
                            {t('qosBandwidth.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setQcPage(p => Math.max(1, p - 1))} disabled={qcPage <= 1}>
                  &laquo; {t('qosBandwidth.prev')}
                </button>
                <span style={styles.pageInfo}>{qcPage} / {qcTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setQcPage(p => p + 1)} disabled={qcPage >= qcTotalPages}>
                  {t('qosBandwidth.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Queue Tree Nodes */}
      {/* ================================================================ */}
      {tab === 'queueTree' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              style={styles.btnSecondary}
              onClick={handleExportQueueTree}
              disabled={exportingQt}
            >
              {exportingQt ? t('qosBandwidth.exporting') : t('qosBandwidth.queueTree.export')}
            </button>
            <button style={styles.btnPrimary} onClick={() => openQtModal()}>
              + {t('qosBandwidth.queueTree.new')}
            </button>
          </div>
          {qtQ.isLoading && <p style={styles.msg}>{t('qosBandwidth.loading')}</p>}
          {qtQ.isError && <p style={styles.msgError}>{t('qosBandwidth.queueTree.loadError')}</p>}
          {qtQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('qosBandwidth.queueTree.name')}</th>
                      <th style={styles.th}>{t('qosBandwidth.queueTree.type')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.queueTree.maxLimit')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.queueTree.burstLimit')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.queueTree.priority')}</th>
                      <th style={styles.th}>{t('qosBandwidth.queueTree.queueKind')}</th>
                      <th style={styles.th}>{t('qosBandwidth.queueTree.status')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {qtQ.data.data.length === 0 && (
                      <tr><td colSpan={9} style={styles.msg}>{t('qosBandwidth.queueTree.noItems')}</td></tr>
                    )}
                    {qtQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.td}>{item.queue_type}</td>
                        <td style={styles.tdNum}>{item.max_limit_mbps !== null ? `${item.max_limit_mbps}M` : '—'}</td>
                        <td style={styles.tdNum}>{item.burst_limit_mbps !== null ? `${item.burst_limit_mbps}M` : '—'}</td>
                        <td style={styles.tdNum}>
                          <span style={{ color: priorityColor(item.priority), fontWeight: 700 }}>{item.priority}</span>
                        </td>
                        <td style={styles.td}>{item.queue_kind}</td>
                        <td style={styles.td}>
                          <span style={{ color: item.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {item.status}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openQtModal(item)}>
                            {t('qosBandwidth.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('qosBandwidth.confirmDelete'))) {
                                deleteQtMut.mutate(item.id);
                              }
                            }}
                          >
                            {t('qosBandwidth.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setQtPage(p => Math.max(1, p - 1))} disabled={qtPage <= 1}>
                  &laquo; {t('qosBandwidth.prev')}
                </button>
                <span style={styles.pageInfo}>{qtPage} / {qtTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setQtPage(p => p + 1)} disabled={qtPage >= qtTotalPages}>
                  {t('qosBandwidth.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Rate Limit Templates */}
      {/* ================================================================ */}
      {tab === 'rateLimitTemplates' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => openRltModal()}>
              + {t('qosBandwidth.rateLimitTemplates.new')}
            </button>
          </div>
          {rltQ.isLoading && <p style={styles.msg}>{t('qosBandwidth.loading')}</p>}
          {rltQ.isError && <p style={styles.msgError}>{t('qosBandwidth.rateLimitTemplates.loadError')}</p>}
          {rltQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('qosBandwidth.rateLimitTemplates.name')}</th>
                      <th style={styles.th}>{t('qosBandwidth.rateLimitTemplates.serviceType')}</th>
                      <th style={styles.th}>{t('qosBandwidth.rateLimitTemplates.vendor')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.rateLimitTemplates.downloadMbps')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.rateLimitTemplates.uploadMbps')}</th>
                      <th style={styles.th}>{t('qosBandwidth.rateLimitTemplates.rateString')}</th>
                      <th style={styles.th}>{t('qosBandwidth.rateLimitTemplates.status')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rltQ.data.data.length === 0 && (
                      <tr><td colSpan={9} style={styles.msg}>{t('qosBandwidth.rateLimitTemplates.noItems')}</td></tr>
                    )}
                    {rltQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.td}>{item.service_type}</td>
                        <td style={styles.td}>{item.radius_vendor}</td>
                        <td style={styles.tdNum}>{item.download_mbps}</td>
                        <td style={styles.tdNum}>{item.upload_mbps}</td>
                        <td style={styles.tdMono} title={item.rate_string ?? ''}>
                          {item.rate_string ? (
                            <span style={{ fontSize: '0.75rem' }}>{item.rate_string}</span>
                          ) : '—'}
                        </td>
                        <td style={styles.td}>
                          <span style={{ color: item.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {item.status}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openRltModal(item)}>
                            {t('qosBandwidth.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('qosBandwidth.confirmDelete'))) {
                                deleteRltMut.mutate(item.id);
                              }
                            }}
                          >
                            {t('qosBandwidth.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setRltPage(p => Math.max(1, p - 1))} disabled={rltPage <= 1}>
                  &laquo; {t('qosBandwidth.prev')}
                </button>
                <span style={styles.pageInfo}>{rltPage} / {rltTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setRltPage(p => p + 1)} disabled={rltPage >= rltTotalPages}>
                  {t('qosBandwidth.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Protocol Shaping Rules */}
      {/* ================================================================ */}
      {tab === 'shapingRules' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              style={styles.btnSecondary}
              onClick={handleExportShapingRules}
              disabled={exportingPsr}
            >
              {exportingPsr ? t('qosBandwidth.exporting') : t('qosBandwidth.shapingRules.export')}
            </button>
            <button style={styles.btnPrimary} onClick={() => openPsrModal()}>
              + {t('qosBandwidth.shapingRules.new')}
            </button>
          </div>
          {psrQ.isLoading && <p style={styles.msg}>{t('qosBandwidth.loading')}</p>}
          {psrQ.isError && <p style={styles.msgError}>{t('qosBandwidth.shapingRules.loadError')}</p>}
          {psrQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('qosBandwidth.shapingRules.name')}</th>
                      <th style={styles.th}>{t('qosBandwidth.shapingRules.protocol')}</th>
                      <th style={styles.th}>{t('qosBandwidth.shapingRules.direction')}</th>
                      <th style={styles.th}>{t('qosBandwidth.shapingRules.action')}</th>
                      <th style={styles.th}>{t('qosBandwidth.shapingRules.ports')}</th>
                      <th style={styles.th}>{t('qosBandwidth.shapingRules.enabled')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {psrQ.data.data.length === 0 && (
                      <tr><td colSpan={8} style={styles.msg}>{t('qosBandwidth.shapingRules.noItems')}</td></tr>
                    )}
                    {psrQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong>{item.preset ? <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#6b7280' }}>[{item.preset}]</span> : null}</td>
                        <td style={styles.tdMono}>{item.protocol}</td>
                        <td style={styles.td}>{item.direction}</td>
                        <td style={styles.td}>{item.action}</td>
                        <td style={styles.tdMono}>{item.dst_port_range ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: item.enabled ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {item.enabled ? t('qosBandwidth.shapingRules.on') : t('qosBandwidth.shapingRules.off')}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openPsrModal(item)}>
                            {t('qosBandwidth.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('qosBandwidth.confirmDelete'))) {
                                deletePsrMut.mutate(item.id);
                              }
                            }}
                          >
                            {t('qosBandwidth.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPsrPage(p => Math.max(1, p - 1))} disabled={psrPage <= 1}>
                  &laquo; {t('qosBandwidth.prev')}
                </button>
                <span style={styles.pageInfo}>{psrPage} / {psrTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setPsrPage(p => p + 1)} disabled={psrPage >= psrTotalPages}>
                  {t('qosBandwidth.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* MODALS */}
      {/* ================================================================ */}

      {/* Quality Class Modal */}
      {showQcModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>
                {editingQc ? t('qosBandwidth.qualityClasses.edit') : t('qosBandwidth.qualityClasses.new')}
              </h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowQcModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('qosBandwidth.qualityClasses.name')} <RequiredMark />
                <input style={modalStyles.input} value={qcForm.name ?? ''} onChange={e => setQcForm(f => ({ ...f, name: e.target.value }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.qualityClasses.description')}
                <input style={modalStyles.input} value={qcForm.description ?? ''} onChange={e => setQcForm(f => ({ ...f, description: e.target.value }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.qualityClasses.trafficType')}
                <select style={modalStyles.select} value={qcForm.traffic_type ?? 'web'} onChange={e => setQcForm(f => ({ ...f, traffic_type: e.target.value }))}>
                  {TRAFFIC_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.qualityClasses.priority')}
                <input style={modalStyles.input} type="number" min={1} max={8} value={qcForm.priority ?? 4} onChange={e => setQcForm(f => ({ ...f, priority: Number(e.target.value) }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.qualityClasses.dscpMark')}
                <input style={modalStyles.input} placeholder="EF, AF41, CS3, BE" value={qcForm.dscp_mark ?? ''} onChange={e => setQcForm(f => ({ ...f, dscp_mark: e.target.value || undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.qualityClasses.queueKind')}
                <select style={modalStyles.select} value={qcForm.mikrotik_queue_kind ?? 'sfq'} onChange={e => setQcForm(f => ({ ...f, mikrotik_queue_kind: e.target.value }))}>
                  {QUEUE_KINDS_QC.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.qualityClasses.maxLimitPct')}
                <input style={modalStyles.input} type="number" min={1} max={100} value={qcForm.max_limit_pct ?? ''} onChange={e => setQcForm(f => ({ ...f, max_limit_pct: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.qualityClasses.status')}
                <select style={modalStyles.select} value={qcForm.status ?? 'active'} onChange={e => setQcForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            </div>
            {qcErr && <p style={modalStyles.error}>{qcErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowQcModal(false)}>{t('qosBandwidth.cancel')}</button>
              <button style={styles.btnPrimary} disabled={saveQcMut.isPending} onClick={() => saveQcMut.mutate()}>{t('qosBandwidth.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Queue Tree Node Modal */}
      {showQtModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>
                {editingQt ? t('qosBandwidth.queueTree.edit') : t('qosBandwidth.queueTree.new')}
              </h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowQtModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.name')} <RequiredMark />
                <input style={modalStyles.input} value={qtForm.name ?? ''} onChange={e => setQtForm(f => ({ ...f, name: e.target.value }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.type')}
                <select style={modalStyles.select} value={qtForm.queue_type ?? 'tree'} onChange={e => setQtForm(f => ({ ...f, queue_type: e.target.value }))}>
                  {QUEUE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.interface')}
                <input style={modalStyles.input} placeholder="ether1, pppoe-out1" value={qtForm.interface ?? ''} onChange={e => setQtForm(f => ({ ...f, interface: e.target.value || undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.maxLimit')} (Mbps)
                <input style={modalStyles.input} type="number" min={0} value={qtForm.max_limit_mbps ?? ''} onChange={e => setQtForm(f => ({ ...f, max_limit_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.burstLimit')} (Mbps)
                <input style={modalStyles.input} type="number" min={0} value={qtForm.burst_limit_mbps ?? ''} onChange={e => setQtForm(f => ({ ...f, burst_limit_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.burstThreshold')} (Mbps)
                <input style={modalStyles.input} type="number" min={0} value={qtForm.burst_threshold_mbps ?? ''} onChange={e => setQtForm(f => ({ ...f, burst_threshold_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.burstTime')} (s)
                <input style={modalStyles.input} type="number" min={1} max={255} value={qtForm.burst_time_seconds ?? ''} onChange={e => setQtForm(f => ({ ...f, burst_time_seconds: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.priority')}
                <input style={modalStyles.input} type="number" min={1} max={8} value={qtForm.priority ?? 8} onChange={e => setQtForm(f => ({ ...f, priority: Number(e.target.value) }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.queueKind')}
                <select style={modalStyles.select} value={qtForm.queue_kind ?? 'sfq'} onChange={e => setQtForm(f => ({ ...f, queue_kind: e.target.value }))}>
                  {QUEUE_KINDS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.sortOrder')}
                <input style={modalStyles.input} type="number" min={0} value={qtForm.sort_order ?? 0} onChange={e => setQtForm(f => ({ ...f, sort_order: Number(e.target.value) }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.queueTree.status')}
                <select style={modalStyles.select} value={qtForm.status ?? 'active'} onChange={e => setQtForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            </div>
            {qtErr && <p style={modalStyles.error}>{qtErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowQtModal(false)}>{t('qosBandwidth.cancel')}</button>
              <button style={styles.btnPrimary} disabled={saveQtMut.isPending} onClick={() => saveQtMut.mutate()}>{t('qosBandwidth.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Rate Limit Template Modal */}
      {showRltModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>
                {editingRlt ? t('qosBandwidth.rateLimitTemplates.edit') : t('qosBandwidth.rateLimitTemplates.new')}
              </h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowRltModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('qosBandwidth.rateLimitTemplates.name')} <RequiredMark />
                <input style={modalStyles.input} value={rltForm.name ?? ''} onChange={e => setRltForm(f => ({ ...f, name: e.target.value }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.rateLimitTemplates.serviceType')}
                <select style={modalStyles.select} value={rltForm.service_type ?? 'pppoe'} onChange={e => setRltForm(f => ({ ...f, service_type: e.target.value }))}>
                  {SERVICE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.rateLimitTemplates.vendor')}
                <select style={modalStyles.select} value={rltForm.radius_vendor ?? 'mikrotik'} onChange={e => setRltForm(f => ({ ...f, radius_vendor: e.target.value }))}>
                  {RADIUS_VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.rateLimitTemplates.downloadMbps')} <RequiredMark />
                <input style={modalStyles.input} type="number" min={0.1} step={0.1} value={rltForm.download_mbps ?? ''} onChange={e => setRltForm(f => ({ ...f, download_mbps: Number(e.target.value) }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.rateLimitTemplates.uploadMbps')} <RequiredMark />
                <input style={modalStyles.input} type="number" min={0.1} step={0.1} value={rltForm.upload_mbps ?? ''} onChange={e => setRltForm(f => ({ ...f, upload_mbps: Number(e.target.value) }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.rateLimitTemplates.burstDl')} (Mbps)
                <input style={modalStyles.input} type="number" min={0} value={rltForm.burst_download_mbps ?? ''} onChange={e => setRltForm(f => ({ ...f, burst_download_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.rateLimitTemplates.burstUl')} (Mbps)
                <input style={modalStyles.input} type="number" min={0} value={rltForm.burst_upload_mbps ?? ''} onChange={e => setRltForm(f => ({ ...f, burst_upload_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.rateLimitTemplates.burstThreshold')} (Mbps)
                <input style={modalStyles.input} type="number" min={0} value={rltForm.burst_threshold_mbps ?? ''} onChange={e => setRltForm(f => ({ ...f, burst_threshold_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.rateLimitTemplates.burstTime')} (s)
                <input style={modalStyles.input} type="number" min={1} max={255} value={rltForm.burst_time_seconds ?? ''} onChange={e => setRltForm(f => ({ ...f, burst_time_seconds: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.rateLimitTemplates.status')}
                <select style={modalStyles.select} value={rltForm.status ?? 'active'} onChange={e => setRltForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              {/* Preview */}
              <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  style={{ ...styles.btnSecondary, padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                  disabled={previewLoading}
                  onClick={handlePreview}
                >
                  {previewLoading ? t('qosBandwidth.rateLimitTemplates.previewing') : t('qosBandwidth.rateLimitTemplates.preview')}
                </button>
                {previewStr && (
                  <code style={{ fontSize: '0.8rem', background: 'var(--bg-subtle, #f3f4f6)', padding: '0.2rem 0.4rem', borderRadius: 4 }}>
                    {previewStr}
                  </code>
                )}
              </div>
            </div>
            {rltErr && <p style={modalStyles.error}>{rltErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowRltModal(false)}>{t('qosBandwidth.cancel')}</button>
              <button style={styles.btnPrimary} disabled={saveRltMut.isPending} onClick={() => saveRltMut.mutate()}>{t('qosBandwidth.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Protocol Shaping Rule Modal */}
      {showPsrModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>
                {editingPsr ? t('qosBandwidth.shapingRules.edit') : t('qosBandwidth.shapingRules.new')}
              </h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowPsrModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.name')} <RequiredMark />
                <input style={modalStyles.input} value={psrForm.name ?? ''} onChange={e => setPsrForm(f => ({ ...f, name: e.target.value }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.protocol')}
                <select style={modalStyles.select} value={psrForm.protocol ?? 'tcp'} onChange={e => setPsrForm(f => ({ ...f, protocol: e.target.value }))}>
                  {PROTOCOLS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.direction')}
                <select style={modalStyles.select} value={psrForm.direction ?? 'both'} onChange={e => setPsrForm(f => ({ ...f, direction: e.target.value }))}>
                  {DIRECTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.dstPort')}
                <input style={modalStyles.input} placeholder="80,443 or 6881-6889" value={psrForm.dst_port_range ?? ''} onChange={e => setPsrForm(f => ({ ...f, dst_port_range: e.target.value || undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.srcPort')}
                <input style={modalStyles.input} value={psrForm.src_port_range ?? ''} onChange={e => setPsrForm(f => ({ ...f, src_port_range: e.target.value || undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.action')}
                <select style={modalStyles.select} value={psrForm.action ?? 'limit'} onChange={e => setPsrForm(f => ({ ...f, action: e.target.value }))}>
                  {ACTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.limitDl')} (Mbps)
                <input style={modalStyles.input} type="number" min={0} value={psrForm.limit_download_mbps ?? ''} onChange={e => setPsrForm(f => ({ ...f, limit_download_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.limitUl')} (Mbps)
                <input style={modalStyles.input} type="number" min={0} value={psrForm.limit_upload_mbps ?? ''} onChange={e => setPsrForm(f => ({ ...f, limit_upload_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.dscpMark')}
                <input style={modalStyles.input} placeholder="EF, AF41, AF21, BE" value={psrForm.dscp_mark ?? ''} onChange={e => setPsrForm(f => ({ ...f, dscp_mark: e.target.value || undefined }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.priority')}
                <input style={modalStyles.input} type="number" min={1} max={8} value={psrForm.priority ?? 8} onChange={e => setPsrForm(f => ({ ...f, priority: Number(e.target.value) }))} />
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.shapingRules.enabled')}
                <select style={modalStyles.select} value={String(psrForm.enabled ?? 0)} onChange={e => setPsrForm(f => ({ ...f, enabled: Number(e.target.value) }))}>
                  <option value="1">{t('qosBandwidth.shapingRules.on')}</option>
                  <option value="0">{t('qosBandwidth.shapingRules.off')}</option>
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('qosBandwidth.notes')}
                <input style={modalStyles.input} value={psrForm.notes ?? ''} onChange={e => setPsrForm(f => ({ ...f, notes: e.target.value || undefined }))} />
              </label>
            </div>
            {psrErr && <p style={modalStyles.error}>{psrErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowPsrModal(false)}>{t('qosBandwidth.cancel')}</button>
              <button style={styles.btnPrimary} disabled={savePsrMut.isPending} onClick={() => savePsrMut.mutate()}>{t('qosBandwidth.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
