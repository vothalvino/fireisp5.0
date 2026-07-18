// =============================================================================
// FireISP 5.0 — Navigation route registry ("Faro" nav)
// =============================================================================
// Single source of truth for where every routed page lives in the UI.
// Three consumers derive from this registry:
//   1. The sidebar rail (Layout.tsx → NavSection) — items with `rail: true`
//   2. The hub pages (/billing, /network, /admin → HubPage) — items with `card`
//   3. (PR-3) the command palette
//
// Invariants — enforced by src/test/navRegistry.test.ts:
//   • Every path routed in App.tsx appears exactly once here (hubs aside).
//   • Every entry is reachable: rail row and/or hub card.
//   • `guard` mirrors the PrivateRoute wrapper the path is declared under in
//     App.tsx — a row whose guard the user fails would render <NotAllowed/>,
//     so canSee() hides it.
//
// Visibility model — canSee():
//   • `roles` is an explicit allowlist (set membership, NOT rank compare), so
//     the technician=billing rank tie in hasRole() is never consulted for nav.
//   • Legacy `admin` sees everything; `readonly` sees everything its route
//     guards allow ("sees everything, changes nothing" — backend rejects writes).
//   • Allowlists were audited against backend requirePermission slugs and
//     role_permissions seeds (migrations 119/194/197/199/298/365/377) so that
//     no visible row 403s — see PR description for the audit table.
// =============================================================================

import { hasRole } from '@/auth/PrivateRoute';

export type Role = 'admin' | 'billing' | 'support' | 'technician' | 'readonly';

/** PrivateRoute wrapper tier in App.tsx that serves this path. */
export type Guard = 'any' | 'technician' | 'billing' | 'admin';

export type SectionId =
  | 'dashboard'
  | 'clients'
  | 'billing'
  | 'support'
  | 'fieldops'
  | 'network'
  | 'inventory'
  | 'compliance'
  | 'admin';

export interface RouteDef {
  /** Absolute path as routed in App.tsx. */
  path: string;
  /** i18n key for the label (reused by rail, hub cards and palette). */
  labelKey: string;
  section: SectionId;
  /** Must mirror the App.tsx PrivateRoute wrapper — tested. */
  guard: Guard;
  /** Rail subheading id (nav.subsections.<sub>); rail items only. */
  sub?: string;
  /** Hub card id (nav.cards.<card>); hub sections only. */
  card?: string;
  /** True = always-visible sidebar row. Card-only items live on the hub page. */
  rail?: boolean;
  /** Explicit allowlist. Omitted = any authenticated role (guard still applies). */
  roles?: Role[];
  /** Only shown when the active org's compliance locale matches. */
  requiredLocale?: 'MX';
  /**
   * Extra command-palette search terms (untranslated: domain jargon and
   * Spanish synonyms operators actually type — "iva", "corte", "timbrado").
   */
  keywords?: string[];
}

export interface SectionDef {
  id: SectionId;
  labelKey: string;
  kind: 'link' | 'group' | 'hub';
  /** Direct target for kind 'link'. */
  path?: string;
  /** Overview page for kind 'hub' (also the "View all N →" target). */
  hubPath?: string;
  /** Guard of the hub route itself — gates the header link + View-all row. */
  hubGuard?: Guard;
  hubRoles?: Role[];
}

export const SECTIONS: SectionDef[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', kind: 'link', path: '/' },
  { id: 'clients', labelKey: 'nav.sections.clients', kind: 'group' },
  { id: 'billing', labelKey: 'nav.sections.billing', kind: 'hub', hubPath: '/billing', hubGuard: 'billing', hubRoles: ['billing'] },
  { id: 'support', labelKey: 'nav.sections.support', kind: 'group' },
  { id: 'fieldops', labelKey: 'nav.sections.fieldWork', kind: 'group' },
  { id: 'network', labelKey: 'nav.sections.network', kind: 'hub', hubPath: '/network', hubGuard: 'technician', hubRoles: ['technician'] },
  { id: 'inventory', labelKey: 'nav.sections.inventory', kind: 'group' },
  { id: 'compliance', labelKey: 'nav.sections.compliance', kind: 'group' },
  { id: 'admin', labelKey: 'nav.sections.admin', kind: 'hub', hubPath: '/admin', hubGuard: 'admin' },
];

