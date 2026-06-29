import React, { useState } from 'react';

/**
 * Primary interactive control. Covers the four FireISP action tones:
 * primary (accent fill), secondary (bordered), ghost (text-only), and
 * danger (destructive red). Border-based, no drop shadows.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual tone of the button. @default 'primary' */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Size preset. @default 'md' */
  size?: 'sm' | 'md';
  children: React.ReactNode;
}

const base: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-2)',
  fontFamily: 'var(--font-sans)',
  fontWeight: 600,
  lineHeight: 1,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'background-color 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s',
  userSelect: 'none',
};

const sizes: Record<NonNullable<ButtonProps['size']>, React.CSSProperties> = {
  sm: { padding: '4px 10px', fontSize: '0.78rem' },
  md: { padding: 'var(--sp-2) var(--sp-4)', fontSize: '0.85rem' },
};

type VariantStyle = { normal: React.CSSProperties; hover: React.CSSProperties };

const variants: Record<NonNullable<ButtonProps['variant']>, VariantStyle> = {
  primary: {
    normal: {
      background: 'var(--accent)',
      color: 'var(--accent-fg)',
      borderColor: 'var(--accent)',
    },
    hover: {
      background: 'var(--accent-hover)',
      color: 'var(--accent-fg)',
      borderColor: 'var(--accent-hover)',
    },
  },
  secondary: {
    normal: {
      background: 'var(--bg-card)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--border-strong)',
    },
    hover: {
      background: 'var(--bg-subtle)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--border-strong)',
    },
  },
  ghost: {
    normal: {
      background: 'transparent',
      color: 'var(--text-secondary)',
      borderColor: 'transparent',
    },
    hover: {
      background: 'var(--bg-subtle)',
      color: 'var(--text-secondary)',
      borderColor: 'transparent',
    },
  },
  danger: {
    normal: {
      background: 'var(--danger)',
      color: '#ffffff',
      borderColor: 'var(--danger)',
    },
    hover: {
      background: 'var(--danger)',
      color: '#ffffff',
      borderColor: 'var(--danger)',
      filter: 'brightness(0.88)',
    },
  },
};

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  disabled,
  style,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: ButtonProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);

  const variantStyle = hovered && !disabled
    ? variants[variant].hover
    : variants[variant].normal;

  const composed: React.CSSProperties = {
    ...base,
    ...sizes[size],
    ...variantStyle,
    ...(disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
    ...style,
  };

  return (
    <button
      disabled={disabled}
      style={composed}
      onMouseEnter={(e) => { setHovered(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHovered(false); onMouseLeave?.(e); }}
      {...rest}
    >
      {children}
    </button>
  );
}
