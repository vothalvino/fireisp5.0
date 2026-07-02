// =============================================================================
// FireISP UI — Field
// =============================================================================
// Faithful TSX port of @fireisp/ui Field. Labeled input with error/hint/
// required affordances and an accent focus ring.
// =============================================================================

import { useId, useState, type ChangeEvent, type CSSProperties } from 'react';

export interface FieldProps {
  label: string;
  value: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  style?: CSSProperties;
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  hint,
  required = false,
  disabled = false,
  id: idProp,
  style,
}: FieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [focused, setFocused] = useState(false);

  const wrapperStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--sp-1)',
    fontFamily: 'var(--font-sans)',
    ...style,
  };
  const labelStyle: CSSProperties = {
    fontSize: '0.82rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  };
  const requiredStyle: CSSProperties = { color: 'var(--danger)', marginLeft: '2px' };
  const inputBorderColor = error ? 'var(--danger)' : focused ? 'var(--accent)' : 'var(--input-border)';
  const inputStyle: CSSProperties = {
    width: '100%',
    padding: 'var(--sp-2) var(--sp-3)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
    color: 'var(--text-primary)',
    background: disabled ? 'var(--bg-subtle)' : 'var(--input-bg)',
    border: `1px solid ${inputBorderColor}`,
    borderRadius: 'var(--radius-md)',
    outline: 'none',
    boxShadow: focused ? '0 0 0 3px var(--focus-ring)' : 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    cursor: disabled ? 'not-allowed' : 'text',
    opacity: disabled ? 0.7 : 1,
    boxSizing: 'border-box',
  };
  const errorStyle: CSSProperties = { fontSize: '0.78rem', color: 'var(--danger)', lineHeight: 1.4 };
  const hintStyle: CSSProperties = { fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 };

  return (
    <div style={wrapperStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
        {required && <span style={requiredStyle} aria-hidden="true">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        style={inputStyle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
      {error && <span id={`${id}-error`} role="alert" style={errorStyle}>{error}</span>}
      {!error && hint && <span id={`${id}-hint`} style={hintStyle}>{hint}</span>}
    </div>
  );
}
