// =============================================================================
// FireISP UI — Card
// =============================================================================
// Faithful TSX port of @fireisp/ui Card. Titled surface panel with an optional
// actions slot. Set padding={false} to wrap a full-bleed Table.
// =============================================================================

import type { CSSProperties, ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  padding?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function Card({ title, actions, children, padding = true, style, className }: CardProps) {
  const hasHeader = Boolean(title) || Boolean(actions);
  const cardStyle: CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    fontFamily: 'var(--font-sans)',
    ...style,
  };
  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--sp-3) var(--sp-5)',
    borderBottom: '1px solid var(--border)',
    gap: 'var(--sp-3)',
  };
  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
    flex: 1,
  };
  const actionsStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--sp-2)',
    flexShrink: 0,
  };
  const bodyStyle: CSSProperties = { padding: padding ? 'var(--sp-5)' : 0 };

  return (
    <div style={cardStyle} className={className}>
      {hasHeader && (
        <div style={headerStyle}>
          {title && <h3 style={titleStyle}>{title}</h3>}
          {actions && <div style={actionsStyle}>{actions}</div>}
        </div>
      )}
      <div style={bodyStyle}>{children}</div>
    </div>
  );
}