/**
 * Workspace presets — an admin/readonly convenience that prunes the rendered
 * sidebar to one job's sections without touching permissions ("admin, but
 * doing billing today"). 'full' = no pruning. Dashboard is always shown.
 */
export interface WorkspaceDef {
  id: string;
  labelKey: string;
  /** Sections kept visible; undefined = all. */
  sections?: SectionId[];
}

export const WORKSPACES: WorkspaceDef[] = [
  { id: 'full', labelKey: 'nav.workspaces.full' },
  { id: 'billing', labelKey: 'nav.workspaces.billing', sections: ['clients', 'billing', 'support', 'compliance'] },
  { id: 'field', labelKey: 'nav.workspaces.field', sections: ['clients', 'support', 'fieldops', 'network', 'inventory'] },
  { id: 'support', labelKey: 'nav.workspaces.support', sections: ['clients', 'support', 'network'] },
  { id: 'noc', labelKey: 'nav.workspaces.noc', sections: ['network', 'fieldops'] },
];

/** Hub card ordering per hub section (card id → nav.cards.<id>). */
export const HUB_CARDS: Record<string, string[]> = {
  billing: ['receivables', 'collections', 'processing', 'catalogPricing', 'reportsAnalytics', 'configuration'],
  network: ['monitoringNoc', 'radiusAaa', 'ipam', 'devicesConfig', 'pollingAlerting', 'ftthPon', 'cpe', 'wirelessQos', 'accessProvisioning'],
  admin: ['peopleAccess', 'organization', 'automationIntegrations', 'ai', 'governance'],
};

