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
import { NotFound } from '@/pages/NotFound';

// Stub pages for Milestone 2.2 pages — each will be replaced with a real component.
const Placeholder = ({ title }: { title: string }) => (
  <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
    <h1 style={{ marginTop: 0 }}>{title}</h1>
    <p style={{ color: '#888', fontStyle: 'italic' }}>
      This page will be implemented in Milestone 2.2.
    </p>
  </div>
);

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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<Login />} />

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

            {/* Billing+ — billing or admin */}
            <Route element={<PrivateRoute requiredRole="billing" />}>
              <Route element={<Layout />}>
                <Route path="cfdi" element={<CfdiList />} />
                <Route path="reports" element={<Placeholder title="Reports" />} />
              </Route>
            </Route>

            {/* Admin-only */}
            <Route element={<PrivateRoute requiredRole="admin" />}>
              <Route element={<Layout />}>
                <Route path="users" element={<UserList />} />
                <Route path="settings" element={<Placeholder title="Settings" />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="404" element={<NotFound />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
