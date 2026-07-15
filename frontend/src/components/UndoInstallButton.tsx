// =============================================================================
// FireISP 5.0 — Undo Install button (Inventory follow-up, migration 392)
// =============================================================================
// A small action + confirm-with-notes modal for reversing a mistaken install
// on a still-live contract. Shared by every place an assigned/active unit
// renders (ServiceOrderList.tsx's Equipment modal, ClientDetail.tsx's
// Assigned Equipment section) so the confirm/notes/error/warnings UX and the
// undo semantics stay in exactly one place.
// =============================================================================

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { uninstallCpeDevice } from '@/api/cpeInventory';
import {
  overlay, modalBox, errorBox, labelStyle, inputStyle, submitBtn, cancelBtn, dangerBtn,
} from '@/components/ClientFormModal';

export interface UndoInstallButtonProps {
  deviceId: number;
  serialNumber: string;
  /** Product name, when known — shown in the confirmation for clarity. */
  itemName?: string | null;
  /** Only 'assigned'/'active' units have anything to undo. */
  lifecycleState: string;
  /** Called after a successful undo so the caller can refetch its lists. */
  onDone: () => void;
}

export function UndoInstallButton({ deviceId, serialNumber, itemName, lifecycleState, onDone }: UndoInstallButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [warnings, setWarnings] = useState<string[] | null>(null);

  const mutation = useMutation({
    mutationFn: () => uninstallCpeDevice(deviceId, notes.trim() || undefined),
    onSuccess: (result) => {
      if (result.warnings.length > 0) {
        // Keep the modal open showing the warning(s) instead of auto-closing —
        // e.g. "this sale invoice must be voided manually" needs to be seen,
        // not silently dismissed with the rest of the modal.
        setWarnings(result.warnings);
      } else {
        setOpen(false);
      }
      onDone();
    },
  });

  if (!['assigned', 'active'].includes(lifecycleState)) return null;

  function close() {
    setOpen(false);
    setNotes('');
    setWarnings(null);
    mutation.reset();
  }

  return (
    <>
      <button
        type="button"
        style={{ background: 'none', border: 'none', color: 'var(--danger, #dc2626)', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline', padding: 0 }}
        onClick={() => setOpen(true)}
      >
        {t('undoInstall.action')}
      </button>

      {open && (
        <div style={overlay} role="dialog" aria-modal="true" aria-label={t('undoInstall.title')}>
          <div style={modalBox}>
            <h3 style={{ margin: '0 0 0.75rem' }}>{t('undoInstall.title')}</h3>

            {warnings ? (
              <>
                <div style={{ ...errorBox, background: '#fef3c7', color: '#92400e', borderColor: '#fbbf24' }}>
                  {warnings.map((w, i) => <p key={i} style={{ margin: i === 0 ? 0 : '4px 0 0' }}>{w}</p>)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button type="button" style={submitBtn} onClick={close}>{t('undoInstall.close')}</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
                  {t('undoInstall.confirm', { item: itemName || t('undoInstall.unknownItem'), serial: serialNumber })}
                </p>
                {mutation.isError && (
                  <div style={errorBox}>{(mutation.error as Error).message}</div>
                )}
                <label style={labelStyle} htmlFor="undo-install-notes">{t('undoInstall.notes')}</label>
                <textarea
                  id="undo-install-notes"
                  style={{ ...inputStyle, minHeight: 60 }}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={t('undoInstall.notesPlaceholder')}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button type="button" style={cancelBtn} onClick={close} disabled={mutation.isPending}>
                    {t('undoInstall.cancel')}
                  </button>
                  <button type="button" style={dangerBtn} onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                    {mutation.isPending ? t('undoInstall.undoing') : t('undoInstall.confirmButton')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
