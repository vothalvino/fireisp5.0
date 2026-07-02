// =============================================================================
// FireISP UI — Modal
// =============================================================================
// Faithful TSX port of @fireisp/ui Modal. Centered dialog over a dimmed
// overlay; ESC and backdrop-click close it. open/title/onClose/footer.
// =============================================================================

import { useCallback, useEffect, type CSSProperties, type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  inline?: boolean;
  style?: CSSProperties;
}

export function Modal({ open, title, onClose, children, footer, inline = false, style }: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const overlayStyle: CSSProperties = inline
    ? { position: 'relative', display: 'flex', justifyContent: 'center', padding: 'var(--sp-4)' }
    : {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.48)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--sp-4)',
      };
  const cardStyle: CSSProperties = {
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
  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--sp-4) var(--sp-5)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  };
  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: '0.9375rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
  };
  const closeStyle: CSSProperties = {
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
  const bodyStyle: CSSProperties = {
    padding: 'var(--sp-5)',
    overflowY: 'auto',
    flex: 1,
    color: 'var(--text-secondary)',
    fontSize: '0.875rem',
    lineHeight: 1.6,
  };
  const footerStyle: CSSProperties = {
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
          <h2 id="fireisp-modal-title" style={titleStyle}>{title}</h2>
          <button style={closeStyle} onClick={onClose} aria-label="Close" type="button">✕</button>
        </div>
        <div style={bodyStyle}>{children}</div>
        {footer && <div style={footerStyle}>{footer}</div>}
      </div>
    </div>
  );
}