export const ROUTES: RouteDef[] = [
  // --- Clients ---------------------------------------------------------------
  { path: '/clients', labelKey: 'nav.clients', section: 'clients', guard: 'any', sub: 'directory', rail: true },
  { path: '/client-groups', labelKey: 'nav.clientGroups', section: 'clients', guard: 'any', sub: 'directory', rail: true },
  // technician lacks leads.view / surveys.view / tickets.view (mig 194/197/119) — audited
  { path: '/leads', labelKey: 'nav.leads', section: 'clients', guard: 'any', sub: 'sales', rail: true, roles: ['support', 'billing'] },
  { path: '/quotes', labelKey: 'nav.quotes', section: 'clients', guard: 'billing', sub: 'sales', rail: true, roles: ['billing'] },
  { path: '/service-orders', labelKey: 'nav.serviceOrders', section: 'clients', guard: 'any', sub: 'sales', rail: true },
  { path: '/contracts', labelKey: 'nav.contracts', section: 'clients', guard: 'any', sub: 'sales', rail: true },
  { path: '/promotions', labelKey: 'nav.promotions', section: 'clients', guard: 'billing', sub: 'retention', rail: true, roles: ['billing'] },
  { path: '/winback-campaigns', labelKey: 'nav.winbackCampaigns', section: 'clients', guard: 'billing', sub: 'retention', rail: true, roles: ['billing'] },
  { path: '/churn-analytics', labelKey: 'nav.churnAnalytics', section: 'clients', guard: 'billing', sub: 'retention', rail: true, roles: ['billing'] },

  // --- Billing (hub: /billing) ------------------------------------------------
  { path: '/invoices', keywords: ['facturas', 'cobro'], labelKey: 'nav.invoices', section: 'billing', guard: 'any', sub: 'receivables', card: 'receivables', rail: true, roles: ['billing'] },
  { path: '/payments', keywords: ['pagos', 'abonos'], labelKey: 'nav.payments', section: 'billing', guard: 'any', sub: 'receivables', card: 'receivables', rail: true, roles: ['billing'] },
  { path: '/cfdi', keywords: ['sat', 'timbrado', 'stamp', 'factura'], labelKey: 'nav.cfdi', section: 'billing', guard: 'billing', sub: 'receivables', card: 'receivables', rail: true, roles: ['billing'], requiredLocale: 'MX' },
  { path: '/credit-notes', labelKey: 'nav.creditNotes', section: 'billing', guard: 'billing', sub: 'receivables', card: 'receivables', rail: true, roles: ['billing'] },
  { path: '/cash-reconciliation', keywords: ['corte', 'caja'], labelKey: 'nav.cashReconciliation', section: 'billing', guard: 'billing', sub: 'receivables', card: 'receivables', rail: true, roles: ['billing'] },
  { path: '/plans', labelKey: 'nav.plans', section: 'billing', guard: 'billing', sub: 'catalog', card: 'catalogPricing', rail: true, roles: ['billing'] },
  { path: '/billing-disputes', labelKey: 'nav.billingDisputes', section: 'billing', guard: 'billing', sub: 'catalog', card: 'collections', rail: true, roles: ['billing'] },
  { path: '/reports', labelKey: 'nav.reports', section: 'billing', guard: 'billing', sub: 'catalog', card: 'reportsAnalytics', rail: true, roles: ['billing'] },
  { path: '/billing-adjustments', labelKey: 'nav.billingAdjustments', section: 'billing', guard: 'billing', card: 'receivables', roles: ['billing'] },
  { path: '/expenses', labelKey: 'nav.expenses', section: 'billing', guard: 'billing', card: 'receivables', roles: ['billing'] },
  { path: '/payment-plans', keywords: ['morosos', 'convenio'], labelKey: 'nav.paymentPlans', section: 'billing', guard: 'billing', card: 'collections', roles: ['billing'] },
  { path: '/refund-requests', labelKey: 'nav.refundRequests', section: 'billing', guard: 'billing', card: 'collections', roles: ['billing'] },
  { path: '/chargebacks', labelKey: 'nav.chargebacks', section: 'billing', guard: 'billing', card: 'collections', roles: ['billing'] },
  { path: '/payment-gateways', labelKey: 'nav.paymentGateways', section: 'billing', guard: 'billing', card: 'processing', roles: ['billing'] },
  { path: '/payment-transactions', labelKey: 'nav.paymentTransactions', section: 'billing', guard: 'billing', card: 'processing', roles: ['billing'] },
  { path: '/recurring-payment-profiles', labelKey: 'nav.recurringPaymentProfiles', section: 'billing', guard: 'billing', card: 'processing', roles: ['billing'] },
  { path: '/tax-reports', keywords: ['iva', 'impuestos', 'fiscal'], labelKey: 'nav.taxReports', section: 'billing', guard: 'billing', card: 'reportsAnalytics', roles: ['billing'] },
  { path: '/analytics-dashboard', labelKey: 'nav.analyticsDashboard', section: 'billing', guard: 'billing', card: 'reportsAnalytics', roles: ['billing'] },
  { path: '/tax-rules', keywords: ['iva', 'impuestos'], labelKey: 'nav.taxRules', section: 'billing', guard: 'billing', card: 'configuration', roles: ['billing'] },
  { path: '/tax-rates', keywords: ['iva', 'impuestos'], labelKey: 'nav.taxRates', section: 'billing', guard: 'billing', card: 'configuration', roles: ['billing'] },
  { path: '/invoice-settings', labelKey: 'nav.invoiceSettings', section: 'billing', guard: 'billing', card: 'configuration', roles: ['billing'] },
  { path: '/late-fee-rules', keywords: ['mora', 'morosos', 'recargos'], labelKey: 'nav.lateFeeRules', section: 'billing', guard: 'billing', card: 'configuration', roles: ['billing'] },
  { path: '/payment-reminder-settings', labelKey: 'nav.paymentReminderSettings', section: 'billing', guard: 'billing', card: 'configuration', roles: ['billing'] },

  // --- Support -----------------------------------------------------------------
  // tickets.view: support (119) + technician (394; sees all categories except
  // billing — tickets.view_billing gates those). Billing still lacks tickets.view.
  { path: '/tickets', keywords: ['soporte', 'casos'], labelKey: 'nav.tickets', section: 'support', guard: 'any', rail: true, roles: ['support', 'technician'] },
  // escalations.view: technician+support (197) + billing (394)
  { path: '/escalations', labelKey: 'nav.escalations', section: 'support', guard: 'any', rail: true, roles: ['technician', 'support', 'billing'] },
  { path: '/follow-up-reminders', labelKey: 'nav.followUps', section: 'support', guard: 'any', rail: true, roles: ['technician', 'support', 'billing'] },
  { path: '/communication-campaigns', labelKey: 'nav.communicationCampaigns', section: 'support', guard: 'any', rail: true, roles: ['technician', 'support', 'billing'] },
  { path: '/satisfaction-surveys', labelKey: 'nav.surveys', section: 'support', guard: 'any', rail: true, roles: ['support', 'billing'] },

  // --- Field Ops -----------------------------------------------------------------
  { path: '/work-orders', keywords: ['visita', 'instalacion'], labelKey: 'nav.workOrders', section: 'fieldops', guard: 'technician', rail: true, roles: ['technician'] },
  { path: '/maintenance-windows', labelKey: 'nav.maintenanceWindows', section: 'fieldops', guard: 'technician', rail: true, roles: ['technician'] },
  { path: '/sites', labelKey: 'nav.sites', section: 'fieldops', guard: 'technician', rail: true, roles: ['technician'] },
  { path: '/coverage-zones', labelKey: 'nav.coverageZones', section: 'fieldops', guard: 'technician', rail: true, roles: ['technician'] },
  { path: '/service-areas', labelKey: 'nav.serviceAreas', section: 'fieldops', guard: 'technician', rail: true, roles: ['technician'] },

  // --- Network (hub: /network) ---------------------------------------------------
  // noc.view: admin/support/readonly (298) + technician (394); support/readonly
  // still fail the technician route guard
  { path: '/noc-dashboard', labelKey: 'nav.nocDashboard', section: 'network', guard: 'technician', card: 'monitoringNoc', rail: true, roles: ['technician'] },
  // support lacks devices.view (deliberately — see mig 383 notes) — audited
  { path: '/devices', labelKey: 'nav.devices', section: 'network', guard: 'any', card: 'monitoringNoc', rail: true, roles: ['technician'] },
  // any-auth guard + support in the allowlist: support has network_health.view /
  // outages.view via mig 377 — the "is it down?" subset
  { path: '/network-health', labelKey: 'nav.networkHealth', section: 'network', guard: 'any', card: 'monitoringNoc', rail: true, roles: ['technician', 'support'] },
  { path: '/outages', keywords: ['down', 'caida', 'fuera de servicio'], labelKey: 'nav.outages', section: 'network', guard: 'any', card: 'monitoringNoc', rail: true, roles: ['technician', 'support'] },
  { path: '/radius-sessions', keywords: ['pppoe', 'sesiones', 'online'], labelKey: 'nav.radiusSessions', section: 'network', guard: 'technician', card: 'radiusAaa', rail: true, roles: ['technician'] },
  { path: '/nas', keywords: ['mikrotik', 'router', 'bras'], labelKey: 'nav.nas', section: 'network', guard: 'technician', card: 'devicesConfig', rail: true, roles: ['technician'] },
  { path: '/ip-pools', labelKey: 'nav.ipPools', section: 'network', guard: 'technician', card: 'ipam', rail: true, roles: ['technician'] },
  // carries a card so the hub shows it and "View all N" counts stay honest
  { path: '/wg-tunnels', keywords: ['wireguard', 'vpn'], labelKey: 'nav.myWgTunnels', section: 'network', guard: 'any', card: 'accessProvisioning', rail: true },
  { path: '/speed-tests', labelKey: 'nav.speedTests', section: 'network', guard: 'technician', card: 'monitoringNoc', roles: ['technician'] },
  { path: '/connection-logs', labelKey: 'nav.connectionLogs', section: 'network', guard: 'technician', card: 'monitoringNoc', roles: ['technician'] },
  { path: '/topology-map', labelKey: 'nav.topologyMap', section: 'network', guard: 'technician', card: 'monitoringNoc', roles: ['technician'] },
  { path: '/snmp-metrics', labelKey: 'nav.snmpMetrics', section: 'network', guard: 'technician', card: 'monitoringNoc', roles: ['technician'] },
  { path: '/snmp-traps', labelKey: 'nav.snmpTraps', section: 'network', guard: 'technician', card: 'monitoringNoc', roles: ['technician'] },
  { path: '/session-accounting', labelKey: 'nav.sessionAccounting', section: 'network', guard: 'technician', card: 'radiusAaa', roles: ['technician'] },
  { path: '/subscriber-certificates', labelKey: 'nav.subscriberCertificates', section: 'network', guard: 'technician', card: 'radiusAaa', roles: ['technician'] },
  { path: '/mac-move-events', labelKey: 'nav.macMoveEvents', section: 'network', guard: 'technician', card: 'radiusAaa', roles: ['technician'] },
  { path: '/pppoe-service-profiles', labelKey: 'nav.pppoeServiceProfiles', section: 'network', guard: 'technician', card: 'radiusAaa', roles: ['technician'] },
  { path: '/pppoe-diagnostics', labelKey: 'nav.pppoeDiagnostics', section: 'network', guard: 'technician', card: 'radiusAaa', roles: ['technician'] },
  { path: '/ip-assignments', labelKey: 'nav.ipAssignments', section: 'network', guard: 'technician', card: 'ipam', roles: ['technician'] },
  { path: '/vlans', labelKey: 'nav.vlans', section: 'network', guard: 'technician', card: 'ipam', roles: ['technician'] },
  { path: '/dhcp-servers', labelKey: 'nav.dhcpServers', section: 'network', guard: 'technician', card: 'ipam', roles: ['technician'] },
  { path: '/nat-management', labelKey: 'nav.natManagement', section: 'network', guard: 'technician', card: 'ipam', roles: ['technician'] },
  { path: '/ptr-records', labelKey: 'nav.ptrRecords', section: 'network', guard: 'technician', card: 'ipam', roles: ['technician'] },
  { path: '/ipv6-management', labelKey: 'nav.ipv6Management', section: 'network', guard: 'technician', card: 'ipam', roles: ['technician'] },
  { path: '/transition-mechanisms', labelKey: 'nav.transitionMechanisms', section: 'network', guard: 'technician', card: 'ipam', roles: ['technician'] },
  { path: '/device-groups', labelKey: 'nav.deviceGroups', section: 'network', guard: 'technician', card: 'devicesConfig', roles: ['technician'] },
  { path: '/discovery-scans', labelKey: 'nav.discoveryScans', section: 'network', guard: 'technician', card: 'devicesConfig', roles: ['technician'] },
  { path: '/device-import', labelKey: 'nav.deviceImport', section: 'network', guard: 'technician', card: 'devicesConfig', roles: ['technician'] },
  { path: '/snmp-profiles', labelKey: 'nav.snmpProfiles', section: 'network', guard: 'technician', card: 'devicesConfig', roles: ['technician'] },
  { path: '/device-config-backups', labelKey: 'nav.deviceConfigBackups', section: 'network', guard: 'technician', card: 'devicesConfig', roles: ['technician'] },
  { path: '/config-templates', labelKey: 'nav.configTemplates', section: 'network', guard: 'technician', card: 'devicesConfig', roles: ['technician'] },
  { path: '/config-backup-schedules', labelKey: 'nav.configBackupSchedules', section: 'network', guard: 'technician', card: 'devicesConfig', roles: ['technician'] },
  { path: '/config-compliance-rules', labelKey: 'nav.configComplianceRules', section: 'network', guard: 'technician', card: 'devicesConfig', roles: ['technician'] },
  { path: '/poller-nodes', labelKey: 'nav.pollerNodes', section: 'network', guard: 'technician', card: 'pollingAlerting', roles: ['technician'] },
  { path: '/device-polling-configs', labelKey: 'nav.devicePollingConfigs', section: 'network', guard: 'technician', card: 'pollingAlerting', roles: ['technician'] },
  { path: '/poller-performance', labelKey: 'nav.pollerPerformance', section: 'network', guard: 'technician', card: 'pollingAlerting', roles: ['technician'] },
  { path: '/trap-forwarding-rules', labelKey: 'nav.trapForwardingRules', section: 'network', guard: 'technician', card: 'pollingAlerting', roles: ['technician'] },
  { path: '/alert-channels', labelKey: 'nav.alertChannels', section: 'network', guard: 'technician', card: 'pollingAlerting', roles: ['technician'] },
  { path: '/alert-escalation-chains', labelKey: 'nav.alertEscalationChains', section: 'network', guard: 'technician', card: 'pollingAlerting', roles: ['technician'] },
  { path: '/alert-suppression-rules', labelKey: 'nav.alertSuppressionRules', section: 'network', guard: 'technician', card: 'pollingAlerting', roles: ['technician'] },
  { path: '/olt-management', labelKey: 'nav.oltManagement', section: 'network', guard: 'technician', card: 'ftthPon', roles: ['technician'] },
  { path: '/onu-management', keywords: ['ftth', 'fibra', 'provision'], labelKey: 'nav.onuManagement', section: 'network', guard: 'technician', card: 'ftthPon', roles: ['technician'] },
  { path: '/pon-port-management', labelKey: 'nav.ponPortManagement', section: 'network', guard: 'technician', card: 'ftthPon', roles: ['technician'] },
  { path: '/fiber-plant-management', labelKey: 'nav.fiberPlantManagement', section: 'network', guard: 'technician', card: 'ftthPon', roles: ['technician'] },
  { path: '/cpe-management', labelKey: 'nav.cpeManagement', section: 'network', guard: 'technician', card: 'cpe', roles: ['technician'] },
  // cpe_profiles.view is admin-only (mig 276; 391's CPE grants to technician
  // cover devices/inventory/lifecycle, not profiles)
  { path: '/cpe-profiles', labelKey: 'nav.cpeProfiles', section: 'network', guard: 'technician', card: 'cpe', roles: ['admin'] },
  { path: '/cpe-diagnostics', labelKey: 'nav.cpeDiagnostics', section: 'network', guard: 'technician', card: 'cpe', roles: ['technician'] },
  { path: '/wireless', labelKey: 'nav.wireless', section: 'network', guard: 'technician', card: 'wirelessQos', roles: ['technician'] },
  { path: '/wireless-metrics', labelKey: 'nav.wirelessMetrics', section: 'network', guard: 'technician', card: 'wirelessQos', roles: ['technician'] },
  { path: '/qos-bandwidth', labelKey: 'nav.qosBandwidth', section: 'network', guard: 'technician', card: 'wirelessQos', roles: ['technician'] },
  { path: '/suspension-rules', labelKey: 'nav.suspensionRules', section: 'network', guard: 'technician', card: 'accessProvisioning', roles: ['technician'] },

  // --- Inventory ---------------------------------------------------------------
  { path: '/inventory', labelKey: 'nav.inventory', section: 'inventory', guard: 'technician', sub: 'stock', rail: true, roles: ['technician'] },
  { path: '/inventory-management', labelKey: 'nav.inventoryManagement', section: 'inventory', guard: 'technician', sub: 'stock', rail: true, roles: ['technician'] },
  { path: '/warehouses', labelKey: 'nav.warehouses', section: 'inventory', guard: 'technician', sub: 'stock', rail: true, roles: ['technician'] },
  { path: '/cpe-inventory', labelKey: 'nav.cpeInventory', section: 'inventory', guard: 'technician', sub: 'stock', rail: true, roles: ['technician'] },
  { path: '/vendors', labelKey: 'nav.vendors', section: 'inventory', guard: 'technician', sub: 'purchasing', rail: true, roles: ['technician'] },
  { path: '/purchase-orders', labelKey: 'nav.purchaseOrders', section: 'inventory', guard: 'technician', sub: 'purchasing', rail: true, roles: ['technician'] },

  // --- Compliance -----------------------------------------------------------------
  { path: '/csd-certificates', labelKey: 'nav.csdCertificates', section: 'compliance', guard: 'billing', sub: 'cfdiSat', rail: true, roles: ['billing'], requiredLocale: 'MX' },
  { path: '/pac-providers', labelKey: 'nav.pacProviders', section: 'compliance', guard: 'billing', sub: 'cfdiSat', rail: true, roles: ['billing'], requiredLocale: 'MX' },
  { path: '/sat-catalogs', labelKey: 'nav.satCatalogs', section: 'compliance', guard: 'billing', sub: 'cfdiSat', rail: true, roles: ['billing'], requiredLocale: 'MX' },
  { path: '/facturas-publicas', labelKey: 'nav.facturasPublicas', section: 'compliance', guard: 'billing', sub: 'cfdiSat', rail: true, roles: ['billing'], requiredLocale: 'MX' },
  { path: '/regulatory-filings', labelKey: 'nav.regulatoryFilings', section: 'compliance', guard: 'billing', sub: 'ift', rail: true, roles: ['billing'], requiredLocale: 'MX' },
  { path: '/concession-titles', labelKey: 'nav.concessionTitles', section: 'compliance', guard: 'billing', sub: 'ift', rail: true, roles: ['billing'], requiredLocale: 'MX' },
  { path: '/ift-statistical-reports', labelKey: 'nav.iftStatisticalReports', section: 'compliance', guard: 'billing', sub: 'ift', rail: true, roles: ['billing'], requiredLocale: 'MX' },
  { path: '/profeco-complaints', labelKey: 'nav.profecoComplaints', section: 'compliance', guard: 'billing', sub: 'consumer', rail: true, roles: ['billing'], requiredLocale: 'MX' },
  // deliberately NOT MX-gated — Compliance still renders for non-Mexico orgs
  { path: '/regulatory-compliance', labelKey: 'nav.regulatoryCompliance', section: 'compliance', guard: 'billing', sub: 'general', rail: true, roles: ['billing'] },

  // --- Admin (hub: /admin) ---------------------------------------------------------
  { path: '/users', labelKey: 'nav.users', section: 'admin', guard: 'admin', card: 'peopleAccess', rail: true },
  { path: '/roles', labelKey: 'nav.roles', section: 'admin', guard: 'admin', card: 'peopleAccess', rail: true },
  { path: '/organizations', labelKey: 'nav.organizations', section: 'admin', guard: 'admin', card: 'organization', rail: true },
  { path: '/settings', labelKey: 'nav.settings', section: 'admin', guard: 'admin', card: 'organization', rail: true },
  { path: '/automation', labelKey: 'nav.automation', section: 'admin', guard: 'admin', card: 'automationIntegrations', rail: true },
  { path: '/audit-logs', labelKey: 'nav.auditLogs', section: 'admin', guard: 'admin', card: 'governance', rail: true },
  { path: '/security-access-control', labelKey: 'nav.securityAccessControl', section: 'admin', guard: 'admin', card: 'peopleAccess' },
  { path: '/api-tokens', labelKey: 'nav.apiTokens', section: 'admin', guard: 'admin', card: 'peopleAccess' },
  { path: '/resellers', labelKey: 'nav.resellers', section: 'admin', guard: 'admin', card: 'organization' },
  { path: '/sla-definitions', labelKey: 'nav.slaDefinitions', section: 'admin', guard: 'admin', card: 'organization' },
  { path: '/scheduled-tasks', labelKey: 'nav.scheduledTasks', section: 'admin', guard: 'admin', card: 'automationIntegrations' },
  { path: '/queue-stats', labelKey: 'nav.queueStats', section: 'admin', guard: 'admin', card: 'automationIntegrations' },
  { path: '/webhooks', labelKey: 'nav.webhooks', section: 'admin', guard: 'admin', card: 'automationIntegrations' },
  { path: '/integrations', labelKey: 'nav.integrations', section: 'admin', guard: 'admin', card: 'automationIntegrations' },
  { path: '/message-templates', labelKey: 'nav.messageTemplates', section: 'admin', guard: 'admin', card: 'automationIntegrations' },
  { path: '/ai-assistant', labelKey: 'nav.aiAssistant', section: 'admin', guard: 'admin', card: 'ai' },
  { path: '/ai-support', labelKey: 'nav.aiSupport', section: 'admin', guard: 'admin', card: 'ai' },
  { path: '/dsar', labelKey: 'nav.dsar', section: 'admin', guard: 'admin', card: 'governance' },
  { path: '/dr-drill', labelKey: 'nav.drDrill', section: 'admin', guard: 'admin', card: 'governance' },
  { path: '/backups', labelKey: 'nav.backups', section: 'admin', guard: 'admin', card: 'governance' },
  { path: '/admin/user-tunnels', labelKey: 'nav.adminUserTunnels', section: 'admin', guard: 'admin', card: 'governance' },
];

