import React from 'react';

/**
 * Compact status pill for displaying operational states (active, suspended,
 * warning, etc.). Uppercase-ish text, fully rounded, no shadow — tokens only.
 */
export interface BadgeProps {
  /**
   * Colour tone matching a semantic status.
   * @default 'neutral'
   */
  tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'accent';
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

const toneStyles: Record<NonNullable<BadgeProps['tone']>, React.CSSProperties> = {
  neutral: {
    background: 'var(--badge-bg)',
    color: 'var(--badge-fg)',
  },
  success: {
    background: 'var(--success-soft)',
    color: 'var(--success)',
  },
  danger: {
    background: 'var(--danger-soft)',
    color: 'var(--danger)',
  },
  warning: {
    background: 'var(--warning-soft)',
    color: 'var(--warning)',
  },
  accent: {
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
  },
};

const base: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '9999px',
  fontSize: '0.72rem',
  fontFamily: 'var(--font-sans)',
  fontWeight: 600,
  letterSpacing: '0.02em',
  lineHeight: 1.6,
  whiteSpace: 'nowrap',
};

export function Badge({
  tone = 'neutral',
  children,
  style,
  className,
}: BadgeProps): React.ReactElement {
  return (
    <span
      className={className}
      style={{ ...base, ...toneStyles[tone], ...style }}
    >
      {children}
    </span>
  );
}
