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

// §10.3 FUP / Data Caps

interface DataPack {
  id: number;
  name: string;
  data_gb: number;
  price: number;
  validity_days: number | null;
  status: string;
}

interface DataPackBody {
  name: string;
  data_gb: number;
  price: number;
  validity_days?: number;
  status?: string;
}

interface FupNotification {
  id: number;
  contract_id: number;
  billing_month: string;
  threshold_pct: number;
  used_gb: number;
  cap_gb: number;
  notified_at: string;
}

// §10.4 Traffic Engineering

interface InterfaceQosPolicy {
  id: number;
  name: string;
  interface_name: string | null;
  algorithm: string;
  max_bandwidth_mbps: number | null;
  committed_bandwidth_mbps: number | null;
  burst_bandwidth_mbps: number | null;
  priority: number;
  vendor_platform: string | null;
  status: string;
  notes: string | null;
}

interface InterfaceQosPolicyBody {
  name: string;
  interface_name?: string;
  algorithm?: string;
  max_bandwidth_mbps?: number;
  committed_bandwidth_mbps?: number;
  burst_bandwidth_mbps?: number;
  priority?: number;
  vendor_platform?: string;
  status?: string;
  notes?: string;
}

interface DscpMarkingPolicy {
  id: number;
  name: string;
  traffic_class: string;
  dscp_value: number;
  dscp_name: string | null;
  match_protocol: string | null;
  match_port_range: string | null;
  action: string;
  priority: number;
  enabled: number;
}

interface DscpMarkingPolicyBody {
  name: string;
  traffic_class?: string;
  dscp_value?: number;
  dscp_name?: string;
  match_protocol?: string;
  match_port_range?: string;
  action?: string;
  priority?: number;
  enabled?: number;
}

interface MplsVlanRule {
  id: number;
  name: string;
  rule_type: string;
  vlan_id: number | null;
  mpls_label: number | null;
  traffic_class: string | null;
  priority_bits: number | null;
  queue_class: string | null;
  enabled: number;
}

interface MplsVlanRuleBody {
  name: string;
  rule_type?: string;
  vlan_id?: number;
  mpls_label?: number;
  traffic_class?: string;
  priority_bits?: number;
  queue_class?: string;
  enabled?: number;
}

interface BandwidthTestServer {
  id: number;
  name: string;
  host: string;
  port: number;
  protocol: string;
  region: string | null;
  site_id: number | null;
  status: string;
}

