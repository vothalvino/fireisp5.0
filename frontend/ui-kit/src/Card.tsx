import React from 'react';

/**
 * Surface panel — the primary grouping primitive in FireISP's flat UI.
 * White card background, 1px border, 8px radius. Optional header with a
 * title on the left and arbitrary action nodes (e.g., Buttons) on the right.
 * No drop shadow; border-only elevation.
 */
export interface CardProps {
  /** Optional section title rendered left-aligned in the card header. */
  title?: string;
  /**
   * Optional node rendered right-aligned in the card header.
   * Typically a Button or a small group of icon Buttons.
   */
  actions?: React.ReactNode;
  /** Card body content. */
  children: React.ReactNode;
  /**
   * Whether to apply the standard body padding (var(--sp-5)).
   * Set to false for full-bleed content like Tables.
   * @default true
   */
  padding?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function Card({
  title,
  actions,
  children,
  padding = true,
  style,
  className,
}: CardProps): React.ReactElement {
  const hasHeader = Boolean(title) || Boolean(actions);

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    fontFamily: 'var(--font-sans)',
    ...style,
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--sp-3) var(--sp-5)',
    borderBottom: '1px solid var(--border)',
    gap: 'var(--sp-3)',
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
    flex: 1,
  };

  const actionsStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--sp-2)',
    flexShrink: 0,
  };

  const bodyStyle: React.CSSProperties = {
    padding: padding ? 'var(--sp-5)' : 0,
  };

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
