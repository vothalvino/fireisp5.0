// =============================================================================
// Persistent install-operator warning for the opt-in admin IP allowlist.
// =============================================================================

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';

interface AdminIpStatus {
  enabled: boolean;
  source: 'environment' | 'database' | 'none';
}

async function fetchStatus(): Promise<AdminIpStatus> {
  const get = api.GET as unknown as (
    path: string,
  ) => Promise<{ data?: unknown; error?: unknown }>;
  const response = await get('/security-admin/admin-ip-allowlist/status');
  if (response.error || !response.data) throw new Error('Failed to load admin IP allowlist status');
  return (response.data as { data: AdminIpStatus }).data;
}

export function AdminIpAllowlistBanner() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const isInstallOperator = user?.is_install_operator === true;

  const { data: status } = useQuery<AdminIpStatus>({
    queryKey: ['admin-ip-allowlist-status', user?.organization_id],
    queryFn: fetchStatus,
    enabled: isInstallOperator,
    staleTime: 60 * 1000,
    retry: false,
  });

  if (!isInstallOperator || !status || status.enabled) return null;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '10px 16px',
        borderBottom: '1px solid #f59e0b',
        background: '#fffbeb',
        color: '#78350f',
      }}
    >
      <span aria-hidden="true">⚠️</span>
      <strong>{t('adminIpAllowlistBanner.title')}</strong>
      <span>{t('adminIpAllowlistBanner.detail')}</span>
      <Link to="/security-access-control#admin-ip-allowlist" style={{ color: '#92400e', fontWeight: 700 }}>
        {t('adminIpAllowlistBanner.action')}
      </Link>
    </div>
  );
}