interface BandwidthTestServerBody {
  name: string;
  host: string;
  port?: number;
  protocol?: string;
  region?: string;
  site_id?: number;
  status?: string;
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
const QOS_ALGORITHMS = ['htb', 'cbq', 'hfsc', 'pcq', 'pfifo', 'sfq'];
const TE_VENDOR_PLATFORMS = ['mikrotik', 'cisco', 'juniper', 'generic'];
const DSCP_ACTIONS = ['mark', 'remark', 'passthrough'];
const MPLS_VLAN_RULE_TYPES = ['vlan', 'mpls', 'qinq', 'mpls_vlan'];
const BWT_PROTOCOLS = ['tcp', 'udp', 'iperf3', 'speedtest'];

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
// API helpers — Data Packs (§10.3)
// ---------------------------------------------------------------------------

async function fetchDataPacks(page: number): Promise<ListResponse<DataPack>> {
  const res = await api.GET('/data-packs' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load data packs');
  return (res as { data: unknown }).data as unknown as ListResponse<DataPack>;
}

async function createDataPack(body: DataPackBody): Promise<void> {
  const res = await api.POST('/data-packs' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create data pack');
}

async function updateDataPack(id: number, body: Partial<DataPackBody>): Promise<void> {
  const res = await api.PATCH('/data-packs/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update data pack');
}

async function deleteDataPack(id: number): Promise<void> {
  const res = await api.DELETE('/data-packs/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete data pack');
}

async function fetchFupNotifications(page: number): Promise<ListResponse<FupNotification>> {
  const res = await api.GET('/fup/notifications' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load FUP notifications');
  return (res as { data: unknown }).data as unknown as ListResponse<FupNotification>;
}

// ---------------------------------------------------------------------------
// API helpers — Traffic Engineering (§10.4)
// ---------------------------------------------------------------------------

async function fetchInterfaceQosPolicies(page: number): Promise<ListResponse<InterfaceQosPolicy>> {
  const res = await api.GET('/interface-qos-policies' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load interface QoS policies');
  return (res as { data: unknown }).data as unknown as ListResponse<InterfaceQosPolicy>;
}

async function createInterfaceQosPolicy(body: InterfaceQosPolicyBody): Promise<void> {
  const res = await api.POST('/interface-qos-policies' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create interface QoS policy');
}

async function updateInterfaceQosPolicy(id: number, body: Partial<InterfaceQosPolicyBody>): Promise<void> {
  const res = await api.PATCH('/interface-qos-policies/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update interface QoS policy');
}

async function deleteInterfaceQosPolicy(id: number): Promise<void> {
  const res = await api.DELETE('/interface-qos-policies/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete interface QoS policy');
}

async function fetchDscpMarkingPolicies(page: number): Promise<ListResponse<DscpMarkingPolicy>> {
  const res = await api.GET('/dscp-marking-policies' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load DSCP marking policies');
  return (res as { data: unknown }).data as unknown as ListResponse<DscpMarkingPolicy>;
}

async function createDscpMarkingPolicy(body: DscpMarkingPolicyBody): Promise<void> {
  const res = await api.POST('/dscp-marking-policies' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create DSCP marking policy');
}

async function updateDscpMarkingPolicy(id: number, body: Partial<DscpMarkingPolicyBody>): Promise<void> {
  const res = await api.PATCH('/dscp-marking-policies/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update DSCP marking policy');
}

async function deleteDscpMarkingPolicy(id: number): Promise<void> {
  const res = await api.DELETE('/dscp-marking-policies/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete DSCP marking policy');
}

async function exportDscpConfig(): Promise<{ rules: unknown[] }> {
  const res = await api.GET('/dscp-marking-policies/export/config' as never, {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to export DSCP config');
  return (res as { data: unknown }).data as unknown as { rules: unknown[] };
}

async function fetchMplsVlanRules(page: number): Promise<ListResponse<MplsVlanRule>> {
  const res = await api.GET('/mpls-vlan-prioritization' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load MPLS/VLAN rules');
  return (res as { data: unknown }).data as unknown as ListResponse<MplsVlanRule>;
}

async function createMplsVlanRule(body: MplsVlanRuleBody): Promise<void> {
  const res = await api.POST('/mpls-vlan-prioritization' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create MPLS/VLAN rule');
}

async function updateMplsVlanRule(id: number, body: Partial<MplsVlanRuleBody>): Promise<void> {
  const res = await api.PATCH('/mpls-vlan-prioritization/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update MPLS/VLAN rule');
}

async function deleteMplsVlanRule(id: number): Promise<void> {
  const res = await api.DELETE('/mpls-vlan-prioritization/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete MPLS/VLAN rule');
}

async function fetchBandwidthTestServers(page: number): Promise<ListResponse<BandwidthTestServer>> {
  const res = await api.GET('/bandwidth-test-servers' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load bandwidth test servers');
  return (res as { data: unknown }).data as unknown as ListResponse<BandwidthTestServer>;
}

async function createBandwidthTestServer(body: BandwidthTestServerBody): Promise<void> {
  const res = await api.POST('/bandwidth-test-servers' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create bandwidth test server');
}

async function updateBandwidthTestServer(id: number, body: Partial<BandwidthTestServerBody>): Promise<void> {
  const res = await api.PATCH('/bandwidth-test-servers/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update bandwidth test server');
}

async function deleteBandwidthTestServer(id: number): Promise<void> {
  const res = await api.DELETE('/bandwidth-test-servers/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete bandwidth test server');
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

  type Tab = 'qualityClasses' | 'queueTree' | 'rateLimitTemplates' | 'shapingRules' | 'fupDataCaps' | 'trafficEngineering';
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

  // ============================== DATA PACKS (§10.3) ==============================

  const [dpPage, setDpPage] = useState(1);
  const dpQ = useQuery({
    queryKey: ['qos', 'dataPacks', dpPage],
    queryFn: () => fetchDataPacks(dpPage),
    enabled: tab === 'fupDataCaps',
  });
  const [showDpModal, setShowDpModal] = useState(false);
  const [editingDp, setEditingDp] = useState<DataPack | null>(null);
  const [dpForm, setDpForm] = useState<Partial<DataPackBody>>({});
  const [dpErr, setDpErr] = useState('');

  function openDpModal(item?: DataPack) {
    setEditingDp(item ?? null);
    setDpForm(item
      ? { name: item.name, data_gb: item.data_gb, price: item.price, validity_days: item.validity_days ?? undefined, status: item.status }
      : { status: 'active' });
    setDpErr('');
    setShowDpModal(true);
  }

  const saveDpMut = useMutation({
    mutationFn: () => editingDp
      ? updateDataPack(editingDp.id, dpForm)
      : createDataPack(dpForm as DataPackBody),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qos', 'dataPacks'] }); setShowDpModal(false); },
    onError: (e: unknown) => setDpErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteDpMut = useMutation({
    mutationFn: deleteDataPack,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qos', 'dataPacks'] }),
  });

  const dpTotalPages = Math.ceil((dpQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  const [fupNotifPage, setFupNotifPage] = useState(1);
  const fupNotifQ = useQuery({
    queryKey: ['qos', 'fupNotifications', fupNotifPage],
    queryFn: () => fetchFupNotifications(fupNotifPage),
    enabled: tab === 'fupDataCaps',
  });
  const fupNotifTotalPages = Math.ceil((fupNotifQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== INTERFACE QoS POLICIES (§10.4) ==============================

  const [iqpPage, setIqpPage] = useState(1);
  const iqpQ = useQuery({
    queryKey: ['qos', 'interfaceQosPolicies', iqpPage],
    queryFn: () => fetchInterfaceQosPolicies(iqpPage),
    enabled: tab === 'trafficEngineering',
  });
  const [showIqpModal, setShowIqpModal] = useState(false);
  const [editingIqp, setEditingIqp] = useState<InterfaceQosPolicy | null>(null);
  const [iqpForm, setIqpForm] = useState<Partial<InterfaceQosPolicyBody>>({});
  const [iqpErr, setIqpErr] = useState('');

  function openIqpModal(item?: InterfaceQosPolicy) {
    setEditingIqp(item ?? null);
    setIqpForm(item
      ? { name: item.name, interface_name: item.interface_name ?? '', algorithm: item.algorithm, max_bandwidth_mbps: item.max_bandwidth_mbps ?? undefined, committed_bandwidth_mbps: item.committed_bandwidth_mbps ?? undefined, burst_bandwidth_mbps: item.burst_bandwidth_mbps ?? undefined, priority: item.priority, vendor_platform: item.vendor_platform ?? '', status: item.status, notes: item.notes ?? '' }
      : { algorithm: 'htb', priority: 4, status: 'active' });
    setIqpErr('');
    setShowIqpModal(true);
  }

  const saveIqpMut = useMutation({
    mutationFn: () => editingIqp
      ? updateInterfaceQosPolicy(editingIqp.id, iqpForm)
      : createInterfaceQosPolicy(iqpForm as InterfaceQosPolicyBody),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qos', 'interfaceQosPolicies'] }); setShowIqpModal(false); },
    onError: (e: unknown) => setIqpErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteIqpMut = useMutation({
    mutationFn: deleteInterfaceQosPolicy,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qos', 'interfaceQosPolicies'] }),
  });

  const iqpTotalPages = Math.ceil((iqpQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== DSCP MARKING POLICIES (§10.4) ==============================

  const [dscpPage, setDscpPage] = useState(1);
  const dscpQ = useQuery({
    queryKey: ['qos', 'dscpPolicies', dscpPage],
    queryFn: () => fetchDscpMarkingPolicies(dscpPage),
    enabled: tab === 'trafficEngineering',
  });
  const [showDscpModal, setShowDscpModal] = useState(false);
  const [editingDscp, setEditingDscp] = useState<DscpMarkingPolicy | null>(null);
  const [dscpForm, setDscpForm] = useState<Partial<DscpMarkingPolicyBody>>({});
  const [dscpErr, setDscpErr] = useState('');
  const [exportingDscp, setExportingDscp] = useState(false);

  function openDscpModal(item?: DscpMarkingPolicy) {
    setEditingDscp(item ?? null);
    setDscpForm(item
      ? { name: item.name, traffic_class: item.traffic_class, dscp_value: item.dscp_value, dscp_name: item.dscp_name ?? '', match_protocol: item.match_protocol ?? '', match_port_range: item.match_port_range ?? '', action: item.action, priority: item.priority, enabled: item.enabled }
      : { action: 'mark', priority: 4, enabled: 1 });
    setDscpErr('');
    setShowDscpModal(true);
  }

  const saveDscpMut = useMutation({
    mutationFn: () => editingDscp
      ? updateDscpMarkingPolicy(editingDscp.id, dscpForm)
      : createDscpMarkingPolicy(dscpForm as DscpMarkingPolicyBody),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qos', 'dscpPolicies'] }); setShowDscpModal(false); },
    onError: (e: unknown) => setDscpErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteDscpMut = useMutation({
    mutationFn: deleteDscpMarkingPolicy,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qos', 'dscpPolicies'] }),
  });

  async function handleExportDscp() {
    setExportingDscp(true);
    try {
      const result = await exportDscpConfig();
      downloadScript('dscp-config.json', JSON.stringify(result, null, 2));
    } finally {
      setExportingDscp(false);
    }
  }

  const dscpTotalPages = Math.ceil((dscpQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== MPLS/VLAN PRIORITIZATION (§10.4) ==============================

  const [mvPage, setMvPage] = useState(1);
  const mvQ = useQuery({
    queryKey: ['qos', 'mplsVlan', mvPage],
    queryFn: () => fetchMplsVlanRules(mvPage),
    enabled: tab === 'trafficEngineering',
  });
  const [showMvModal, setShowMvModal] = useState(false);
  const [editingMv, setEditingMv] = useState<MplsVlanRule | null>(null);
  const [mvForm, setMvForm] = useState<Partial<MplsVlanRuleBody>>({});
  const [mvErr, setMvErr] = useState('');

  function openMvModal(item?: MplsVlanRule) {
    setEditingMv(item ?? null);
    setMvForm(item
      ? { name: item.name, rule_type: item.rule_type, vlan_id: item.vlan_id ?? undefined, mpls_label: item.mpls_label ?? undefined, traffic_class: item.traffic_class ?? '', priority_bits: item.priority_bits ?? undefined, queue_class: item.queue_class ?? '', enabled: item.enabled }
      : { rule_type: 'vlan', enabled: 1 });
    setMvErr('');
    setShowMvModal(true);
  }

  const saveMvMut = useMutation({
    mutationFn: () => editingMv
      ? updateMplsVlanRule(editingMv.id, mvForm)
      : createMplsVlanRule(mvForm as MplsVlanRuleBody),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qos', 'mplsVlan'] }); setShowMvModal(false); },
    onError: (e: unknown) => setMvErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteMvMut = useMutation({
    mutationFn: deleteMplsVlanRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qos', 'mplsVlan'] }),
  });

  const mvTotalPages = Math.ceil((mvQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== BANDWIDTH TEST SERVERS (§10.4) ==============================

  const [bwtPage, setBwtPage] = useState(1);
  const bwtQ = useQuery({
    queryKey: ['qos', 'bandwidthTestServers', bwtPage],
    queryFn: () => fetchBandwidthTestServers(bwtPage),
    enabled: tab === 'trafficEngineering',
  });
  const [showBwtModal, setShowBwtModal] = useState(false);
  const [editingBwt, setEditingBwt] = useState<BandwidthTestServer | null>(null);
  const [bwtForm, setBwtForm] = useState<Partial<BandwidthTestServerBody>>({});
  const [bwtErr, setBwtErr] = useState('');

  function openBwtModal(item?: BandwidthTestServer) {
    setEditingBwt(item ?? null);
    setBwtForm(item
      ? { name: item.name, host: item.host, port: item.port, protocol: item.protocol, region: item.region ?? '', status: item.status }
      : { port: 5201, protocol: 'iperf3', status: 'active' });
    setBwtErr('');
    setShowBwtModal(true);
  }

  const saveBwtMut = useMutation({
    mutationFn: () => editingBwt
      ? updateBandwidthTestServer(editingBwt.id, bwtForm)
      : createBandwidthTestServer(bwtForm as BandwidthTestServerBody),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qos', 'bandwidthTestServers'] }); setShowBwtModal(false); },
    onError: (e: unknown) => setBwtErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteBwtMut = useMutation({
    mutationFn: deleteBandwidthTestServer,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qos', 'bandwidthTestServers'] }),
  });

  const bwtTotalPages = Math.ceil((bwtQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

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
        {(['qualityClasses', 'queueTree', 'rateLimitTemplates', 'shapingRules', 'fupDataCaps', 'trafficEngineering'] as const).map(t2 => (
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

      {/* ================================================================ */}
      {/* TAB: FUP & Data Caps (§10.3) */}
      {/* ================================================================ */}
      {tab === 'fupDataCaps' && (
        <div>

          {/* ---- Data Packs sub-section ---- */}
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>
            {t('qosBandwidth.fupDataCaps.dataPacks')}
          </h2>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => openDpModal()}>
              + {t('qosBandwidth.fupDataCaps.newDataPack')}
            </button>
          </div>
          {dpQ.isLoading && <p style={styles.msg}>{t('qosBandwidth.loading')}</p>}
          {dpQ.isError && <p style={styles.msgError}>{t('qosBandwidth.fupDataCaps.loadError')}</p>}
          {dpQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('qosBandwidth.fupDataCaps.name')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.fupDataCaps.dataGb')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.fupDataCaps.price')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.fupDataCaps.validityDays')}</th>
                      <th style={styles.th}>{t('qosBandwidth.fupDataCaps.status')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dpQ.data.data.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('qosBandwidth.fupDataCaps.noDataPacks')}</td></tr>
                    )}
                    {dpQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.tdNum}>{item.data_gb} GB</td>
                        <td style={styles.tdNum}>${item.price}</td>
                        <td style={styles.tdNum}>{item.validity_days ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: item.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {item.status}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openDpModal(item)}>
                            {t('qosBandwidth.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => { if (window.confirm(t('qosBandwidth.confirmDelete'))) deleteDpMut.mutate(item.id); }}
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
                <button style={styles.pageBtn} onClick={() => setDpPage(p => Math.max(1, p - 1))} disabled={dpPage <= 1}>
                  &laquo; {t('qosBandwidth.prev')}
                </button>
                <span style={styles.pageInfo}>{dpPage} / {dpTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setDpPage(p => p + 1)} disabled={dpPage >= dpTotalPages}>
                  {t('qosBandwidth.next')} &raquo;
                </button>
              </div>
            </>
          )}

          {/* ---- FUP Notifications sub-section ---- */}
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '2rem 0 0.75rem' }}>
            {t('qosBandwidth.fupDataCaps.notifications')}
          </h2>
          {fupNotifQ.isLoading && <p style={styles.msg}>{t('qosBandwidth.loading')}</p>}
          {fupNotifQ.isError && <p style={styles.msgError}>{t('qosBandwidth.fupDataCaps.loadError')}</p>}
          {fupNotifQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.thNum}>{t('qosBandwidth.fupDataCaps.contractId')}</th>
                      <th style={styles.th}>{t('qosBandwidth.fupDataCaps.billingMonth')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.fupDataCaps.thresholdPct')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.fupDataCaps.usedGb')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.fupDataCaps.capGb')}</th>
                      <th style={styles.th}>{t('qosBandwidth.fupDataCaps.notifiedAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fupNotifQ.data.data.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('qosBandwidth.fupDataCaps.noNotifications')}</td></tr>
                    )}
                    {fupNotifQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.tdNum}>{item.contract_id}</td>
                        <td style={styles.td}>{item.billing_month}</td>
                        <td style={styles.tdNum}>
                          <span style={{ color: item.threshold_pct >= 100 ? '#dc2626' : item.threshold_pct >= 90 ? '#d97706' : '#2563eb', fontWeight: 700 }}>
                            {item.threshold_pct}%
                          </span>
                        </td>
                        <td style={styles.tdNum}>{item.used_gb} GB</td>
                        <td style={styles.tdNum}>{item.cap_gb} GB</td>
                        <td style={styles.td}>{new Date(item.notified_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setFupNotifPage(p => Math.max(1, p - 1))} disabled={fupNotifPage <= 1}>
                  &laquo; {t('qosBandwidth.prev')}
                </button>
                <span style={styles.pageInfo}>{fupNotifPage} / {fupNotifTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setFupNotifPage(p => p + 1)} disabled={fupNotifPage >= fupNotifTotalPages}>
                  {t('qosBandwidth.next')} &raquo;
                </button>
              </div>
            </>
          )}

          {/* ---- Data Pack Modal ---- */}
          {showDpModal && (
            <div style={modalStyles.backdrop}>
              <div style={modalStyles.panel}>
                <div style={modalStyles.header}>
                  <h3 style={modalStyles.title}>
                    {editingDp ? t('qosBandwidth.fupDataCaps.editDataPack') : t('qosBandwidth.fupDataCaps.newDataPack')}
                  </h3>
                  <button style={modalStyles.closeBtn} onClick={() => setShowDpModal(false)}>&#x2715;</button>
                </div>
                <div style={modalStyles.form}>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.fupDataCaps.name')} <RequiredMark />
                    <input style={modalStyles.input} value={dpForm.name ?? ''} onChange={e => setDpForm(f => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.fupDataCaps.dataGb')} <RequiredMark />
                    <input style={modalStyles.input} type="number" min={0} step={0.1} value={dpForm.data_gb ?? ''} onChange={e => setDpForm(f => ({ ...f, data_gb: Number(e.target.value) }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.fupDataCaps.price')} <RequiredMark />
                    <input style={modalStyles.input} type="number" min={0} step={0.01} value={dpForm.price ?? ''} onChange={e => setDpForm(f => ({ ...f, price: Number(e.target.value) }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.fupDataCaps.validityDays')}
                    <input style={modalStyles.input} type="number" min={1} value={dpForm.validity_days ?? ''} onChange={e => setDpForm(f => ({ ...f, validity_days: e.target.value ? Number(e.target.value) : undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.fupDataCaps.status')}
                    <select style={modalStyles.select} value={dpForm.status ?? 'active'} onChange={e => setDpForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                </div>
                {dpErr && <p style={modalStyles.error}>{dpErr}</p>}
                <div style={modalStyles.actions}>
                  <button style={styles.btnSecondary} onClick={() => setShowDpModal(false)}>{t('qosBandwidth.cancel')}</button>
                  <button style={styles.btnPrimary} disabled={saveDpMut.isPending} onClick={() => saveDpMut.mutate()}>{t('qosBandwidth.save')}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Traffic Engineering (§10.4) */}
      {/* ================================================================ */}
      {tab === 'trafficEngineering' && (
        <div>

          {/* ---- Interface QoS Policies sub-section ---- */}
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>
            {t('qosBandwidth.trafficEngineering.interfaceQosPolicies')}
          </h2>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => openIqpModal()}>
              + {t('qosBandwidth.trafficEngineering.newPolicy')}
            </button>
          </div>
          {iqpQ.isLoading && <p style={styles.msg}>{t('qosBandwidth.loading')}</p>}
          {iqpQ.isError && <p style={styles.msgError}>{t('qosBandwidth.trafficEngineering.loadError')}</p>}
          {iqpQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.name')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.interface')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.algorithm')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.trafficEngineering.maxBandwidth')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.trafficEngineering.priority')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.vendor')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.status')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {iqpQ.data.data.length === 0 && (
                      <tr><td colSpan={9} style={styles.msg}>{t('qosBandwidth.trafficEngineering.noItems')}</td></tr>
                    )}
                    {iqpQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.td}>{item.interface_name ?? '—'}</td>
                        <td style={styles.td}><span style={styles.tdMono}>{item.algorithm}</span></td>
                        <td style={styles.tdNum}>{item.max_bandwidth_mbps !== null ? `${item.max_bandwidth_mbps}M` : '—'}</td>
                        <td style={styles.tdNum}>
                          <span style={{ color: priorityColor(item.priority), fontWeight: 700 }}>{item.priority}</span>
                        </td>
                        <td style={styles.td}>{item.vendor_platform ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: item.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {item.status}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openIqpModal(item)}>
                            {t('qosBandwidth.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => { if (window.confirm(t('qosBandwidth.confirmDelete'))) deleteIqpMut.mutate(item.id); }}
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
                <button style={styles.pageBtn} onClick={() => setIqpPage(p => Math.max(1, p - 1))} disabled={iqpPage <= 1}>
                  &laquo; {t('qosBandwidth.prev')}
                </button>
                <span style={styles.pageInfo}>{iqpPage} / {iqpTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setIqpPage(p => p + 1)} disabled={iqpPage >= iqpTotalPages}>
                  {t('qosBandwidth.next')} &raquo;
                </button>
              </div>
            </>
          )}

          {/* ---- DSCP Marking Policies sub-section ---- */}
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '2rem 0 0.75rem' }}>
            {t('qosBandwidth.trafficEngineering.dscpMarkingPolicies')}
          </h2>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '1rem' }}>
            <button style={styles.btnSecondary} onClick={handleExportDscp} disabled={exportingDscp}>
              {exportingDscp ? t('qosBandwidth.exporting') : t('qosBandwidth.trafficEngineering.exportDscp')}
            </button>
            <button style={styles.btnPrimary} onClick={() => openDscpModal()}>
              + {t('qosBandwidth.trafficEngineering.newDscpPolicy')}
            </button>
          </div>
          {dscpQ.isLoading && <p style={styles.msg}>{t('qosBandwidth.loading')}</p>}
          {dscpQ.isError && <p style={styles.msgError}>{t('qosBandwidth.trafficEngineering.loadError')}</p>}
          {dscpQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.name')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.trafficClass')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.trafficEngineering.dscpValue')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.dscpName')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.action')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.trafficEngineering.priority')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.enabled')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dscpQ.data.data.length === 0 && (
                      <tr><td colSpan={9} style={styles.msg}>{t('qosBandwidth.trafficEngineering.noItems')}</td></tr>
                    )}
                    {dscpQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.td}>{item.traffic_class}</td>
                        <td style={styles.tdNum}><span style={styles.tdMono}>{item.dscp_value}</span></td>
                        <td style={styles.tdMono}>{item.dscp_name ?? '—'}</td>
                        <td style={styles.td}>{item.action}</td>
                        <td style={styles.tdNum}>
                          <span style={{ color: priorityColor(item.priority), fontWeight: 700 }}>{item.priority}</span>
                        </td>
                        <td style={styles.td}>
                          <span style={{ color: item.enabled ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {item.enabled ? 'on' : 'off'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openDscpModal(item)}>
                            {t('qosBandwidth.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => { if (window.confirm(t('qosBandwidth.confirmDelete'))) deleteDscpMut.mutate(item.id); }}
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
                <button style={styles.pageBtn} onClick={() => setDscpPage(p => Math.max(1, p - 1))} disabled={dscpPage <= 1}>
                  &laquo; {t('qosBandwidth.prev')}
                </button>
                <span style={styles.pageInfo}>{dscpPage} / {dscpTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setDscpPage(p => p + 1)} disabled={dscpPage >= dscpTotalPages}>
                  {t('qosBandwidth.next')} &raquo;
                </button>
              </div>
            </>
          )}

          {/* ---- MPLS/VLAN Prioritization sub-section ---- */}
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '2rem 0 0.75rem' }}>
            {t('qosBandwidth.trafficEngineering.mplsVlanPrioritization')}
          </h2>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => openMvModal()}>
              + {t('qosBandwidth.trafficEngineering.newMplsVlanRule')}
            </button>
          </div>
          {mvQ.isLoading && <p style={styles.msg}>{t('qosBandwidth.loading')}</p>}
          {mvQ.isError && <p style={styles.msgError}>{t('qosBandwidth.trafficEngineering.loadError')}</p>}
          {mvQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.name')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.ruleType')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.trafficEngineering.vlanId')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.trafficEngineering.mplsLabel')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.trafficClass')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.enabled')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mvQ.data.data.length === 0 && (
                      <tr><td colSpan={8} style={styles.msg}>{t('qosBandwidth.trafficEngineering.noItems')}</td></tr>
                    )}
                    {mvQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.td}>{item.rule_type}</td>
                        <td style={styles.tdNum}>{item.vlan_id ?? '—'}</td>
                        <td style={styles.tdNum}>{item.mpls_label ?? '—'}</td>
                        <td style={styles.td}>{item.traffic_class ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: item.enabled ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {item.enabled ? 'on' : 'off'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openMvModal(item)}>
                            {t('qosBandwidth.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => { if (window.confirm(t('qosBandwidth.confirmDelete'))) deleteMvMut.mutate(item.id); }}
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
                <button style={styles.pageBtn} onClick={() => setMvPage(p => Math.max(1, p - 1))} disabled={mvPage <= 1}>
                  &laquo; {t('qosBandwidth.prev')}
                </button>
                <span style={styles.pageInfo}>{mvPage} / {mvTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setMvPage(p => p + 1)} disabled={mvPage >= mvTotalPages}>
                  {t('qosBandwidth.next')} &raquo;
                </button>
              </div>
            </>
          )}

          {/* ---- Bandwidth Test Servers sub-section ---- */}
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '2rem 0 0.75rem' }}>
            {t('qosBandwidth.trafficEngineering.bandwidthTestServers')}
          </h2>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => openBwtModal()}>
              + {t('qosBandwidth.trafficEngineering.newBwtServer')}
            </button>
          </div>
          {bwtQ.isLoading && <p style={styles.msg}>{t('qosBandwidth.loading')}</p>}
          {bwtQ.isError && <p style={styles.msgError}>{t('qosBandwidth.trafficEngineering.loadError')}</p>}
          {bwtQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.name')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.host')}</th>
                      <th style={styles.thNum}>{t('qosBandwidth.trafficEngineering.port')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.protocol')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.region')}</th>
                      <th style={styles.th}>{t('qosBandwidth.trafficEngineering.status')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bwtQ.data.data.length === 0 && (
                      <tr><td colSpan={8} style={styles.msg}>{t('qosBandwidth.trafficEngineering.noItems')}</td></tr>
                    )}
                    {bwtQ.data.data.map(item => (
                      <tr key={item.id} style={styles.tr}>
                        <td style={styles.tdNum}>{item.id}</td>
                        <td style={styles.td}><strong>{item.name}</strong></td>
                        <td style={styles.tdMono}>{item.host}</td>
                        <td style={styles.tdNum}>{item.port}</td>
                        <td style={styles.td}>{item.protocol}</td>
                        <td style={styles.td}>{item.region ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: item.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {item.status}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openBwtModal(item)}>
                            {t('qosBandwidth.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => { if (window.confirm(t('qosBandwidth.confirmDelete'))) deleteBwtMut.mutate(item.id); }}
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
                <button style={styles.pageBtn} onClick={() => setBwtPage(p => Math.max(1, p - 1))} disabled={bwtPage <= 1}>
                  &laquo; {t('qosBandwidth.prev')}
                </button>
                <span style={styles.pageInfo}>{bwtPage} / {bwtTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setBwtPage(p => p + 1)} disabled={bwtPage >= bwtTotalPages}>
                  {t('qosBandwidth.next')} &raquo;
                </button>
              </div>
            </>
          )}

          {/* ---- Interface QoS Policy Modal ---- */}
          {showIqpModal && (
            <div style={modalStyles.backdrop}>
              <div style={modalStyles.panel}>
                <div style={modalStyles.header}>
                  <h3 style={modalStyles.title}>
                    {editingIqp ? t('qosBandwidth.trafficEngineering.editPolicy') : t('qosBandwidth.trafficEngineering.newPolicy')}
                  </h3>
                  <button style={modalStyles.closeBtn} onClick={() => setShowIqpModal(false)}>&#x2715;</button>
                </div>
                <div style={modalStyles.form}>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.name')} <RequiredMark />
                    <input style={modalStyles.input} value={iqpForm.name ?? ''} onChange={e => setIqpForm(f => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.interface')}
                    <input style={modalStyles.input} placeholder="ether1" value={iqpForm.interface_name ?? ''} onChange={e => setIqpForm(f => ({ ...f, interface_name: e.target.value || undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.algorithm')}
                    <select style={modalStyles.select} value={iqpForm.algorithm ?? 'htb'} onChange={e => setIqpForm(f => ({ ...f, algorithm: e.target.value }))}>
                      {QOS_ALGORITHMS.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
                    </select>
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.maxBandwidth')} (Mbps)
                    <input style={modalStyles.input} type="number" min={0} value={iqpForm.max_bandwidth_mbps ?? ''} onChange={e => setIqpForm(f => ({ ...f, max_bandwidth_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.committedBandwidth')} (Mbps)
                    <input style={modalStyles.input} type="number" min={0} value={iqpForm.committed_bandwidth_mbps ?? ''} onChange={e => setIqpForm(f => ({ ...f, committed_bandwidth_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.burstBandwidth')} (Mbps)
                    <input style={modalStyles.input} type="number" min={0} value={iqpForm.burst_bandwidth_mbps ?? ''} onChange={e => setIqpForm(f => ({ ...f, burst_bandwidth_mbps: e.target.value ? Number(e.target.value) : undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.priority')}
                    <input style={modalStyles.input} type="number" min={1} max={8} value={iqpForm.priority ?? 4} onChange={e => setIqpForm(f => ({ ...f, priority: Number(e.target.value) }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.vendor')}
                    <select style={modalStyles.select} value={iqpForm.vendor_platform ?? ''} onChange={e => setIqpForm(f => ({ ...f, vendor_platform: e.target.value || undefined }))}>
                      <option value="">—</option>
                      {TE_VENDOR_PLATFORMS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.status')}
                    <select style={modalStyles.select} value={iqpForm.status ?? 'active'} onChange={e => setIqpForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.notes')}
                    <input style={modalStyles.input} value={iqpForm.notes ?? ''} onChange={e => setIqpForm(f => ({ ...f, notes: e.target.value || undefined }))} />
                  </label>
                </div>
                {iqpErr && <p style={modalStyles.error}>{iqpErr}</p>}
                <div style={modalStyles.actions}>
                  <button style={styles.btnSecondary} onClick={() => setShowIqpModal(false)}>{t('qosBandwidth.cancel')}</button>
                  <button style={styles.btnPrimary} disabled={saveIqpMut.isPending} onClick={() => saveIqpMut.mutate()}>{t('qosBandwidth.save')}</button>
                </div>
              </div>
            </div>
          )}

          {/* ---- DSCP Marking Policy Modal ---- */}
          {showDscpModal && (
            <div style={modalStyles.backdrop}>
              <div style={modalStyles.panel}>
                <div style={modalStyles.header}>
                  <h3 style={modalStyles.title}>
                    {editingDscp ? t('qosBandwidth.trafficEngineering.editDscpPolicy') : t('qosBandwidth.trafficEngineering.newDscpPolicy')}
                  </h3>
                  <button style={modalStyles.closeBtn} onClick={() => setShowDscpModal(false)}>&#x2715;</button>
                </div>
                <div style={modalStyles.form}>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.name')} <RequiredMark />
                    <input style={modalStyles.input} value={dscpForm.name ?? ''} onChange={e => setDscpForm(f => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.trafficClass')}
                    <input style={modalStyles.input} placeholder="voip, video, web, bulk" value={dscpForm.traffic_class ?? ''} onChange={e => setDscpForm(f => ({ ...f, traffic_class: e.target.value }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.dscpValue')} (0–63)
                    <input style={modalStyles.input} type="number" min={0} max={63} value={dscpForm.dscp_value ?? ''} onChange={e => setDscpForm(f => ({ ...f, dscp_value: Number(e.target.value) }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.dscpName')}
                    <input style={modalStyles.input} placeholder="EF, AF41, CS3, BE" value={dscpForm.dscp_name ?? ''} onChange={e => setDscpForm(f => ({ ...f, dscp_name: e.target.value || undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.matchProtocol')}
                    <input style={modalStyles.input} placeholder="tcp, udp, any" value={dscpForm.match_protocol ?? ''} onChange={e => setDscpForm(f => ({ ...f, match_protocol: e.target.value || undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.matchPortRange')}
                    <input style={modalStyles.input} placeholder="5060-5061" value={dscpForm.match_port_range ?? ''} onChange={e => setDscpForm(f => ({ ...f, match_port_range: e.target.value || undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.action')}
                    <select style={modalStyles.select} value={dscpForm.action ?? 'mark'} onChange={e => setDscpForm(f => ({ ...f, action: e.target.value }))}>
                      {DSCP_ACTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.priority')}
                    <input style={modalStyles.input} type="number" min={1} max={8} value={dscpForm.priority ?? 4} onChange={e => setDscpForm(f => ({ ...f, priority: Number(e.target.value) }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.enabled')}
                    <select style={modalStyles.select} value={String(dscpForm.enabled ?? 1)} onChange={e => setDscpForm(f => ({ ...f, enabled: Number(e.target.value) }))}>
                      <option value="1">{t('qosBandwidth.shapingRules.on')}</option>
                      <option value="0">{t('qosBandwidth.shapingRules.off')}</option>
                    </select>
                  </label>
                </div>
                {dscpErr && <p style={modalStyles.error}>{dscpErr}</p>}
                <div style={modalStyles.actions}>
                  <button style={styles.btnSecondary} onClick={() => setShowDscpModal(false)}>{t('qosBandwidth.cancel')}</button>
                  <button style={styles.btnPrimary} disabled={saveDscpMut.isPending} onClick={() => saveDscpMut.mutate()}>{t('qosBandwidth.save')}</button>
                </div>
              </div>
            </div>
          )}

          {/* ---- MPLS/VLAN Rule Modal ---- */}
          {showMvModal && (
            <div style={modalStyles.backdrop}>
              <div style={modalStyles.panel}>
                <div style={modalStyles.header}>
                  <h3 style={modalStyles.title}>
                    {editingMv ? t('qosBandwidth.trafficEngineering.editMplsVlanRule') : t('qosBandwidth.trafficEngineering.newMplsVlanRule')}
                  </h3>
                  <button style={modalStyles.closeBtn} onClick={() => setShowMvModal(false)}>&#x2715;</button>
                </div>
                <div style={modalStyles.form}>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.name')} <RequiredMark />
                    <input style={modalStyles.input} value={mvForm.name ?? ''} onChange={e => setMvForm(f => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.ruleType')}
                    <select style={modalStyles.select} value={mvForm.rule_type ?? 'vlan'} onChange={e => setMvForm(f => ({ ...f, rule_type: e.target.value }))}>
                      {MPLS_VLAN_RULE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.vlanId')}
                    <input style={modalStyles.input} type="number" min={1} max={4094} value={mvForm.vlan_id ?? ''} onChange={e => setMvForm(f => ({ ...f, vlan_id: e.target.value ? Number(e.target.value) : undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.mplsLabel')}
                    <input style={modalStyles.input} type="number" min={0} value={mvForm.mpls_label ?? ''} onChange={e => setMvForm(f => ({ ...f, mpls_label: e.target.value ? Number(e.target.value) : undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.trafficClass')}
                    <input style={modalStyles.input} placeholder="voip, video, bulk" value={mvForm.traffic_class ?? ''} onChange={e => setMvForm(f => ({ ...f, traffic_class: e.target.value || undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.priorityBits')} (0–7)
                    <input style={modalStyles.input} type="number" min={0} max={7} value={mvForm.priority_bits ?? ''} onChange={e => setMvForm(f => ({ ...f, priority_bits: e.target.value ? Number(e.target.value) : undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.queueClass')}
                    <input style={modalStyles.input} value={mvForm.queue_class ?? ''} onChange={e => setMvForm(f => ({ ...f, queue_class: e.target.value || undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.enabled')}
                    <select style={modalStyles.select} value={String(mvForm.enabled ?? 1)} onChange={e => setMvForm(f => ({ ...f, enabled: Number(e.target.value) }))}>
                      <option value="1">{t('qosBandwidth.shapingRules.on')}</option>
                      <option value="0">{t('qosBandwidth.shapingRules.off')}</option>
                    </select>
                  </label>
                </div>
                {mvErr && <p style={modalStyles.error}>{mvErr}</p>}
                <div style={modalStyles.actions}>
                  <button style={styles.btnSecondary} onClick={() => setShowMvModal(false)}>{t('qosBandwidth.cancel')}</button>
                  <button style={styles.btnPrimary} disabled={saveMvMut.isPending} onClick={() => saveMvMut.mutate()}>{t('qosBandwidth.save')}</button>
                </div>
              </div>
            </div>
          )}

          {/* ---- Bandwidth Test Server Modal ---- */}
          {showBwtModal && (
            <div style={modalStyles.backdrop}>
              <div style={modalStyles.panel}>
                <div style={modalStyles.header}>
                  <h3 style={modalStyles.title}>
                    {editingBwt ? t('qosBandwidth.trafficEngineering.editBwtServer') : t('qosBandwidth.trafficEngineering.newBwtServer')}
                  </h3>
                  <button style={modalStyles.closeBtn} onClick={() => setShowBwtModal(false)}>&#x2715;</button>
                </div>
                <div style={modalStyles.form}>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.name')} <RequiredMark />
                    <input style={modalStyles.input} value={bwtForm.name ?? ''} onChange={e => setBwtForm(f => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.host')} <RequiredMark />
                    <input style={modalStyles.input} placeholder="192.168.1.100 or speedtest.example.com" value={bwtForm.host ?? ''} onChange={e => setBwtForm(f => ({ ...f, host: e.target.value }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.port')}
                    <input style={modalStyles.input} type="number" min={1} max={65535} value={bwtForm.port ?? 5201} onChange={e => setBwtForm(f => ({ ...f, port: Number(e.target.value) }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.protocol')}
                    <select style={modalStyles.select} value={bwtForm.protocol ?? 'iperf3'} onChange={e => setBwtForm(f => ({ ...f, protocol: e.target.value }))}>
                      {BWT_PROTOCOLS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.region')}
                    <input style={modalStyles.input} placeholder="us-west, mx-central" value={bwtForm.region ?? ''} onChange={e => setBwtForm(f => ({ ...f, region: e.target.value || undefined }))} />
                  </label>
                  <label style={modalStyles.label}>
                    {t('qosBandwidth.trafficEngineering.status')}
                    <select style={modalStyles.select} value={bwtForm.status ?? 'active'} onChange={e => setBwtForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                </div>
                {bwtErr && <p style={modalStyles.error}>{bwtErr}</p>}
                <div style={modalStyles.actions}>
                  <button style={styles.btnSecondary} onClick={() => setShowBwtModal(false)}>{t('qosBandwidth.cancel')}</button>
                  <button style={styles.btnPrimary} disabled={saveBwtMut.isPending} onClick={() => saveBwtMut.mutate()}>{t('qosBandwidth.save')}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
