import React, { useEffect, useCallback } from 'react';

/**
 * Focused dialog overlay for confirmations, create/edit flows, and alerts.
 * Returns null when closed. Uses a dimmed fixed overlay + centered card
 * with a title bar (title + close button) and optional footer action row.
 * No animations; border-based; no shadow.
 */
export interface ModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** Title rendered in the modal header. */
  title: string;
  /** Called when the user clicks the overlay or the close button. */
  onClose: () => void;
  /** Modal body content. */
  children: React.ReactNode;
  /**
   * Optional footer node rendered right-aligned below the body.
   * Typically a row of Button components (Cancel + primary action).
   */
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  style,
}: ModalProps): React.ReactElement | null {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.48)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--sp-4)',
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    minWidth: '420px',
    maxWidth: '90vw',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'var(--font-sans)',
    ...style,
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--sp-4) var(--sp-5)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '0.9375rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
  };

  const closeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    fontSize: '1.15rem',
    lineHeight: 1,
    padding: 'var(--sp-1)',
    borderRadius: 'var(--radius-sm)',
    flexShrink: 0,
    marginLeft: 'var(--sp-3)',
  };

  const bodyStyle: React.CSSProperties = {
    padding: 'var(--sp-5)',
    overflowY: 'auto',
    flex: 1,
    color: 'var(--text-secondary)',
    fontSize: '0.875rem',
    lineHeight: 1.6,
  };

  const footerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 'var(--sp-2)',
    padding: 'var(--sp-3) var(--sp-5)',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  };

  return (
    <div
      style={overlayStyle}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fireisp-modal-title"
    >
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h2 id="fireisp-modal-title" style={titleStyle}>
            {title}
          </h2>
          <button
            style={closeStyle}
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            &#x2715;
          </button>
        </div>
        <div style={bodyStyle}>{children}</div>
        {footer && <div style={footerStyle}>{footer}</div>}
      </div>
    </div>
  );
}
