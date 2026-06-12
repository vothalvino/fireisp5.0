// =============================================================================
// FireISP 5.0 — App Layout (shell + nav)
// =============================================================================

import { useState, type ChangeEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthContext';
import { hasRole } from '@/auth/PrivateRoute';
import { DrDrillBanner } from '@/components/DrDrillBanner';
import { useDarkMode } from '@/auth/DarkModeContext';
import { ChangelogPanel } from '@/components/ChangelogPanel';

interface NavItem {
  to: string;
  labelKey: string;
  requiredRole?: string;
}

interface NavGroup {
  /** i18n key for the section heading; omit for the top-level (ungrouped) items. */
  titleKey?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ to: '/', labelKey: 'nav.dashboard' }],
  },
  {
    titleKey: 'nav.sections.clients',
    items: [
      { to: '/clients', labelKey: 'nav.clients' },
      { to: '/client-groups', labelKey: 'nav.clientGroups' },
      { to: '/leads', labelKey: 'nav.leads' },
      { to: '/service-orders', labelKey: 'nav.serviceOrders' },
      { to: '/contracts', labelKey: 'nav.contracts' },
      { to: '/winback-campaigns', labelKey: 'nav.winbackCampaigns', requiredRole: 'billing' },
      { to: '/churn-analytics', labelKey: 'nav.churnAnalytics', requiredRole: 'billing' },
      { to: '/communication-campaigns', labelKey: 'nav.communicationCampaigns', requiredRole: 'support' },
      { to: '/tickets', labelKey: 'nav.tickets' },
      { to: '/follow-up-reminders', labelKey: 'nav.followUps' },
      { to: '/satisfaction-surveys', labelKey: 'nav.surveys' },
      { to: '/escalations', labelKey: 'nav.escalations' },
      { to: '/noc-dashboard', labelKey: 'nav.nocDashboard', requiredRole: 'technician' },
      { to: '/work-orders', labelKey: 'nav.workOrders', requiredRole: 'technician' },
    ],
  },
  {
    titleKey: 'nav.sections.billing',
    items: [
      { to: '/invoices', labelKey: 'nav.invoices' },
      { to: '/payments', labelKey: 'nav.payments' },
      { to: '/cfdi', labelKey: 'nav.cfdi', requiredRole: 'billing' },
      { to: '/plans', labelKey: 'nav.plans', requiredRole: 'billing' },
      { to: '/quotes', labelKey: 'nav.quotes', requiredRole: 'billing' },
      { to: '/credit-notes', labelKey: 'nav.creditNotes', requiredRole: 'billing' },
      { to: '/expenses', labelKey: 'nav.expenses', requiredRole: 'billing' },
      { to: '/promotions', labelKey: 'nav.promotions', requiredRole: 'billing' },
      { to: '/tax-rules', labelKey: 'nav.taxRules', requiredRole: 'billing' },
      { to: '/tax-rates', labelKey: 'nav.taxRates', requiredRole: 'billing' },
      { to: '/payment-gateways', labelKey: 'nav.paymentGateways', requiredRole: 'billing' },
      { to: '/payment-transactions', labelKey: 'nav.paymentTransactions', requiredRole: 'billing' },
      { to: '/recurring-payment-profiles', labelKey: 'nav.recurringPaymentProfiles', requiredRole: 'billing' },
      { to: '/reports', labelKey: 'nav.reports', requiredRole: 'billing' },
      { to: '/tax-reports', labelKey: 'nav.taxReports', requiredRole: 'billing' },
      { to: '/invoice-settings', labelKey: 'nav.invoiceSettings', requiredRole: 'billing' },
      { to: '/late-fee-rules', labelKey: 'nav.lateFeeRules', requiredRole: 'billing' },
      { to: '/payment-reminder-settings', labelKey: 'nav.paymentReminderSettings', requiredRole: 'billing' },
      { to: '/payment-plans', labelKey: 'nav.paymentPlans', requiredRole: 'billing' },
      { to: '/cash-reconciliation', labelKey: 'nav.cashReconciliation', requiredRole: 'billing' },
      { to: '/refund-requests', labelKey: 'nav.refundRequests', requiredRole: 'billing' },
      { to: '/billing-disputes', labelKey: 'nav.billingDisputes', requiredRole: 'billing' },
      { to: '/chargebacks', labelKey: 'nav.chargebacks', requiredRole: 'billing' },
      { to: '/billing-adjustments', labelKey: 'nav.billingAdjustments', requiredRole: 'billing' },
    ],
  },
  {
    titleKey: 'nav.sections.network',
    items: [
      { to: '/devices', labelKey: 'nav.devices' },
      { to: '/inventory', labelKey: 'nav.inventory', requiredRole: 'technician' },
      { to: '/warehouses', labelKey: 'nav.warehouses', requiredRole: 'technician' },
      { to: '/inventory-management', labelKey: 'nav.inventoryManagement', requiredRole: 'technician' },
      { to: '/radius-sessions', labelKey: 'nav.radiusSessions', requiredRole: 'technician' },
      { to: '/session-accounting', labelKey: 'nav.sessionAccounting', requiredRole: 'technician' },
      { to: '/snmp-metrics', labelKey: 'nav.snmpMetrics', requiredRole: 'technician' },
      { to: '/snmp-traps', labelKey: 'nav.snmpTraps', requiredRole: 'technician' },
      { to: '/coverage-zones', labelKey: 'nav.coverageZones', requiredRole: 'technician' },
      { to: '/sites', labelKey: 'nav.sites', requiredRole: 'technician' },
      { to: '/nas', labelKey: 'nav.nas', requiredRole: 'technician' },
      { to: '/ip-pools', labelKey: 'nav.ipPools', requiredRole: 'technician' },
      { to: '/ip-assignments', labelKey: 'nav.ipAssignments', requiredRole: 'technician' },
      { to: '/vlans', labelKey: 'nav.vlans', requiredRole: 'technician' },
      { to: '/service-areas', labelKey: 'nav.serviceAreas', requiredRole: 'technician' },
      { to: '/outages', labelKey: 'nav.outages', requiredRole: 'technician' },
      { to: '/speed-tests', labelKey: 'nav.speedTests', requiredRole: 'technician' },
      { to: '/connection-logs', labelKey: 'nav.connectionLogs', requiredRole: 'technician' },
      { to: '/network-health', labelKey: 'nav.networkHealth', requiredRole: 'technician' },
      { to: '/snmp-profiles', labelKey: 'nav.snmpProfiles', requiredRole: 'technician' },
      { to: '/device-config-backups', labelKey: 'nav.deviceConfigBackups', requiredRole: 'technician' },
      { to: '/suspension-rules', labelKey: 'nav.suspensionRules', requiredRole: 'technician' },
      { to: '/dhcp-servers', labelKey: 'nav.dhcpServers', requiredRole: 'technician' },
      { to: '/nat-management', labelKey: 'nav.natManagement', requiredRole: 'technician' },
      { to: '/ptr-records', labelKey: 'nav.ptrRecords', requiredRole: 'technician' },
      { to: '/ipv6-management', labelKey: 'nav.ipv6Management', requiredRole: 'technician' },
      { to: '/transition-mechanisms', labelKey: 'nav.transitionMechanisms', requiredRole: 'technician' },
    ],
  },
  {
    titleKey: 'nav.sections.compliance',
    items: [
      { to: '/csd-certificates', labelKey: 'nav.csdCertificates', requiredRole: 'billing' },
      { to: '/pac-providers', labelKey: 'nav.pacProviders', requiredRole: 'billing' },
      { to: '/sat-catalogs', labelKey: 'nav.satCatalogs', requiredRole: 'billing' },
      { to: '/regulatory-filings', labelKey: 'nav.regulatoryFilings', requiredRole: 'billing' },
      { to: '/concession-titles', labelKey: 'nav.concessionTitles', requiredRole: 'billing' },
      { to: '/ift-statistical-reports', labelKey: 'nav.iftStatisticalReports', requiredRole: 'billing' },
      { to: '/facturas-publicas', labelKey: 'nav.facturasPublicas', requiredRole: 'billing' },
      { to: '/profeco-complaints', labelKey: 'nav.profecoComplaints', requiredRole: 'billing' },
    ],
  },
  {
    titleKey: 'nav.sections.admin',
    items: [
      { to: '/users', labelKey: 'nav.users', requiredRole: 'admin' },
      { to: '/organizations', labelKey: 'nav.organizations', requiredRole: 'admin' },
      { to: '/dsar', labelKey: 'nav.dsar', requiredRole: 'admin' },
      { to: '/dr-drill', labelKey: 'nav.drDrill', requiredRole: 'admin' },
      { to: '/sla-definitions', labelKey: 'nav.slaDefinitions', requiredRole: 'admin' },
      { to: '/roles', labelKey: 'nav.roles', requiredRole: 'admin' },
      { to: '/api-tokens', labelKey: 'nav.apiTokens', requiredRole: 'admin' },
      { to: '/webhooks', labelKey: 'nav.webhooks', requiredRole: 'admin' },
      { to: '/audit-logs', labelKey: 'nav.auditLogs', requiredRole: 'admin' },
      { to: '/scheduled-tasks', labelKey: 'nav.scheduledTasks', requiredRole: 'admin' },
      { to: '/jobs', labelKey: 'nav.jobs', requiredRole: 'admin' },
      { to: '/queue-stats', labelKey: 'nav.queueStats', requiredRole: 'admin' },
      { to: '/ai-assistant', labelKey: 'nav.aiAssistant', requiredRole: 'admin' },
      { to: '/settings', labelKey: 'nav.settings', requiredRole: 'admin' },
      { to: '/message-templates', labelKey: 'nav.messageTemplates', requiredRole: 'admin' },
    ],
  },
];