// =============================================================================
// Visibility + tree helpers
// =============================================================================

export interface NavUser {
  role: string;
  organization_locale?: string;
}

export function canSee(
  user: NavUser,
  node: { guard?: Guard; roles?: Role[]; requiredLocale?: 'MX' },
): boolean {
  if (node.requiredLocale && user.organization_locale !== node.requiredLocale) return false;
  if (user.role === 'admin') return true;
  // A row whose route guard the user fails would render <NotAllowed/> — hide it.
  if (node.guard && node.guard !== 'any' && !hasRole(user.role, node.guard)) return false;
  // readonly sees everything its guards allow; backend rejects writes.
  if (user.role === 'readonly') return true;
  return !node.roles || node.roles.includes(user.role as Role);
}

/** Rail rows of a section, in registry order. */
export function visibleRailItems(user: NavUser, sectionId: SectionId): RouteDef[] {
  return ROUTES.filter(r => r.section === sectionId && r.rail && canSee(user, r));
}

/** Everything reachable in a section (rail + hub cards) — the "View all N" count. */
export function visibleSectionCount(user: NavUser, sectionId: SectionId): number {
  return ROUTES.filter(r => r.section === sectionId && canSee(user, r)).length;
}

/** Whether the hub header link / "View all" row may be shown. */
export function canSeeHub(user: NavUser, section: SectionDef): boolean {
  if (section.kind !== 'hub' || !section.hubPath) return false;
  return canSee(user, { guard: section.hubGuard, roles: section.hubRoles });
}

