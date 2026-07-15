// =============================================================================
// FireISP 5.0 — CPE Inventory Page (§8.4 / Inventory Phase 3, migration 391)
// =============================================================================
// Tabbed page:
//   Tab 1: Lifecycle — current state, transition form, history table
//   Tab 2: Subscriber Link — link/unlink subscriber to CPE
//   Tab 3: Swap Device — swap workflow (old → returned, new → assigned)
//   Tab 4: Depreciation — purchase info + computed book value
//   Tab 5: Register — manual serial registration (legacy devices / catch-up
//          for stock that predates an item's serial_required toggle) + a
//          filterable list of every serial (serial, product, state, client,
//          ownership).
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';
import { styles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CpeDevice {
  id: number;
  serial_number: string;
  oui: string | null;
  manufacturer: string | null;
  model_name: string | null;
  status: string;
  lifecycle_state: string;
  subscriber_id: number | null;
  subscriber_linked_at: string | null;
  purchase_cost: string | null;
  purchase_date: string | null;
  depreciation_method: string;
  useful_life_months: number | null;
  salvage_value: string | null;
  // Inventory Phase 3 (migration 391)
  inventory_item_id: number | null;
  ownership: 'rented' | 'sold' | null;
  contract_id: number | null;
  item_name?: string | null;
  item_sku?: string | null;
  subscriber_name?: string | null;
}

interface InventoryItemOption { id: number; name: string; sku: string | null; serial_required: number | boolean }
interface WarehouseOption { id: number; name: string }

interface LifecycleHistory {
  id: number;
  from_state: string | null;
  to_state: string;
  reason: string | null;
  performed_by: number | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

interface DepreciationResult {
  currentValue: number | null;
  accumulatedDepreciation: number | null;
  method: string;
  elapsedMonths?: number;
  remainingMonths?: number;
}

interface ListResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIFECYCLE_STATES = ['in_stock', 'assigned', 'active', 'returned', 'rma'];

const tabStyle = (active: boolean) => ({
  padding: '8px 20px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
  background: active ? '#2563eb' : '#f3f4f6',
  color: active ? '#fff' : '#374151',
  marginRight: 8,
});

const lifecycleStateColor = (state: string): string => {
  switch (state) {
    case 'active': return '#16a34a';
    case 'assigned': return '#2563eb';
    case 'in_stock': return '#9ca3af';
    case 'returned': return '#d97706';
    case 'rma': return '#dc2626';
    default: return '#9ca3af';
  }
};

// ---------------------------------------------------------------------------
// DeviceSelector — shared
// ---------------------------------------------------------------------------

function DeviceSelector({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { t } = useTranslation();
  const { data } = useQuery<ListResponse<CpeDevice>>({
    queryKey: ['cpe-devices-select'],
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices' as never, {
        params: { query: { limit: 200 } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load devices');
      return (res as { data: unknown }).data as unknown as ListResponse<CpeDevice>;
    },
  });

  const devices = data?.data ?? [];
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.label}>{t('common.device') || 'Device'}</label>
      <select
        style={{ ...styles.input, minWidth: 260 }}
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? parseInt(e.target.value, 10) : null)}
      >
        <option value="">— {t('common.selectDevice') || 'Select device'} —</option>
        {devices.map(d => (
          <option key={d.id} value={d.id}>
            #{d.id} — {d.serial_number}
            {d.manufacturer ? ` (${d.manufacturer})` : ''}
            {' '}[{d.lifecycle_state}]
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LifecycleTab
// ---------------------------------------------------------------------------

function LifecycleTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [toState, setToState] = useState('');
  const [reason, setReason] = useState('');
  const [transitionError, setTransitionError] = useState('');
  const [page, setPage] = useState(1);

  const { data: deviceData } = useQuery<{ data: CpeDevice }>({
    queryKey: ['cpe-device', selectedDeviceId],
    enabled: selectedDeviceId !== null,
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices/{id}' as never, {
        params: { path: { id: selectedDeviceId } } as never,
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load device');
      return (res as { data: unknown }).data as unknown as { data: CpeDevice };
    },
  });

  const { data: historyData, isLoading: historyLoading } = useQuery<ListResponse<LifecycleHistory>>({
    queryKey: ['cpe-lifecycle', selectedDeviceId, page],
    enabled: selectedDeviceId !== null,
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices/{id}/lifecycle' as never, {
        params: { path: { id: selectedDeviceId }, query: { page, limit: 25 } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load lifecycle history');
      return (res as { data: unknown }).data as unknown as ListResponse<LifecycleHistory>;
    },
  });

  const transitionMut = useMutation({
    mutationFn: async () => {
      if (!selectedDeviceId || !toState) throw new Error('Select device and new state');
      const res = await api.POST('/cpe-management/devices/{id}/lifecycle/transition' as never, {
        params: { path: { id: selectedDeviceId } } as never,
        body: { to_state: toState, reason: reason || undefined } as never,
      } as never);
      // Surface the backend's real message (e.g. the stock-boundary 422 for
      // inventory-linked units) instead of a generic failure string.
      if ((res as { error?: unknown }).error) throw new Error(extractApiError((res as { error?: unknown }).error, 'Transition failed'));
      return (res as { data: unknown }).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cpe-lifecycle', selectedDeviceId] });
      qc.invalidateQueries({ queryKey: ['cpe-device', selectedDeviceId] });
      qc.invalidateQueries({ queryKey: ['cpe-devices-select'] });
      setToState('');
      setReason('');
      setTransitionError('');
    },
    onError: (e: Error) => setTransitionError(e.message),
  });

  const device = deviceData?.data;
  const history = historyData?.data ?? [];
  const total = historyData?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / 25);

  return (
    <div>
      <DeviceSelector value={selectedDeviceId} onChange={(id) => { setSelectedDeviceId(id); setPage(1); }} />

      {device && (
        <div style={{ marginBottom: 20, padding: 12, background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd' }}>
          <strong>{t('cpeInventory.lifecycle.currentState')}:</strong>{' '}
          <span style={{ color: lifecycleStateColor(device.lifecycle_state), fontWeight: 700 }}>
            {t(`cpeInventory.lifecycle.states.${device.lifecycle_state}`)}
          </span>
        </div>
      )}

      {selectedDeviceId && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{t('cpeInventory.lifecycle.transition')}</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={styles.label}>{t('cpeInventory.lifecycle.toState')} <RequiredMark /></label>
              <select style={styles.input} value={toState} onChange={e => setToState(e.target.value)}>
                <option value="">— select —</option>
                {LIFECYCLE_STATES.map(s => (
                  <option key={s} value={s}>{t(`cpeInventory.lifecycle.states.${s}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={styles.label}>{t('cpeInventory.lifecycle.reason')}</label>
              <input
                style={{ ...styles.input, minWidth: 200 }}
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </div>
            <button
              style={{ ...styles.primaryButton, alignSelf: 'flex-end' }}
              onClick={() => transitionMut.mutate()}
              disabled={!toState || transitionMut.isPending}
            >
              {t('cpeInventory.lifecycle.apply')}
            </button>
          </div>
          {transitionError && <p style={styles.errorText}>{transitionError}</p>}
        </div>
      )}

      {selectedDeviceId && (
        <>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>{t('cpeInventory.lifecycle.history')}</h3>
          {historyLoading ? <p style={{ color: '#6b7280' }}>{t('common.loading')}</p> : (
            <>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>{t('cpeInventory.lifecycle.fromState')}</th>
                    <th style={styles.th}>→</th>
                    <th style={styles.th}>{t('cpeInventory.lifecycle.toState')}</th>
                    <th style={styles.th}>{t('cpeInventory.lifecycle.reason')}</th>
                    <th style={styles.th}>{t('cpeInventory.lifecycle.performedBy')}</th>
                    <th style={styles.th}>{t('common.createdAt') || 'Date'}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr><td colSpan={6} style={styles.emptyCell}>{t('cpeInventory.lifecycle.empty')}</td></tr>
                  ) : history.map(h => (
                    <tr key={h.id}>
                      <td style={styles.td}>
                        <span style={{ color: lifecycleStateColor(h.from_state || '') }}>
                          {h.from_state ? t(`cpeInventory.lifecycle.states.${h.from_state}`) : '—'}
                        </span>
                      </td>
                      <td style={styles.td}>→</td>
                      <td style={styles.td}>
                        <span style={{ color: lifecycleStateColor(h.to_state), fontWeight: 600 }}>
                          {t(`cpeInventory.lifecycle.states.${h.to_state}`)}
                        </span>
                      </td>
                      <td style={styles.td}>{h.reason || '—'}</td>
                      <td style={styles.td}>
                        {h.first_name ? `${h.first_name} ${h.last_name}` : (h.performed_by ? `#${h.performed_by}` : '—')}
                      </td>
                      <td style={styles.td}>{new Date(h.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div style={styles.pagination}>
                  <button style={styles.pageButton} disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                    {t('common.previous') || 'Prev'}
                  </button>
                  <span style={{ color: '#6b7280' }}>{page} / {totalPages}</span>
                  <button style={styles.pageButton} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    {t('common.next') || 'Next'}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubscriberTab
// ---------------------------------------------------------------------------

function SubscriberTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [subscriberId, setSubscriberId] = useState('');
  const [linkError, setLinkError] = useState('');

  const { data: deviceData } = useQuery<{ data: CpeDevice }>({
    queryKey: ['cpe-device', selectedDeviceId],
    enabled: selectedDeviceId !== null,
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices/{id}' as never, {
        params: { path: { id: selectedDeviceId } } as never,
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load device');
      return (res as { data: unknown }).data as unknown as { data: CpeDevice };
    },
  });

  const linkMut = useMutation({
    mutationFn: async (subId: number | null) => {
      if (!selectedDeviceId) throw new Error('Select a device');
      const res = await api.POST('/cpe-management/devices/{id}/subscriber-link' as never, {
        params: { path: { id: selectedDeviceId } } as never,
        body: { subscriber_id: subId } as never,
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Link update failed');
      return (res as { data: unknown }).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cpe-device', selectedDeviceId] });
      qc.invalidateQueries({ queryKey: ['cpe-devices-select'] });
      setLinkError('');
    },
    onError: (e: Error) => setLinkError(e.message),
  });

  const device = deviceData?.data;

  return (
    <div>
      <DeviceSelector value={selectedDeviceId} onChange={setSelectedDeviceId} />

      {device && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, maxWidth: 480 }}>
          <div style={{ marginBottom: 12 }}>
            <strong>{t('cpeInventory.subscribers.current')}:</strong>{' '}
            {device.subscriber_id ? (
              <span>#{device.subscriber_id} (linked {device.subscriber_linked_at ? new Date(device.subscriber_linked_at).toLocaleDateString() : ''})</span>
            ) : (
              <span style={{ color: '#9ca3af' }}>{t('cpeInventory.subscribers.notLinked')}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <label style={styles.label}>{t('cpeInventory.subscribers.subscriberId')}</label>
              <input
                style={{ ...styles.input, width: 140 }}
                type="number"
                min={1}
                placeholder="Client ID"
                value={subscriberId}
                onChange={e => setSubscriberId(e.target.value)}
              />
            </div>
            <button
              style={{ ...styles.primaryButton, alignSelf: 'flex-end' }}
              onClick={() => linkMut.mutate(subscriberId ? parseInt(subscriberId, 10) : null)}
              disabled={linkMut.isPending}
            >
              {subscriberId ? t('cpeInventory.subscribers.link') : t('cpeInventory.subscribers.unlink')}
            </button>
            {device.subscriber_id && (
              <button
                style={{ ...styles.dangerButton, alignSelf: 'flex-end' }}
                onClick={() => linkMut.mutate(null)}
                disabled={linkMut.isPending}
              >
                {t('cpeInventory.subscribers.unlink')}
              </button>
            )}
          </div>
          {linkError && <p style={styles.errorText}>{linkError}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SwapTab
// ---------------------------------------------------------------------------

function SwapTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [oldDeviceId, setOldDeviceId] = useState('');
  const [newDeviceId, setNewDeviceId] = useState('');
  const [swapReason, setSwapReason] = useState('');
  const [swapError, setSwapError] = useState('');
  const [swapSuccess, setSwapSuccess] = useState('');

  const swapMut = useMutation({
    mutationFn: async () => {
      if (!oldDeviceId || !newDeviceId) throw new Error('Both device IDs required');
      const res = await api.POST('/cpe-management/devices/swap' as never, {
        body: {
          old_device_id: parseInt(oldDeviceId, 10),
          new_device_id: parseInt(newDeviceId, 10),
          reason: swapReason || 'CPE swap',
        } as never,
      } as never);
      if ((res as { error?: unknown }).error) throw new Error((res as { error?: { message?: string } }).error?.message || 'Swap failed');
      return (res as { data: unknown }).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cpe-devices-select'] });
      setSwapSuccess(t('cpeInventory.swap.success'));
      setSwapError('');
      setOldDeviceId('');
      setNewDeviceId('');
      setSwapReason('');
    },
    onError: (e: Error) => { setSwapError(e.message); setSwapSuccess(''); },
  });

  const { data: devicesData } = useQuery<ListResponse<CpeDevice>>({
    queryKey: ['cpe-devices-select'],
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices' as never, {
        params: { query: { limit: 200 } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load devices');
      return (res as { data: unknown }).data as unknown as ListResponse<CpeDevice>;
    },
  });

  const devices = devicesData?.data ?? [];
  const activeDevices = devices.filter(d => ['active', 'assigned'].includes(d.lifecycle_state));
  const stockDevices = devices.filter(d => d.lifecycle_state === 'in_stock');

  return (
    <div>
      <p style={{ color: '#6b7280', marginBottom: 16 }}>{t('cpeInventory.swap.description')}</p>
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, maxWidth: 560 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={styles.label}>{t('cpeInventory.swap.oldDevice')} <RequiredMark /></label>
          <select
            style={{ ...styles.input, minWidth: 300 }}
            value={oldDeviceId}
            onChange={e => setOldDeviceId(e.target.value)}
          >
            <option value="">— select active/assigned device —</option>
            {activeDevices.map(d => (
              <option key={d.id} value={d.id}>
                #{d.id} — {d.serial_number} [{d.lifecycle_state}]
                {d.subscriber_id ? ` sub:#${d.subscriber_id}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={styles.label}>{t('cpeInventory.swap.newDevice')} <RequiredMark /></label>
          <select
            style={{ ...styles.input, minWidth: 300 }}
            value={newDeviceId}
            onChange={e => setNewDeviceId(e.target.value)}
          >
            <option value="">— select in-stock device —</option>
            {stockDevices.map(d => (
              <option key={d.id} value={d.id}>
                #{d.id} — {d.serial_number}{d.manufacturer ? ` (${d.manufacturer})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={styles.label}>{t('cpeInventory.swap.reason')}</label>
          <input
            style={{ ...styles.input, width: '100%' }}
            value={swapReason}
            onChange={e => setSwapReason(e.target.value)}
            placeholder="CPE swap"
          />
        </div>
        <button
          style={styles.primaryButton}
          onClick={() => swapMut.mutate()}
          disabled={!oldDeviceId || !newDeviceId || swapMut.isPending}
        >
          {t('cpeInventory.swap.execute')}
        </button>
        {swapSuccess && <p style={{ color: '#16a34a', marginTop: 8 }}>{swapSuccess}</p>}
        {swapError && <p style={styles.errorText}>{swapError}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DepreciationTab
// ---------------------------------------------------------------------------

function DepreciationTab() {
  const { t } = useTranslation();
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);

  const { data: deprData, isLoading } = useQuery<{ data: DepreciationResult & { device_id: number } }>({
    queryKey: ['cpe-depreciation', selectedDeviceId],
    enabled: selectedDeviceId !== null,
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices/{id}/depreciation' as never, {
        params: { path: { id: selectedDeviceId } } as never,
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load depreciation');
      return (res as { data: unknown }).data as unknown as { data: DepreciationResult & { device_id: number } };
    },
  });

  const dep = deprData?.data;

  const fieldRow = (label: string, value: React.ReactNode) => (
    <tr key={label}>
      <td style={{ ...styles.td, fontWeight: 500, width: 220, background: '#f9fafb' }}>{label}</td>
      <td style={styles.td}>{value}</td>
    </tr>
  );

  return (
    <div>
      <DeviceSelector value={selectedDeviceId} onChange={setSelectedDeviceId} />

      {selectedDeviceId && (
        isLoading ? <p style={{ color: '#6b7280' }}>{t('common.loading')}</p> : (
          dep?.method === 'none' || dep?.currentValue === null ? (
            <p style={{ color: '#9ca3af' }}>{t('cpeInventory.depreciation.notConfigured')}</p>
          ) : (
            <table style={{ ...styles.table, maxWidth: 520 }}>
              <tbody>
                {fieldRow(t('cpeInventory.depreciation.currentValue'),
                  <strong style={{ color: '#2563eb' }}>${dep?.currentValue?.toFixed(2)}</strong>
                )}
                {fieldRow(t('cpeInventory.depreciation.accumulated'),
                  `$${dep?.accumulatedDepreciation?.toFixed(2)}`
                )}
                {fieldRow(t('cpeInventory.depreciation.method'),
                  t(`cpeInventory.depreciation.methods.${dep?.method || 'none'}`)
                )}
                {fieldRow(t('cpeInventory.depreciation.elapsedMonths'),
                  dep?.elapsedMonths !== undefined ? `${dep.elapsedMonths} mo` : '—'
                )}
                {fieldRow(t('cpeInventory.depreciation.remainingMonths'),
                  dep?.remainingMonths !== undefined ? `${dep.remainingMonths} mo` : '—'
                )}
              </tbody>
            </table>
          )
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RegisterTab (Inventory Phase 3, migration 391) — manual serial
// registration + a filterable list of every serial (serial, product, state,
// client, ownership).
// ---------------------------------------------------------------------------

function RegisterTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [itemId, setItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [modelName, setModelName] = useState('');
  const [incrementStock, setIncrementStock] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  const [stateFilter, setStateFilter] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data: itemsData } = useQuery<ListResponse<InventoryItemOption>>({
    queryKey: ['inventory-items-lookup'],
    queryFn: async () => {
      const res = await api.GET('/inventory/items' as never, { params: { query: { limit: 200 } as never } } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load inventory items');
      return (res as { data: unknown }).data as unknown as ListResponse<InventoryItemOption>;
    },
  });
  const { data: warehousesData } = useQuery<ListResponse<WarehouseOption>>({
    queryKey: ['warehouses-lookup'],
    queryFn: async () => {
      const res = await api.GET('/warehouses' as never, { params: { query: { limit: 200 } as never } } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load warehouses');
      return (res as { data: unknown }).data as unknown as ListResponse<WarehouseOption>;
    },
  });

  const registerMut = useMutation({
    mutationFn: async () => {
      const res = await api.POST('/cpe-management/devices/register' as never, {
        body: {
          inventory_item_id: Number(itemId),
          serial_number: serialNumber.trim(),
          warehouse_id: warehouseId ? Number(warehouseId) : undefined,
          manufacturer: manufacturer || undefined,
          model_name: modelName || undefined,
          increment_stock: incrementStock,
        } as never,
      } as never);
      if ((res as { error?: unknown }).error) {
        throw new Error((res as { error?: { message?: string } }).error?.message || t('cpeInventory.register.error'));
      }
      return (res as { data: unknown }).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cpe-devices-list'] });
      qc.invalidateQueries({ queryKey: ['cpe-devices-select'] });
      setFormSuccess(t('cpeInventory.register.success'));
      setFormError('');
      setSerialNumber('');
      setManufacturer('');
      setModelName('');
      setIncrementStock(false);
    },
    onError: (e: Error) => { setFormError(e.message); setFormSuccess(''); },
  });

  const { data: listData, isLoading: listLoading } = useQuery<ListResponse<CpeDevice>>({
    queryKey: ['cpe-devices-list', stateFilter, itemFilter, page],
    queryFn: async () => {
      const query: Record<string, string | number> = { page, limit: 25 };
      if (stateFilter) query.lifecycle_state = stateFilter;
      if (itemFilter) query.inventory_item_id = itemFilter;
      const res = await api.GET('/cpe-management/devices' as never, { params: { query: query as never } } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load devices');
      return (res as { data: unknown }).data as unknown as ListResponse<CpeDevice>;
    },
  });

  const items = itemsData?.data ?? [];
  const warehouses = warehousesData?.data ?? [];
  const devices = listData?.data ?? [];
  const total = listData?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / 25);

  return (
    <div>
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20, maxWidth: 640 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{t('cpeInventory.register.formTitle')}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <label style={styles.label}>{t('cpeInventory.register.item')} <RequiredMark /></label>
            <select style={{ ...styles.input, minWidth: 220 }} value={itemId} onChange={e => setItemId(e.target.value)}>
              <option value="">— {t('common.select') || 'select'} —</option>
              {items.map(i => (
                <option key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''}{i.serial_required ? ` — ${t('inventoryManagement.serialRequired.badge')}` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={styles.label}>{t('cpeInventory.register.serialNumber')} <RequiredMark /></label>
            <input style={styles.input} value={serialNumber} onChange={e => setSerialNumber(e.target.value)} />
          </div>
          <div>
            <label style={styles.label}>{t('cpeInventory.register.warehouse')}</label>
            <select style={{ ...styles.input, minWidth: 160 }} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              <option value="">— {t('common.select') || 'select'} —</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label style={styles.label}>{t('cpeInventory.register.manufacturer')}</label>
            <input style={styles.input} value={manufacturer} onChange={e => setManufacturer(e.target.value)} />
          </div>
          <div>
            <label style={styles.label}>{t('cpeInventory.register.modelName')}</label>
            <input style={styles.input} value={modelName} onChange={e => setModelName(e.target.value)} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: '0.85rem', color: '#6b7280' }}>
          <input type="checkbox" checked={incrementStock} onChange={e => setIncrementStock(e.target.checked)} />
          {t('cpeInventory.register.incrementStock')}
        </label>
        <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '4px 0 12px' }}>
          {t('cpeInventory.register.incrementStockHint')}
        </p>
        <button
          style={styles.primaryButton}
          disabled={!itemId || !serialNumber.trim() || registerMut.isPending}
          onClick={() => registerMut.mutate()}
        >
          {registerMut.isPending ? t('common.saving') : t('cpeInventory.register.submit')}
        </button>
        {formSuccess && <p style={{ color: '#16a34a', marginTop: 8 }}>{formSuccess}</p>}
        {formError && <p style={styles.errorText}>{formError}</p>}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <label style={styles.label}>{t('cpeInventory.register.filterState')}</label>
          <select style={styles.input} value={stateFilter} onChange={e => { setStateFilter(e.target.value); setPage(1); }}>
            <option value="">{t('common.all') || 'All'}</option>
            {LIFECYCLE_STATES.map(s => <option key={s} value={s}>{t(`cpeInventory.lifecycle.states.${s}`)}</option>)}
          </select>
        </div>
        <div>
          <label style={styles.label}>{t('cpeInventory.register.filterItem')}</label>
          <select style={{ ...styles.input, minWidth: 200 }} value={itemFilter} onChange={e => { setItemFilter(e.target.value); setPage(1); }}>
            <option value="">{t('common.all') || 'All'}</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      {listLoading ? <p style={{ color: '#6b7280' }}>{t('common.loading')}</p> : (
        <>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{t('cpeInventory.register.colSerial')}</th>
                <th style={styles.th}>{t('cpeInventory.register.colProduct')}</th>
                <th style={styles.th}>{t('cpeInventory.register.colState')}</th>
                <th style={styles.th}>{t('cpeInventory.register.colClient')}</th>
                <th style={styles.th}>{t('cpeInventory.register.colOwnership')}</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr><td colSpan={5} style={styles.emptyCell}>{t('cpeInventory.register.empty')}</td></tr>
              ) : devices.map(d => (
                <tr key={d.id}>
                  <td style={styles.td}>{d.serial_number}</td>
                  <td style={styles.td}>{d.item_name ?? '—'}</td>
                  <td style={styles.td}>
                    <span style={{ color: lifecycleStateColor(d.lifecycle_state), fontWeight: 600 }}>
                      {t(`cpeInventory.lifecycle.states.${d.lifecycle_state}`)}
                    </span>
                  </td>
                  <td style={styles.td}>{d.subscriber_name ?? '—'}</td>
                  <td style={styles.td}>{d.ownership ? t(`cpeInventory.register.ownership.${d.ownership}`) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div style={styles.pagination}>
              <button style={styles.pageButton} disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                {t('common.previous') || 'Prev'}
              </button>
              <span style={{ color: '#6b7280' }}>{page} / {totalPages}</span>
              <button style={styles.pageButton} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                {t('common.next') || 'Next'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CpeInventoryPage
// ---------------------------------------------------------------------------

export function CpeInventoryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'lifecycle' | 'subscribers' | 'swap' | 'depreciation' | 'register'>('lifecycle');

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>{t('cpeInventory.title')}</h1>
      <p style={styles.subtitle}>{t('cpeInventory.subtitle')}</p>

      <div style={{ marginBottom: 20 }}>
        {(['lifecycle', 'subscribers', 'swap', 'depreciation', 'register'] as const).map(t2 => (
          <button key={t2} style={tabStyle(tab === t2)} onClick={() => setTab(t2)}>
            {t(`cpeInventory.tabs.${t2}`)}
          </button>
        ))}
      </div>

      {tab === 'lifecycle' && <LifecycleTab />}
      {tab === 'subscribers' && <SubscriberTab />}
      {tab === 'swap' && <SwapTab />}
      {tab === 'depreciation' && <DepreciationTab />}
      {tab === 'register' && <RegisterTab />}
    </div>
  );
}