export function Layout() {
  const { user, logout, switchOrganization } = useAuth();
  const { t } = useTranslation();
  const { effectiveTheme, toggleTheme } = useDarkMode();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  async function handleLogout() {
    await logout();
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  async function handleOrgChange(e: ChangeEvent<HTMLSelectElement>) {
    const newOrgId = Number(e.target.value);
    if (!user || newOrgId === user.organization_id) return;
    setSwitching(true);
    try {
      await switchOrganization(newOrgId);
    } catch (err) {
      // Restore the select to the current org and surface the error
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : t('layout.switchOrgFailed'));
    } finally {
      setSwitching(false);
    }
  }

  const orgs = user?.organizations ?? [];
  const showOrgSwitcher = orgs.length > 1;

  return (
    <div className="app-shell">
      {/* Hamburger button — visible only on mobile via CSS */}
      <button
        className="hamburger-btn"
        onClick={() => setSidebarOpen(v => !v)}
        aria-label={sidebarOpen ? t('layout.closeNav') : t('layout.openNav')}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Mobile top bar — visible only on mobile via CSS */}
      <div className="mobile-topbar">{t('layout.brandName')}</div>

      {/* Backdrop overlay — shown on mobile when sidebar is open */}
      <div
        className={`nav-overlay${sidebarOpen ? ' overlay-open' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside className={`app-sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div style={styles.logo}>{t('layout.brandName')}</div>

        <nav style={styles.nav}>
          {NAV_GROUPS.map((group, idx) => {
            const visibleItems = group.items.filter(
              item => !item.requiredRole || (user && hasRole(user.role, item.requiredRole)),
            );
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.titleKey ?? `group-${idx}`} style={styles.navGroup}>
                {group.titleKey && (
                  <div style={styles.navGroupTitle}>{t(group.titleKey)}</div>
                )}
                {visibleItems.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={closeSidebar}
                    style={({ isActive }) => ({
                      ...styles.navLink,
                      ...(isActive ? styles.navLinkActive : {}),
                    })}
                  >
                    {t(item.labelKey)}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        {/* User info + logout */}
        <div style={styles.userArea}>
          {user && (
            <>
              <div style={styles.userName}>{user.name || user.email}</div>
              <div style={styles.userRole}>{user.role}</div>
              {showOrgSwitcher && (
                <select
                  aria-label={t('layout.orgSwitcherLabel')}
                  value={user.organization_id ?? ''}
                  onChange={handleOrgChange}
                  disabled={switching}
                  style={styles.orgSelect}
                >
                  {orgs.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <button
            onClick={toggleTheme}
            style={styles.themeBtn}
            aria-label={effectiveTheme === 'dark' ? t('darkMode.switchToLight') : t('darkMode.switchToDark')}
            title={effectiveTheme === 'dark' ? t('darkMode.switchToLight') : t('darkMode.switchToDark')}
          >
            {effectiveTheme === 'dark' ? '☀️' : '🌙'}
          </button>
          <ChangelogPanel />
            <button onClick={handleLogout} style={styles.logoutBtn}>
            {t('common.signOut')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="app-main">
        {/* Desktop top bar — contextual brand + org status (hidden on mobile) */}
        <header className="app-topbar">
          <span style={styles.topbarBrand}>{t('layout.brandName')}</span>
          <span className="app-topbar-spacer" />
          {user?.organization_id != null && orgs.length > 0 && (
            <span style={styles.topbarOrg}>
              {orgs.find(o => o.id === user.organization_id)?.name ?? ''}
            </span>
          )}
        </header>
        <DrDrillBanner />
        <Outlet />
      </main>
    </div>
  );
}

const styles = {
  logo: {
    padding: '1.25rem 1rem',
    fontWeight: 700,
    fontSize: '1.1rem',
    color: '#fff',
    borderBottom: '1px solid var(--sidebar-border)',
  },
  topbarBrand: {
    fontWeight: 700,
    fontSize: '0.95rem',
    color: 'var(--text-primary)',
    letterSpacing: '0.01em',
  },
  topbarOrg: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    borderRadius: 9999,
    padding: '3px 10px',
  },
  nav: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '0.5rem 0',
    overflowY: 'auto' as const,
  },
  navGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    paddingBottom: '0.35rem',
  },
  navGroupTitle: {
    padding: '0.6rem 1rem 0.25rem',
    color: 'var(--sidebar-fg-dim)',
    fontSize: '0.68rem',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  navLink: {
    display: 'block',
    padding: '0.5rem 1rem',
    color: 'var(--sidebar-fg-muted)',
    textDecoration: 'none',
    borderRadius: 6,
    margin: '1px 8px',
    transition: 'background .15s, color .15s',
  },
  navLinkActive: {
    background: 'var(--sidebar-active-bg)',
    color: 'var(--sidebar-active-fg)',
  },
  userArea: {
    padding: '0.75rem 1rem',
    borderTop: '1px solid var(--sidebar-border)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  userName: { color: '#fff', fontWeight: 600, fontSize: '0.85rem' },
  userRole: { color: 'var(--sidebar-fg-dim)', fontSize: '0.75rem', textTransform: 'capitalize' as const },
  orgSelect: {
    marginTop: 6,
    background: 'var(--sidebar-hover-bg)',
    color: '#fff',
    border: '1px solid var(--sidebar-border)',
    borderRadius: 4,
    padding: '4px 6px',
    fontSize: '0.8rem',
  },
  logoutBtn: {
    marginTop: 6,
    background: 'transparent',
    border: '1px solid var(--sidebar-border)',
    color: 'var(--sidebar-fg-muted)',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.8rem',
    alignSelf: 'flex-start' as const,
  },
  themeBtn: {
    background: 'transparent',
    border: '1px solid var(--sidebar-border)',
    color: 'var(--sidebar-fg-muted)',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.9rem',
    alignSelf: 'flex-start' as const,
  },
};
