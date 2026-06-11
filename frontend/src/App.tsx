// =============================================================================
// FireISP 5.0 — App Router
// =============================================================================
// Implements role-based UI routing:
//   • Public routes: /login
//   • Protected routes (any authenticated user): /, /clients, /contracts, etc.
//   • Admin-only routes: /users, /settings
//   • Billing+ routes: /reports
// =============================================================================

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/auth/AuthContext';
import { PrivateRoute } from '@/auth/PrivateRoute';
import { Layout } from '@/components/Layout';
import { Login } from '@/pages/Login';
import { PortalAuthProvider } from '@/auth/PortalAuthContext';
import { PortalRoute } from '@/auth/PortalRoute';
import { PortalLayout } from '@/components/PortalLayout';
import { PortalLogin } from '@/pages/portal/PortalLogin';
import { PortalDashboard } from '@/pages/portal/PortalDashboard';
import { PortalInvoices } from '@/pages/portal/PortalInvoices';
import { PortalInvoiceDetail } from '@/pages/portal/PortalInvoiceDetail';
import { PortalTickets } from '@/pages/portal/PortalTickets';
import { PortalTicketDetail } from '@/pages/portal/PortalTicketDetail';
import { Dashboard } from '@/pages/Dashboard';
import { ClientList } from '@/pages/ClientList';
import { ClientDetail } from '@/pages/ClientDetail';
import { ClientGroupList } from '@/pages/ClientGroupList';
import { LeadList } from '@/pages/LeadList';
import { ServiceOrderList } from '@/pages/ServiceOrderList';
import { WinbackCampaignList } from '@/pages/WinbackCampaignList';
import { CommunicationCampaignList } from '@/pages/CommunicationCampaignList';
import { ChurnAnalytics } from '@/pages/ChurnAnalytics';
import { ContractList } from '@/pages/ContractList';
import { InvoiceList } from '@/pages/InvoiceList';
import { InvoiceDetail } from '@/pages/InvoiceDetail';
import { PaymentList } from '@/pages/PaymentList';
import { TicketList } from '@/pages/TicketList';
import { TicketDetail } from '@/pages/TicketDetail';
import { FollowUpReminderList } from '@/pages/FollowUpReminderList';
import { SatisfactionSurveyList } from '@/pages/SatisfactionSurveyList';
import { EscalationList } from '@/pages/EscalationList';
import { DeviceMap } from '@/pages/DeviceMap';
import { UserList } from '@/pages/UserList';
import { CfdiList } from '@/pages/CfdiList';
import { PlanList } from '@/pages/PlanList';
import { QuoteList } from '@/pages/QuoteList';
import { CreditNoteList } from '@/pages/CreditNoteList';
import { ExpenseList } from '@/pages/ExpenseList';
import { InventoryList } from '@/pages/InventoryList';
import { WarehouseList } from '@/pages/WarehouseList';
import { CoverageZoneMap } from '@/pages/CoverageZoneMap';
import { RadiusSessions } from '@/pages/RadiusSessions';
import { SessionAccounting } from '@/pages/SessionAccounting';
import { SnmpMetrics } from '@/pages/SnmpMetrics';
import { SnmpTraps } from '@/pages/SnmpTraps';
import { SiteList } from '@/pages/SiteList';
import { NasList } from '@/pages/NasList';
import { MacMoveEvents } from '@/pages/MacMoveEvents';
import { PppoeServiceProfileList } from '@/pages/PppoeServiceProfileList';
import { PppoeDiagnostics } from '@/pages/PppoeDiagnostics';
import { DhcpServerList } from '@/pages/DhcpServerList';
import { NatManagementList } from '@/pages/NatManagementList';
import { PtrRecordList } from '@/pages/PtrRecordList';
import { Ipv6ManagementPage } from '@/pages/Ipv6ManagementPage';
import { TransitionMechanismsPage } from '@/pages/TransitionMechanismsPage';
import { DeviceGroupList } from '@/pages/DeviceGroupList';
import { DiscoveryScanList } from '@/pages/DiscoveryScanList';
import { TrapForwardingRuleList } from '@/pages/TrapForwardingRuleList';
import { PollerNodeList } from '@/pages/PollerNodeList';
import { DevicePollingConfigList } from '@/pages/DevicePollingConfigList';
import { PollerPerformanceDashboard } from '@/pages/PollerPerformanceDashboard';
import { AlertEscalationChainList } from '@/pages/AlertEscalationChainList';
import { MaintenanceWindowList } from '@/pages/MaintenanceWindowList';
import { AlertChannelList } from '@/pages/AlertChannelList';
import { AlertSuppressionList } from '@/pages/AlertSuppressionList';
import { IpPoolList } from '@/pages/IpPoolList';
import { IpAssignmentList } from '@/pages/IpAssignmentList';
import { VlanList } from '@/pages/VlanList';
import { ServiceAreaList } from '@/pages/ServiceAreaList';
import { OutageList } from '@/pages/OutageList';
import { SpeedTestList } from '@/pages/SpeedTestList';
import { ConnectionLogList } from '@/pages/ConnectionLogList';
import { NetworkHealthList } from '@/pages/NetworkHealthList';
import { SnmpProfileList } from '@/pages/SnmpProfileList';
import { DeviceConfigBackupList } from '@/pages/DeviceConfigBackupList';
import { SuspensionRuleList } from '@/pages/SuspensionRuleList';
import { Reports } from '@/pages/Reports';
import { TaxReports } from '@/pages/TaxReports';
import { InvoiceSettings } from '@/pages/InvoiceSettings';
import { LateFeeRuleList } from '@/pages/LateFeeRuleList';
import { PaymentReminderSettings } from '@/pages/PaymentReminderSettings';
import { Settings } from '@/pages/Settings';
import { ProfecoComplaints } from '@/pages/ProfecoComplaints';
import { SlaDefinitionList } from '@/pages/SlaDefinitionList';
import { RoleList } from '@/pages/RoleList';
import { ApiTokenList } from '@/pages/ApiTokenList';
import { WebhookList } from '@/pages/WebhookList';
import { AuditLogList } from '@/pages/AuditLogList';
import { ScheduledTaskList } from '@/pages/ScheduledTaskList';
import { OrganizationList } from '@/pages/OrganizationList';
import { DsarTool } from '@/pages/DsarTool';
import { DrDrillStatus } from '@/pages/DrDrillStatus';
import { JobList } from '@/pages/JobList';
import { QueueStats } from '@/pages/QueueStats';
import { CsdCertificateList } from '@/pages/CsdCertificateList';
import { PacProviderList } from '@/pages/PacProviderList';
import { SatCatalogList } from '@/pages/SatCatalogList';
import { RegulatoryFilingList } from '@/pages/RegulatoryFilingList';
import { ConcessionTitleList } from '@/pages/ConcessionTitleList';
import { IftStatisticalReportList } from '@/pages/IftStatisticalReportList';
import { FacturaPublicaList } from '@/pages/FacturaPublicaList';
import { MessageTemplateList } from '@/pages/MessageTemplateList';
import { PromotionList } from '@/pages/PromotionList';
import { TaxRuleList } from '@/pages/TaxRuleList';
import { TaxRateList } from '@/pages/TaxRateList';
import { PaymentGatewayList } from '@/pages/PaymentGatewayList';
import { PaymentTransactionList } from '@/pages/PaymentTransactionList';
import { RecurringPaymentProfileList } from '@/pages/RecurringPaymentProfileList';
import { PaymentPlanList } from '@/pages/PaymentPlanList';
import { CashReconciliationList } from '@/pages/CashReconciliationList';
import { RefundRequestList } from '@/pages/RefundRequestList';
import { BillingDisputeList } from '@/pages/BillingDisputeList';
import { ChargebackList } from '@/pages/ChargebackList';
import { BillingAdjustmentList } from '@/pages/BillingAdjustmentList';
import { AIAssistantSettings } from '@/pages/AIAssistantSettings';
import { NotFound } from '@/pages/NotFound';
import { DarkModeProvider } from '@/auth/DarkModeContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export function App() {
  return (
    <DarkModeProvider>
      <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PortalAuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<Login />} />

              {/* ---- Client Self-Service Portal ---- */}
              <Route path="/portal/login" element={<PortalLogin />} />
              <Route element={<PortalRoute />}>
                <Route element={<PortalLayout />}>
                  <Route path="/portal" element={<PortalDashboard />} />
                  <Route path="/portal/invoices" element={<PortalInvoices />} />
                  <Route path="/portal/invoices/:id" element={<PortalInvoiceDetail />} />
                  <Route path="/portal/tickets" element={<PortalTickets />} />
                  <Route path="/portal/tickets/:id" element={<PortalTicketDetail />} />
                </Route>
              </Route>

            {/* Protected — any authenticated user */}
            <Route element={<PrivateRoute />}>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="clients" element={<ClientList />} />
                <Route path="clients/:id" element={<ClientDetail />} />
                <Route path="client-groups" element={<ClientGroupList />} />
                <Route path="leads" element={<LeadList />} />
                <Route path="service-orders" element={<ServiceOrderList />} />
                <Route path="contracts" element={<ContractList />} />
                <Route path="invoices" element={<InvoiceList />} />
                <Route path="invoices/:id" element={<InvoiceDetail />} />
                <Route path="payments" element={<PaymentList />} />
                <Route path="tickets" element={<TicketList />} />
                <Route path="tickets/:id" element={<TicketDetail />} />
                <Route path="communication-campaigns" element={<CommunicationCampaignList />} />
                <Route path="follow-up-reminders" element={<FollowUpReminderList />} />
                <Route path="satisfaction-surveys" element={<SatisfactionSurveyList />} />
                <Route path="escalations" element={<EscalationList />} />
                <Route path="devices" element={<DeviceMap />} />
              </Route>
            </Route>

            {/* Technician+ — technician, billing, or admin */}
            <Route element={<PrivateRoute requiredRole="technician" />}>
              <Route element={<Layout />}>
                <Route path="inventory" element={<InventoryList />} />
                <Route path="warehouses" element={<WarehouseList />} />
                <Route path="radius-sessions" element={<RadiusSessions />} />
                <Route path="session-accounting" element={<SessionAccounting />} />
                <Route path="snmp-metrics" element={<SnmpMetrics />} />
                <Route path="snmp-traps" element={<SnmpTraps />} />
                <Route path="coverage-zones" element={<CoverageZoneMap />} />
                <Route path="sites" element={<SiteList />} />
                <Route path="nas" element={<NasList />} />
                <Route path="mac-move-events" element={<MacMoveEvents />} />
                <Route path="pppoe-service-profiles" element={<PppoeServiceProfileList />} />
                <Route path="pppoe-diagnostics" element={<PppoeDiagnostics />} />
                <Route path="ip-pools" element={<IpPoolList />} />
                <Route path="ip-assignments" element={<IpAssignmentList />} />
                <Route path="vlans" element={<VlanList />} />
                <Route path="service-areas" element={<ServiceAreaList />} />
                <Route path="outages" element={<OutageList />} />
                <Route path="speed-tests" element={<SpeedTestList />} />
                <Route path="connection-logs" element={<ConnectionLogList />} />
                <Route path="network-health" element={<NetworkHealthList />} />
                <Route path="snmp-profiles" element={<SnmpProfileList />} />
                <Route path="device-config-backups" element={<DeviceConfigBackupList />} />
                <Route path="suspension-rules" element={<SuspensionRuleList />} />
                <Route path="dhcp-servers" element={<DhcpServerList />} />
                <Route path="nat-management" element={<NatManagementList />} />
                <Route path="ptr-records" element={<PtrRecordList />} />
                <Route path="ipv6-management" element={<Ipv6ManagementPage />} />
                <Route path="transition-mechanisms" element={<TransitionMechanismsPage />} />
                <Route path="device-groups" element={<DeviceGroupList />} />
                <Route path="discovery-scans" element={<DiscoveryScanList />} />
                <Route path="trap-forwarding-rules" element={<TrapForwardingRuleList />} />
                <Route path="poller-nodes" element={<PollerNodeList />} />
                <Route path="device-polling-configs" element={<DevicePollingConfigList />} />
                <Route path="poller-performance" element={<PollerPerformanceDashboard />} />
                <Route path="alert-escalation-chains" element={<AlertEscalationChainList />} />
                <Route path="maintenance-windows" element={<MaintenanceWindowList />} />
                <Route path="alert-channels" element={<AlertChannelList />} />
                <Route path="alert-suppression-rules" element={<AlertSuppressionList />} />
              </Route>
            </Route>

            {/* Billing+ — billing or admin */}
            <Route element={<PrivateRoute requiredRole="billing" />}>
              <Route element={<Layout />}>
                <Route path="cfdi" element={<CfdiList />} />
                <Route path="plans" element={<PlanList />} />
                <Route path="quotes" element={<QuoteList />} />
                <Route path="credit-notes" element={<CreditNoteList />} />
                <Route path="expenses" element={<ExpenseList />} />
                <Route path="promotions" element={<PromotionList />} />
                <Route path="tax-rules" element={<TaxRuleList />} />
                <Route path="tax-rates" element={<TaxRateList />} />
                <Route path="payment-gateways" element={<PaymentGatewayList />} />
                <Route path="payment-transactions" element={<PaymentTransactionList />} />
                <Route path="recurring-payment-profiles" element={<RecurringPaymentProfileList />} />
                <Route path="payment-plans" element={<PaymentPlanList />} />
                <Route path="cash-reconciliation" element={<CashReconciliationList />} />
                <Route path="refund-requests" element={<RefundRequestList />} />
                <Route path="billing-disputes" element={<BillingDisputeList />} />
                <Route path="chargebacks" element={<ChargebackList />} />
                <Route path="billing-adjustments" element={<BillingAdjustmentList />} />
                <Route path="winback-campaigns" element={<WinbackCampaignList />} />
                <Route path="churn-analytics" element={<ChurnAnalytics />} />
                <Route path="csd-certificates" element={<CsdCertificateList />} />
                <Route path="pac-providers" element={<PacProviderList />} />
                <Route path="sat-catalogs" element={<SatCatalogList />} />
                <Route path="regulatory-filings" element={<RegulatoryFilingList />} />
                <Route path="concession-titles" element={<ConcessionTitleList />} />
                <Route path="ift-statistical-reports" element={<IftStatisticalReportList />} />
                <Route path="facturas-publicas" element={<FacturaPublicaList />} />
                <Route path="reports" element={<Reports />} />
                <Route path="tax-reports" element={<TaxReports />} />
                <Route path="invoice-settings" element={<InvoiceSettings />} />
                <Route path="late-fee-rules" element={<LateFeeRuleList />} />
                <Route path="payment-reminder-settings" element={<PaymentReminderSettings />} />
                <Route path="profeco-complaints" element={<ProfecoComplaints />} />
              </Route>
            </Route>

            {/* Admin-only */}
            <Route element={<PrivateRoute requiredRole="admin" />}>
              <Route element={<Layout />}>
                <Route path="users" element={<UserList />} />
                <Route path="organizations" element={<OrganizationList />} />
                <Route path="dsar" element={<DsarTool />} />
                <Route path="dr-drill" element={<DrDrillStatus />} />
                <Route path="sla-definitions" element={<SlaDefinitionList />} />
                <Route path="roles" element={<RoleList />} />
                <Route path="api-tokens" element={<ApiTokenList />} />
                <Route path="webhooks" element={<WebhookList />} />
                <Route path="audit-logs" element={<AuditLogList />} />
                <Route path="scheduled-tasks" element={<ScheduledTaskList />} />
                <Route path="jobs" element={<JobList />} />
                <Route path="queue-stats" element={<QueueStats />} />
                <Route path="settings" element={<Settings />} />
                <Route path="message-templates" element={<MessageTemplateList />} />
                <Route path="ai-assistant" element={<AIAssistantSettings />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="404" element={<NotFound />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Routes>
        </BrowserRouter>
        </PortalAuthProvider>
      </AuthProvider>
    </QueryClientProvider>
    </DarkModeProvider>
  );
}
