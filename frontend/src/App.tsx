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
import { ContractList } from '@/pages/ContractList';
import { InvoiceList } from '@/pages/InvoiceList';
import { InvoiceDetail } from '@/pages/InvoiceDetail';
import { PaymentList } from '@/pages/PaymentList';
import { TicketList } from '@/pages/TicketList';
import { TicketDetail } from '@/pages/TicketDetail';
import { DeviceMap } from '@/pages/DeviceMap';
import { UserList } from '@/pages/UserList';
import { CfdiList } from '@/pages/CfdiList';
import { InventoryList } from '@/pages/InventoryList';
import { WarehouseList } from '@/pages/WarehouseList';
import { CoverageZoneMap } from '@/pages/CoverageZoneMap';
import { RadiusSessions } from '@/pages/RadiusSessions';
import { SessionAccounting } from '@/pages/SessionAccounting';
import { SnmpMetrics } from '@/pages/SnmpMetrics';
import { SnmpTraps } from '@/pages/SnmpTraps';
import { Reports } from '@/pages/Reports';
import { Settings } from '@/pages/Settings';
import { ProfecoComplaints } from '@/pages/ProfecoComplaints';
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
                <Route path="contracts" element={<ContractList />} />
                <Route path="invoices" element={<InvoiceList />} />
                <Route path="invoices/:id" element={<InvoiceDetail />} />
                <Route path="payments" element={<PaymentList />} />
                <Route path="tickets" element={<TicketList />} />
                <Route path="tickets/:id" element={<TicketDetail />} />
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
              </Route>
            </Route>

            {/* Billing+ — billing or admin */}
            <Route element={<PrivateRoute requiredRole="billing" />}>
              <Route element={<Layout />}>
                <Route path="cfdi" element={<CfdiList />} />
                <Route path="reports" element={<Reports />} />
                <Route path="profeco-complaints" element={<ProfecoComplaints />} />
              </Route>
            </Route>

            {/* Admin-only */}
            <Route element={<PrivateRoute requiredRole="admin" />}>
              <Route element={<Layout />}>
                <Route path="users" element={<UserList />} />
                <Route path="settings" element={<Settings />} />
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