/** Hub card contents for HubPage, keyed by card id in HUB_CARDS order. */
export function visibleHubCards(user: NavUser, sectionId: SectionId): { card: string; items: RouteDef[] }[] {
  const order = HUB_CARDS[sectionId] ?? [];
  return order
    .map(card => ({
      card,
      items: ROUTES.filter(r => r.section === sectionId && r.card === card && canSee(user, r)),
    }))
    .filter(c => c.items.length > 0);
}

const HUB_PATHS: Record<string, SectionId> = { '/billing': 'billing', '/network': 'network', '/admin': 'admin' };

/** Owning section for a pathname (active trail) — longest-prefix match. */
export function sectionForPath(pathname: string): SectionId | null {
  if (pathname === '/') return 'dashboard';
  const candidates: { path: string; section: SectionId }[] = [
    ...ROUTES.map(r => ({ path: r.path, section: r.section })),
    ...Object.entries(HUB_PATHS).map(([path, section]) => ({ path, section })),
  ];
  let best: { path: string; section: SectionId } | null = null;
  for (const c of candidates) {
    if (pathname === c.path || pathname.startsWith(`${c.path}/`)) {
      if (!best || c.path.length > best.path.length) best = c;
    }
  }
  return best?.section ?? null;
}

/** Section auto-opened on first load, per persona. */
export function defaultExpandedSection(role: string): SectionId | null {
  switch (role) {
    case 'technician': return 'fieldops';
    case 'billing': return 'billing';
    case 'support': return 'support';
    case 'readonly': return null;
    default: return 'clients'; // admin
  }
}
