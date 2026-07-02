// =============================================================================
// FireISP UI — Badge
// =============================================================================
// Faithful TSX port of @fireisp/ui Badge. Pill with a status tone.
// tone: neutral | success | danger | warning | accent
// =============================================================================

import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'danger' | 'warning' | 'accent';

export interface BadgeProps {
  tone?: BadgeTone;
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

const toneStyles: Record<BadgeTone, CSSProperties> = {
  neutral: { background: 'var(--badge-bg)', color: 'var(--badge-fg)' },
  success: { background: 'var(--success-soft)', color: 'var(--success)' },
  danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
  warning: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  accent: { background: 'var(--accent-soft)', color: 'var(--accent)' },
};

const base: CSSProperties = {
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

export function Badge({ tone = 'neutral', children, style, className }: BadgeProps) {
  return (
    <span className={className} style={{ ...base, ...toneStyles[tone], ...style }}>
      {children}
    </span>
  );
}
