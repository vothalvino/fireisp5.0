// =============================================================================
// FireISP 5.0 — Dashboard (role router)
// =============================================================================
// Technicians get the field/NOC dashboard built from endpoints their role can
// load; everyone else lands on the Operations Console — the dense operations
// overview (KPIs, throughput, live events, sites, devices). The former
// AdminDashboard was replaced by OperationsConsole (kept in git history).
// =============================================================================

import { useAuth } from '@/auth/AuthContext';
import { TechnicianDashboard } from '@/pages/TechnicianDashboard';
import { OperationsConsole } from '@/pages/OperationsConsole';

export function Dashboard() {
  const { user } = useAuth();
  if (user?.role === 'technician') return <TechnicianDashboard />;
  return <OperationsConsole />;
}
