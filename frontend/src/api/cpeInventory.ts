// =============================================================================
// FireISP 5.0 — CPE undo-install (Inventory follow-up, migration 392)
// =============================================================================
// Shared by every place an assigned/active unit renders an "Undo install"
// action (see components/UndoInstallButton.tsx) — ServiceOrderList.tsx's
// Equipment modal and ClientDetail.tsx's Assigned Equipment section.
// =============================================================================

import { api } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';

export interface UninstallResponse {
  data: { id: number; lifecycle_state: string; [key: string]: unknown };
  warnings: string[];
}

export async function uninstallCpeDevice(id: number, notes?: string): Promise<UninstallResponse> {
  const res = await api.POST('/cpe-management/devices/{id}/uninstall' as never, {
    params: { path: { id } } as never,
    body: (notes ? { notes } : {}) as never,
  } as never);
  // Surface the backend's real message (e.g. "resolve the payment before
  // undoing this install") instead of a generic failure string.
  if ((res as { error?: unknown }).error) {
    throw new Error(extractApiError((res as { error?: unknown }).error, 'Failed to undo install'));
  }
  return ((res as { data?: UninstallResponse }).data) ?? { data: { id, lifecycle_state: 'in_stock' }, warnings: [] };
}
